import {
  GameState, Cluster, Room, Position, TileType,
  CorruptionStage, CLUSTER_WIDTH, CLUSTER_HEIGHT, COLORS,
  HazardOverlayType,
} from './types';
import { addMessage } from './game';
import { random, randInt } from './rng';

function roomInterior(room: Room): { x1: number; y1: number; x2: number; y2: number } {
  return { x1: room.x + 1, y1: room.y + 1, x2: room.x + room.w - 2, y2: room.y + room.h - 2 };
}

function posInRoom(pos: Position, room: Room): boolean {
  const { x1, y1, x2, y2 } = roomInterior(room);
  return pos.x >= x1 && pos.x <= x2 && pos.y >= y1 && pos.y <= y2;
}

function playerRoom(state: GameState, cluster: Cluster): Room | undefined {
  return cluster.rooms.find(r => posInRoom(state.player.position, r));
}

/** Mark a room as containing a hazard overlay type (for tiles that spread across room boundaries) */
function markTileHazardInRoom(cluster: Cluster, x: number, y: number, type: HazardOverlayType) {
  const roomId = cluster.tiles[y]?.[x]?.roomId;
  if (roomId == null || roomId < 0) return;
  const room = cluster.rooms.find(r => r.id === roomId);
  if (room) room.containedHazards.add(type);
}

/** BFS distance between two rooms via adjacency graph. Returns -1 if unreachable. */
function roomDistance(adj: Map<number, number[]>, fromId: number, toId: number): number {
  if (fromId === toId) return 0;
  const visited = new Set<number>([fromId]);
  const queue: { id: number; dist: number }[] = [{ id: fromId, dist: 0 }];
  while (queue.length > 0) {
    const { id, dist } = queue.shift()!;
    for (const neighbor of (adj.get(id) ?? [])) {
      if (neighbor === toId) return dist + 1;
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ id: neighbor, dist: dist + 1 });
      }
    }
  }
  return -1;
}

function damageCoherence(state: GameState, amount: number) {
  if (state.godMode) return;
  if (state.player.coherence == null) return;
  state.player.coherence = Math.max(0, state.player.coherence - amount);
}

/** Convert a wall or door tile to floor (breach) */
function breachTile(cluster: Cluster, x: number, y: number) {
  const tile = cluster.tiles[y]?.[x];
  if (!tile) return;
  tile.type = TileType.Floor;
  tile.glyph = '·';
  tile.fg = COLORS.floorFg;
  tile.walkable = true;
  tile.transparent = true;
}

function tileIntegrity(cluster: Cluster, x: number, y: number): number {
  const tile = cluster.tiles[y]?.[x];
  if (!tile) return 99;
  if (tile.integrity != null) return tile.integrity;
  if (tile.type === TileType.Wall) return 6;
  if (tile.type === TileType.Door) return 3;
  return 99;
}

// ── Corruption ──

const CORRUPTION_STAGES: CorruptionStage[] = ['degrading', 'corrupted', 'collapsed'];

function nextCorruptionStage(stage: CorruptionStage): CorruptionStage | null {
  const idx = CORRUPTION_STAGES.indexOf(stage);
  return idx < CORRUPTION_STAGES.length - 1 ? CORRUPTION_STAGES[idx + 1] : null;
}

function corruptionOverlayStage(stage: CorruptionStage): number {
  return CORRUPTION_STAGES.indexOf(stage);
}

