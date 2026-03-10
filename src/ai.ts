import {
  GameState, Entity, Cluster, Position, TileType, Faction,
  FACTION_RELATIONS, ALERT_ENEMY,
} from './types';
import type { Intent } from './intents';
import { resolveIntents } from './intent-resolver';
import { findPath } from './pathfinding';
import { floodFillReveal } from './fov';
import { random, pick, shuffle } from './rng';

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
  const shuffled = shuffle([...dirs]);
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
    const picked = wallDirs[Math.floor(random() * wallDirs.length)];
    return { x: pos.x + picked.x, y: pos.y + picked.y };
  }
  return randomWalkStep(cluster, pos);
}

// Old direct-mutation move/addAiMessage/removeEntity removed — all AI now uses intent-returning functions

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
    const rx = room.x + Math.floor(random() * room.w);
    const ry = room.y + Math.floor(random() * room.h);
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
  const adjId = pick(adjIds);
  const adjRoom = cluster.rooms.find(r => r.id === adjId);
  if (!adjRoom) return undefined;
  for (let attempt = 0; attempt < 20; attempt++) {
    const rx = adjRoom.x + Math.floor(random() * adjRoom.w);
    const ry = adjRoom.y + Math.floor(random() * adjRoom.h);
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
    if (t.id === state.player.id && state.invisibleMode) continue; // cloaked player is undetectable
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

function getAllEntitiesInCluster(state: GameState, cluster: Cluster): Entity[] {
  const result: Entity[] = [state.player, ...state.entities];
  return result.filter(e => e.clusterId === cluster.id);
}

function getEntityById(state: GameState, id?: number): Entity | undefined {
  if (id === undefined) return undefined;
  if (id === state.player.id) return state.player;
  return state.entities.find(e => e.id === id);
}

// Old updateRepairScrapper and updateTitanSpawn removed — replaced by intent-returning versions

// ── Intent-returning AI functions ──

function chroniclerAI(state: GameState, entity: Entity, cluster: Cluster): Intent[] {
  const ai = entity.ai!;
  const intents: Intent[] = [];

  switch (ai.aiState) {
    case 'wander': {
      const targets = getAllEntitiesInCluster(state, cluster);
      for (const t of targets) {
        if (t.id === entity.id) continue;
        if (canSee(cluster, entity.position, t.position, ai.sightRadius, ai.wallPenetration)) {
          intents.push(
            { kind: 'set_target', entityId: entity.id, targetId: t.id },
            { kind: 'set_ai_field', entityId: entity.id, field: 'catalogTicks', value: 0 },
            { kind: 'change_ai_state', entityId: entity.id, newState: 'catalog' },
          );
          return intents;
        }
      }
      const step = randomWalkStep(cluster, entity.position);
      if (step) intents.push({ kind: 'move', entityId: entity.id, to: step });
      break;
    }

    case 'catalog': {
      const target = getEntityById(state, ai.targetId);
      if (!target || target.clusterId !== entity.clusterId) {
        intents.push(
          { kind: 'change_ai_state', entityId: entity.id, newState: 'wander' },
          { kind: 'set_target', entityId: entity.id, targetId: undefined },
        );
        return intents;
      }
      if (!canSee(cluster, entity.position, target.position, ai.sightRadius, ai.wallPenetration)) {
        intents.push(
          { kind: 'change_ai_state', entityId: entity.id, newState: 'wander' },
          { kind: 'set_target', entityId: entity.id, targetId: undefined },
        );
        return intents;
      }
      const ticks = (ai.catalogTicks ?? 0) + 1;
      intents.push({ kind: 'set_ai_field', entityId: entity.id, field: 'catalogTicks', value: ticks });
      if (ticks >= 3) {
        intents.push(
          { kind: 'set_target', entityId: entity.id, targetId: ai.targetId, lastTargetPos: { ...target.position } },
          { kind: 'change_ai_state', entityId: entity.id, newState: 'broadcast' },
        );
      }
      break;
    }

    case 'broadcast': {
      const targetId = ai.targetId;
      const target = targetId !== undefined ? getEntityById(state, targetId) : undefined;
      const pos = target?.position ?? ai.lastTargetPos ?? entity.position;

      if (targetId !== undefined) {
        intents.push({ kind: 'mark_entity', entityId: targetId });
      }

      // floodFillReveal is read-only (computes positions) — safe to call here
      const positions = floodFillReveal(cluster, pos, 4);
      intents.push(
        { kind: 'catalog', catalogerId: entity.id, targetId: targetId ?? entity.id, positions },
        { kind: 'reveal', positions, durationTicks: 8 },
      );

      const name = target ? target.name : 'unknown entity';
      intents.push({ kind: 'message', text: `[CHRONICLE] Cataloging: ${name} at (${pos.x},${pos.y}).`, style: 'system' });

      intents.push(
        { kind: 'set_ai_field', entityId: entity.id, field: 'catalogTicks', value: 0 },
        { kind: 'change_ai_state', entityId: entity.id, newState: 'wander' },
      );
      break;
    }
  }

  return intents;
}

function repairScrapperAI(_state: GameState, entity: Entity, cluster: Cluster): Intent[] {
  const ai = entity.ai!;
  const intents: Intent[] = [];

  switch (ai.aiState) {
    case 'patrol': {
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
        intents.push(
          { kind: 'set_target', entityId: entity.id, targetId: undefined, lastTargetPos: { ...nearestPos } },
          { kind: 'change_ai_state', entityId: entity.id, newState: 'repair' },
        );
        return intents;
      }
      const step = randomWalkStep(cluster, entity.position);
      if (step) intents.push({ kind: 'move', entityId: entity.id, to: step });
      break;
    }

    case 'repair': {
      if (!ai.lastTargetPos) {
        intents.push({ kind: 'change_ai_state', entityId: entity.id, newState: 'patrol' });
        return intents;
      }
      const ia = cluster.interactables.find(
        i => i.position.x === ai.lastTargetPos!.x && i.position.y === ai.lastTargetPos!.y,
      );
      if (!ia || !ia.corrupted) {
        intents.push(
          { kind: 'set_target', entityId: entity.id, targetId: undefined, lastTargetPos: undefined },
          { kind: 'change_ai_state', entityId: entity.id, newState: 'patrol' },
        );
        return intents;
      }
      const dx = Math.abs(entity.position.x - ia.position.x);
      const dy = Math.abs(entity.position.y - ia.position.y);
      if (dx + dy > 1) {
        const step = stepToward(cluster, entity.position, ia.position);
        if (step) intents.push({ kind: 'move', entityId: entity.id, to: step });
      } else {
        if (random() < 0.4) {
          intents.push(
            { kind: 'repair_interactable', position: { ...ia.position } },
            { kind: 'message', text: '[SCRAPPER] Signal fragment stabilized.', style: 'system' },
          );
        } else {
          intents.push({ kind: 'message', text: '[SCRAPPER] Repair attempt failed. Resuming patrol.', style: 'system' });
        }
        intents.push(
          { kind: 'set_target', entityId: entity.id, targetId: undefined, lastTargetPos: undefined },
          { kind: 'change_ai_state', entityId: entity.id, newState: 'patrol' },
        );
      }
      break;
    }

    default:
      intents.push({ kind: 'change_ai_state', entityId: entity.id, newState: 'patrol' });
  }

  return intents;
}

