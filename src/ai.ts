import {
  GameState, Entity, Cluster, Position, TileType,
  ALERT_SUSPICIOUS, ALERT_ENEMY,
} from './types';
import { findPath } from './pathfinding';
import { floodFillReveal } from './fov';

// ── Helpers ──

function canSee(cluster: Cluster, from: Position, to: Position, radius: number): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx * dx + dy * dy > radius * radius) return false;
  // Bresenham line-of-sight using transparency
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  for (let i = 1; i <= steps; i++) {
    const x = Math.round(from.x + (dx * i) / steps);
    const y = Math.round(from.y + (dy * i) / steps);
    if (x === to.x && y === to.y) break;
    const tile = cluster.tiles[y]?.[x];
    if (!tile || !tile.transparent) return false;
  }
  return true;
}

function isWalkableTile(cluster: Cluster, x: number, y: number): boolean {
  if (x < 0 || x >= cluster.width || y < 0 || y >= cluster.height) return false;
  const tile = cluster.tiles[y][x];
  return tile.walkable || tile.type === TileType.Door;
}

function stepToward(cluster: Cluster, from: Position, to: Position): Position | null {
  const path = findPath(cluster, from, to);
  if (!path || path.length === 0) return null;
  return path[0];
}

function randomWalkStep(cluster: Cluster, pos: Position): Position | null {
  const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
  const shuffled = [...dirs].sort(() => Math.random() - 0.5);
  for (const d of shuffled) {
    const nx = pos.x + d.x;
    const ny = pos.y + d.y;
    if (isWalkableTile(cluster, nx, ny)) return { x: nx, y: ny };
  }
  return null;
}

function wallWalkStep(cluster: Cluster, pos: Position): Position | null {
  // Prefer moves that keep a wall adjacent (so Logic Leech hugs walls)
  const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
  const wallDirs = dirs.filter(d => {
    if (!isWalkableTile(cluster, pos.x + d.x, pos.y + d.y)) return false;
    // After moving, is there a wall adjacent?
    const nx = pos.x + d.x;
    const ny = pos.y + d.y;
    return dirs.some(wd => {
      const wx = nx + wd.x;
      const wy = ny + wd.y;
      const tile = cluster.tiles[wy]?.[wx];
      return tile && !tile.walkable && tile.type === TileType.Wall;
    });
  });
  if (wallDirs.length > 0) {
    const pick = wallDirs[Math.floor(Math.random() * wallDirs.length)];
    return { x: pos.x + pick.x, y: pos.y + pick.y };
  }
  return randomWalkStep(cluster, pos);
}

function move(entity: Entity, cluster: Cluster, target: Position): boolean {
  const tile = cluster.tiles[target.y]?.[target.x];
  if (!tile) return false;
  if (!tile.walkable) {
    if (tile.type === TileType.Door) {
      // Open the door
      tile.doorOpen = true;
      tile.walkable = true;
      tile.transparent = true;
      tile.glyph = '▯';
      tile.doorCloseTick = undefined;
      return true; // used turn to open door, don't move yet
    }
    return false;
  }
  entity.position = { ...target };
  return true;
}

function addAiMessage(state: GameState, text: string, type: 'normal' | 'system' | 'hazard' | 'alert' = 'normal') {
  state.messages.push({ text, type, tick: state.tick });
}

// ── Chronicler (neutral) ──
// Speed 40 (slow). Wanders → catalogs target → broadcasts reveal+mark → wanders