function updateCorruption(state: GameState, cluster: Cluster, room: Room) {
  const hz = room.hazardState!;
  if (!hz.corruptionTiles) return;

  const spreadInterval = randInt(8, 12);
  if (state.tick - (hz.lastSpreadTick ?? 0) < spreadInterval) return;
  hz.lastSpreadTick = state.tick;

  const newEntries: [string, CorruptionStage][] = [];

  for (const [key, stage] of hz.corruptionTiles.entries()) {
    // Progress existing tiles
    const next = nextCorruptionStage(stage);
    if (next) {
      hz.corruptionTiles.set(key, next);
      const [cx, cy] = key.split(',').map(Number);
      cluster.tiles[cy][cx].hazardOverlay = {
        type: 'corruption',
        stage: corruptionOverlayStage(next),
      };
      if (next === 'collapsed') {
        cluster.tiles[cy][cx].walkable = false;
      }
    }

    // Spread to adjacent tile (floor, wall, or door)
    const [cx, cy] = key.split(',').map(Number);
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const shuffled = dirs.sort(() => random() - 0.5);
    for (const [dx, dy] of shuffled) {
      const nx = cx + dx;
      const ny = cy + dy;
      const nkey = `${nx},${ny}`;
      if (nx < 0 || nx >= CLUSTER_WIDTH || ny < 0 || ny >= CLUSTER_HEIGHT) continue;
      if (hz.corruptionTiles.has(nkey)) continue;

      const target = cluster.tiles[ny][nx];
      if (target.type === TileType.Floor) {
        newEntries.push([nkey, 'degrading']);
        break;
      } else if (target.type === TileType.Wall || target.type === TileType.Door) {
        // Probabilistic degradation: walls resist more than doors
        const degradeChance = target.type === TileType.Wall ? 0.25 : 0.50;
        // Always show corruption overlay (visual cracking)
        target.hazardOverlay = { type: 'corruption', stage: 0 };
        markTileHazardInRoom(cluster, nx, ny, 'corruption');

        if (random() < degradeChance) {
          const integrity = tileIntegrity(cluster, nx, ny);
          const newIntegrity = integrity - 1;
          if (newIntegrity <= 0) {
            // Breach the tile — convert to corrupted floor
            breachTile(cluster, nx, ny);
            newEntries.push([nkey, 'degrading']);
          } else {
            target.integrity = newIntegrity;
          }
        }
        break;
      }
    }
  }

  for (const [key, stage] of newEntries) {
    hz.corruptionTiles.set(key, stage);
    const [cx, cy] = key.split(',').map(Number);
    cluster.tiles[cy][cx].hazardOverlay = {
      type: 'corruption',
      stage: corruptionOverlayStage(stage),
    };
    markTileHazardInRoom(cluster, cx, cy, 'corruption');
  }

  // Sound propagation
  if (newEntries.length > 0) {
    const pRoom = playerRoom(state, cluster);
    if (pRoom) {
      const dist = roomDistance(cluster.roomAdjacency, pRoom.id, room.id);
      if (dist === 0) {
        addMessage(state, 'Data structures crack and fragment around you.', 'important');
      } else if (dist === 1) {
        addMessage(state, 'You hear cracking through the walls.', 'normal');
      } else if (dist === 2) {
        addMessage(state, 'A faint crackling echoes from somewhere.', 'normal');
      }
    }
  }

  if (state.debugMode) {
    addMessage(state, `[DBG] Corruption room ${room.id}: ${hz.corruptionTiles.size} tiles, +${newEntries.length} new`, 'debug');
  }
}

// ── Trigger Trap ──

