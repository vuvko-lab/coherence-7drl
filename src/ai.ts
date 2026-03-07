import {
  GameState, Entity, Cluster, Position, TileType, Faction,
  FACTION_RELATIONS, ALERT_ENEMY,
} from './types';
import { shootingAnimation } from './combat_animations';
import { findPath } from './pathfinding';
import { floodFillReveal } from './fov';
import { tryPushEntity } from './game';

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

function move(entity: Entity, cluster: Cluster, target: Position, state?: GameState): boolean {
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
  // Check for entity at target position
  if (state) {
    const occupant = state.entities.find(
      e => e.id !== entity.id && e.clusterId === cluster.id
        && e.position.x === target.x && e.position.y === target.y,
    );
    if (occupant) {
      // Same faction: try to push aside
      if (occupant.ai?.faction === entity.ai?.faction) {
        tryPushEntity(state, cluster, occupant, entity.position);
        // Continue to move entity even if push failed (occupant absorbs the bump)
      } else {
        return false; // Different faction: blocked
      }
    }
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
      if (step) move(entity, cluster, step, state);
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

function bitMiteAttack(state: GameState, entity: Entity, target: Entity) {
  if (target.coherence !== undefined) {
    target.coherence = Math.max(0, target.coherence - entity.attackValue);
    addAiMessage(state, `Bit-Mite Swarm attacks ${target.name}! −${entity.attackValue} coherence. (${target.coherence}/${target.maxCoherence})`, 'combat');
    if (target.coherence <= 0) {
      addAiMessage(state, `Bit-Mite Swarm destroys ${target.name}!`, 'combat');
      removeEntity(state, target);
      entity.ai!.aiState = 'wander';
      entity.ai!.targetId = undefined;
    }
  }
}

function updateBitMite(state: GameState, entity: Entity, cluster: Cluster) {
  const ai = entity.ai!;

  // Find nearest visible attack target per faction table
  const target = findAttackTarget(state, entity, cluster);

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
      if (step) move(entity, cluster, step, state);
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

      // Adjacent — attack immediately (no wasted state-transition turn)
      const dx = Math.abs(entity.position.x - chaseTarget.position.x);
      const dy = Math.abs(entity.position.y - chaseTarget.position.y);
      if (dx + dy <= 1) {
        bitMiteAttack(state, entity, chaseTarget);
        break;
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
      if (step) move(entity, cluster, step, state);
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
        // Target moved away — chase immediately instead of wasting turn
        ai.aiState = 'chase';
        ai.lastTargetPos = { ...attackTarget.position };
        const step = stepToward(cluster, entity.position, attackTarget.position);
        if (step) move(entity, cluster, step, state);
        break;
      }
      bitMiteAttack(state, entity, attackTarget);
      break;
    }
  }
}

// ── Logic Leech (aggressive) ──
// Speed 30. Hugs walls → spots non-aggressive target → invisible stalk 3t → cardinal charge → rest 6t

function leechMeleeAttack(state: GameState, entity: Entity, target: Entity): boolean {
  if (target.coherence === undefined) return false;
  target.coherence = Math.max(0, target.coherence - entity.attackValue);
  addAiMessage(state, `Logic Leech strikes ${target.name}! −${entity.attackValue} coherence. (${target.coherence}/${target.maxCoherence})`, 'combat');
  if (target.coherence <= 0) {
    addAiMessage(state, `Logic Leech destroys ${target.name}!`, 'combat');
    removeEntity(state, target);
  }
  return true;
}

/** Check if leech is adjacent to an attack target and melee if so. Returns true if attacked. */
function leechTryMelee(state: GameState, entity: Entity, cluster: Cluster): boolean {
  const target = findAttackTarget(state, entity, cluster);
  if (!target) return false;
  const dx = Math.abs(entity.position.x - target.position.x);
  const dy = Math.abs(entity.position.y - target.position.y);
  if (dx + dy > 1) return false;
  leechMeleeAttack(state, entity, target);
  return true;
}