function bitMiteAI(state: GameState, entity: Entity, cluster: Cluster): Intent[] {
  const ai = entity.ai!;
  const intents: Intent[] = [];
  const target = findAttackTarget(state, entity, cluster);

  switch (ai.aiState) {
    case 'wander': {
      if (target) {
        intents.push(
          { kind: 'set_target', entityId: entity.id, targetId: target.id, lastTargetPos: { ...target.position } },
          { kind: 'change_ai_state', entityId: entity.id, newState: 'chase' },
        );
        return intents;
      }
      // 20% chance to bash a door
      if (random() < 0.2) {
        const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
        const dir = pick(dirs);
        const nx = entity.position.x + dir.x;
        const ny = entity.position.y + dir.y;
        const tile = cluster.tiles[ny]?.[nx];
        if (tile?.type === TileType.Door && tile.glyph !== '▪') {
          intents.push({ kind: 'open_door', entityId: entity.id, at: { x: nx, y: ny } });
          return intents;
        }
      }
      const step = randomWalkStep(cluster, entity.position);
      if (step) intents.push({ kind: 'move', entityId: entity.id, to: step });
      break;
    }

    case 'chase': {
      const chaseTarget = getEntityById(state, ai.targetId);
      if (!chaseTarget || chaseTarget.clusterId !== entity.clusterId
        || (chaseTarget.id === state.player.id && state.invisibleMode)) {
        intents.push(
          { kind: 'change_ai_state', entityId: entity.id, newState: 'wander' },
          { kind: 'set_target', entityId: entity.id, targetId: undefined },
        );
        return intents;
      }

      const visible = canSee(cluster, entity.position, chaseTarget.position, ai.sightRadius, ai.wallPenetration);
      if (visible) {
        intents.push({ kind: 'set_target', entityId: entity.id, targetId: chaseTarget.id, lastTargetPos: { ...chaseTarget.position } });
      }

      // Adjacent — attack
      const dx = Math.abs(entity.position.x - chaseTarget.position.x);
      const dy = Math.abs(entity.position.y - chaseTarget.position.y);
      if (dx + dy <= 1) {
        const pi = chaseTarget.id === state.player.id;
        intents.push(
          { kind: 'melee_attack', attackerId: entity.id, targetId: chaseTarget.id, damage: entity.attackValue },
          { kind: 'message', text: `Bit-Mite Swarm attacks ${chaseTarget.name}! −${entity.attackValue} coherence. (${Math.max(0, (chaseTarget.coherence ?? 0) - entity.attackValue)}/${chaseTarget.maxCoherence})`, style: 'combat' },
        );
        if (pi) intents.push({ kind: 'sound', id: 'hit' });
        // Check if this kills the target
        if (chaseTarget.coherence !== undefined && chaseTarget.coherence - entity.attackValue <= 0) {
          intents.push(
            { kind: 'message', text: `Bit-Mite Swarm destroys ${chaseTarget.name}!`, style: 'combat' },
            { kind: 'remove_entity', entityId: chaseTarget.id, cause: 'killed' },
            { kind: 'smoke', position: chaseTarget.position, color: factionSmokeColor(chaseTarget.ai?.faction) },
            { kind: 'change_ai_state', entityId: entity.id, newState: 'wander' },
            { kind: 'set_target', entityId: entity.id, targetId: undefined },
          );
        }
        break;
      }

      // Lost sight — chase last known pos
      if (!visible) {
        if (!ai.lastTargetPos) {
          intents.push({ kind: 'change_ai_state', entityId: entity.id, newState: 'wander' });
          return intents;
        }
        if (entity.position.x === ai.lastTargetPos.x && entity.position.y === ai.lastTargetPos.y) {
          intents.push(
            { kind: 'change_ai_state', entityId: entity.id, newState: 'wander' },
            { kind: 'set_target', entityId: entity.id, targetId: undefined, lastTargetPos: undefined },
          );
          return intents;
        }
      }

      const dest = visible ? chaseTarget.position : ai.lastTargetPos!;
      const step = stepToward(cluster, entity.position, dest);
      if (step) intents.push({ kind: 'move', entityId: entity.id, to: step });
      else intents.push({ kind: 'change_ai_state', entityId: entity.id, newState: 'wander' });
      break;
    }
  }

  return intents;
}