function updateTriggerTrap(state: GameState, cluster: Cluster, room: Room) {
  const hz = room.hazardState!;
  if (hz.detonated || !hz.activated) return;

  hz.ticksRemaining = (hz.ticksRemaining ?? 0) - 1;

  // Sound at 5 ticks remaining
  if (hz.ticksRemaining === 5) {
    const pRoom = playerRoom(state, cluster);
    if (pRoom) {
      const dist = roomDistance(cluster.roomAdjacency, pRoom.id, room.id);
      if (dist <= 1) {
        addMessage(state, `Rapid ticking from ${dist === 0 ? 'this room' : 'nearby'}!`, 'hazard');
      }
    }
  }

  // Detonation
  if (hz.ticksRemaining! <= 0) {
    hz.detonated = true;
    const { x1, y1, x2, y2 } = roomInterior(room);

    // Scorch all floor tiles
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        if (cluster.tiles[y][x].type === TileType.Floor) {
          cluster.tiles[y][x].hazardOverlay = { type: 'scorch' };
        }
      }
    }

    // Break all doors on room perimeter
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (x < 0 || x >= CLUSTER_WIDTH || y < 0 || y >= CLUSTER_HEIGHT) continue;
        if (cluster.tiles[y][x].type === TileType.Door) {
          breachTile(cluster, x, y);
          cluster.tiles[y][x].hazardOverlay = { type: 'scorch' };
          markTileHazardInRoom(cluster, x, y, 'scorch');
        }
      }
    }

    // Damage: player in room = 40-60, adjacent = 15-25
    const pRoom = playerRoom(state, cluster);
    if (pRoom) {
      const dist = roomDistance(cluster.roomAdjacency, pRoom.id, room.id);
      if (dist === 0) {
        addMessage(state, 'DETONATION! The data-bomb tears through the room!', 'hazard');
        damageCoherence(state, randInt(40, 60));
      } else if (dist === 1) {
        addMessage(state, 'An explosion shakes the walls!', 'hazard');
        damageCoherence(state, randInt(15, 25));
      } else if (dist <= 3) {
        addMessage(state, 'A distant explosion rumbles through the structure.', 'normal');
      }
    }
  }

  if (state.debugMode) {
    addMessage(state, `[DBG] Trap room ${room.id}: ${hz.detonated ? 'DETONATED' : `ticks=${hz.ticksRemaining}`}`, 'debug');
  }
}

function onPlayerEnterTriggerTrap(_state: GameState, room: Room) {
  const hz = room.hazardState!;
  if (hz.activated || hz.detonated) return;
  hz.activated = true;
}

// ── Memory Leak ──

function updateMemoryLeak(state: GameState, cluster: Cluster, room: Room) {
  const hz = room.hazardState!;
  const floodLevel = hz.floodLevel ?? 0;
  const innerH = room.h - 2;
  const maxFlood = Math.max(0, innerH - 4);

  // Rise every 6 ticks
  if (state.tick % 6 === 0 && floodLevel < maxFlood) {
    hz.floodLevel = floodLevel + 1;

    const { x1, y1, x2, y2 } = roomInterior(room);
    for (let row = 0; row < hz.floodLevel; row++) {
      const fy = y2 - row;
      if (fy < y1) break;
      for (let x = x1; x <= x2; x++) {
        if (cluster.tiles[fy][x].type === TileType.Floor) {
          cluster.tiles[fy][x].hazardOverlay = {
            type: 'flood',
            stage: row >= 2 ? 1 : 0,
          };
        }
      }
    }

    const pRoom = playerRoom(state, cluster);
    if (pRoom) {
      const dist = roomDistance(cluster.roomAdjacency, pRoom.id, room.id);
      if (dist === 0) {
        addMessage(state, 'Data floods rise around your feet.', 'hazard');
      } else if (dist === 1 && hz.floodLevel === 1) {
        addMessage(state, 'You hear liquid data gurgling through the walls.', 'normal');
      }
    }
  }

  // Flood pressure on doors — 30% chance per tick to breach
  if ((hz.floodLevel ?? 0) > 0) {
    const { x1, y1, x2, y2 } = roomInterior(room);

    // Check door tiles on room boundary
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (x < 0 || x >= CLUSTER_WIDTH || y < 0 || y >= CLUSTER_HEIGHT) continue;
        if (cluster.tiles[y][x].type !== TileType.Door) continue;

        // Is this door adjacent to a flooded tile?
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const adjacentToFlood = dirs.some(([dx, dy]) => {
          const ax = x + dx, ay = y + dy;
          return ax >= x1 && ax <= x2 && ay >= y1 && ay <= y2 &&
            cluster.tiles[ay]?.[ax]?.hazardOverlay?.type === 'flood';
        });

        if (adjacentToFlood && random() < 0.30) {
          breachTile(cluster, x, y);
          cluster.tiles[y][x].hazardOverlay = { type: 'flood', stage: 0 };
          markTileHazardInRoom(cluster, x, y, 'flood');
          addMessage(state, 'A door bursts open under flood pressure!', 'hazard');
        }
      }
    }
  }

  if (state.debugMode) {
    addMessage(state, `[DBG] Leak room ${room.id}: flood=${hz.floodLevel ?? 0}/${maxFlood}`, 'debug');
  }
}