function updateChronicler(state: GameState, entity: Entity, cluster: Cluster) {
  const ai = entity.ai!;

  switch (ai.aiState) {
    case 'wander': {
      // Look for any entity to catalog (player or other)
      const targets = getAllEntitiesInCluster(state, cluster);
      for (const t of targets) {
        if (t.id === entity.id) continue;
        if (canSee(cluster, entity.position, t.position, ai.sightRadius)) {
          ai.targetId = t.id;
          ai.catalogTicks = 0;
          ai.aiState = 'catalog';
          return;
        }
      }
      // Wander
      const step = randomWalkStep(cluster, entity.position);
      if (step) move(entity, cluster, step);
      break;
    }

    case 'catalog': {
      const target = getEntityById(state, ai.targetId);
      if (!target || target.clusterId !== entity.clusterId) {
        ai.aiState = 'wander';
        ai.targetId = undefined;
        return;
      }
      if (!canSee(cluster, entity.position, target.position, ai.sightRadius)) {
        ai.aiState = 'wander';
        ai.targetId = undefined;
        return;
      }
      ai.catalogTicks = (ai.catalogTicks ?? 0) + 1;
      if (ai.catalogTicks >= 3) {
        ai.lastTargetPos = { ...target.position };
        ai.aiState = 'broadcast';
      }
      break;
    }

    case 'broadcast': {
      const targetId = ai.targetId;
      const target = targetId !== undefined ? getEntityById(state, targetId) : undefined;
      const pos = target?.position ?? ai.lastTargetPos ?? entity.position;

      // Mark the entity
      if (targetId !== undefined) {
        state.markedEntities.add(targetId);
      }

      // Reveal tiles around the target
      const positions = floodFillReveal(cluster, pos, 4);
      state.revealEffects.push({ positions, expireTick: state.tick + 8 });
      for (const key of positions) {
        const [x, y] = key.split(',').map(Number);
        const tile = cluster.tiles[y]?.[x];
        if (tile) tile.seen = true;
      }

      const name = target ? target.name : 'unknown entity';
      addAiMessage(state, `[CHRONICLE] Cataloging: ${name} at (${pos.x},${pos.y}).`, 'system');

      ai.catalogTicks = 0;
      ai.aiState = 'wander';
      break;
    }
  }
}

// ── Bit-Mite Swarm (aggressive) ──
// Speed 12 (fast). Wanders (20% door/wall bust) → chases player → attacks adjacent

function updateBitMite(state: GameState, entity: Entity, cluster: Cluster) {
  const ai = entity.ai!;
  const player = state.player;

  const playerVisible = player.clusterId === entity.clusterId &&
    canSee(cluster, entity.position, player.position, ai.sightRadius);

  switch (ai.aiState) {
    case 'wander': {
      if (playerVisible) {
        ai.targetId = player.id;
        ai.aiState = 'chase';
        ai.lastTargetPos = { ...player.position };
        return;
      }
      // Sporadic movement with 20% chance to bash a door/wall
      if (Math.random() < 0.2) {
        const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
        const dir = dirs[Math.floor(Math.random() * dirs.length)];
        const nx = entity.position.x + dir.x;
        const ny = entity.position.y + dir.y;
        const tile = cluster.tiles[ny]?.[nx];
        if (tile?.type === TileType.Door) {
          tile.doorOpen = true;
          tile.walkable = true;
          tile.transparent = true;
          tile.glyph = '▯';
          tile.doorCloseTick = undefined;
          return;
        }
      }
      const step = randomWalkStep(cluster, entity.position);
      if (step) move(entity, cluster, step);
      break;
    }

    case 'chase': {
      // Check if player still in sight
      if (playerVisible) {
        ai.lastTargetPos = { ...player.position };
      }

      // Adjacent attack
      const pp = player.position;
      const dx = Math.abs(entity.position.x - pp.x);
      const dy = Math.abs(entity.position.y - pp.y);
      if (dx + dy <= 1 && player.clusterId === entity.clusterId) {
        ai.aiState = 'attack';
        return;
      }

      // If we lost sight, chase last known position then give up
      if (!playerVisible) {
        if (!ai.lastTargetPos) { ai.aiState = 'wander'; return; }
        if (entity.position.x === ai.lastTargetPos.x && entity.position.y === ai.lastTargetPos.y) {
          ai.aiState = 'wander';
          ai.lastTargetPos = undefined;
          return;
        }
      }

      const dest = playerVisible ? player.position : ai.lastTargetPos!;
      const step = stepToward(cluster, entity.position, dest);
      if (step) move(entity, cluster, step);
      else ai.aiState = 'wander';
      break;
    }

    case 'attack': {
      const pp = player.position;
      const dx = Math.abs(entity.position.x - pp.x);
      const dy = Math.abs(entity.position.y - pp.y);
      if (dx + dy > 1 || player.clusterId !== entity.clusterId) {
        ai.aiState = playerVisible ? 'chase' : 'wander';
        return;
      }
      // Deal damage
      if (player.coherence !== undefined) {
        player.coherence = Math.max(0, player.coherence - 5);
        addAiMessage(state, `Bit-Mite Swarm attacks! −5 coherence. (${player.coherence}/${player.maxCoherence})`, 'hazard');
      }
      ai.aiState = 'chase';
      break;
    }
  }
}