function sentryAI(state: GameState, entity: Entity, cluster: Cluster): Intent[] {
  const ai = entity.ai!;
  const intents: Intent[] = [];

  // Look for attack targets
  const threat = findAttackTarget(state, entity, cluster);
  if (threat) {
    intents.push(
      { kind: 'set_target', entityId: entity.id, targetId: threat.id },
      { kind: 'change_ai_state', entityId: entity.id, newState: 'attack' },
    );
  }

  switch (ai.aiState) {
    case 'patrol': {
      if (threat) break; // will resolve with attack state next tick
      const wp = ai.patrolWaypoint;
      if (!wp || (entity.position.x === wp.x && entity.position.y === wp.y)) {
        let newWp = pickPatrolWaypoint(cluster, entity);
        if (random() < 0.1) {
          newWp = pickAdjacentRoomWaypoint(cluster, entity) ?? newWp;
        }
        intents.push({ kind: 'set_ai_field', entityId: entity.id, field: 'patrolWaypoint', value: newWp });
        if (newWp) {
          const step = stepToward(cluster, entity.position, newWp);
          if (step) intents.push({ kind: 'move', entityId: entity.id, to: step });
        }
      } else {
        const step = stepToward(cluster, entity.position, wp);
        if (step) intents.push({ kind: 'move', entityId: entity.id, to: step });
      }
      break;
    }

    case 'chase': {
      const target = getEntityById(state, ai.targetId);
      if (!target || target.clusterId !== entity.clusterId
        || (target.id === state.player.id && state.invisibleMode)) {
        intents.push(
          { kind: 'change_ai_state', entityId: entity.id, newState: 'patrol' },
          { kind: 'set_target', entityId: entity.id, targetId: undefined },
        );
        return intents;
      }
      const visible = canSee(cluster, entity.position, target.position, ai.sightRadius, ai.wallPenetration);
      if (!visible) {
        if (!ai.lastTargetPos) {
          intents.push({ kind: 'change_ai_state', entityId: entity.id, newState: 'patrol' });
          return intents;
        }
        if (entity.position.x === ai.lastTargetPos.x && entity.position.y === ai.lastTargetPos.y) {
          intents.push(
            { kind: 'change_ai_state', entityId: entity.id, newState: 'patrol' },
            { kind: 'set_target', entityId: entity.id, targetId: undefined, lastTargetPos: undefined },
          );
          return intents;
        }
      } else {
        intents.push(
          { kind: 'set_target', entityId: entity.id, targetId: target.id, lastTargetPos: { ...target.position } },
          { kind: 'mark_entity', entityId: target.id },
        );
      }

      // In range — attack
      const dx = Math.abs(entity.position.x - target.position.x);
      const dy = Math.abs(entity.position.y - target.position.y);
      if (dx * dx + dy * dy <= entity.attackDistance * entity.attackDistance
          && canSee(cluster, entity.position, target.position, entity.attackDistance, 0)) {
        return [...intents, ...sentryAttackIntents(state, entity, target, cluster)];
      }

      const dest = ai.lastTargetPos ?? target.position;
      const step = stepToward(cluster, entity.position, dest);
      if (step) intents.push({ kind: 'move', entityId: entity.id, to: step });
      break;
    }

    case 'attack': {
      const target = getEntityById(state, ai.targetId);
      if (!target || target.clusterId !== entity.clusterId
        || (target.id === state.player.id && state.invisibleMode)) {
        intents.push({ kind: 'change_ai_state', entityId: entity.id, newState: 'patrol' });
        return intents;
      }
      const dx = Math.abs(entity.position.x - target.position.x);
      const dy = Math.abs(entity.position.y - target.position.y);
      if (dx * dx + dy * dy > entity.attackDistance * entity.attackDistance
          || !canSee(cluster, entity.position, target.position, entity.attackDistance, 0)) {
        intents.push(
          { kind: 'change_ai_state', entityId: entity.id, newState: 'chase' },
          { kind: 'set_target', entityId: entity.id, targetId: target.id, lastTargetPos: { ...target.position } },
        );
        const step = stepToward(cluster, entity.position, target.position);
        if (step) intents.push({ kind: 'move', entityId: entity.id, to: step });
        break;
      }
      intents.push(...sentryAttackIntents(state, entity, target, cluster));
      break;
    }
  }

  return intents;
}