// ── Firewall Checkpoint ──

function updateFirewall(state: GameState, cluster: Cluster, room: Room) {
  const hz = room.hazardState!;
  if (!hz.beams) return;

  if (state.tick % 2 !== 0) return;

  const { x1, y1, x2, y2 } = roomInterior(room);

  // Clear old beam overlays
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      if (cluster.tiles[y][x].hazardOverlay?.type === 'beam') {
        cluster.tiles[y][x].hazardOverlay = undefined;
      }
    }
  }

  for (const beam of hz.beams) {
    beam.position += beam.direction;
    if (beam.position >= beam.max) { beam.position = beam.max; beam.direction = -1 as const; }
    if (beam.position <= beam.min) { beam.position = beam.min; beam.direction = 1 as const; }

    if (beam.axis === 'horizontal') {
      for (let x = x1; x <= x2; x++) {
        if (cluster.tiles[beam.position]?.[x]?.type === TileType.Floor) {
          cluster.tiles[beam.position][x].hazardOverlay = { type: 'beam' };
        }
      }
      if (!state.invisibleMode && state.player.position.y === beam.position && posInRoom(state.player.position, room)) {
        if (!hz.alarmTriggered) {
          hz.alarmTriggered = true;
          addMessage(state, 'SCAN DETECTED! Firewall alarm triggered!', 'hazard');
        }
      }
    } else {
      for (let y = y1; y <= y2; y++) {
        if (cluster.tiles[y]?.[beam.position]?.type === TileType.Floor) {
          cluster.tiles[y][beam.position].hazardOverlay = { type: 'beam' };
        }
      }
      if (!state.invisibleMode && state.player.position.x === beam.position && posInRoom(state.player.position, room)) {
        if (!hz.alarmTriggered) {
          hz.alarmTriggered = true;
          addMessage(state, 'SCAN DETECTED! Firewall alarm triggered!', 'hazard');
        }
      }
    }
  }
}

// ── Unstable Process ──

function updateUnstable(state: GameState, cluster: Cluster, room: Room) {
  const hz = room.hazardState!;
  if (hz.coreDestroyed) return;

  const { x1, y1, x2, y2 } = roomInterior(room);

  // Clear previous sparks
  if (hz.sparkedTiles) {
    for (const sp of hz.sparkedTiles) {
      if (cluster.tiles[sp.y][sp.x].hazardOverlay?.type === 'spark') {
        cluster.tiles[sp.y][sp.x].hazardOverlay = undefined;
      }
    }
  }

  const sparkCount = randInt(1, 3);
  const sparks: Position[] = [];
  for (let i = 0; i < sparkCount; i++) {
    const sx = randInt(x1, x2);
    const sy = randInt(y1, y2);
    if (hz.corePos && sx === hz.corePos.x && sy === hz.corePos.y) continue;
    if (cluster.tiles[sy][sx].type !== TileType.Floor) continue;
    sparks.push({ x: sx, y: sy });
    cluster.tiles[sy][sx].hazardOverlay = { type: 'spark' };
  }
  hz.sparkedTiles = sparks;

  const pp = state.player.position;
  if (!state.invisibleMode && sparks.some(s => s.x === pp.x && s.y === pp.y)) {
    addMessage(state, 'Electric discharge surges through you!', 'hazard');
    damageCoherence(state, randInt(5, 10));
  }
}

// ── Trigger Trap visual pulsing ──

