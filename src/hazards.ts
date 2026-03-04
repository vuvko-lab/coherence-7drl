import {
  GameState, Cluster, Room, Position, TileType,
  CorruptionStage,
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

  const { x1, y1, x2, y2 } = roomInterior(room);
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
      // Collapsed tiles become impassable
      if (next === 'collapsed') {
        cluster.tiles[cy][cx].walkable = false;
      }
    }

    // Spread to adjacent floor tile
    const [cx, cy] = key.split(',').map(Number);
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const shuffled = dirs.sort(() => Math.random() - 0.5);
    for (const [dx, dy] of shuffled) {
      const nx = cx + dx;
      const ny = cy + dy;
      const nkey = `${nx},${ny}`;
      if (nx < x1 || nx > x2 || ny < y1 || ny > y2) continue;
      if (hz.corruptionTiles.has(nkey)) continue;
      if (cluster.tiles[ny][nx].type !== TileType.Floor) continue;

      newEntries.push([nkey, 'degrading']);
      break; // Only one spread per tile per interval
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

    // Damage: player in room = 40-60, adjacent = 15-25
    const pRoom = playerRoom(state, cluster);
    if (pRoom) {
      const dist = roomDistance(cluster.roomAdjacency, pRoom.id, room.id);
      if (dist === 0) {
        addMessage(state, 'DETONATION! The data-bomb tears through the room!', 'hazard');
        // TODO: coherence damage 40-60
      } else if (dist === 1) {
        addMessage(state, 'An explosion shakes the walls!', 'hazard');
        // TODO: coherence damage 15-25
      } else if (dist <= 3) {
        addMessage(state, 'A distant explosion rumbles through the structure.', 'normal');
      }
    }
  }
}

/** Called when player enters a trigger_trap room */
function onPlayerEnterTriggerTrap(_state: GameState, room: Room) {
  const hz = room.hazardState!;
  if (hz.activated || hz.detonated) return;
  hz.activated = true;
  // Visual pulsing begins (handled in renderer)
}

// ── Memory Leak ──

function updateMemoryLeak(state: GameState, cluster: Cluster, room: Room) {
  const hz = room.hazardState!;
  const floodLevel = hz.floodLevel ?? 0;
  const innerH = room.h - 2;
  const maxFlood = Math.max(0, innerH - 4); // Top 2 rows stay clear

  if (floodLevel >= maxFlood) return;
  if (state.tick % 6 !== 0) return;

  hz.floodLevel = floodLevel + 1;

  const { x1, y1, x2, y2 } = roomInterior(room);
  // Flood from bottom up
  for (let row = 0; row < hz.floodLevel; row++) {
    const fy = y2 - row;
    if (fy < y1) break;
    for (let x = x1; x <= x2; x++) {
      if (cluster.tiles[fy][x].type === TileType.Floor) {
        const deep = row >= 2;
        cluster.tiles[fy][x].hazardOverlay = {
          type: 'flood',
          stage: deep ? 1 : 0,
        };
      }
    }
  }

  // Sound
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

// ── Firewall Checkpoint ──

function updateFirewall(state: GameState, cluster: Cluster, room: Room) {
  const hz = room.hazardState!;
  if (!hz.beams) return;

  // Move beams every 2 ticks
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
    // Move beam
    beam.position += beam.direction;
    if (beam.position >= beam.max) { beam.position = beam.max; beam.direction = -1 as const; }
    if (beam.position <= beam.min) { beam.position = beam.min; beam.direction = 1 as const; }

    // Place beam overlay
    if (beam.axis === 'horizontal') {
      for (let x = x1; x <= x2; x++) {
        if (cluster.tiles[beam.position]?.[x]?.type === TileType.Floor) {
          cluster.tiles[beam.position][x].hazardOverlay = { type: 'beam' };
        }
      }
      // Check if player is on beam line
      if (state.player.position.y === beam.position && posInRoom(state.player.position, room)) {
        if (!hz.alarmTriggered) {
          hz.alarmTriggered = true;
          addMessage(state, 'SCAN DETECTED! Firewall alarm triggered!', 'hazard');
          // TODO: spawn fw-hunter entities, increase suspicion
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

  // Generate 1-3 new sparks
  const sparkCount = randInt(1, 3);
  const sparks: Position[] = [];
  for (let i = 0; i < sparkCount; i++) {
    const sx = randInt(x1, x2);
    const sy = randInt(y1, y2);
    // Don't spark the core tile
    if (hz.corePos && sx === hz.corePos.x && sy === hz.corePos.y) continue;
    if (cluster.tiles[sy][sx].type !== TileType.Floor) continue;
    sparks.push({ x: sx, y: sy });
    cluster.tiles[sy][sx].hazardOverlay = { type: 'spark' };
  }
  hz.sparkedTiles = sparks;

  // Damage if player on sparked tile
  const pp = state.player.position;
  if (sparks.some(s => s.x === pp.x && s.y === pp.y)) {
    addMessage(state, 'Electric discharge surges through you!', 'hazard');
    // TODO: coherence damage 5-10
  }
}

// ── Trigger Trap visual pulsing ──

function updateTriggerTrapVisuals(cluster: Cluster, room: Room, tick: number) {
  const hz = room.hazardState!;
  if (!hz.activated || hz.detonated) return;

  const remaining = hz.ticksRemaining ?? 0;
  const { x1, y1, x2, y2 } = roomInterior(room);

  // Pulse frequency based on remaining ticks
  let pulseRate: number;
  if (remaining > 10) pulseRate = 8;
  else if (remaining > 5) pulseRate = 4;
  else pulseRate = 2;

  const pulseOn = (tick % pulseRate) < (pulseRate / 2);

  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      if (cluster.tiles[y][x].type === TileType.Floor && !cluster.tiles[y][x].hazardOverlay) {
        if (pulseOn) {
          // Temporary visual hint — renderer will pick up fg override
          cluster.tiles[y][x].hazardOverlay = { type: 'scorch', stage: remaining <= 5 ? 2 : 1 };
        }
      }
    }
  }

  // Clear pulse overlays on off-phase
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
      // quarantine and echo_chamber are static — no per-tick updates
    }
  }
}

/** Called when player moves to a new room */
export function onPlayerEnterRoom(state: GameState, room: Room) {
  if (room.roomType === 'trigger_trap') {
    onPlayerEnterTriggerTrap(state, room);
  } else if (room.roomType === 'echo_chamber') {
    addMessage(state, 'Residual process echoes shimmer around you...', 'system');
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
        // degrading: 1 coherence/tick
        // TODO: actual coherence damage
      } else if (overlay.stage === 1) {
        // corrupted: 3 coherence/tick
        // TODO: actual coherence damage
      }
      break;
    case 'flood':
      if (overlay.stage === 0) {
        // shallow: 1 coherence/tick
      } else {
        // deep: 2 coherence/tick
      }
      break;
    // spark damage handled in updateUnstable
  }
}