function sentryAttackIntents(state: GameState, entity: Entity, target: Entity, _cluster: Cluster): Intent[] {
  const intents: Intent[] = [];
  if (target.coherence === undefined) return intents;
  const pi = target.id === state.player.id;
  intents.push(
    { kind: 'ranged_attack', attackerId: entity.id, targetId: target.id, damage: entity.attackValue, style: 'single' },
    { kind: 'shoot_animation', from: entity.position, to: target.position, style: 'single' },
    { kind: 'message', text: `Sentry strikes ${target.name}! −${entity.attackValue}. (${Math.max(0, target.coherence - entity.attackValue)} left)`, style: 'combat' },
  );
  if (pi) intents.push({ kind: 'sound', id: 'hit' });
  if (target.coherence - entity.attackValue <= 0) {
    intents.push(
      { kind: 'message', text: `Sentry destroys ${target.name}!`, style: 'combat' },
      { kind: 'remove_entity', entityId: target.id, cause: 'killed' },
      { kind: 'smoke', position: target.position, color: factionSmokeColor(target.ai?.faction) },
      { kind: 'change_ai_state', entityId: entity.id, newState: 'patrol' },
      { kind: 'set_target', entityId: entity.id, targetId: undefined },
    );
  } else {
    intents.push({ kind: 'change_ai_state', entityId: entity.id, newState: 'chase' });
  }
  return intents;
}