function updateTriggerTrapVisuals(cluster: Cluster, room: Room, tick: number) {
  const hz = room.hazardState!;
  if (!hz.activated || hz.detonated) return;

  const remaining = hz.ticksRemaining ?? 0;
  const { x1, y1, x2, y2 } = roomInterior(room);

  let pulseRate: number;
  if (remaining > 10) pulseRate = 8;
  else if (remaining > 5) pulseRate = 4;
  else pulseRate = 2;

  const pulseOn = (tick % pulseRate) < (pulseRate / 2);

  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      if (cluster.tiles[y][x].type === TileType.Floor && !cluster.tiles[y][x].hazardOverlay) {
        if (pulseOn) {
          cluster.tiles[y][x].hazardOverlay = { type: 'scorch', stage: remaining <= 5 ? 2 : 1 };
        }
      }
    }
  }

  if (!pulseOn) {
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        if (cluster.tiles[y][x].hazardOverlay?.type === 'scorch' &&
            (cluster.tiles[y][x].hazardOverlay?.stage === 1 || cluster.tiles[y][x].hazardOverlay?.stage === 2)) {
          cluster.tiles[y][x].hazardOverlay = undefined;
        }
      }
    }
  }
}

// ── Gravity Well ──

function updateGravityWell(state: GameState, cluster: Cluster, room: Room) {
  const hz = room.hazardState!;
  if (!hz.singularityPos) return;

  const interval = hz.pullInterval ?? 3;
  if (state.tick - (hz.lastPullTick ?? 0) < interval) return;
  hz.lastPullTick = state.tick;

  // Pull player if in room (invisible mode: player doesn't exist on map)
  if (!state.invisibleMode && posInRoom(state.player.position, room)) {
    const pp = state.player.position;
    const sp = hz.singularityPos;

    // Calculate pull direction (1 tile toward singularity)
    let dx = 0, dy = 0;
    if (pp.x < sp.x) dx = 1;
    else if (pp.x > sp.x) dx = -1;
    if (pp.y < sp.y) dy = 1;
    else if (pp.y > sp.y) dy = -1;

    // Only pull one axis at a time (prefer the longer distance)
    if (Math.abs(pp.x - sp.x) >= Math.abs(pp.y - sp.y)) {
      dy = 0;
    } else {
      dx = 0;
    }

    if (dx !== 0 || dy !== 0) {
      const nx = pp.x + dx;
      const ny = pp.y + dy;
      if (cluster.tiles[ny]?.[nx]?.walkable) {
        state.player.position.x = nx;
        state.player.position.y = ny;
        addMessage(state, 'The gravity well pulls you inward!', 'hazard');
      }
    }

    // Damage on singularity
    if (pp.x === sp.x && pp.y === sp.y) {
      addMessage(state, 'The singularity tears at your coherence!', 'hazard');
      damageCoherence(state, randInt(8, 15));
    }
  }
}

// ── Main update ──

export function updateHazards(state: GameState) {
  const cluster = state.clusters.get(state.currentClusterId);
  if (!cluster) return;

  for (const room of cluster.rooms) {
    if (room.roomType === 'normal' || !room.hazardState) continue;

    switch (room.roomType) {
      case 'corrupted':
        updateCorruption(state, cluster, room);
        break;
      case 'trigger_trap':
        updateTriggerTrap(state, cluster, room);
        updateTriggerTrapVisuals(cluster, room, state.tick);
        break;
      case 'memory_leak':
        updateMemoryLeak(state, cluster, room);
        break;
      case 'firewall':
        updateFirewall(state, cluster, room);
        break;
      case 'unstable':
        updateUnstable(state, cluster, room);
        break;
      case 'gravity_well':
        updateGravityWell(state, cluster, room);
        break;
    }
  }
}