// ── Logic Leech (aggressive) ──
// Speed 30. Hugs walls → spots target → becomes invisible (stalk 3t) → fast straight-line charge → rest 6t

function updateLogicLeech(state: GameState, entity: Entity, cluster: Cluster) {
  const ai = entity.ai!;
  const player = state.player;

  const playerVisible = player.clusterId === entity.clusterId &&
    canSee(cluster, entity.position, player.position, ai.sightRadius);

  switch (ai.aiState) {
    case 'wall_walk': {
      if (playerVisible) {
        ai.targetId = player.id;
        ai.lastTargetPos = { ...player.position };
        ai.aiState = 'stalk';
        ai.actionCooldown = 3;
        ai.invisible = true;
        return;
      }
      const step = wallWalkStep(cluster, entity.position);
      if (step) move(entity, cluster, step);
      break;
    }

    case 'stalk': {
      // Stand still while counting down
      if (!playerVisible) {
        ai.aiState = 'wall_walk';
        ai.invisible = false;
        ai.actionCooldown = undefined;
        return;
      }
      ai.lastTargetPos = { ...player.position };
      ai.actionCooldown = (ai.actionCooldown ?? 1) - 1;
      if (ai.actionCooldown <= 0) {
        // Compute charge direction (toward player)
        const dx = player.position.x - entity.position.x;
        const dy = player.position.y - entity.position.y;
        const len = Math.max(Math.abs(dx), Math.abs(dy));
        if (len === 0) { ai.aiState = 'rest'; ai.actionCooldown = 6; ai.invisible = false; return; }
        ai.chargeDir = {
          x: Math.round(dx / len),
          y: Math.round(dy / len),
        };
        // Only charge cardinally
        if (Math.abs(ai.chargeDir.x) > 0 && Math.abs(ai.chargeDir.y) > 0) {
          // Pick dominant axis
          if (Math.abs(dx) >= Math.abs(dy)) ai.chargeDir.y = 0;
          else ai.chargeDir.x = 0;
        }
        ai.chargeSteps = 3;
        ai.aiState = 'charge';
        ai.invisible = false;
      }
      break;
    }

    case 'charge': {
      if ((ai.chargeSteps ?? 0) <= 0) {
        ai.aiState = 'rest';
        ai.actionCooldown = 6;
        ai.chargeDir = undefined;
        return;
      }
      const dir = ai.chargeDir!;
      const nx = entity.position.x + dir.x;
      const ny = entity.position.y + dir.y;
      ai.chargeSteps = (ai.chargeSteps ?? 1) - 1;

      // Check for player hit
      const pp = player.position;
      if (nx === pp.x && ny === pp.y && player.clusterId === entity.clusterId) {
        if (player.coherence !== undefined) {
          player.coherence = Math.max(0, player.coherence - 15);
          addAiMessage(state, `Logic Leech charge hits! −15 coherence. (${player.coherence}/${player.maxCoherence})`, 'hazard');
        }
        ai.aiState = 'rest';
        ai.actionCooldown = 6;
        ai.chargeDir = undefined;
        return;
      }

      if (!isWalkableTile(cluster, nx, ny)) {
        ai.aiState = 'rest';
        ai.actionCooldown = 6;
        ai.chargeDir = undefined;
        return;
      }
      entity.position = { x: nx, y: ny };
      break;
    }

    case 'rest': {
      ai.actionCooldown = (ai.actionCooldown ?? 1) - 1;
      if ((ai.actionCooldown ?? 0) <= 0) {
        ai.aiState = 'wall_walk';
        ai.actionCooldown = undefined;
      }
      break;
    }
  }
}

// ── White-Hat Sentry (friendly) ──
// Speed 20. Patrols room, 10% chance to switch to adjacent room. Attacks aggressive entities.