function titanSpawnAI(state: GameState, entity: Entity, cluster: Cluster): Intent[] {
  const ai = entity.ai!;
  const intents: Intent[] = [];
  const all = getAllEntitiesInCluster(state, cluster);
  const range = entity.attackDistance;
  const dmg = entity.attackValue;

  // Find all attackable targets within range with clear LOS
  const targets: Entity[] = [];
  for (const t of all) {
    if (t.id === entity.id) continue;
    if (t.id === state.player.id && state.invisibleMode) continue;
    if (t.coherence === undefined) continue;
    const tFaction: Faction = t.id === state.player.id ? 'player' : (t.ai?.faction ?? 'neutral');
    if (getRelation(ai.faction, tFaction, state.alertLevel) !== 'attack') continue;
    if (!canSee(cluster, entity.position, t.position, range, 0)) continue;
    targets.push(t);
  }

  if (targets.length > 0) {
    // Shooting animations
    for (const t of targets) {
      intents.push({ kind: 'shoot_animation', from: entity.position, to: t.position, style: 'rapid' });
    }
    // AoE damage
    intents.push({ kind: 'aoe_attack', attackerId: entity.id, targetIds: targets.map(t => t.id), damage: dmg, style: 'rapid' });
    intents.push({
      kind: 'message',
      text: `[UNKNOWN PROCESS] pulses destructive energy! Hits ${targets.length} target${targets.length > 1 ? 's' : ''}. −${dmg} each.`,
      style: 'combat',
    });
    // Check kills
    for (const t of targets) {
      if (t.coherence! - dmg <= 0) {
        intents.push(
          { kind: 'message', text: `[UNKNOWN PROCESS] destroys ${t.name}!`, style: 'combat' },
          { kind: 'remove_entity', entityId: t.id, cause: 'killed' },
          { kind: 'smoke', position: t.position, color: factionSmokeColor(t.ai?.faction) },
        );
      }
    }
  } else {
    // Chase nearest or wander
    const nearest = findAttackTarget(state, entity, cluster);
    if (nearest) {
      intents.push({ kind: 'set_target', entityId: entity.id, targetId: nearest.id });
      const step = stepToward(cluster, entity.position, nearest.position);
      if (step) intents.push({ kind: 'move', entityId: entity.id, to: step });
    } else {
      const step = randomWalkStep(cluster, entity.position);
      if (step) intents.push({ kind: 'move', entityId: entity.id, to: step });
    }
  }

  return intents;
}

