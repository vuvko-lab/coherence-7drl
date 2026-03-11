/**
 * Composable AI behavior primitives.
 *
 * Each behavior is a pure function that reads GameState + Entity and returns
 * Intent[] describing what the entity wants to do. No direct state mutation.
 *
 * These primitives are the building blocks for entity AI state machines.
 * Entity-specific AI (ai.ts) will be migrated to compose these primitives
 * in later phases; for now they can be used alongside the existing code.
 */

import type { GameState, Entity, Cluster, Position, Faction } from './types';
import type { Intent } from './intents';
import { canSee } from './ai';
import { findPath } from './pathfinding';
import { random, pick, shuffle } from './rng';
import { TileType, FACTION_RELATIONS, ALERT_ENEMY } from './types';

// ── Helpers (pure, no mutation) ──

function isWalkable(cluster: Cluster, x: number, y: number): boolean {
  if (x < 0 || x >= cluster.width || y < 0 || y >= cluster.height) return false;
  const tile = cluster.tiles[y][x];
  return tile.walkable || tile.type === TileType.Door;
}

function dist2(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function manhattan(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Get the entity's current room, if any. */
function getEntityRoom(cluster: Cluster, pos: Position) {
  return cluster.rooms.find(r =>
    pos.x >= r.x && pos.x < r.x + r.w && pos.y >= r.y && pos.y < r.y + r.h
  );
}

/** Resolve faction relation including alert-level-dependent friendly→player. */
export function getRelation(attackerFaction: Faction, targetFaction: Faction, alertLevel: number): 'attack' | 'ignore' {
  if (attackerFaction === 'friendly' && targetFaction === 'player') {
    return alertLevel >= ALERT_ENEMY ? 'attack' : 'ignore';
  }
  return FACTION_RELATIONS[attackerFaction]?.[targetFaction] ?? 'ignore';
}

/** Find nearest visible hostile entity. */
export function findNearestHostile(
  state: GameState, entity: Entity, cluster: Cluster,
): Entity | undefined {
  const ai = entity.ai!;
  const all = getAllVisible(state, entity, cluster);
  let best: Entity | undefined;
  let bestDist = Infinity;

  for (const t of all) {
    if (t.id === entity.id) continue;
    const targetFaction: Faction = t.id === state.player.id ? 'player' : (t.ai?.faction ?? 'neutral');
    if (getRelation(ai.faction, targetFaction, state.alertLevel) !== 'attack') continue;
    if (t.id === state.player.id && state.invisibleMode) continue;
    const d = dist2(entity.position, t.position);
    if (d < bestDist) { bestDist = d; best = t; }
  }
  return best;
}

/** Get all entities in cluster visible to this entity (includes marked entities regardless of LOS). */
function getAllVisible(state: GameState, entity: Entity, cluster: Cluster): Entity[] {
  const ai = entity.ai!;
  const result: Entity[] = [];
  // Check player
  if (state.player.clusterId === cluster.id &&
      canSee(cluster, entity.position, state.player.position, ai.sightRadius, ai.wallPenetration)) {
    result.push(state.player);
  }
  // Check other entities
  for (const e of state.entities) {
    if (e.id === entity.id || e.clusterId !== cluster.id) continue;
    if (e._pendingRemoval) continue;
    // Marked entities are visible to all (chronicler broadcast)
    if (state.markedEntities.has(e.id) ||
        canSee(cluster, entity.position, e.position, ai.sightRadius, ai.wallPenetration)) {
      result.push(e);
    }
  }
  return result;
}

// ── Behavior primitives ──

/**
 * Wander randomly. Returns a move intent to a random adjacent walkable tile.
 */
export function behaviorWander(
  entity: Entity, cluster: Cluster, _state: GameState,
): Intent[] {
  const dirs = shuffle([{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }]);
  for (const d of dirs) {
    const nx = entity.position.x + d.x;
    const ny = entity.position.y + d.y;
    if (isWalkable(cluster, nx, ny)) {
      return [{ kind: 'move', entityId: entity.id, to: { x: nx, y: ny } }];
    }
  }
  return [{ kind: 'wait' }];
}

/**
 * Wall-walk: prefer moves that keep a wall adjacent (for Logic Leech).
 */
export function behaviorWallWalk(
  entity: Entity, cluster: Cluster,
): Intent[] {
  const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
  const wallDirs = dirs.filter(d => {
    const nx = entity.position.x + d.x;
    const ny = entity.position.y + d.y;
    if (!isWalkable(cluster, nx, ny)) return false;
    return dirs.some(wd => {
      const wx = nx + wd.x;
      const wy = ny + wd.y;
      const tile = cluster.tiles[wy]?.[wx];
      return tile && !tile.walkable && tile.type === TileType.Wall;
    });
  });

  if (wallDirs.length > 0) {
    const picked = wallDirs[Math.floor(random() * wallDirs.length)];
    const nx = entity.position.x + picked.x;
    const ny = entity.position.y + picked.y;
    return [{ kind: 'move', entityId: entity.id, to: { x: nx, y: ny } }];
  }
  // Fall back to random walk
  return behaviorWander(entity, cluster, undefined as any);
}

/**
 * Chase a target position using pathfinding.
 */
export function behaviorChase(
  entity: Entity, cluster: Cluster, target: Position,
): Intent[] {
  const path = findPath(cluster, entity.position, target);
  if (path && path.length > 0) {
    return [{ kind: 'move', entityId: entity.id, to: path[0] }];
  }
  return [{ kind: 'wait' }];
}

/**
 * Melee attack an adjacent target.
 */
export function behaviorMeleeAttack(
  entity: Entity, target: Entity,
): Intent[] {
  if (manhattan(entity.position, target.position) > 1) return [];
  const intents: Intent[] = [
    {
      kind: 'melee_attack',
      attackerId: entity.id,
      targetId: target.id,
      damage: entity.attackValue,
    },
    {
      kind: 'message',
      text: `${entity.name} strikes ${target.name}! −${entity.attackValue} coherence.`,
      style: 'combat',
    },
    { kind: 'sound', id: 'hit' },
  ];
  return intents;
}

/**
 * Ranged attack a target within attack distance.
 */
export function behaviorRangedAttack(
  entity: Entity, target: Entity, cluster: Cluster,
  style: 'single' | 'beam' | 'rapid' = 'single',
): Intent[] {
  const d2 = dist2(entity.position, target.position);
  if (d2 > entity.attackDistance * entity.attackDistance) return [];
  if (!canSee(cluster, entity.position, target.position, entity.attackDistance, 0)) return [];

  return [
    {
      kind: 'ranged_attack',
      attackerId: entity.id,
      targetId: target.id,
      damage: entity.attackValue,
      style,
    },
    {
      kind: 'shoot_animation',
      from: entity.position,
      to: target.position,
      style,
    },
    {
      kind: 'message',
      text: `${entity.name} fires at ${target.name}! −${entity.attackValue} coherence.`,
      style: 'combat',
    },
  ];
}

/**
 * Patrol within current room, with optional chance to move to adjacent room.
 */
export function behaviorPatrol(
  entity: Entity, cluster: Cluster,
  waypoint: Position | undefined,
  adjacentRoomChance = 0.1,
): { intents: Intent[]; newWaypoint: Position | undefined } {
  const room = getEntityRoom(cluster, entity.position);
  if (!room) return { intents: [{ kind: 'wait' }], newWaypoint: waypoint };

  let wp = waypoint;

  // Pick new waypoint if needed
  if (!wp || (entity.position.x === wp.x && entity.position.y === wp.y)) {
    // Try adjacent room
    if (random() < adjacentRoomChance) {
      const adjIds = cluster.doorAdjacency.get(room.id) ?? [];
      if (adjIds.length > 0) {
        const adjId = pick(adjIds);
        const adjRoom = cluster.rooms.find(r => r.id === adjId);
        if (adjRoom) {
          wp = pickRandomWalkable(cluster, adjRoom);
        }
      }
    }
    // Otherwise pick within current room
    if (!wp || (entity.position.x === wp.x && entity.position.y === wp.y)) {
      wp = pickRandomWalkable(cluster, room);
    }
  }

  if (!wp) return { intents: [{ kind: 'wait' }], newWaypoint: undefined };

  const path = findPath(cluster, entity.position, wp);
  if (path && path.length > 0) {
    return {
      intents: [{ kind: 'move', entityId: entity.id, to: path[0] }],
      newWaypoint: wp,
    };
  }
  return { intents: [{ kind: 'wait' }], newWaypoint: undefined };
}

/**
 * Open a door at a position (for entities that bash doors).
 */
export function behaviorOpenDoor(
  entity: Entity, pos: Position,
): Intent[] {
  return [{ kind: 'open_door', entityId: entity.id, at: pos }];
}

/**
 * Become invisible (for Logic Leech stalk phase).
 */
export function behaviorSetInvisible(
  entity: Entity, invisible: boolean,
): Intent[] {
  return [{ kind: 'set_invisible', entityId: entity.id, invisible }];
}

/**
 * Change AI state.
 */
export function behaviorChangeState(
  entity: Entity, newState: string,
): Intent[] {
  return [{ kind: 'change_ai_state', entityId: entity.id, newState }];
}

/**
 * Set target tracking.
 */
export function behaviorSetTarget(
  entity: Entity, targetId: number | undefined, lastPos?: Position,
): Intent[] {
  return [{ kind: 'set_target', entityId: entity.id, targetId, lastTargetPos: lastPos }];
}

/**
 * Set action cooldown.
 */
export function behaviorSetCooldown(
  entity: Entity, ticks: number,
): Intent[] {
  return [{ kind: 'set_cooldown', entityId: entity.id, ticks }];
}

/**
 * Remove an entity (killed/despawn/dissolve) with smoke effect.
 */
export function behaviorRemoveEntity(
  entity: Entity, cause: 'killed' | 'despawn' | 'dissolve',
  smokeColor: string,
): Intent[] {
  return [
    { kind: 'remove_entity', entityId: entity.id, cause },
    { kind: 'smoke', position: entity.position, color: smokeColor },
    { kind: 'sound', id: 'entity_destroy' },
  ];
}

/**
 * Mark an entity (for Chronicler/White-Hat broadcast).
 */
export function behaviorMarkEntity(
  catalogerId: number,
  targetId: number,
): Intent[] {
  return [{ kind: 'mark_entity', entityId: targetId, catalogerId }];
}

// ── Internal helpers ──

function pickRandomWalkable(cluster: Cluster, room: { x: number; y: number; w: number; h: number }): Position | undefined {
  for (let attempt = 0; attempt < 20; attempt++) {
    const rx = room.x + Math.floor(random() * room.w);
    const ry = room.y + Math.floor(random() * room.h);
    if (cluster.tiles[ry]?.[rx]?.walkable) return { x: rx, y: ry };
  }
  return undefined;
}