function updateWhiteHat(state: GameState, entity: Entity, cluster: Cluster) {
  const ai = entity.ai!;

  // Look for aggressive entities in sight
  const threat = findAggressiveTarget(state, entity, cluster);
  if (threat) {
    ai.targetId = threat.id;
    ai.aiState = 'chase';
  }

  switch (ai.aiState) {
    case 'patrol': {
      // Move toward patrol waypoint or pick a new one
      const wp = ai.patrolWaypoint;
      if (!wp || (entity.position.x === wp.x && entity.position.y === wp.y)) {
        ai.patrolWaypoint = pickPatrolWaypoint(cluster, entity);
        // 10% chance to leave current room
        if (Math.random() < 0.1) {
          ai.patrolWaypoint = pickAdjacentRoomWaypoint(cluster, entity);
        }
      }
      if (ai.patrolWaypoint) {
        const step = stepToward(cluster, entity.position, ai.patrolWaypoint);
        if (step) move(entity, cluster, step);
      }
      break;
    }

    case 'chase': {
      const target = getEntityById(state, ai.targetId);
      if (!target || target.clusterId !== entity.clusterId) {
        ai.aiState = 'patrol';
        ai.targetId = undefined;
        return;
      }
      if (!canSee(cluster, entity.position, target.position, ai.sightRadius)) {
        // Lost sight — last known pos
        if (!ai.lastTargetPos) { ai.aiState = 'patrol'; return; }
        if (entity.position.x === ai.lastTargetPos.x && entity.position.y === ai.lastTargetPos.y) {
          ai.aiState = 'patrol';
          ai.lastTargetPos = undefined;
          return;
        }
      } else {
        ai.lastTargetPos = { ...target.position };
        state.markedEntities.add(target.id);
      }

      // Adjacent attack
      const dx = Math.abs(entity.position.x - target.position.x);
      const dy = Math.abs(entity.position.y - target.position.y);
      if (dx + dy <= 1) {
        ai.aiState = 'attack';
        return;
      }

      const dest = ai.lastTargetPos ?? target.position;
      const step = stepToward(cluster, entity.position, dest);
      if (step) move(entity, cluster, step);
      break;
    }

    case 'attack': {
      const target = getEntityById(state, ai.targetId);
      if (!target || target.clusterId !== entity.clusterId) {
        ai.aiState = 'patrol';
        return;
      }
      const dx = Math.abs(entity.position.x - target.position.x);
      const dy = Math.abs(entity.position.y - target.position.y);
      if (dx + dy > 1) {
        ai.aiState = 'chase';
        return;
      }
      if (target.coherence !== undefined) {
        target.coherence = Math.max(0, target.coherence - 10);
        if (target.coherence <= 0) {
          addAiMessage(state, `White-Hat Sentry destroys ${target.name}!`, 'system');
          // Remove entity
          state.entities = state.entities.filter(e => e.id !== target.id);
          state.markedEntities.delete(target.id);
          ai.aiState = 'patrol';
          ai.targetId = undefined;
          return;
        }
        addAiMessage(state, `White-Hat Sentry strikes ${target.name}! −10. (${target.coherence} left)`, 'system');
      }
      ai.aiState = 'chase';
      break;
    }
  }
}

// ── Spawn helpers ──

function pickPatrolWaypoint(cluster: Cluster, entity: Entity): Position | undefined {
  // Find current room
  const pos = entity.position;
  const room = cluster.rooms.find(r =>
    pos.x >= r.x && pos.x < r.x + r.w && pos.y >= r.y && pos.y < r.y + r.h
  );
  if (!room) return undefined;
  // Pick a random walkable tile in the room
  for (let attempt = 0; attempt < 20; attempt++) {
    const rx = room.x + Math.floor(Math.random() * room.w);
    const ry = room.y + Math.floor(Math.random() * room.h);
    if (cluster.tiles[ry]?.[rx]?.walkable) return { x: rx, y: ry };
  }
  return undefined;
}

function pickAdjacentRoomWaypoint(cluster: Cluster, entity: Entity): Position | undefined {
  const pos = entity.position;
  const room = cluster.rooms.find(r =>
    pos.x >= r.x && pos.x < r.x + r.w && pos.y >= r.y && pos.y < r.y + r.h
  );
  if (!room) return undefined;
  const adjIds = cluster.doorAdjacency.get(room.id) ?? [];
  if (adjIds.length === 0) return undefined;
  const adjId = adjIds[Math.floor(Math.random() * adjIds.length)];
  const adjRoom = cluster.rooms.find(r => r.id === adjId);
  if (!adjRoom) return undefined;
  for (let attempt = 0; attempt < 20; attempt++) {
    const rx = adjRoom.x + Math.floor(Math.random() * adjRoom.w);
    const ry = adjRoom.y + Math.floor(Math.random() * adjRoom.h);
    if (cluster.tiles[ry]?.[rx]?.walkable) return { x: rx, y: ry };
  }
  return undefined;
}