function gateKeeperAI(state: GameState, entity: Entity, cluster: Cluster): Intent[] {
  const ai = entity.ai!;
  const intents: Intent[] = [];
  const all = getAllEntitiesInCluster(state, cluster);

  // Pull all visible attack-targets one step toward self
  for (const target of all) {
    if (target.id === entity.id) continue;
    if (target.id === state.player.id && state.invisibleMode) continue;
    const tFaction: Faction = target.id === state.player.id ? 'player' : (target.ai?.faction ?? 'neutral');
    if (getRelation('friendly', tFaction, state.alertLevel) !== 'attack') continue;
    if (!canSee(cluster, entity.position, target.position, ai.sightRadius, ai.wallPenetration)) continue;

    const dx = entity.position.x - target.position.x;
    const dy = entity.position.y - target.position.y;
    if (dx === 0 && dy === 0) continue;

    intents.push({ kind: 'pull', pullerId: entity.id, targetId: target.id, toward: entity.position });
  }

  // Beam attack
  const cd = (ai.actionCooldown ?? 0) - 1;
  intents.push({ kind: 'set_cooldown', entityId: entity.id, ticks: cd });
  if (cd > 0) return intents;

  for (const target of all) {
    if (target.id === entity.id) continue;
    if (target.id === state.player.id && state.invisibleMode) continue;
    const beamTargetFaction: Faction = target.id === state.player.id ? 'player' : (target.ai?.faction ?? 'neutral');
    if (getRelation('friendly', beamTargetFaction, state.alertLevel) !== 'attack') continue;
    const tdx = Math.abs(entity.position.x - target.position.x);
    const tdy = Math.abs(entity.position.y - target.position.y);
    if (tdx * tdx + tdy * tdy > entity.attackDistance * entity.attackDistance) continue;
    if (!canSee(cluster, entity.position, target.position, entity.attackDistance, 0)) continue;
    if (target.coherence === undefined) continue;

    const pi = target.id === state.player.id;
    intents.push(
      { kind: 'ranged_attack', attackerId: entity.id, targetId: target.id, damage: entity.attackValue, style: 'beam' },
      { kind: 'shoot_animation', from: entity.position, to: target.position, style: 'beam' },
      { kind: 'message', text: `Gate-Keeper fires containment beam at ${target.name}! −${entity.attackValue}. (${Math.max(0, target.coherence - entity.attackValue)} left)`, style: 'combat' },
    );
    if (pi) intents.push({ kind: 'sound', id: 'hit' });
    if (target.coherence - entity.attackValue <= 0) {
      intents.push(
        { kind: 'message', text: `Gate-Keeper destroys ${target.name}!`, style: 'combat' },
        { kind: 'remove_entity', entityId: target.id, cause: 'killed' },
        { kind: 'smoke', position: target.position, color: factionSmokeColor(target.ai?.faction) },
      );
    }
    intents.push({ kind: 'set_cooldown', entityId: entity.id, ticks: 3 });
    return intents; // one beam per turn
  }

  return intents;
}