/** Called when player moves to a new room */
export function onPlayerEnterRoom(state: GameState, room: Room) {
  if (state.invisibleMode) return; // player doesn't trigger room events
  switch (room.roomType) {
    case 'trigger_trap':
      onPlayerEnterTriggerTrap(state, room);
      break;
    case 'echo_chamber':
      addMessage(state, 'Residual process echoes shimmer around you...', 'system');
      break;
    case 'gravity_well':
      addMessage(state, 'You feel a gravitational pull toward the center...', 'hazard');
      break;
  }
}

/** Check which room player is in and return it */
export function getPlayerRoom(state: GameState): Room | undefined {
  const cluster = state.clusters.get(state.currentClusterId);
  if (!cluster) return undefined;
  return playerRoom(state, cluster);
}

/** Apply per-tile hazard damage for standing on hazard tiles */
export function applyTileHazardToPlayer(state: GameState) {
  if (state.invisibleMode) return; // player doesn't exist on the map
  const cluster = state.clusters.get(state.currentClusterId);
  if (!cluster) return;

  const { x, y } = state.player.position;
  const overlay = cluster.tiles[y]?.[x]?.hazardOverlay;
  if (!overlay) return;

  switch (overlay.type) {
    case 'corruption':
      if (overlay.stage === 0) {
        damageCoherence(state, 1);
      } else if (overlay.stage === 1) {
        damageCoherence(state, 3);
      }
      break;
    case 'flood':
      if (overlay.stage === 0) {
        damageCoherence(state, 1);
      } else {
        damageCoherence(state, 2);
      }
      break;
    case 'gravity':
      if (overlay.stage === 2) {
        damageCoherence(state, 5);
      }
      break;
    // spark and collapse damage handled in their update functions
  }
}

// ── Alert flood-fill ──

const ALERT_FILL_BUDGET = 15;
const ALERT_THROTTLE_TICKS = 10;

/** Get traversal cost for a tile. Returns Infinity for impassable. */
function tileWeight(tile: { type: TileType; doorOpen?: boolean }): number {
  switch (tile.type) {
    case TileType.Void: return Infinity;
    case TileType.Wall: return 10;
    case TileType.Door: return tile.doorOpen ? 2 : 5;
    case TileType.Floor:
    case TileType.InterfaceExit:
      return 1;
    default: return 1;
  }
}

/** Describe a threat tile for alert messages */
function describeTileThreat(tile: { hazardOverlay?: { type: string } }, room: Room | undefined): string {
  const parts: string[] = [];
  if (tile.hazardOverlay) parts.push(tile.hazardOverlay.type);
  if (room && room.roomType !== 'normal' && room.roomType !== 'echo_chamber') {
    if (!parts.includes(room.roomType)) parts.push(room.roomType);
  }
  return parts.join(', ') || 'unknown';
}

/** Check if a room has an active native hazard */
function isRoomDangerous(room: Room): boolean {
  if (room.containedHazards.size > 0) return true;
  if (room.roomType === 'normal' || room.roomType === 'echo_chamber') return false;
  const hz = room.hazardState;
  if (!hz) return false;
  switch (room.roomType) {
    case 'trigger_trap': return !hz.detonated;
    case 'corrupted': return !!(hz.corruptionTiles && hz.corruptionTiles.size > 0);
    case 'memory_leak': return (hz.floodLevel ?? 0) > 0;
    case 'firewall': return !!hz.beams;
    case 'unstable': return !hz.coreDestroyed;
    case 'gravity_well': return true;
    case 'quarantine': return !!hz.locked;
    default: return false;
  }
}

