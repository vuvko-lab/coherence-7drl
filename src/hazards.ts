import {
  GameState, Cluster, Room, Position, TileType,
  CorruptionStage, CLUSTER_WIDTH, CLUSTER_HEIGHT, COLORS,
} from './types';
import { addMessage } from './game';

// ── Helpers ──

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

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
    const shuffled = dirs.sort(() => Math.random() - 0.5);
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

        if (Math.random() < degradeChance) {
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

        if (adjacentToFlood && Math.random() < 0.30) {
          breachTile(cluster, x, y);
          cluster.tiles[y][x].hazardOverlay = { type: 'flood', stage: 0 };
          addMessage(state, 'A door bursts open under flood pressure!', 'hazard');
        }
      }
    }
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
      if (state.player.position.y === beam.position && posInRoom(state.player.position, room)) {
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
      if (state.player.position.x === beam.position && posInRoom(state.player.position, room)) {
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
  if (sparks.some(s => s.x === pp.x && s.y === pp.y)) {
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

  // Pull player if in room
  if (posInRoom(state.player.position, room)) {
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

// ── Cascade Failure ──

function updateCascade(state: GameState, cluster: Cluster, room: Room) {
  const hz = room.hazardState!;
  if (!hz.cascadeActivated) return;

  // Advance every 2 ticks
  if (state.tick % 2 !== 0) return;

  const { x1, y1, x2, y2 } = roomInterior(room);
  const edge = hz.cascadeEdge ?? 'left';
  const progress = hz.cascadeProgress ?? 0;

  // Calculate max dimension along collapse axis
  const maxProgress = (edge === 'left' || edge === 'right')
    ? (x2 - x1) - 1  // leave 1-tile safe strip
    : (y2 - y1) - 1;

  if (progress >= maxProgress) return;

  hz.cascadeProgress = progress + 1;
  const p = hz.cascadeProgress;

  // Apply collapse based on edge direction
  for (let stage = 0; stage <= 2; stage++) {
    const offset = p - stage; // 0=collapsed, 1=crumbling, 2=warning
    if (offset < 0) continue;

    const collapseStage = 2 - stage; // 2=collapsed, 1=crumble, 0=warning

    if (edge === 'left') {
      const x = x1 + offset;
      if (x > x2) continue;
      for (let y = y1; y <= y2; y++) {
        if (cluster.tiles[y][x].type === TileType.Floor) {
          cluster.tiles[y][x].hazardOverlay = { type: 'collapse', stage: collapseStage };
          if (collapseStage === 2) cluster.tiles[y][x].walkable = false;
        }
      }
    } else if (edge === 'right') {
      const x = x2 - offset;
      if (x < x1) continue;
      for (let y = y1; y <= y2; y++) {
        if (cluster.tiles[y][x].type === TileType.Floor) {
          cluster.tiles[y][x].hazardOverlay = { type: 'collapse', stage: collapseStage };
          if (collapseStage === 2) cluster.tiles[y][x].walkable = false;
        }
      }
    } else if (edge === 'top') {
      const y = y1 + offset;
      if (y > y2) continue;
      for (let x = x1; x <= x2; x++) {
        if (cluster.tiles[y][x].type === TileType.Floor) {
          cluster.tiles[y][x].hazardOverlay = { type: 'collapse', stage: collapseStage };
          if (collapseStage === 2) cluster.tiles[y][x].walkable = false;
        }
      }
    } else {
      const y = y2 - offset;
      if (y < y1) continue;
      for (let x = x1; x <= x2; x++) {
        if (cluster.tiles[y][x].type === TileType.Floor) {
          cluster.tiles[y][x].hazardOverlay = { type: 'collapse', stage: collapseStage };
          if (collapseStage === 2) cluster.tiles[y][x].walkable = false;
        }
      }
    }
  }

  // Damage if player on collapsed tile
  const pp = state.player.position;
  const overlay = cluster.tiles[pp.y]?.[pp.x]?.hazardOverlay;
  if (overlay?.type === 'collapse' && overlay.stage === 2) {
    addMessage(state, 'The floor crumbles beneath you!', 'hazard');
    damageCoherence(state, randInt(10, 20));
  }

  // Sound
  const pRoom = playerRoom(state, cluster);
  if (pRoom) {
    const dist = roomDistance(cluster.roomAdjacency, pRoom.id, room.id);
    if (dist === 0 && p === 1) {
      addMessage(state, 'The floor begins to collapse!', 'hazard');
    } else if (dist === 1 && p === 1) {
      addMessage(state, 'You hear crumbling from the next room.', 'normal');
    }
  }
}

function onPlayerEnterCascade(_state: GameState, room: Room) {
  const hz = room.hazardState!;
  if (hz.cascadeActivated) return;
  hz.cascadeActivated = true;
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
      case 'cascade':
        updateCascade(state, cluster, room);
        break;
    }
  }
}

/** Called when player moves to a new room */
export function onPlayerEnterRoom(state: GameState, room: Room) {
  switch (room.roomType) {
    case 'trigger_trap':
      onPlayerEnterTriggerTrap(state, room);
      break;
    case 'cascade':
      onPlayerEnterCascade(state, room);
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

/** Update alert.m module detection state */
export function updateAlertModule(state: GameState) {
  const alertMod = state.player.modules?.find(m => m.id === 'alert.m' && m.status === 'loaded');
  if (!alertMod) return;

  const cluster = state.clusters.get(state.currentClusterId);
  if (!cluster) return;

  const pRoom = playerRoom(state, cluster);
  if (!pRoom) {
    alertMod.alertActive = false;
    return;
  }

  let detected = false;

  // Check current room
  if (pRoom.roomType !== 'normal' && pRoom.roomType !== 'echo_chamber' && pRoom.hazardState) {
    const hz = pRoom.hazardState;
    if (pRoom.roomType === 'trigger_trap' && hz.activated && !hz.detonated) detected = true;
    if (pRoom.roomType === 'corrupted' && hz.corruptionTiles && hz.corruptionTiles.size > 0) detected = true;
    if (pRoom.roomType === 'memory_leak' && (hz.floodLevel ?? 0) > 0) detected = true;
    if (pRoom.roomType === 'firewall' && hz.beams) detected = true;
    if (pRoom.roomType === 'unstable' && !hz.coreDestroyed) detected = true;
    if (pRoom.roomType === 'gravity_well') detected = true;
    if (pRoom.roomType === 'cascade' && hz.cascadeActivated) detected = true;
  }

  // Check adjacent rooms
  if (!detected) {
    const adjacentIds = cluster.roomAdjacency.get(pRoom.id) ?? [];
    for (const adjId of adjacentIds) {
      const adjRoom = cluster.rooms.find(r => r.id === adjId);
      if (!adjRoom || adjRoom.roomType === 'normal' || adjRoom.roomType === 'echo_chamber') continue;
      const hz = adjRoom.hazardState;
      if (!hz) continue;

      if (adjRoom.roomType === 'trigger_trap' && !hz.detonated) { detected = true; break; }
      if (adjRoom.roomType === 'corrupted' && hz.corruptionTiles && hz.corruptionTiles.size > 3) { detected = true; break; }
      if (adjRoom.roomType === 'memory_leak' && (hz.floodLevel ?? 0) > 1) { detected = true; break; }
      if (adjRoom.roomType === 'firewall') { detected = true; break; }
      if (adjRoom.roomType === 'unstable' && !hz.coreDestroyed) { detected = true; break; }
      if (adjRoom.roomType === 'gravity_well') { detected = true; break; }
      if (adjRoom.roomType === 'quarantine' && hz.locked) { detected = true; break; }
      if (adjRoom.roomType === 'cascade' && !hz.cascadeActivated) { detected = true; break; }
    }
  }

  alertMod.alertActive = detected;
}