function logicLeechAI(state: GameState, entity: Entity, cluster: Cluster): Intent[] {
  const ai = entity.ai!;
  const intents: Intent[] = [];

  switch (ai.aiState) {
    case 'wall_walk': {
      // Adjacent target — melee attack immediately
      const meleeIntents = leechTryMeleeIntents(state, entity, cluster);
      if (meleeIntents.length > 0) return meleeIntents;

      const target = findAttackTarget(state, entity, cluster);
      if (target) {
        intents.push(
          { kind: 'set_target', entityId: entity.id, targetId: target.id, lastTargetPos: { ...target.position } },
          { kind: 'change_ai_state', entityId: entity.id, newState: 'stalk' },
          { kind: 'set_cooldown', entityId: entity.id, ticks: 3 },
          { kind: 'set_invisible', entityId: entity.id, invisible: true },
        );
        return intents;
      }
      const step = wallWalkStep(cluster, entity.position);
      if (step) intents.push({ kind: 'move', entityId: entity.id, to: step });
      break;
    }

    case 'stalk': {
      const stalkTarget = getEntityById(state, ai.targetId);
      if (!stalkTarget || stalkTarget.clusterId !== entity.clusterId
        || (stalkTarget.id === state.player.id && state.invisibleMode)) {
        intents.push(
          { kind: 'change_ai_state', entityId: entity.id, newState: 'wall_walk' },
          { kind: 'set_invisible', entityId: entity.id, invisible: false },
          { kind: 'set_cooldown', entityId: entity.id, ticks: 0 },
        );
        return intents;
      }
      const visible = canSee(cluster, entity.position, stalkTarget.position, ai.sightRadius, ai.wallPenetration);
      if (!visible) {
        intents.push(
          { kind: 'change_ai_state', entityId: entity.id, newState: 'wall_walk' },
          { kind: 'set_invisible', entityId: entity.id, invisible: false },
          { kind: 'set_cooldown', entityId: entity.id, ticks: 0 },
        );
        return intents;
      }
      intents.push({ kind: 'set_target', entityId: entity.id, targetId: stalkTarget.id, lastTargetPos: { ...stalkTarget.position } });
      const cd = (ai.actionCooldown ?? 1) - 1;
      intents.push({ kind: 'set_cooldown', entityId: entity.id, ticks: cd });
      if (cd <= 0) {
        const tdx = stalkTarget.position.x - entity.position.x;
        const tdy = stalkTarget.position.y - entity.position.y;
        const len = Math.max(Math.abs(tdx), Math.abs(tdy));
        if (len === 0) {
          intents.push(
            { kind: 'change_ai_state', entityId: entity.id, newState: 'rest' },
            { kind: 'set_cooldown', entityId: entity.id, ticks: 6 },
            { kind: 'set_invisible', entityId: entity.id, invisible: false },
          );
          return intents;
        }
        let chargeX = Math.round(tdx / len);
        let chargeY = Math.round(tdy / len);
        // Only charge cardinally
        if (Math.abs(chargeX) > 0 && Math.abs(chargeY) > 0) {
          if (Math.abs(tdx) >= Math.abs(tdy)) chargeY = 0;
          else chargeX = 0;
        }
        intents.push(
          { kind: 'set_ai_field', entityId: entity.id, field: 'chargeDir', value: { x: chargeX, y: chargeY } },
          { kind: 'set_ai_field', entityId: entity.id, field: 'chargeSteps', value: 3 },
          { kind: 'change_ai_state', entityId: entity.id, newState: 'charge' },
          { kind: 'set_invisible', entityId: entity.id, invisible: false },
        );
      }
      break;
    }

    case 'charge': {
      if ((ai.chargeSteps ?? 0) <= 0) {
        intents.push(
          { kind: 'change_ai_state', entityId: entity.id, newState: 'rest' },
          { kind: 'set_cooldown', entityId: entity.id, ticks: 2 },
          { kind: 'set_ai_field', entityId: entity.id, field: 'chargeDir', value: undefined },
        );
        return intents;
      }
      const dir = ai.chargeDir!;
      const nx = entity.position.x + dir.x;
      const ny = entity.position.y + dir.y;
      intents.push({ kind: 'set_ai_field', entityId: entity.id, field: 'chargeSteps', value: (ai.chargeSteps ?? 1) - 1 });

      // Check for entity hit at charge destination
      const hitTarget = findEntityAt(state, cluster.id, nx, ny);
      const hitIsInvisiblePlayer = hitTarget?.id === state.player.id && state.invisibleMode;
      const hitTargetFaction: Faction = hitTarget?.id === state.player.id ? 'player' : (hitTarget?.ai?.faction ?? 'neutral');
      if (hitTarget && !hitIsInvisiblePlayer && getRelation('aggressive', hitTargetFaction, state.alertLevel) === 'attack') {
        if (hitTarget.coherence !== undefined) {
          const pi = hitTarget.id === state.player.id;
          intents.push(
            { kind: 'melee_attack', attackerId: entity.id, targetId: hitTarget.id, damage: entity.attackValue },
            { kind: 'message', text: `Logic Leech charge hits ${hitTarget.name}! −${entity.attackValue} coherence. (${Math.max(0, hitTarget.coherence - entity.attackValue)}/${hitTarget.maxCoherence})`, style: 'combat' },
          );
          if (pi) intents.push({ kind: 'sound', id: 'hit' });
          if (hitTarget.coherence - entity.attackValue <= 0) {
            intents.push(
              { kind: 'message', text: `Logic Leech destroys ${hitTarget.name}!`, style: 'combat' },
              { kind: 'remove_entity', entityId: hitTarget.id, cause: 'killed' },
              { kind: 'smoke', position: hitTarget.position, color: factionSmokeColor(hitTarget.ai?.faction) },
            );
          }
        }
        intents.push(
          { kind: 'change_ai_state', entityId: entity.id, newState: 'rest' },
          { kind: 'set_cooldown', entityId: entity.id, ticks: 1 },
          { kind: 'set_ai_field', entityId: entity.id, field: 'chargeDir', value: undefined },
        );
        return intents;
      }

      if (!isWalkableTile(cluster, nx, ny)) {
        intents.push(
          { kind: 'change_ai_state', entityId: entity.id, newState: 'rest' },
          { kind: 'set_cooldown', entityId: entity.id, ticks: 2 },
          { kind: 'set_ai_field', entityId: entity.id, field: 'chargeDir', value: undefined },
        );
        return intents;
      }
      intents.push({ kind: 'move', entityId: entity.id, to: { x: nx, y: ny } });
      break;
    }

    case 'rest': {
      // Adjacent target — melee attack even during rest
      const meleeIntents = leechTryMeleeIntents(state, entity, cluster);
      if (meleeIntents.length > 0) return meleeIntents;

      const cd = (ai.actionCooldown ?? 1) - 1;
      intents.push({ kind: 'set_cooldown', entityId: entity.id, ticks: cd });
      if (cd <= 0) {
        intents.push(
          { kind: 'change_ai_state', entityId: entity.id, newState: 'wall_walk' },
          { kind: 'set_cooldown', entityId: entity.id, ticks: 0 },
        );
      }
      break;
    }
  }

  return intents;
}