/** Dijkstra flood-fill from player position with weighted tile costs */
function alertFloodFill(
  cluster: Cluster,
  origin: Position,
  budget: number,
): { filled: Map<string, number>; threats: { x: number; y: number; desc: string }[] } {
  const filled = new Map<string, number>();
  const threats: { x: number; y: number; desc: string }[] = [];
  const key = (x: number, y: number) => `${x},${y}`;

  // Simple priority queue via sorted array (map is small: 50x30)
  const open: { x: number; y: number; cost: number }[] = [];
  const push = (x: number, y: number, cost: number) => {
    // Binary insert by cost
    let lo = 0, hi = open.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (open[mid].cost < cost) lo = mid + 1; else hi = mid;
    }
    open.splice(lo, 0, { x, y, cost });
  };

  // Start at player position with cost 0
  const k0 = key(origin.x, origin.y);
  filled.set(k0, 0);
  push(origin.x, origin.y, 0);

  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  while (open.length > 0) {
    const { x, y, cost } = open.shift()!;
    const k = key(x, y);

    // Skip if we already found a cheaper path
    if ((filled.get(k) ?? Infinity) < cost) continue;

    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= cluster.width || ny < 0 || ny >= cluster.height) continue;

      const tile = cluster.tiles[ny][nx];
      const w = tileWeight(tile);
      if (w === Infinity) continue;

      const newCost = cost + w;
      if (newCost > budget) continue;

      const nk = key(nx, ny);
      const existing = filled.get(nk);
      if (existing !== undefined && existing <= newCost) continue;

      filled.set(nk, newCost);
      push(nx, ny, newCost);
    }
  }

  // Scan filled tiles for threats
  const seenThreats = new Set<string>(); // dedupe by description
  for (const [k, _cost] of filled) {
    const [xs, ys] = k.split(',');
    const x = Number(xs), y = Number(ys);
    if (x === origin.x && y === origin.y) continue; // skip player tile

    const tile = cluster.tiles[y][x];
    const rid = tile.roomId;
    const room = rid >= 0 ? cluster.rooms.find(r => r.id === rid) : undefined;

    let isThreat = false;

    // Check tile hazard overlay
    if (tile.hazardOverlay) {
      isThreat = true;
    }

    // Check if tile is in a dangerous room (only flag once per room)
    if (!isThreat && room && isRoomDangerous(room)) {
      const roomKey = `room:${rid}`;
      if (!seenThreats.has(roomKey)) {
        isThreat = true;
        seenThreats.add(roomKey);
      }
    }

    if (isThreat) {
      threats.push({ x, y, desc: describeTileThreat(tile, room) });
    }
  }

  return { filled, threats };
}

/** Update alert.m module detection state via weighted flood-fill */
export function updateAlertModule(state: GameState) {
  const alertMod = state.player.modules?.find(m => m.id === 'alert.m' && m.status === 'loaded');
  if (!alertMod) {
    state.alertFill = undefined;
    state.alertThreats = undefined;
    return;
  }

  const cluster = state.clusters.get(state.currentClusterId);
  if (!cluster) return;

  if (!alertMod.lastAlertTicks) alertMod.lastAlertTicks = new Map();

  const wasActive = alertMod.alertActive ?? false;
  const { filled, threats } = alertFloodFill(cluster, state.player.position, ALERT_FILL_BUDGET);

  // Store for debug overlay
  state.alertFill = filled;
  state.alertThreats = threats;

  const detected = threats.length > 0;
  alertMod.alertActive = detected;

  // Post throttled alert messages — group by description
  const threatsByDesc = new Map<string, { x: number; y: number; desc: string }>();
  for (const t of threats) {
    if (!threatsByDesc.has(t.desc)) threatsByDesc.set(t.desc, t);
  }
  for (const [desc, _t] of threatsByDesc) {
    const lastTick = alertMod.lastAlertTicks.get(desc) ?? -Infinity;
    if (state.tick - lastTick >= ALERT_THROTTLE_TICKS) {
      addMessage(state, `alert.m ▲ ${desc}`, 'alert');
      alertMod.lastAlertTicks.set(desc, state.tick);
    }
  }

  // Clear message when transitioning to safe
  if (!detected && wasActive) {
    addMessage(state, 'alert.m ▽ area clear', 'alert');
    alertMod.lastAlertTicks.clear();
  }

  if (state.debugMode && detected) {
    const descs = [...threatsByDesc.keys()].join(', ');
    addMessage(state, `[DBG] Alert: ${threats.length} threat tiles — ${descs}`, 'debug');
  }
}