function findAggressiveTarget(state: GameState, sentry: Entity, cluster: Cluster): Entity | undefined {
  // At ENEMY level, player is the primary target
  if (state.alertLevel >= ALERT_ENEMY && state.player.clusterId === sentry.clusterId) {
    if (canSee(cluster, sentry.position, state.player.position, sentry.ai!.sightRadius)) return state.player;
  }
  for (const e of state.entities) {
    if (e.id === sentry.id) continue;
    if (e.clusterId !== sentry.clusterId) continue;
    if (e.ai?.faction !== 'aggressive') continue;
    if (canSee(cluster, sentry.position, e.position, sentry.ai!.sightRadius)) return e;
  }
  // At SUSPICIOUS level, player is a secondary target when no aggressive entity is nearby
  if (state.alertLevel >= ALERT_SUSPICIOUS && state.player.clusterId === sentry.clusterId) {
    if (canSee(cluster, sentry.position, state.player.position, sentry.ai!.sightRadius)) return state.player;
  }
  return undefined;
}

function getAllEntitiesInCluster(state: GameState, cluster: Cluster): Entity[] {
  const result: Entity[] = [state.player, ...state.entities];
  return result.filter(e => e.clusterId === cluster.id);
}

function getEntityById(state: GameState, id?: number): Entity | undefined {
  if (id === undefined) return undefined;
  if (id === state.player.id) return state.player;
  return state.entities.find(e => e.id === id);
}

// ── Main dispatch ──

export function updateEntityAI(state: GameState, entity: Entity) {
  const ai = entity.ai;
  if (!ai) return;
  const cluster = state.clusters.get(entity.clusterId);
  if (!cluster) return;

  switch (ai.kind) {
    case 'chronicler':  updateChronicler(state, entity, cluster);  break;
    case 'bit_mite':    updateBitMite(state, entity, cluster);     break;
    case 'logic_leech': updateLogicLeech(state, entity, cluster);  break;
    case 'white_hat':   updateWhiteHat(state, entity, cluster);    break;
  }
}

// ── Entity factory ──

let _nextEntityId = 1000;

export function makeChronicler(pos: Position, clusterId: number): Entity {
  return {
    id: _nextEntityId++,
    name: 'Chronicler',
    glyph: 'Ω',
    fg: '#aaaa66',
    position: { ...pos },
    clusterId,
    speed: 40,
    energy: 0,
    coherence: 30,
    maxCoherence: 30,
    ai: {
      kind: 'chronicler',
      faction: 'neutral',
      aiState: 'wander',
      sightRadius: 6,
    },
  };
}

export function makeBitMite(pos: Position, clusterId: number): Entity {
  return {
    id: _nextEntityId++,
    name: 'Bit-Mite Swarm',
    glyph: '⁕',
    fg: '#cc4444',
    position: { ...pos },
    clusterId,
    speed: 12,
    energy: 0,
    coherence: 20,
    maxCoherence: 20,
    ai: {
      kind: 'bit_mite',
      faction: 'aggressive',
      aiState: 'wander',
      sightRadius: 8,
    },
  };
}

export function makeLogicLeech(pos: Position, clusterId: number): Entity {
  return {
    id: _nextEntityId++,
    name: 'Logic Leech',
    glyph: '⌒',
    fg: '#9933cc',
    position: { ...pos },
    clusterId,
    speed: 30,
    energy: 0,
    coherence: 25,
    maxCoherence: 25,
    ai: {
      kind: 'logic_leech',
      faction: 'aggressive',
      aiState: 'wall_walk',
      sightRadius: 7,
      invisible: false,
    },
  };
}

export function makeWhiteHat(pos: Position, clusterId: number): Entity {
  return {
    id: _nextEntityId++,
    name: 'White-Hat Sentry',
    glyph: '⊢',
    fg: '#44ccaa',
    position: { ...pos },
    clusterId,
    speed: 20,
    energy: 0,
    coherence: 40,
    maxCoherence: 40,
    ai: {
      kind: 'white_hat',
      faction: 'friendly',
      aiState: 'patrol',
      sightRadius: 10,
    },
  };
}