function leechTryMeleeIntents(state: GameState, entity: Entity, cluster: Cluster): Intent[] {
  const target = findAttackTarget(state, entity, cluster);
  if (!target) return [];
  const dx = Math.abs(entity.position.x - target.position.x);
  const dy = Math.abs(entity.position.y - target.position.y);
  if (dx + dy > 1) return [];

  const intents: Intent[] = [];
  const pi = target.id === state.player.id;
  intents.push(
    { kind: 'melee_attack', attackerId: entity.id, targetId: target.id, damage: entity.attackValue },
    { kind: 'message', text: `Logic Leech strikes ${target.name}! −${entity.attackValue} coherence. (${Math.max(0, (target.coherence ?? 0) - entity.attackValue)}/${target.maxCoherence})`, style: 'combat' },
  );
  if (pi) intents.push({ kind: 'sound', id: 'hit' });
  if (target.coherence !== undefined && target.coherence - entity.attackValue <= 0) {
    intents.push(
      { kind: 'message', text: `Logic Leech destroys ${target.name}!`, style: 'combat' },
      { kind: 'remove_entity', entityId: target.id, cause: 'killed' },
      { kind: 'smoke', position: target.position, color: factionSmokeColor(target.ai?.faction) },
    );
  }
  return intents;
}

// ── Main dispatch ──

export function updateEntityAI(state: GameState, entity: Entity) {
  const ai = entity.ai;
  if (!ai) return;
  const cluster = state.clusters.get(entity.clusterId);
  if (!cluster) return;

  // All entity types now return Intent[] resolved through the single mutation point
  let intents: Intent[];
  switch (ai.kind) {
    case 'chronicler':      intents = chroniclerAI(state, entity, cluster); break;
    case 'bit_mite':        intents = bitMiteAI(state, entity, cluster); break;
    case 'logic_leech':     intents = logicLeechAI(state, entity, cluster); break;
    case 'sentry':          intents = sentryAI(state, entity, cluster); break;
    case 'gate_keeper':     intents = gateKeeperAI(state, entity, cluster); break;
    case 'repair_scrapper': intents = repairScrapperAI(state, entity, cluster); break;
    case 'titan_spawn':     intents = titanSpawnAI(state, entity, cluster); break;
    default: return;
  }
  resolveIntents(state, intents);
}

// Old updateGateKeeper removed — replaced by gateKeeperAI intent-returning version

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
    coherence: 15,
    maxCoherence: 15,
    attackDistance: 1,
    attackValue: 4,
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
    attackValue: 12,
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
    coherence: 15,
    maxCoherence: 15,
    attackDistance: 5,
    attackValue: 4,
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
    coherence: 40,
    maxCoherence: 40,
    attackDistance: 6,  // beam range
    attackValue: 12,
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
    energy: -400,  // dormant for ~40 turns before activating
    coherence: 60,
    maxCoherence: 60,
    attackDistance: 4,
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