function updateLogicLeech(state: GameState, entity: Entity, cluster: Cluster) {
  const ai = entity.ai!;

  switch (ai.aiState) {
    case 'wall_walk': {
      // Adjacent target — melee attack immediately
      if (leechTryMelee(state, entity, cluster)) break;

      const target = findAttackTarget(state, entity, cluster);
      if (target) {
        ai.targetId = target.id;
        ai.lastTargetPos = { ...target.position };
        ai.aiState = 'stalk';
        ai.actionCooldown = 3;
        ai.invisible = true;
        return;
      }
      const step = wallWalkStep(cluster, entity.position);
      if (step) move(entity, cluster, step, state);
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
      const hitTargetFaction: Faction = hitTarget?.id === state.player.id ? 'player' : (hitTarget?.ai?.faction ?? 'neutral');
      if (hitTarget && getRelation('aggressive', hitTargetFaction, state.alertLevel) === 'attack') {
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
      // Adjacent target — melee attack even during rest
      if (leechTryMelee(state, entity, cluster)) break;

      ai.actionCooldown = (ai.actionCooldown ?? 1) - 1;
      if ((ai.actionCooldown ?? 0) <= 0) {
        ai.aiState = 'wall_walk';
        ai.actionCooldown = undefined;
      }
      break;
    }
  }
}

// ── Sentry (friendly) ──
// Speed 20. Patrols room, 10% chance to switch to adjacent room.
// Attacks aggressive+titan entities; attacks player when alertLevel >= ALERT_ENEMY.

function sentryAttack(state: GameState, entity: Entity, target: Entity) {
  if (target.coherence !== undefined) {
    target.coherence = Math.max(0, target.coherence - entity.attackValue);
    addAiMessage(state, `Sentry strikes ${target.name}! −${entity.attackValue}. (${target.coherence} left)`, 'combat');
    shootingAnimation(state, entity.position, target.position, 'single');
    if (target.coherence <= 0) {
      addAiMessage(state, `Sentry destroys ${target.name}!`, 'combat');
      removeEntity(state, target);
      entity.ai!.aiState = 'patrol';
      entity.ai!.targetId = undefined;
      return;
    }
  }
  entity.ai!.aiState = 'chase';
}

function updateSentry(state: GameState, entity: Entity, cluster: Cluster) {
  const ai = entity.ai!;
  // addAiMessage(state, `Sentry state ${ai.aiState}`);

  // Look for attack targets per faction table (includes player at high alert)
  const threat = findAttackTarget(state, entity, cluster);
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
        if (step) move(entity, cluster, step, state);
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

      // In range — attack immediately instead of wasting a turn on state transition
      const dx = Math.abs(entity.position.x - target.position.x);
      const dy = Math.abs(entity.position.y - target.position.y);
      if (dx * dx + dy * dy <= entity.attackDistance * entity.attackDistance
          && canSee(cluster, entity.position, target.position, entity.attackDistance, 0)) {
        sentryAttack(state, entity, target);
        break;
      }

      const dest = ai.lastTargetPos ?? target.position;
      const step = stepToward(cluster, entity.position, dest);
      if (step) move(entity, cluster, step, state);
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
      if (dx * dx + dy * dy > entity.attackDistance * entity.attackDistance
          || !canSee(cluster, entity.position, target.position, entity.attackDistance, 0)) {
        // Target out of range or LOS — chase immediately
        ai.aiState = 'chase';
        ai.lastTargetPos = { ...target.position };
        const step = stepToward(cluster, entity.position, target.position);
        if (step) move(entity, cluster, step, state);
        break;
      }
      sentryAttack(state, entity, target);
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

/** Resolve whether `attackerFaction` should attack `targetFaction` given current alertLevel. */
function getRelation(attackerFaction: Faction, targetFaction: Faction, alertLevel: number): 'attack' | 'ignore' {
  if (attackerFaction === 'friendly' && targetFaction === 'player') {
    return alertLevel >= ALERT_ENEMY ? 'attack' : 'ignore';
  }
  return FACTION_RELATIONS[attackerFaction]?.[targetFaction] ?? 'ignore';
}

/** Find the nearest visible entity that `entity` should attack, per the faction table. */
function findAttackTarget(state: GameState, entity: Entity, cluster: Cluster): Entity | undefined {
  const ai = entity.ai!;
  const attackerFaction = ai.faction;
  const all = getAllEntitiesInCluster(state, cluster);
  let best: Entity | undefined;
  let bestDist = Infinity;
  for (const t of all) {
    if (t.id === entity.id) continue;
    const targetFaction: Faction = t.id === state.player.id ? 'player' : (t.ai?.faction ?? 'neutral');
    if (getRelation(attackerFaction, targetFaction, state.alertLevel) !== 'attack') continue;
    if (!canSee(cluster, entity.position, t.position, ai.sightRadius, ai.wallPenetration)) continue;
    const dx = t.position.x - entity.position.x;
    const dy = t.position.y - entity.position.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) { bestDist = dist; best = t; }
  }
  return best;
}

/** Find any entity (including player) at a given position in a cluster. */
function findEntityAt(state: GameState, clusterId: number, x: number, y: number): Entity | undefined {
  if (state.player.clusterId === clusterId && state.player.position.x === x && state.player.position.y === y) {
    return state.player;
  }
  return state.entities.find(e => e.clusterId === clusterId && e.position.x === x && e.position.y === y);
}

function factionSmokeColor(faction?: string): string {
  if (faction === 'aggressive') return '#cc4444';
  if (faction === 'friendly') return '#23d2a6';
  return '#aaaa66';
}

/** Remove an entity from the game state, spawning a death-smoke effect. */
function removeEntity(state: GameState, target: Entity) {
  if (target.id === state.player.id) return; // never remove player
  state.smokeEffects.push({
    x: target.position.x, y: target.position.y,
    fg: factionSmokeColor(target.ai?.faction),
    spawnTime: performance.now(),
  });
  if (target.ai) state.killedEntities.push({ name: target.name, kind: target.ai.kind });
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

// ── Repair Scrapper (neutral) ──
// Speed 25 (moderate). Patrols → seeks corrupted interactables → attempts repair.

function updateRepairScrapper(state: GameState, entity: Entity, cluster: Cluster) {
  const ai = entity.ai!;

  switch (ai.aiState) {
    case 'patrol': {
      // Scan for nearby corrupted interactables
      let nearestDist = Infinity;
      let nearestPos: Position | undefined;
      for (const ia of cluster.interactables) {
        if (!ia.corrupted || ia.rewardTaken) continue;
        const dx = ia.position.x - entity.position.x;
        const dy = ia.position.y - entity.position.y;
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist <= ai.sightRadius && dist < nearestDist) {
          nearestDist = dist;
          nearestPos = ia.position;
        }
      }
      if (nearestPos) {
        ai.lastTargetPos = { ...nearestPos };
        ai.aiState = 'repair';
        return;
      }
      // Wander if no target
      const step = randomWalkStep(cluster, entity.position);
      if (step) move(entity, cluster, step, state);
      break;
    }

    case 'repair': {
      if (!ai.lastTargetPos) { ai.aiState = 'patrol'; return; }
      // Find the interactable at the stored position
      const ia = cluster.interactables.find(
        i => i.position.x === ai.lastTargetPos!.x && i.position.y === ai.lastTargetPos!.y,
      );
      if (!ia || !ia.corrupted) {
        ai.lastTargetPos = undefined;
        ai.aiState = 'patrol';
        return;
      }
      // Move toward target
      const dx = Math.abs(entity.position.x - ia.position.x);
      const dy = Math.abs(entity.position.y - ia.position.y);
      if (dx + dy > 1) {
        const step = stepToward(cluster, entity.position, ia.position);
        if (step) move(entity, cluster, step, state);
      } else {
        // Adjacent — attempt repair
        if (Math.random() < 0.4) {
          ia.corrupted = false;
          addAiMessage(state, '[SCRAPPER] Signal fragment stabilized.', 'system');
        } else {
          addAiMessage(state, '[SCRAPPER] Repair attempt failed. Resuming patrol.', 'system');
        }
        ai.lastTargetPos = undefined;
        ai.aiState = 'patrol';
      }
      break;
    }

    default:
      ai.aiState = 'patrol';
  }
}

// ── Titan Spawn (titan) ──
// Speed 15 (fast). Hunts nearest entity of ANY faction — attacks everything.

function updateTitanSpawn(state: GameState, entity: Entity, cluster: Cluster) {
  const ai = entity.ai!;
  const target = findAttackTarget(state, entity, cluster);

  if (!target) {
    const step = randomWalkStep(cluster, entity.position);
    if (step) move(entity, cluster, step, state);
    return;
  }

  ai.targetId = target.id;
  const dx = Math.abs(entity.position.x - target.position.x);
  const dy = Math.abs(entity.position.y - target.position.y);

  if (dx + dy <= 1) {
    // Adjacent — attack
    if (target.coherence !== undefined) {
      target.coherence = Math.max(0, target.coherence - entity.attackValue);
      addAiMessage(state, `[UNKNOWN PROCESS] consumes ${target.name}! −${entity.attackValue}. (${target.coherence} left)`, 'combat');
      if (target.coherence <= 0) {
        addAiMessage(state, `[UNKNOWN PROCESS] destroys ${target.name}!`, 'combat');
        removeEntity(state, target);
      }
    }
  } else {
    const step = stepToward(cluster, entity.position, target.position);
    if (step) move(entity, cluster, step, state);
  }
}

// ── Main dispatch ──

export function updateEntityAI(state: GameState, entity: Entity) {
  const ai = entity.ai;
  if (!ai) return;
  const cluster = state.clusters.get(entity.clusterId);
  if (!cluster) return;

  switch (ai.kind) {
    case 'chronicler':      updateChronicler(state, entity, cluster);      break;
    case 'bit_mite':        updateBitMite(state, entity, cluster);         break;
    case 'logic_leech':     updateLogicLeech(state, entity, cluster);      break;
    case 'sentry':          updateSentry(state, entity, cluster);          break;
    case 'gate_keeper':     updateGateKeeper(state, entity, cluster);      break;
    case 'repair_scrapper': updateRepairScrapper(state, entity, cluster);  break;
    case 'titan_spawn':     updateTitanSpawn(state, entity, cluster);     break;
  }
}

function updateGateKeeper(state: GameState, entity: Entity, cluster: Cluster) {
  const ai = entity.ai!;
  const all = getAllEntitiesInCluster(state, cluster);

  // Pull all visible attack-targets one step toward self each turn
  for (const target of all) {
    if (target.id === entity.id) continue;
    const tFaction: Faction = target.id === state.player.id ? 'player' : (target.ai?.faction ?? 'neutral');
    if (getRelation('friendly', tFaction, state.alertLevel) !== 'attack') continue;
    if (!canSee(cluster, entity.position, target.position, ai.sightRadius, ai.wallPenetration)) continue;

    const dx = entity.position.x - target.position.x;
    const dy = entity.position.y - target.position.y;
    if (dx === 0 && dy === 0) continue;

    // Step pulled entity one tile closer along dominant axis
    const stepX = dx !== 0 ? Math.sign(dx) : 0;
    const stepY = dy !== 0 ? Math.sign(dy) : 0;
    // Prefer the axis with greater distance
    const absDx = Math.abs(dx), absDy = Math.abs(dy);
    const candidates: [number, number][] = absDx >= absDy
      ? [[stepX, 0], [0, stepY]]
      : [[0, stepY], [stepX, 0]];

    for (const [cx, cy] of candidates) {
      const nx = target.position.x + cx;
      const ny = target.position.y + cy;
      const tile = cluster.tiles[ny]?.[nx];
      if (!tile?.walkable) continue;
      const occupied = findEntityAt(state, cluster.id, nx, ny);
      if (occupied && occupied.id !== entity.id) continue;
      target.position = { x: nx, y: ny };
      break;
    }
  }

  // Beam attack: fire at nearest visible non-friendly target in range with clear LOS
  ai.actionCooldown = (ai.actionCooldown ?? 0) - 1;
  if (ai.actionCooldown > 0) return;

  for (const target of all) {
    if (target.id === entity.id) continue;
    const beamTargetFaction: Faction = target.id === state.player.id ? 'player' : (target.ai?.faction ?? 'neutral');
    if (getRelation('friendly', beamTargetFaction, state.alertLevel) !== 'attack') continue;
    const dx = Math.abs(entity.position.x - target.position.x);
    const dy = Math.abs(entity.position.y - target.position.y);
    const distSq = dx * dx + dy * dy;
    if (distSq > entity.attackDistance * entity.attackDistance) continue;
    // Require clear line of sight — no shooting through walls or closed doors
    if (!canSee(cluster, entity.position, target.position, entity.attackDistance, 0)) continue;
    if (target.coherence === undefined) continue;

    target.coherence = Math.max(0, target.coherence - entity.attackValue);
    addAiMessage(state, `Gate-Keeper fires containment beam at ${target.name}! −${entity.attackValue}. (${target.coherence} left)`, 'combat');
    shootingAnimation(state, entity.position, target.position, 'beam');
    if (target.coherence <= 0) {
      addAiMessage(state, `Gate-Keeper destroys ${target.name}!`, 'combat');
      removeEntity(state, target);
    }
    ai.actionCooldown = 3; // beam fires every 3 ticks
    return; // one beam per turn
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

export function makePropEntity(pos: Position, clusterId: number, glyph: string, fg: string, name: string, propTag: string): Entity {
  return {
    id: _nextEntityId++,
    name,
    glyph,
    fg,
    position: { ...pos },
    clusterId,
    speed: 9999,
    energy: 0,
    attackDistance: 0,
    attackValue: 0,
    propTag,
    // no ai — static prop, never acts
  };
}

export function makeDamagedBitMite(pos: Position, clusterId: number): Entity {
  return {
    id: _nextEntityId++,
    name: 'Corrupted Echo Fragment',
    glyph: '⁕',
    fg: '#aa6644',
    position: { ...pos },
    clusterId,
    speed: 18,
    energy: 0,
    coherence: 5,
    maxCoherence: 5,
    attackDistance: 1,
    attackValue: 2,
    ai: {
      kind: 'bit_mite',
      faction: 'aggressive',
      aiState: 'wander',
      sightRadius: 5,
      wallPenetration: 0,
    },
  };
}

export function makeLogicLeech(pos: Position, clusterId: number): Entity {
  return {
    id: _nextEntityId++,
    name: 'Logic Leech',
    glyph: '⌒',
    fg: '#cc4444',
    position: { ...pos },
    clusterId,
    speed: 20,
    energy: 0,
    coherence: 25,
    maxCoherence: 25,
    attackDistance: 1,
    attackValue: 30,
    ai: {
      kind: 'logic_leech',
      faction: 'aggressive',
      aiState: 'wall_walk',
      sightRadius: 15,
      wallPenetration: 2,
      invisible: false,
    },
  };
}

export function makeSentry(pos: Position, clusterId: number): Entity {
  return {
    id: _nextEntityId++,
    name: 'Sentry',
    glyph: 'S',
    fg: '#23d2a6',
    position: { ...pos },
    clusterId,
    speed: 20,
    energy: 0,
    coherence: 40,
    maxCoherence: 40,
    attackDistance: 5,
    attackValue: 5,
    ai: {
      kind: 'sentry',
      faction: 'friendly',
      aiState: 'patrol',
      sightRadius: 10,
      wallPenetration: 1,
    },
  };
}

export function makeGateKeeper(pos: Position, clusterId: number): Entity {
  return {
    id: _nextEntityId++,
    name: 'Gate-Keeper',
    glyph: '⛨',
    fg: '#23d2a6',
    position: { ...pos },
    clusterId,
    speed: 15,
    energy: 0,
    coherence: 150,
    maxCoherence: 150,
    attackDistance: 6,  // beam range
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

export function makeTitanSpawn(pos: Position, clusterId: number): Entity {
  return {
    id: _nextEntityId++,
    name: '[UNKNOWN PROCESS]',
    glyph: 'X',
    fg: '#ff44ff',
    position: { ...pos },
    clusterId,
    speed: 15,
    energy: 0,
    coherence: 60,
    maxCoherence: 60,
    attackDistance: 1,
    attackValue: 20,
    ai: {
      kind: 'titan_spawn',
      faction: 'titan',
      aiState: 'hunt',
      sightRadius: 12,
      wallPenetration: 1,
    },
  };
}

export function makeRepairScrapper(pos: Position, clusterId: number): Entity {
  return {
    id: _nextEntityId++,
    name: 'Repair Scrapper',
    glyph: '⚙',
    fg: '#aaaa66',
    position: { ...pos },
    clusterId,
    speed: 25,
    energy: 0,
    coherence: 35,
    maxCoherence: 35,
    attackDistance: 0,
    attackValue: 0,
    ai: {
      kind: 'repair_scrapper',
      faction: 'neutral',
      aiState: 'patrol',
      sightRadius: 5,
      wallPenetration: 0,
    },
  };
}
