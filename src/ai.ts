import {
  GameState, Entity, Cluster, Position, TileType,
} from './types';
import { shootingAnimation } from './combat_animations';
import { findPath } from './pathfinding';
import { floodFillReveal } from './fov';

// ── Helpers ──

export function canSee(cluster: Cluster, from: Position, to: Position, radius: number, wallPen = 0): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx * dx + dy * dy > radius * radius) return false;
  // Bresenham line-of-sight with wall penetration
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  let wallsHit = 0;
  for (let i = 1; i <= steps; i++) {
    const x = Math.round(from.x + (dx * i) / steps);
    const y = Math.round(from.y + (dy * i) / steps);
    if (x === to.x && y === to.y) break;
    const tile = cluster.tiles[y]?.[x];
    if (!tile) return false;
    if (!tile.transparent) {
      wallsHit++;
      if (wallsHit > wallPen) return false;
    }
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

function addAiMessage(state: GameState, text: string, type: 'normal' | 'system' | 'hazard' | 'alert' | 'combat' = 'normal') {
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
        if (canSee(cluster, entity.position, t.position, ai.sightRadius, ai.wallPenetration)) {
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
      if (!canSee(cluster, entity.position, target.position, ai.sightRadius, ai.wallPenetration)) {
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
// Speed 12 (fast). Wanders (20% door bash) → chases any non-aggressive target → attacks adjacent

function updateBitMite(state: GameState, entity: Entity, cluster: Cluster) {
  const ai = entity.ai!;

  // Find nearest visible non-aggressive target
  const target = findNonFactionTarget(state, entity, cluster, 'aggressive');

  switch (ai.aiState) {
    case 'wander': {
      if (target) {
        ai.targetId = target.id;
        ai.aiState = 'chase';
        ai.lastTargetPos = { ...target.position };
        return;
      }
      // Sporadic movement with 20% chance to bash a door
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
      const chaseTarget = getEntityById(state, ai.targetId);
      if (!chaseTarget || chaseTarget.clusterId !== entity.clusterId) {
        ai.aiState = 'wander';
        ai.targetId = undefined;
        return;
      }

      const visible = canSee(cluster, entity.position, chaseTarget.position, ai.sightRadius, ai.wallPenetration);
      if (visible) {
        ai.lastTargetPos = { ...chaseTarget.position };
      }

      // Adjacent attack
      const dx = Math.abs(entity.position.x - chaseTarget.position.x);
      const dy = Math.abs(entity.position.y - chaseTarget.position.y);
      if (dx + dy <= 1) {
        ai.aiState = 'attack';
        return;
      }

      // Lost sight — chase last known position then give up
      if (!visible) {
        if (!ai.lastTargetPos) { ai.aiState = 'wander'; return; }
        if (entity.position.x === ai.lastTargetPos.x && entity.position.y === ai.lastTargetPos.y) {
          ai.aiState = 'wander';
          ai.lastTargetPos = undefined;
          return;
        }
      }

      const dest = visible ? chaseTarget.position : ai.lastTargetPos!;
      const step = stepToward(cluster, entity.position, dest);
      if (step) move(entity, cluster, step);
      else ai.aiState = 'wander';
      break;
    }

    case 'attack': {
      const attackTarget = getEntityById(state, ai.targetId);
      if (!attackTarget || attackTarget.clusterId !== entity.clusterId) {
        ai.aiState = 'wander';
        ai.targetId = undefined;
        return;
      }
      const dx = Math.abs(entity.position.x - attackTarget.position.x);
      const dy = Math.abs(entity.position.y - attackTarget.position.y);
      if (dx + dy > 1) {
        ai.aiState = 'chase';
        return;
      }
      // Deal damage
      if (attackTarget.coherence !== undefined) {
        attackTarget.coherence = Math.max(0, attackTarget.coherence - entity.attackValue);
        addAiMessage(state, `Bit-Mite Swarm attacks ${attackTarget.name}! −${entity.attackValue} coherence. (${attackTarget.coherence}/${attackTarget.maxCoherence})`, 'combat');
        if (attackTarget.coherence <= 0) {
          addAiMessage(state, `Bit-Mite Swarm destroys ${attackTarget.name}!`, 'combat');
          removeEntity(state, attackTarget);
          ai.aiState = 'wander';
          ai.targetId = undefined;
          return;
        }
      }
      ai.aiState = 'chase';
      break;
    }
  }
}

// ── Logic Leech (aggressive) ──
// Speed 30. Hugs walls → spots non-aggressive target → invisible stalk 3t → cardinal charge → rest 6t

function updateLogicLeech(state: GameState, entity: Entity, cluster: Cluster) {
  const ai = entity.ai!;

  switch (ai.aiState) {
    case 'wall_walk': {
      const target = findNonFactionTarget(state, entity, cluster, 'aggressive');
      if (target) {
        ai.targetId = target.id;
        ai.lastTargetPos = { ...target.position };
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
      const stalkTarget = getEntityById(state, ai.targetId);
      if (!stalkTarget || stalkTarget.clusterId !== entity.clusterId) {
        ai.aiState = 'wall_walk'; ai.invisible = false; ai.actionCooldown = undefined; return;
      }
      const visible = canSee(cluster, entity.position, stalkTarget.position, ai.sightRadius, ai.wallPenetration);
      if (!visible) {
        ai.aiState = 'wall_walk';
        ai.invisible = false;
        ai.actionCooldown = undefined;
        return;
      }
      ai.lastTargetPos = { ...stalkTarget.position };
      ai.actionCooldown = (ai.actionCooldown ?? 1) - 1;
      if (ai.actionCooldown <= 0) {
        const dx = stalkTarget.position.x - entity.position.x;
        const dy = stalkTarget.position.y - entity.position.y;
        const len = Math.max(Math.abs(dx), Math.abs(dy));
        if (len === 0) { ai.aiState = 'rest'; ai.actionCooldown = 6; ai.invisible = false; return; }
        ai.chargeDir = {
          x: Math.round(dx / len),
          y: Math.round(dy / len),
        };
        // Only charge cardinally
        if (Math.abs(ai.chargeDir.x) > 0 && Math.abs(ai.chargeDir.y) > 0) {
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
        ai.actionCooldown = 2;
        ai.chargeDir = undefined;
        return;
      }
      const dir = ai.chargeDir!;
      const nx = entity.position.x + dir.x;
      const ny = entity.position.y + dir.y;
      ai.chargeSteps = (ai.chargeSteps ?? 1) - 1;

      // Check for entity hit at charge destination
      const hitTarget = findEntityAt(state, cluster.id, nx, ny);
      if (hitTarget && hitTarget.ai?.faction !== 'aggressive') {
        if (hitTarget.coherence !== undefined) {
          hitTarget.coherence = Math.max(0, hitTarget.coherence - entity.attackValue);
          addAiMessage(state, `Logic Leech charge hits ${hitTarget.name}! −${entity.attackValue} coherence. (${hitTarget.coherence}/${hitTarget.maxCoherence})`, 'combat');
          if (hitTarget.coherence <= 0) {
            addAiMessage(state, `Logic Leech destroys ${hitTarget.name}!`, 'combat');
            removeEntity(state, hitTarget);
          }
        }
        ai.aiState = 'rest';
        ai.actionCooldown = 1;
        ai.chargeDir = undefined;
        return;
      }

      if (!isWalkableTile(cluster, nx, ny)) {
        ai.aiState = 'rest';
        ai.actionCooldown = 2;
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
  // addAiMessage(state, `Sentry state ${ai.aiState}`);

  // Look for aggressive entities in sight
  const threat = findAggressiveTarget(state, entity, cluster);
  if (threat) {
    ai.targetId = threat.id;
    ai.aiState = 'attack';
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
      if (!canSee(cluster, entity.position, target.position, ai.sightRadius, ai.wallPenetration)) {
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
      if (dx * dx + dy * dy <= entity.attackDistance * entity.attackDistance) {
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
      // addAiMessage(state, `Sentry targets ${JSON.stringify(target)}`);
      if (!target || target.clusterId !== entity.clusterId) {
        ai.aiState = 'patrol';
        return;
      }
      const dx = Math.abs(entity.position.x - target.position.x);
      const dy = Math.abs(entity.position.y - target.position.y);
      if (dx * dx + dy * dy > entity.attackDistance * entity.attackDistance) {
        ai.aiState = 'chase';
        return;
      }
      if (target.coherence !== undefined) {
        target.coherence = Math.max(0, target.coherence - entity.attackValue);
        addAiMessage(state, `White-Hat Sentry strikes ${target.name}! −${entity.attackValue}. (${target.coherence} left)`, 'combat');
        shootingAnimation(state, entity.position, target.position, 'single');
        if (target.coherence <= 0) {
          addAiMessage(state, `White-Hat Sentry destroys ${target.name}!`, 'combat');
          // Remove entity
          state.entities = state.entities.filter(e => e.id !== target.id);
          state.markedEntities.delete(target.id);
          ai.aiState = 'patrol';
          ai.targetId = undefined;
          return;
        }
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

/** Find the nearest visible entity NOT of the given faction. */
function findNonFactionTarget(state: GameState, entity: Entity, cluster: Cluster, excludeFaction: string): Entity | undefined {
  const ai = entity.ai!;
  const all = getAllEntitiesInCluster(state, cluster);
  let best: Entity | undefined;
  let bestDist = Infinity;
  for (const t of all) {
    if (t.id === entity.id) continue;
    if (t.ai?.faction === excludeFaction) continue;
    if (!canSee(cluster, entity.position, t.position, ai.sightRadius, ai.wallPenetration)) continue;
    const dx = t.position.x - entity.position.x;
    const dy = t.position.y - entity.position.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) { bestDist = dist; best = t; }
  }
  return best;
}

/** Find the nearest visible aggressive-faction entity (for White-Hat). */
function findAggressiveTarget(state: GameState, sentry: Entity, cluster: Cluster): Entity | undefined {
  const ai = sentry.ai!;
  for (const e of state.entities) {
    if (e.id === sentry.id) continue;
    if (e.clusterId !== sentry.clusterId) continue;
    if (e.ai?.faction !== 'aggressive') continue;
    // if (e.id === 0x3A7F && )
    if (canSee(cluster, sentry.position, e.position, ai.sightRadius, ai.wallPenetration)) return e;
  }
  return undefined;
}

/** Find any entity (including player) at a given position in a cluster. */
function findEntityAt(state: GameState, clusterId: number, x: number, y: number): Entity | undefined {
  if (state.player.clusterId === clusterId && state.player.position.x === x && state.player.position.y === y) {
    return state.player;
  }
  return state.entities.find(e => e.clusterId === clusterId && e.position.x === x && e.position.y === y);
}

/** Remove an entity from the game state. */
function removeEntity(state: GameState, target: Entity) {
  if (target.id === state.player.id) return; // never remove player
  state.entities = state.entities.filter(e => e.id !== target.id);
  state.markedEntities.delete(target.id);
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
    attackDistance: 5,
    attackValue: 0,
    ai: {
      kind: 'chronicler',
      faction: 'neutral',
      aiState: 'wander',
      sightRadius: 6,
      wallPenetration: 0,
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
    attackDistance: 1,
    attackValue: 3,
    ai: {
      kind: 'bit_mite',
      faction: 'aggressive',
      aiState: 'wander',
      sightRadius: 8,
      wallPenetration: 0,
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
    attackDistance: 1,
    attackValue: 30,
    ai: {
      kind: 'logic_leech',
      faction: 'aggressive',
      aiState: 'wall_walk',
      sightRadius: 7,
      wallPenetration: 1,
      invisible: false,
    },
  };
}

export function makeWhiteHat(pos: Position, clusterId: number): Entity {
  return {
    id: _nextEntityId++,
    name: 'White-Hat Sentry',
    glyph: 'S',
    fg: '#44ccaa',
    position: { ...pos },
    clusterId,
    speed: 20,
    energy: 0,
    coherence: 40,
    maxCoherence: 40,
    attackDistance: 5,
    attackValue: 5,
    ai: {
      kind: 'white_hat',
      faction: 'friendly',
      aiState: 'patrol',
      sightRadius: 10,
      wallPenetration: 2,
    },
  };
}

export function makeGateKeeper(pos: Position, clusterId: number): Entity {
  return {
    id: _nextEntityId++,
    name: 'Gate-Keeper',
    glyph: '⛨',
    fg: '#88ffaa',
    position: { ...pos },
    clusterId,
    speed: 15,
    energy: 0,
    coherence: 150,
    maxCoherence: 150,
    attackDistance: 2,
    attackValue: 20,
    ai: {
      kind: 'gate_keeper',
      faction: 'friendly',
      aiState: 'lockdown',        // pulls targets onto inself
      sightRadius: 6,
      wallPenetration: 0,
    },
  };
}
