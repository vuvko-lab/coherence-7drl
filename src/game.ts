import {
  GameState, Entity, Cluster, Position, PlayerAction, Tile, PlayerModule,
  TileType, DIR_DELTA, GameMessage, Direction, DebugLogEntry,
  Interactable, DialogChoice, Faction,
  ALERT_SUSPICIOUS, ALERT_ENEMY, ROOT_PRIVILEGES, COLORS,
  FACTION_RELATIONS, NarrativeTriggerEvent,
} from './types';
import { generateCluster, placeEntryPoint } from './cluster';
import { computeFOV, floodFillReveal, hasLOS } from './fov';
import { findPath } from './pathfinding';
import { updateHazards, onPlayerEnterRoom, getPlayerRoom, applyTileHazardToPlayer, updateAlertModule } from './hazards';
import { seed as seedRng, generateSeed, random, randInt, pick, shuffle } from './rng';
import { updateEntityAI, makePropEntity } from './ai';
import { NARRATIVE_TRIGGERS, GAME_MESSAGES } from './narrative/index';
import { makeEntity } from './entity-defs';
import {
  DOOR_CLOSE_DELAY, CORRUPT_M_RANGE as _CORRUPT_M_RANGE,
  PLAYER_MELEE_DAMAGE,
  CORRUPT_M_DAMAGE, CORRUPT_M_COOLDOWN, CORRUPT_M_FREE_SHOTS, CORRUPT_M_DRAIN_PER_EXTRA,
  CLOAK_DURATION, CLOAK_COOLDOWN, CLOAK_FREE_USES, CLOAK_DRAIN_PER_EXTRA,
  MAX_MESSAGES, MAX_DEBUG_LOG, MAX_ACTION_LOG,
} from './balance';
import type { Intent } from './intents';
import { resolveIntents } from './intent-resolver';

export const CORRUPT_M_RANGE = _CORRUPT_M_RANGE;
const MELEE_DAMAGE = PLAYER_MELEE_DAMAGE;

/** Try to push an entity one tile away from pusher. Returns true if successful. */
export function tryPushEntity(
  state: GameState,
  cluster: Cluster,
  entity: Entity,
  pusherPos: Position,
): boolean {
  const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
  for (const d of dirs) {
    const nx = entity.position.x + d.x;
    const ny = entity.position.y + d.y;
    if (nx === pusherPos.x && ny === pusherPos.y) continue; // that's where pusher is
    if (nx < 0 || nx >= cluster.width || ny < 0 || ny >= cluster.height) continue;
    const tile = cluster.tiles[ny]?.[nx];
    if (!tile?.walkable) continue;
    const occupied = (state.player.position.x === nx && state.player.position.y === ny && state.player.clusterId === cluster.id)
      || state.entities.some(e => e.clusterId === cluster.id && e.position.x === nx && e.position.y === ny);
    if (occupied) continue;
    entity.position = { x: nx, y: ny };
    return true;
  }
  return false;
}

function closeDoor(tile: Tile) {
  tile.doorOpen = false;
  tile.walkable = false;
  tile.transparent = false;
  tile.glyph = tile.sealed ? '▪' : '+';
  tile.fg = tile.sealed ? '#ff2222' : tile.fg;
  tile.doorCloseTick = undefined;
}

export function deactivateHazardRoom(state: GameState, cluster: Cluster, hazardRoomId: number): boolean {
  const hazardRoom = cluster.rooms.find(r => r.id === hazardRoomId);
  if (!hazardRoom) return false;
  const wasQuarantine = hazardRoom.roomType === 'quarantine';
  hazardRoom.roomType = 'normal';
  hazardRoom.hazardState = undefined;
  for (let ry = hazardRoom.y; ry < hazardRoom.y + hazardRoom.h; ry++) {
    for (let rx = hazardRoom.x; rx < hazardRoom.x + hazardRoom.w; rx++) {
      const tile = cluster.tiles[ry]?.[rx];
      if (!tile) continue;
      tile.hazardOverlay = undefined;
      if (wasQuarantine && tile.type === TileType.Door && !tile.walkable) {
        tile.sealed = false;
        closeDoor(tile);
        tile.fg = COLORS.door;
      }
    }
  }
  const roomCenter = {
    x: Math.floor(hazardRoom.x + hazardRoom.w / 2),
    y: Math.floor(hazardRoom.y + hazardRoom.h / 2),
  };
  const radius = Math.max(hazardRoom.w, hazardRoom.h);
  applyReveal(state, cluster, floodFillReveal(cluster, roomCenter, radius), 15);
  addMessage(state, GAME_MESSAGES.hazardNeutralized, 'important');
  return true;
}

function deltaToDir(dx: number, dy: number): Direction {
  if (dx === 1) return 'right';
  if (dx === -1) return 'left';
  if (dy === 1) return 'down';
  return 'up';
}

export function createGame(initialSeed?: number): GameState {
  const gameSeed = initialSeed ?? generateSeed();
  seedRng(gameSeed);
  console.log(`[Game] Seed: ${gameSeed} (reproduce with #seed=${gameSeed})`);

  const cluster = generateCluster(0);
  const entryPos = placeEntryPoint(cluster.tiles, cluster.rooms);

  const player: Entity = {
    id: 0x3A7F,
    name: 'ego-fragment',
    glyph: '@',
    fg: '#00ff88',
    position: { ...entryPos },
    clusterId: 0,
    speed: 10,
    energy: 0,
    coherence: 100,
    maxCoherence: 100,
    attackDistance: 1,
    attackValue: 3,
    modules: [
      { id: 'alert.m', status: 'loaded' },
      { id: 'cloak.m', status: 'loaded' },
      { id: 'corrupt.m', status: 'loaded' },
    ],
  };

  const state: GameState = {
    clusters: new Map([[0, cluster]]),
    currentClusterId: 0,
    player,
    entities: [],
    nextClusterId: 1,
    tick: 0,
    messages: [],
    autoPath: [],
    actionLog: [],
    seed: gameSeed,
    debugMode: false,
    debugLog: [],
    mapReveal: false,
    godMode: false,
    invisibleMode: false,
    showRoomLabels: false,
    showCollapseOverlay: false,
    showFunctionalOverlay: false,
    showAlertOverlay: false,
    showEnemyVision: false,
    revealEffects: [],
    shootingEffects: [],
    animation: null,
    hazardFogMarks: new Map(),
    alertLevel: 0,
    markedEntities: new Map(),
    rootPrivileges: [],
    killedEntities: [],
    finalClusterId: 5,
    collapseGlitchTiles: new Map(),
    selfPanelRevealed: false,
    smokeEffects: [],
    markEffects: [],
    pendingSounds: [],
    firedTriggerIds: new Set(),
    corruptShotsFired: 0,
    cloakActivations: 0,
    terminalsRead: 0,
  };

  // Fire cluster 0 entry triggers
  checkNarrativeTriggers(state, 'cluster_enter', { clusterId: 0 });

  for (const line of GAME_MESSAGES.boot) addMessage(state, line, 'system');

  computeFOV(cluster, player.position);

  // Spawn entities in the starting cluster
  spawnClusterEntities(state, cluster);

  return state;
}

export function addMessage(state: GameState, text: string, type: GameMessage['type'] = 'normal') {
  state.messages.push({ text, type, tick: state.tick });
}

export function dlog(state: GameState, category: DebugLogEntry['category'], event: string, detail?: string) {
  state.debugLog.push({ tick: state.tick, cluster: state.currentClusterId, category, event, detail });
}

// ── Entity spawning ──

/**
 * Spawn AI entities in a cluster. Scale count by cluster depth.
 * Called once when a cluster is first visited.
 */
function spawnClusterEntities(state: GameState, cluster: Cluster) {
  const id = cluster.id;

  // Cluster 0 is fully enemy-free (tutorial zone) — only spawn scenario props
  if (id === 0) {
    for (const room of cluster.rooms) {
      const props = room.scenarioState?.pendingProps;
      if (!props || props.length === 0) continue;
      for (const p of props) {
        const e = makePropEntity(p.position, id, p.glyph, p.fg, p.name, p.propTag);
        const ppKey = `${state.player.position.x},${state.player.position.y}`;
        if (`${e.position.x},${e.position.y}` !== ppKey) state.entities.push(e);
      }
      room.scenarioState!.pendingProps = [];
    }
    return;
  }

  const allRooms = cluster.rooms.filter(r => !r.tags.geometric.has('hall'));
  if (allRooms.length === 0) return;

  const depth = id + 1; // 1-indexed depth for scaling

  const spawned: Entity[] = [];

  function pickWalkableTile(room: typeof allRooms[number]): Position | null {
    for (let attempt = 0; attempt < 30; attempt++) {
      const x = room.x + 1 + Math.floor(random() * (room.w - 2));
      const y = room.y + 1 + Math.floor(random() * (room.h - 2));
      if (cluster.tiles[y]?.[x]?.walkable) return { x, y };
    }
    return null;
  }

  // Mite guard: cluster 2+ spawns 2–3 Bit-Mites near each forward exit interface.
  // Skips the back-reference entry (x=0). Searches a 3-tile radius so mites
  // are guaranteed to spawn on reachable floor even if the exit is in a corridor.
  if (id >= 2) {
    const guardCount = id >= 4 ? 3 : 2;
    for (const iface of cluster.interfaces) {
      if (iface.position.x === 0) continue; // skip entry back-reference
      const { x: ix, y: iy } = iface.position;
      const nearby: Position[] = [];
      for (let dy2 = -3; dy2 <= 3; dy2++) {
        for (let dx2 = -3; dx2 <= -1; dx2++) {
          const nx2 = ix + dx2, ny2 = iy + dy2;
          if (nx2 < 0 || nx2 >= cluster.width || ny2 < 0 || ny2 >= cluster.height) continue;
          const t = cluster.tiles[ny2]?.[nx2];
          if (t?.walkable && t.type !== TileType.InterfaceExit) nearby.push({ x: nx2, y: ny2 });
        }
      }
      shuffle(nearby);
      for (let i = 0; i < Math.min(guardCount, nearby.length); i++) {
        spawned.push(makeEntity('bit_mite', nearby[i], id));
      }
    }
  }

  // ── Shuffle-and-cooldown spawn loop ──
  // Shuffles all eligible rooms, iterates in random order.
  // Each room gets one spawn roll; after a successful spawn, the next 5 rooms are skipped.
  // Spawn chance scales with room collapse + cluster depth.
  // Entity kind is weighted by room geometry; functional tag modifies entity stats.

  const shuffled = shuffle([...allRooms]);
  const baseChance = 0.05 + depth * 0.025; // 0.10 at depth 2, 0.175 at depth 5
  let cooldown = 0;

  for (const room of shuffled) {
    if (cooldown > 0) { cooldown--; continue; }
    if (room.roomType === 'corrupted') continue; // corruption rooms are uninhabitable

    const spawnChance = Math.min(0.75, baseChance + room.collapse * 0.35);
    if (random() >= spawnChance) continue;

    const pos = pickWalkableTile(room);
    if (!pos) continue;

    // Pick entity kind: weighted by geometry and room type
    const isPeripheral = room.tags.geometric.has('peripheral') || room.tags.geometric.has('dead_end');
    const inSafeRoom = room.roomType === 'normal';
    const hasEnemies = id >= 2; // enemies only in cluster 2+

    // Weights: [bit_mite, logic_leech, chronicler, sentry, gate_keeper, repair_scrapper]
    // Logic Leech and Gate-Keeper scale up significantly with cluster depth.
    // Sentry spawns are rare and capped to avoid friendly flood.
    const leechWeight = hasEnemies
      ? (isPeripheral ? 2 + depth : 1 + depth * 0.5)  // leech loves edges, scales with depth
      : 0;
    const gkWeight = hasEnemies
      ? Math.max(0, (depth - 2) * 1.2) * (room.collapse > 0.5 ? 2 : 1)  // starts cluster 2+, steeper ramp
      : 0;
    // Sentry: rare overall, capped weight so it never dominates
    const whWeight = hasEnemies && inSafeRoom ? Math.min(0.5, 0.1 * depth) : 0;
    // Repair scrapper: low weight in cluster 1, slightly higher in clusters 4-5
    const rsWeight = id >= 4 ? 1.5 : id >= 2 ? 0.6 : 0.4;
    const w = [
      hasEnemies ? 6 + depth * 1.5 : 0,  // bit_mite: dominant, grows fast with depth
      leechWeight,                         // logic_leech: scales with depth, prefers edges
      hasEnemies ? 1.2 : 0,               // chronicler: constant low neutral presence
      whWeight,                            // sentry: rare, capped
      gkWeight,                            // gate_keeper: scales from cluster 2+
      rsWeight,                            // repair_scrapper: all clusters 1+
    ];
    const total = w[0] + w[1] + w[2] + w[3] + w[4] + w[5];
    const roll = random() * total;

    let entity: Entity;
    if (roll < w[0]) {
      entity = makeEntity('bit_mite', pos, id);
    } else if (roll < w[0] + w[1]) {
      entity = makeEntity('logic_leech', pos, id);
    } else if (roll < w[0] + w[1] + w[2]) {
      entity = makeEntity('chronicler', pos, id);
    } else if (roll < w[0] + w[1] + w[2] + w[3]) {
      entity = makeEntity('sentry', pos, id);
    } else if (roll < w[0] + w[1] + w[2] + w[3] + w[4]) {
      entity = makeEntity('gate_keeper', pos, id);
    } else {
      entity = makeEntity('repair_scrapper', pos, id);
    }

    // Apply functional tag modifiers to entity stats
    applyFunctionalTagModifiers(entity, room.tags.functional);

    spawned.push(entity);
    cooldown = 8; // skip next 8 rooms before rolling again
  }

  // Spawn scenario prop entities from rooms that have pendingProps
  for (const room of cluster.rooms) {
    const props = room.scenarioState?.pendingProps;
    if (!props || props.length === 0) continue;
    for (const p of props) {
      // Special prop tags that resolve to real entities instead of static props
      if (p.propTag === 'ritual_gatekeeper') {
        spawned.push(makeEntity('gate_keeper', p.position, id));
      } else {
        spawned.push(makePropEntity(p.position, id, p.glyph, p.fg, p.name, p.propTag));
      }
    }
    room.scenarioState!.pendingProps = []; // clear so we don't re-spawn
  }

  // Cluster 4: spawn 1-2 TitanSpawn; Cluster 5: spawn 3-5 TitanSpawn
  if (id === 5) {
    const highCollapse = allRooms
      .filter(r => r.collapse > 0.4)
      .sort((a, b) => b.collapse - a.collapse)
      .slice(0, 2);
    const titanCount = Math.min(randInt(1, 2), highCollapse.length);
    for (let ti = 0; ti < titanCount; ti++) {
      const pos = pickWalkableTile(highCollapse[ti]);
      if (pos) spawned.push(makeEntity('titan_spawn', pos, id));
    }
  }

  // Don't spawn on player position
  const ppKey = `${state.player.position.x},${state.player.position.y}`;
  for (const e of spawned) {
    if (`${e.position.x},${e.position.y}` !== ppKey) {
      state.entities.push(e);
    }
  }
}

/**
 * Apply functional room tag modifiers to an entity's base stats.
 * Tag influences HP, damage, speed, and starting state — not entity kind.
 */
function applyFunctionalTagModifiers(entity: Entity, tag: import('./types').FunctionalTag | null) {
  if (!tag || entity.coherence == null) return;
  const scale = (entity: Entity, hpMult: number, dmgMult: number, alreadyDamaged = false) => {
    entity.coherence    = Math.max(1, Math.ceil(entity.coherence!    * hpMult));
    entity.maxCoherence = Math.max(1, Math.ceil((entity.maxCoherence ?? entity.coherence!) * hpMult));
    entity.attackValue  = Math.max(0, Math.ceil(entity.attackValue   * dmgMult));
    if (alreadyDamaged) {
      // Start at 40-70% HP to simulate a battle-worn entity
      const frac = 0.4 + random() * 0.3;
      entity.coherence = Math.max(1, Math.ceil(entity.maxCoherence! * frac));
    }
  };
  switch (tag) {
    case 'reactor':       scale(entity, 0.7, 1.6); break;        // fragile but hits hard
    case 'armory':        scale(entity, 1.0, 1.5); break;        // fully armed
    case 'barracks':      scale(entity, 1.2, 1.3); break;        // combat-ready, tougher
    case 'bridge':        scale(entity, 1.3, 1.3); break;        // elite unit
    case 'engine_room':   scale(entity, 1.4, 1.0); break;        // reinforced systems
    case 'lab':           scale(entity, 1.5, 0.8); break;        // experimental: high HP, low damage
    case 'server_rack':   scale(entity, 1.2, 0.9); break;        // process-heavy, slightly tougher
    case 'sensor_matrix': scale(entity, 0.8, 1.0, true); break;  // already damaged
    case 'medbay':        scale(entity, 1.0, 0.7, true); break;  // wounded but in care
    case 'archive':       scale(entity, 0.9, 0.8, true); break;  // degraded, low-threat
    case 'cargo':         scale(entity, 0.7, 0.9); break;        // fragile
    case 'hangar':        scale(entity, 0.75, 1.0); break;       // exposed, fragile
    case 'comms':         scale(entity, 1.0, 0.6); break;        // comm-focused, low damage
    case 'maintenance':   break;                                   // no modifier
  }
}

/**
 * Simulation helper: generate a cluster at a given depth, spawn entities, and return them.
 * Used by sim-test.ts to measure expected entity counts per cluster depth.
 */
export function sampleEntitySpawn(clusterId: number, rngSeed: number): Entity[] {
  seedRng(rngSeed);
  const cluster = generateCluster(clusterId);
  const mockState = {
    entities: [] as Entity[],
    player: { id: -1, clusterId: -1, position: { x: -999, y: -999 } },
  } as unknown as GameState;
  spawnClusterEntities(mockState, cluster);
  return mockState.entities;
}

function getCurrentCluster(state: GameState): Cluster {
  return state.clusters.get(state.currentClusterId)!;
}

function isWalkable(cluster: Cluster, x: number, y: number): boolean {
  if (x < 0 || x >= cluster.width || y < 0 || y >= cluster.height) return false;
  return cluster.tiles[y][x].walkable;
}

export function getEntityAt(state: GameState, cluster: Cluster, x: number, y: number): Entity | undefined {
  if (state.player.clusterId === cluster.id &&
      state.player.position.x === x && state.player.position.y === y) return state.player;
  return state.entities.find(
    e => e.clusterId === cluster.id && e.position.x === x && e.position.y === y
  );
}

// Module constants imported from balance.ts

/**
 * Collect intents for a corrupt.m ranged shot. Returns { acted, intents }.
 * Module bookkeeping (cooldowns, shot counts, drain) is applied directly
 * since it's player-specific state. Combat damage is expressed as intents.
 */
function collectShootIntents(state: GameState, target: Position): { acted: boolean; intents: Intent[] } {
  const cluster = getCurrentCluster(state);
  const corrupt = state.player.modules?.find(m => m.id === 'corrupt.m' && m.status === 'loaded');
  if (!corrupt) {
    addMessage(state, GAME_MESSAGES.noAttackModule, 'alert');
    return { acted: false, intents: [] };
  }

  // Cooldown check
  if (corrupt.cooldownUntilTick != null && corrupt.cooldownUntilTick > state.tick) {
    const remaining = corrupt.cooldownUntilTick - state.tick;
    addMessage(state, `corrupt.m reloading — ${remaining} tick${remaining !== 1 ? 's' : ''} remaining.`, 'alert');
    return { acted: false, intents: [] };
  }

  const from = state.player.position;
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > CORRUPT_M_RANGE) {
    addMessage(state, GAME_MESSAGES.targetOutOfRange, 'alert');
    return { acted: false, intents: [] };
  }

  const targetTile = cluster.tiles[target.y]?.[target.x];
  if (!targetTile?.visible) {
    addMessage(state, GAME_MESSAGES.noVisibleTarget, 'alert');
    return { acted: false, intents: [] };
  }

  if (!hasLOS(cluster, from, target)) {
    addMessage(state, GAME_MESSAGES.noLineOfSight, 'alert');
    return { acted: false, intents: [] };
  }

  // Module bookkeeping: track shots and apply coherence drain beyond free quota
  const shotCount = corrupt.clusterShotCount ?? 0;
  const overQuota = shotCount - CORRUPT_M_FREE_SHOTS + 1; // >0 means this shot drains
  if (overQuota > 0 && state.player.coherence != null && !state.godMode) {
    const drain = overQuota * CORRUPT_M_DRAIN_PER_EXTRA;
    state.player.coherence = Math.max(0, state.player.coherence - drain);
    const rolledState = pick(['heap corruption', 'memory corruption', 'buffer overflow', 'stack overflow', 'BUG', 'error'])
    addMessage(state, `[LEAK] ${rolledState} in corrupt.m — coherence drain: −${drain} (${state.player.coherence}/${state.player.maxCoherence}).`, 'hazard');
  }

  corrupt.clusterShotCount = shotCount + 1;
  corrupt.cooldownUntilTick = state.tick + CORRUPT_M_COOLDOWN;
  state.corruptShotsFired++;
  dlog(state, 'player', 'shoot', `target=(${target.x},${target.y}) shot#=${corrupt.clusterShotCount}`);

  // Build intents for combat effects
  const intents: Intent[] = [
    { kind: 'sound', id: 'shoot' },
    { kind: 'shoot_animation', from: { ...from }, to: { ...target }, style: 'beam' as const },
  ];

  // Damage entity at target if present
  const targetEntity = getEntityAt(state, cluster, target.x, target.y);
  if (targetEntity && targetEntity.id !== state.player.id && targetEntity.coherence !== undefined) {
    const postHp = Math.max(0, targetEntity.coherence - CORRUPT_M_DAMAGE);
    intents.push(
      { kind: 'ranged_attack', attackerId: state.player.id, targetId: targetEntity.id, damage: CORRUPT_M_DAMAGE, style: 'beam' },
      { kind: 'message', text: `Corrupt shot hits ${targetEntity.name} for ${CORRUPT_M_DAMAGE}. (${postHp}/${targetEntity.maxCoherence})`, style: 'combat' },
    );
  }

  // Warn when the NEXT shot will start draining coherence
  const newCount = corrupt.clusterShotCount;
  if (newCount === CORRUPT_M_FREE_SHOTS) {
    intents.push({ kind: 'message', text: GAME_MESSAGES.corruptModuleWarn, style: 'alert' });
  }

  return { acted: true, intents };
}

// ── Cloak module ──

export function activateCloak(state: GameState, cloak: PlayerModule): boolean {
  if (cloak.status !== 'loaded') {
    addMessage(state, 'cloak.m is offline.', 'alert');
    return false;
  }
  if (cloak.active) {
    addMessage(state, 'cloak.m already active.', 'alert');
    return false;
  }
  if (cloak.cooldownUntilTick && state.tick < cloak.cooldownUntilTick) {
    const remaining = cloak.cooldownUntilTick - state.tick;
    addMessage(state, `cloak.m reloading... ${remaining} ticks remaining.`, 'alert');
    return false;
  }

  const useCount = cloak.clusterUseCount ?? 0;
  const overQuota = useCount - CLOAK_FREE_USES + 1; // >0 means this use drains
  if (overQuota > 0 && state.player.coherence != null && !state.godMode) {
    const drain = overQuota * CLOAK_DRAIN_PER_EXTRA;
    state.player.coherence = Math.max(0, state.player.coherence - drain);
    const rolledState = pick(['signal leak', 'phase drift', 'sync loss', 'buffer underrun', 'echo bleed']);
    addMessage(state, `[LEAK] ${rolledState} in cloak.m — coherence drain: −${drain} (${state.player.coherence}/${state.player.maxCoherence}).`, 'hazard');
  }

  cloak.clusterUseCount = useCount + 1;
  state.cloakActivations++;
  cloak.active = true;
  cloak.cloakExpiresAtTick = state.tick + CLOAK_DURATION;
  cloak.cooldownUntilTick = state.tick + CLOAK_COOLDOWN;
  state.invisibleMode = true;

  addMessage(state, `cloak.m engaged — invisible for ${CLOAK_DURATION} ticks.`, 'important');

  if (useCount + 1 === CLOAK_FREE_USES) {
    addMessage(state, 'cloak.m: next activation will drain coherence.', 'alert');
  }

  dlog(state, 'player', 'cloak_activate', `use#=${cloak.clusterUseCount} expires=${cloak.cloakExpiresAtTick}`);
  return true;
}

function updateCloak(state: GameState): void {
  const cloak = state.player.modules?.find(m => m.id === 'cloak.m');
  if (!cloak?.active) return;
  if (cloak.cloakExpiresAtTick && state.tick >= cloak.cloakExpiresAtTick) {
    cloak.active = false;
    cloak.cloakExpiresAtTick = undefined;
    state.invisibleMode = false;
    addMessage(state, 'cloak.m disengaged — you are visible again.', 'alert');
    dlog(state, 'player', 'cloak_expire', `tick=${state.tick}`);
  }
}

// ── Player actions ──

/**
 * Collect intents for a player move. Returns { acted, intents }.
 * UI-only side effects (terminal/interactable opening) are applied directly.
 * All game-state mutations are expressed as intents.
 */
function collectMoveIntents(state: GameState, dx: number, dy: number): { acted: boolean; intents: Intent[] } {
  const cluster = getCurrentCluster(state);
  const nx = state.player.position.x + dx;
  const ny = state.player.position.y + dy;

  if (nx < 0 || nx >= cluster.width || ny < 0 || ny >= cluster.height) return { acted: false, intents: [] };

  const targetTile = cluster.tiles[ny][nx];

  // God mode: walk through anything (noclip)
  if (state.godMode) {
    const intents: Intent[] = [
      { kind: 'move', entityId: state.player.id, to: { x: nx, y: ny }, force: true },
      { kind: 'sound', id: 'step' },
    ];
    if (targetTile.type === TileType.InterfaceExit) {
      intents.push({ kind: 'message', text: GAME_MESSAGES.interfaceExitDetected, style: 'important' });
    }
    return { acted: true, intents };
  }

  // Bump-to-open: closed door → open it, costs a turn, don't move
  if (targetTile.type === TileType.Door && !targetTile.doorOpen && targetTile.glyph === '+') {
    return {
      acted: true,
      intents: [
        { kind: 'open_door', entityId: state.player.id, at: { x: nx, y: ny } },
        { kind: 'sound', id: 'door_open' },
      ],
    };
  }

  // Bump-into-terminal → open it, no turn cost (UI-only)
  if (targetTile.type === TileType.Terminal && targetTile.terminalId) {
    state.openTerminal = { terminalId: targetTile.terminalId, clusterId: state.currentClusterId };
    return { acted: false, intents: [] };
  }

  // Bump-into-interactable → open dialog, no turn cost (UI-only)
  const bumped = cluster.interactables.find(
    i => i.position.x === nx && i.position.y === ny && !i.hidden,
  );
  if (bumped) {
    bumped.currentNodeId = 'root';
    state.openInteractable = { id: bumped.id, clusterId: state.currentClusterId };
    return { acted: false, intents: [] };
  }

  // Bump-into-entity → melee (hostile), push (friendly), or examine (neutral)
  const bumpedEntity = getEntityAt(state, cluster, nx, ny);
  if (bumpedEntity && bumpedEntity.id !== state.player.id) {
    const targetFaction: Faction = bumpedEntity.ai?.faction ?? 'neutral';
    const canAttack = FACTION_RELATIONS['player']?.[targetFaction] === 'attack';
    if (canAttack) {
      if (bumpedEntity.coherence !== undefined) {
        const postHp = Math.max(0, bumpedEntity.coherence - MELEE_DAMAGE);
        const intents: Intent[] = [
          { kind: 'melee_attack', attackerId: state.player.id, targetId: bumpedEntity.id, damage: MELEE_DAMAGE },
          { kind: 'sound', id: 'melee' },
          { kind: 'message', text: `You strike ${bumpedEntity.name} for ${MELEE_DAMAGE}. (${postHp}/${bumpedEntity.maxCoherence})`, style: 'important' },
        ];
        dlog(state, 'entity', 'player_melee', `target=${bumpedEntity.name} dmg=${MELEE_DAMAGE} postHp=${postHp}`);
        return { acted: true, intents };
      }
      return { acted: true, intents: [] };
    } else if (targetFaction === 'friendly') {
      // Push + move through intents (resolveIntents processes sequentially)
      return {
        acted: true,
        intents: [
          { kind: 'push_entity', pusherId: state.player.id, targetId: bumpedEntity.id, awayFrom: state.player.position },
          { kind: 'move', entityId: state.player.id, to: { x: nx, y: ny } },
        ],
      };
    } else {
      addMessage(state, `You observe ${bumpedEntity.name}. It does not react.`, 'normal');
      return { acted: false, intents: [] };
    }
  }

  if (!isWalkable(cluster, nx, ny)) {
    return { acted: false, intents: [] };
  }

  // Normal move
  const intents: Intent[] = [
    { kind: 'move', entityId: state.player.id, to: { x: nx, y: ny } },
  ];

  // Check for interface exit
  if (targetTile.type === TileType.InterfaceExit) {
    if (cluster.id === 0 && nx < 1) {
      intents.push({ kind: 'message', text: GAME_MESSAGES.sleevingFacility, style: 'important' });
    } else if (nx < 1) {
      intents.push({ kind: 'message', text: GAME_MESSAGES.interfaceClosed, style: 'important' });
    } else {
      intents.push({ kind: 'message', text: GAME_MESSAGES.interfaceLocated, style: 'important' });
    }
  }

  return { acted: true, intents };
}

function tryTransfer(state: GameState): boolean {
  const cluster = getCurrentCluster(state);
  const { x, y } = state.player.position;
  const tile = cluster.tiles[y][x];

  if (tile.type !== TileType.InterfaceExit) {
    addMessage(state, GAME_MESSAGES.noInterfaceHere);
    return false;
  }

  // Find the interface exit
  const iface = cluster.interfaces.find(
    i => i.position.x === x && i.position.y === y
  );
  if (!iface) return false;

  // Block backtracking through entry interface (x=0 in all clusters except the first)
  if (iface.position.x === 0 && cluster.id > 0) {
    addMessage(state, GAME_MESSAGES.interfaceBlocked, 'important');
    return false;
  }

  // Victory: exiting the final cluster triggers the end screen
  if (cluster.id === state.finalClusterId && x > 0) {
    state.gameOver = true;
    addMessage(state, GAME_MESSAGES.victory, 'important');
    return false;
  }

  // Forward exits (x > 0; x=0 is always the back-entry) require authorization
  if (x > 0 && cluster.exitLocked) {
    addMessage(state, GAME_MESSAGES.exitLocked, 'hazard');
    return false;
  }

  // Generate target cluster if needed
  if (iface.targetClusterId === -1) {
    const newId = state.nextClusterId++;
    const newCluster = generateCluster(newId);
    const entryPos = placeEntryPoint(newCluster.tiles, newCluster.rooms);

    iface.targetClusterId = newId;
    iface.targetPosition = entryPos;

    // Create a back-reference interface in the new cluster
    // (entry point leads back)
    newCluster.interfaces.push({
      position: { x: 0, y: entryPos.y },
      targetClusterId: cluster.id,
      targetPosition: { x: x, y: y },
    });
    // Make the entry tile an interface exit for the back connection
    if (newCluster.tiles[entryPos.y]?.[0]) {
      newCluster.tiles[entryPos.y][0].type = TileType.InterfaceExit;
      newCluster.tiles[entryPos.y][0].glyph = '⇏';
      newCluster.tiles[entryPos.y][0].fg = '#ff8844';
      newCluster.tiles[entryPos.y][0].walkable = true;
    }

    state.clusters.set(newId, newCluster);
    spawnClusterEntities(state, newCluster);
    addMessage(state, `Cluster ${newId} generated.`, 'system');
  }

  // Leaving cluster 0 always reveals the SELF panel (for players who skip the tutorial echo)
  if (cluster.id === 0) state.selfPanelRevealed = true;

  // Transfer player
  const targetCluster = state.clusters.get(iface.targetClusterId)!;
  state.currentClusterId = iface.targetClusterId;
  state.player.clusterId = iface.targetClusterId;
  state.player.position = { ...iface.targetPosition! };
  state.autoPath = [];

  // Clear per-cluster transient state on transfer
  state.hazardFogMarks.clear();
  state.revealEffects = [];
  // Reset corrupt.m shot quota (two free shots per cluster)
  const corruptM = state.player.modules?.find(m => m.id === 'corrupt.m');
  if (corruptM) corruptM.clusterShotCount = 0;
  // Reset cloak.m on transfer: end cloak, reset uses, clear cooldown
  const cloakM = state.player.modules?.find(m => m.id === 'cloak.m');
  if (cloakM) {
    if (cloakM.active) {
      cloakM.active = false;
      cloakM.cloakExpiresAtTick = undefined;
      state.invisibleMode = false;
    }
    cloakM.clusterUseCount = 0;
    cloakM.cooldownUntilTick = undefined;
  }

  state.pendingSounds.push('transfer');
  if (cluster.id === 0) {
    addMessage(state, GAME_MESSAGES.sleevingFacility, 'important');
  } else {
    addMessage(state, `${GAME_MESSAGES.transferPrefix} ${iface.targetClusterId}.`, 'important');
  }

  dlog(state, 'system', 'cluster_transfer', `from=${state.currentClusterId} to=${iface.targetClusterId}`);
  checkNarrativeTriggers(state, 'cluster_enter', { clusterId: iface.targetClusterId });

  // Clean up entities from previous clusters to prevent unbounded growth
  state.entities = state.entities.filter(e => e.clusterId === iface.targetClusterId || e.id === state.player.id);

  // Cap log arrays to prevent memory bloat over long sessions
  if (state.messages.length > MAX_MESSAGES) state.messages = state.messages.slice(-MAX_MESSAGES);
  if (state.debugLog.length > MAX_DEBUG_LOG) state.debugLog = state.debugLog.slice(-MAX_DEBUG_LOG);
  if (state.actionLog.length > MAX_ACTION_LOG) state.actionLog = state.actionLog.slice(-MAX_ACTION_LOG);

  computeFOV(targetCluster, state.player.position);
  return true;
}

// ── Door auto-close ──

function updateDoors(state: GameState): boolean {
  const cluster = getCurrentCluster(state);
  const px = state.player.position.x;
  const py = state.player.position.y;
  let changed = false;

  for (let y = 0; y < cluster.height; y++) {
    for (let x = 0; x < cluster.width; x++) {
      const tile = cluster.tiles[y][x];
      if (tile.type !== TileType.Door || !tile.doorOpen) continue;

      // Check if occupied by player or entity
      const occupied = (x === px && y === py) ||
        state.entities.some(e => e.clusterId === state.currentClusterId && e.position.x === x && e.position.y === y);

      if (occupied) {
        tile.doorCloseTick = undefined;
      } else if (tile.doorCloseTick === undefined) {
        tile.doorCloseTick = state.tick;
      } else if (state.tick - tile.doorCloseTick >= DOOR_CLOSE_DELAY) {
        closeDoor(tile);
        changed = true;
      }
    }
  }

  return changed;
}

// ── Turn processing ──

export function processAction(state: GameState, action: PlayerAction): boolean {
  // ── Phase 1: Collect player intents ──
  let acted = false;
  let playerIntents: Intent[] = [];

  switch (action.kind) {
    case 'move': {
      const delta = DIR_DELTA[action.dir];
      const result = collectMoveIntents(state, delta.x, delta.y);
      acted = result.acted;
      playerIntents = result.intents;
      break;
    }
    case 'transfer':
      acted = tryTransfer(state);
      break;
    case 'wait':
      acted = true;
      break;
    case 'shoot': {
      const result = collectShootIntents(state, action.target);
      acted = result.acted;
      playerIntents = result.intents;
      break;
    }
  }

  // Resolve player intents through the single mutation point
  if (playerIntents.length > 0) {
    resolveIntents(state, playerIntents);
  }

  if (acted) {
    state.actionLog.push(action);

    // Track room change for entry triggers
    const prevRoom = getPlayerRoom(state);

    state.tick++;

    // ── Phase 2: Environment reacts ──
    const cluster = getCurrentCluster(state);
    computeFOV(cluster, state.player.position);

    // Check room entry
    const newRoom = getPlayerRoom(state);
    if (newRoom && (!prevRoom || prevRoom.id !== newRoom.id)) {
      dlog(state, 'room', 'enter', `room=${newRoom.id} type=${newRoom.roomType} functional=${newRoom.tags.functional} collapse=${newRoom.collapse.toFixed(2)}`);
      onPlayerEnterRoom(state, newRoom);
      checkNarrativeTriggers(state, 'room_enter', { room: newRoom });
    }

    // Update doors (auto-close), recompute FOV if any closed
    if (updateDoors(state)) {
      computeFOV(cluster, state.player.position);
    }

    // ── Phase 3: Hazards & room effects ──
    updateHazards(state);
    applyTileHazardToPlayer(state);

    // Check coherence-low triggers after hazard damage
    checkNarrativeTriggers(state, 'coherence_low');
    updateAlertModule(state);
    updateCloak(state);

    // Check if final terminal lockdown expired — unlock exit
    checkFinalTerminalLockExpiry(state, cluster);

    // Update alert fog marks from newly visible hazard tiles
    updateHazardFogMarks(state, cluster);

    // Expire reveal effects
    state.revealEffects = state.revealEffects.filter(e => e.expireTick > state.tick);

    // Clear shooting effects - they are handled by animation system now
    state.shootingEffects = [];

    // Update lost echo visibility (random hide/reappear)
    for (const item of cluster.interactables) {
      if (item.kind !== 'lost_echo') continue;
      if (item.hidden && state.tick >= item.hiddenUntilTick) {
        item.hidden = false;
      } else if (!item.hidden && state.openInteractable?.id !== item.id) {
        if (random() < 0.004) {
          item.hidden = true;
          item.hiddenUntilTick = state.tick + randInt(6, 22);
        }
      }
    }

    // ── Phase 4: Entity AI ──
    for (let i = 0; i < state.entities.length; i++) {
      const entity = state.entities[i];
      if (entity._pendingRemoval) continue;
      if (entity.clusterId !== state.currentClusterId) continue;
      entity.energy += 10;
      if (entity.energy >= entity.speed) {
        entity.energy -= entity.speed;
        updateEntityAI(state, entity);
      }
    }

    // ── Phase 5: Cleanup ──
    // Catch any entities that reached coherence 0 (from player combat, hazards, etc.)
    // but weren't explicitly removed via remove_entity intents.
    for (const e of state.entities) {
      if (e._pendingRemoval) continue; // already handled by intent resolver
      if ((e.coherence ?? 1) <= 0 && e.id !== state.player.id) {
        state.pendingSounds.push('entity_destroy');
        if (!state.smokeEffects.some(s => s.x === e.position.x && s.y === e.position.y)) {
          const _sf = e.ai?.faction;
          state.smokeEffects.push({
            x: e.position.x, y: e.position.y,
            fg: _sf === 'aggressive' ? '#cc4444' : _sf === 'friendly' ? '#23d2a6' : _sf === 'titan' ? '#ff44ff' : '#aaaa66',
            spawnTime: 0, // stamped by presentation layer
          });
        }
        if (e.ai) {
          state.killedEntities.push({ name: e.name, kind: e.ai.kind, byPlayer: e._lastDamagedBy === state.player.id });
          state.markedEntities.delete(e.id);
          // If a chronicler dies, remove all marks it created
          if (e.ai.kind === 'chronicler') {
            for (const [markedId, catalogerId] of state.markedEntities) {
              if (catalogerId === e.id) state.markedEntities.delete(markedId);
            }
          }
          dlog(state, 'entity', 'killed', `name=${e.name} kind=${e.ai.kind} pos=(${e.position.x},${e.position.y})`);
          checkNarrativeTriggers(state, 'entity_killed', { killedFaction: e.ai.faction });
        }
        e._pendingRemoval = true;
      }
    }
    // Flush all pending removals in one pass
    state.entities = state.entities.filter(e => !e._pendingRemoval);

    // Check player death
    if ((state.player.coherence ?? 100) <= 0 && !state.godMode) {
      state.playerDead = true;
      state.gameOver = true;
    }
  }

  return acted;
}

// ── Terminal / exit access ──

/** Called from the terminal overlay when the player activates a terminal. */
export function grantExitAccess(state: GameState, terminalId: string, clusterId: number) {
  const cluster = state.clusters.get(clusterId);
  if (!cluster) return;
  const terminal = cluster.terminals.find(t => t.id === terminalId);
  if (!terminal) return;

  // Final terminal: requires root parts or hacking
  if (terminal.isFinalTerminal) {
    if (terminal.lockModeUntilTick != null && terminal.lockModeUntilTick > state.tick) {
      addMessage(state, `${GAME_MESSAGES.terminalLocked} Wait ${terminal.lockModeUntilTick - state.tick} ticks.`, 'hazard');
      state.openTerminal = undefined;
      return;
    }
    const needed = ROOT_PRIVILEGES.length;
    if (state.rootPrivileges.length >= needed) {
      terminal.activated = true;
      cluster.exitLocked = false;
      addMessage(state, `${GAME_MESSAGES.privilegeVerified} [${state.rootPrivileges.join(' · ')}]. Egress unlocked.`, 'important');
    } else {
      const missing = ROOT_PRIVILEGES.filter(p => !state.rootPrivileges.includes(p));
      addMessage(state, `${GAME_MESSAGES.privilegeIncomplete} Missing: ${missing.join(', ')}. Use HACK to override.`, 'hazard');
    }
    state.openTerminal = undefined;
    return;
  }

  terminal.activated = true;
  if (!terminal.hasKey) {
    addMessage(state, GAME_MESSAGES.noExitKey, 'normal');
    state.openTerminal = undefined;
    return;
  }
  cluster.exitLocked = false;
  state.pendingSounds.push('ui_select');
  addMessage(state, GAME_MESSAGES.exitUnlocked, 'important');
  state.openTerminal = undefined;
}

/** Hack the final terminal once per missing privilege. Each hack spawns more mites and costs coherence. */
export function hackFinalTerminal(state: GameState, terminalId: string, clusterId: number) {
  const cluster = state.clusters.get(clusterId);
  if (!cluster) return;
  const terminal = cluster.terminals.find(t => t.id === terminalId);
  if (!terminal?.isFinalTerminal) return;
  if (terminal.lockModeUntilTick != null && terminal.lockModeUntilTick > state.tick) {
    addMessage(state, GAME_MESSAGES.hackLocked, 'hazard');
    return;
  }

  const missing = ROOT_PRIVILEGES.filter(p => !state.rootPrivileges.includes(p));
  const hacksDone = terminal.hackCount ?? 0;

  if (hacksDone >= missing.length) {
    // All missing privs already hacked — unlock
    terminal.activated = true;
    cluster.exitLocked = false;
    addMessage(state, GAME_MESSAGES.overrideComplete, 'important');
    state.openTerminal = undefined;
    return;
  }

  // Each hack bypasses one missing privilege
  const hackNum = hacksDone + 1;
  const cohCost = 5;
  if (state.player.coherence != null && !state.godMode) {
    state.player.coherence = Math.max(0, state.player.coherence - cohCost);
    addMessage(state, `Override ${hackNum}/${missing.length}: ${missing[hacksDone]} bypassed. Coherence drain: −${cohCost}.`, 'hazard');
  }

  // Spawn one mite per missing root privilege
  const miteCount = missing.length;
  const { x, y } = terminal.position;
  let spawned = 0;
  const candidates: { x: number; y: number }[] = [];
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const nx = x + dx; const ny2 = y + dy;
      if (nx < 0 || nx >= cluster.width || ny2 < 0 || ny2 >= cluster.height) continue;
      const tile = cluster.tiles[ny2]?.[nx];
      if (!tile?.walkable) continue;
      if (state.entities.some(e => e.clusterId === clusterId && e.position.x === nx && e.position.y === ny2)) continue;
      candidates.push({ x: nx, y: ny2 });
    }
  }
  for (let i = 0; i < miteCount && i < candidates.length; i++) {
    const pos = candidates[i];
    const enemy = makeEntity('bit_mite', pos, clusterId);
    state.entities.push(enemy);
    spawned++;
  }
  if (spawned > 0) addMessage(state, `${spawned} intrusion countermeasure${spawned > 1 ? 's' : ''} deployed.`, 'hazard');

  terminal.hackCount = hackNum;
  const remaining = missing.length - hackNum;

  if (remaining <= 0) {
    // All missing privs hacked — unlock now
    terminal.activated = true;
    cluster.exitLocked = false;
    addMessage(state, GAME_MESSAGES.overrideComplete, 'important');
  } else {
    // Lock terminal briefly between hacks
    terminal.lockModeUntilTick = state.tick + randInt(8, 15);
    addMessage(state, `${remaining} privilege override${remaining > 1 ? 's' : ''} remaining. Terminal in lockdown for ${terminal.lockModeUntilTick - state.tick} ticks.`, 'hazard');
  }
  state.openTerminal = undefined;
}

/** Called from the terminal overlay to mark a terminal accessed (read only). */
export function activateTerminal(state: GameState, terminalId: string, clusterId: number) {
  const cluster = state.clusters.get(clusterId);
  if (!cluster) return;
  const terminal = cluster.terminals.find(t => t.id === terminalId);
  if (terminal) {
    terminal.activated = true;
    dlog(state, 'terminal', 'activate', `id=${terminalId} hasKey=${terminal.hasKey} cluster=${clusterId}`);
  }
}

// ── Interactable actions ──

function applyReveal(state: GameState, cluster: Cluster, positions: string[], ticks: number) {
  if (positions.length === 0) return;
  state.revealEffects.push({ positions, expireTick: state.tick + ticks });
  for (const key of positions) {
    const [x, y] = key.split(',').map(Number);
    const tile = cluster.tiles[y]?.[x];
    if (tile) tile.seen = true;
  }
}

function spawnCorruptionAtRoom(state: GameState, cluster: Cluster, roomId: number) {
  const room = cluster.rooms.find(r => r.id === roomId);
  if (!room) return;
  const cx = Math.floor(room.x + room.w / 2);
  const cy = Math.floor(room.y + room.h / 2);
  const r = Math.max(1, Math.floor(Math.min(room.w, room.h) / 3));
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const tile = cluster.tiles[cy + dy]?.[cx + dx];
      if (tile?.type === TileType.Floor) {
        tile.hazardOverlay = { type: 'corruption', stage: 0 };
      }
    }
  }
  room.containedHazards.add('corruption');
  addMessage(state, GAME_MESSAGES.corruptionSpawned, 'hazard');
}

// ── Narrative trigger evaluation ──

export function checkNarrativeTriggers(
  state: GameState,
  event: NarrativeTriggerEvent,
  ctx: {
    clusterId?: number;
    room?: { tags: { functional: string | null }; collapse: number };
    killedFaction?: string;
    alertLevel?: number;  
  } = {},
): void {
  for (const trigger of NARRATIVE_TRIGGERS) {
    const c = trigger.condition;
    if (c.event !== event) continue;
    const once = c.once !== false; // default true
    if (once && state.firedTriggerIds.has(trigger.id)) continue;

    // Cluster filter
    const cid = ctx.clusterId ?? state.currentClusterId;
    if (c.clusterId !== undefined && c.clusterId !== cid) continue;
    if (c.clusterIdMin !== undefined && cid < c.clusterIdMin) continue;
    if (c.clusterIdMax !== undefined && cid > c.clusterIdMax) continue;

    // Event-specific filters
    if (event === 'room_enter') {
      if (c.functionalTag && ctx.room?.tags.functional !== c.functionalTag) continue;
      if (c.collapseMin !== undefined && (ctx.room?.collapse ?? 0) < c.collapseMin) continue;
    }
    if (event === 'entity_killed') {
      if (c.killedFaction && c.killedFaction !== ctx.killedFaction) continue;
    }
    if (event === 'alert_threshold') {
      const al = ctx.alertLevel ?? state.alertLevel;
      if (c.alertMin !== undefined && al < c.alertMin) continue;
      if (c.alertMax !== undefined && al > c.alertMax) continue;
    }
    if (event === 'coherence_low') {
      if (c.coherencePct !== undefined) {
        const pct = ((state.player.coherence ?? 100) / (state.player.maxCoherence ?? 100)) * 100;
        if (pct > c.coherencePct) continue;
      }
    }

    dlog(state, 'narrative', 'trigger_fired', `id=${trigger.id} event=${event}`);
    // Fire effects
    for (const effect of trigger.effects) {
      if (effect.kind === 'message') {
        addMessage(state, effect.text, effect.style ?? 'normal');
      } else if (effect.kind === 'alert_delta') {
        state.alertLevel += effect.amount;
        checkNarrativeTriggers(state, 'alert_threshold', { alertLevel: state.alertLevel });
      }
    }
    if (once) state.firedTriggerIds.add(trigger.id);
  }
}

/** Execute a dialog choice action for an interactable. Returns true if the overlay should close. */
export function executeInteractableAction(
  state: GameState,
  itemId: string,
  clusterId: number,
  action: NonNullable<DialogChoice['action']>,
  choice?: DialogChoice,
): boolean {
  if (action === 'close') return true;

  const cluster = state.clusters.get(clusterId);
  if (!cluster) return true;
  const item = cluster.interactables.find(i => i.id === itemId) as Interactable | undefined;
  if (!item) return true;

  dlog(state, 'interactable', action, `item=${itemId} kind=${item.kind} room=${item.roomId}`);

  switch (action) {
    case 'reveal_terminals': {
      let count = 0;
      for (const t of cluster.terminals) {
        applyReveal(state, cluster, floodFillReveal(cluster, t.position, 2), 10);
        count++;
      }
      addMessage(state, `Network scan: ${count} terminal${count !== 1 ? 's' : ''} located.`, 'system');
      return true; // close dialog to show scan result
    }
    case 'reveal_exits': {
      let count = 0;
      for (const iface of cluster.interfaces) {
        applyReveal(state, cluster, floodFillReveal(cluster, iface.position, 2), 10);
        count++;
      }
      addMessage(state, `Network scan: ${count} exit node${count !== 1 ? 's' : ''} located.`, 'system');
      return true; // close dialog to show scan result
    }
    case 'extract_reward': {
      if (item.rewardTaken) break;
      item.rewardTaken = true;

      // Lost echoes dissolve into a damaged fragment after extraction (2–5 seconds, real-time)
      // Store negative delay so presentation layer can stamp: echoFadeAtTime = performance.now() + abs(value)
      if (item.kind === 'lost_echo') {
        item.echoFadeAtTime = -randInt(2000, 5000); // negative = unstamped delay
      }

      if ((item.alertCost ?? 0) > 0) {
        const prev = state.alertLevel;
        state.alertLevel += item.alertCost!;
        addMessage(state, `Antivirus alert level: ${state.alertLevel}.`, 'alert');
        if (prev < ALERT_SUSPICIOUS && state.alertLevel >= ALERT_SUSPICIOUS)
          addMessage(state, GAME_MESSAGES.flaggedSuspicious, 'alert');
        else if (prev < ALERT_ENEMY && state.alertLevel >= ALERT_ENEMY)
          addMessage(state, GAME_MESSAGES.flaggedHostile, 'alert');
        checkNarrativeTriggers(state, 'alert_threshold', { alertLevel: state.alertLevel });
      }
      if (item.hasExitCode) {
        cluster.exitLocked = false;
        addMessage(state, GAME_MESSAGES.exitCodeExtracted, 'important');
      }
      if (item.spawnHazardOnExtract) {
        spawnCorruptionAtRoom(state, cluster, item.roomId);
      }
      if (item.revealTerminals) {
        const unvisited = cluster.terminals.filter(t => !t.activated);
        if (unvisited.length > 0) {
          const t = pick(unvisited);
          applyReveal(state, cluster, floodFillReveal(cluster, t.position, 2), 10);
          addMessage(state, GAME_MESSAGES.dataFragment, 'normal');
        }
      }
      break;
    }
    case 'extract_root_part': {
      if (item.rootPartTaken) break;
      item.rootPartTaken = true;
      const privName = ROOT_PRIVILEGES[clusterId - 1] ?? `ROOT ${clusterId}`;
      if (!state.rootPrivileges.includes(privName)) state.rootPrivileges.push(privName);
      addMessage(state, `Privilege fragment bound: ${privName} [${state.rootPrivileges.length}/${ROOT_PRIVILEGES.length}].`, 'important');
      return true; // close dialog
    }
    case 'deactivate_hazard': {
      const hazardRoomId = choice?.deactivatesHazardRoomId ?? item.deactivatesHazardRoomId;
      if (hazardRoomId == null) break;
      if (!deactivateHazardRoom(state, cluster, hazardRoomId)) break;
      dlog(state, 'hazard', 'deactivate', `room=${hazardRoomId} via=${item.id}`);
      return true; // close dialog
    }
    case 'hack_terminal': {
      // Handled separately via hackFinalTerminal() — should not reach here
      break;
    }
    case 'set_narrative_choice': {
      if (choice?.narrativeChoiceValue) {
        state.narrativeChoice = choice.narrativeChoiceValue as GameState['narrativeChoice'];
        addMessage(state, `Choice recorded: ${choice.narrativeChoiceValue.toUpperCase()}.`, 'system');
      }
      return true;
    }
  }
  return false; // keep overlay open so player sees updated state
}

function checkFinalTerminalLockExpiry(state: GameState, cluster: Cluster) {
  if (cluster.id !== state.finalClusterId) return;
  for (const terminal of cluster.terminals) {
    if (!terminal.isFinalTerminal) continue;
    if (terminal.lockModeUntilTick != null && terminal.lockModeUntilTick <= state.tick) {
      terminal.lockModeUntilTick = undefined;
      cluster.exitLocked = false;
      addMessage(state, GAME_MESSAGES.lockdownExpired, 'important');
    }
  }
}

function updateHazardFogMarks(state: GameState, cluster: Cluster) {
  if (!state.player.modules?.some(m => m.id === 'alert.m' && m.status === 'loaded')) return;
  for (let y = 0; y < cluster.height; y++) {
    for (let x = 0; x < cluster.width; x++) {
      const tile = cluster.tiles[y][x];
      if (!tile.visible) continue;
      if (tile.hazardOverlay) {
        state.hazardFogMarks.set(`${x},${y}`, tile.hazardOverlay.type);
      } else {
        state.hazardFogMarks.delete(`${x},${y}`);
      }
    }
  }
}

// ── Click-to-move ──

/** Build a set of positions blocked by entities and visible interactables. */
function buildBlockedSet(state: GameState, cluster: Cluster): Set<string> {
  return new Set([
    ...state.entities
      .filter(e => e.clusterId === cluster.id)
      .map(e => `${e.position.x},${e.position.y}`),
    ...cluster.interactables
      .filter(i => !i.hidden)
      .map(i => `${i.position.x},${i.position.y}`),
  ]);
}

export function handleMapClick(state: GameState, target: Position): Position[] {
  const cluster = getCurrentCluster(state);

  // If target is the player position, do nothing
  if (target.x === state.player.position.x && target.y === state.player.position.y) {
    state.autoPath = [];
    return [];
  }

  const blocked = buildBlockedSet(state, cluster);

  // Click on a terminal: if adjacent open it, otherwise pathfind to adjacent
  const tile = cluster.tiles[target.y]?.[target.x];
  if (tile?.type === TileType.Terminal && tile.terminalId && tile.seen) {
    const pp = state.player.position;
    if (Math.abs(target.x - pp.x) + Math.abs(target.y - pp.y) === 1) {
      state.openTerminal = { terminalId: tile.terminalId, clusterId: state.currentClusterId };
      state.autoPath = [];
      return [];
    }
    // Pathfind toward the terminal tile (to a walkable neighbour)
    const adj = ([ [-1,0],[1,0],[0,-1],[0,1] ] as const)
      .map(([dx, dy]) => ({ x: target.x + dx, y: target.y + dy }))
      .filter(p => cluster.tiles[p.y]?.[p.x]?.walkable);
    let best: Position[] = [];
    for (const a of adj) {
      const p = findPath(cluster, pp, a, blocked);
      if (p && p.length > 0 && (best.length === 0 || p.length < best.length)) best = p;
    }
    state.autoPath = best;
    return best;
  }

  // Only pathfind to seen tiles that are walkable or doors
  if (!tile || !tile.seen || (!tile.walkable && tile.type !== TileType.Door)) {
    state.autoPath = [];
    return [];
  }

  const path = findPath(cluster, state.player.position, target, blocked);
  if (path && path.length > 0) {
    state.autoPath = path;
    return path;
  }

  state.autoPath = [];
  return [];
}

export function stepAutoPath(state: GameState): boolean {
  if (state.autoPath.length === 0) return false;

  const next = state.autoPath[0];
  const cluster = getCurrentCluster(state);
  const prevCoherence = state.player.coherence ?? 100;

  // Check if next step is a closed door — bump to open it via intents
  const nextTile = cluster.tiles[next.y]?.[next.x];
  if (nextTile?.type === TileType.Door && !nextTile.doorOpen && nextTile.glyph === '+') {
    const bumpDx = next.x - state.player.position.x;
    const bumpDy = next.y - state.player.position.y;
    state.actionLog.push({ kind: 'move', dir: deltaToDir(bumpDx, bumpDy) });
    resolveIntents(state, [
      { kind: 'open_door', entityId: state.player.id, at: { x: next.x, y: next.y } },
      { kind: 'sound', id: 'door_open' },
    ]);
    // Don't shift path — we'll walk through on the next step
    state.tick++;
    computeFOV(cluster, state.player.position);
    if (updateDoors(state)) computeFOV(cluster, state.player.position);
    updateHazards(state);
    applyTileHazardToPlayer(state);
    updateAlertModule(state);
    updateCloak(state);

    // Stop if player took damage
    if ((state.player.coherence ?? 100) < prevCoherence) {
      state.autoPath = [];
      return true;
    }
    return true;
  }

  // Verify next step is still walkable
  if (!isWalkable(cluster, next.x, next.y)) {
    state.autoPath = [];
    addMessage(state, GAME_MESSAGES.pathBlocked);
    return false;
  }

  // Check if any tile on the path is now blocked by an entity or interactable — reroute
  const dest = state.autoPath[state.autoPath.length - 1];
  const blocked = buildBlockedSet(state, cluster);

  const pathBlocked = state.autoPath.some(p => {
    const k = `${p.x},${p.y}`;
    if (!blocked.has(k)) return false;
    // Allow walking to the destination even if blocked
    if (p.x === dest.x && p.y === dest.y) return false;
    return true;
  });

  if (pathBlocked) {
    const newPath = findPath(cluster, state.player.position, dest, blocked);
    if (newPath && newPath.length > 0) {
      state.autoPath = newPath;
    } else {
      state.autoPath = [];
    }
    return false; // pause for one tick while rerouting
  }

  const dx = next.x - state.player.position.x;
  const dy = next.y - state.player.position.y;

  const prevRoom = getPlayerRoom(state);

  const moveResult = collectMoveIntents(state, dx, dy);
  if (moveResult.acted && moveResult.intents.length > 0) {
    resolveIntents(state, moveResult.intents);
    state.actionLog.push({ kind: 'move', dir: deltaToDir(dx, dy) });
    state.autoPath.shift();
    state.tick++;
    computeFOV(cluster, state.player.position);

    if (updateDoors(state)) computeFOV(cluster, state.player.position);

    const newRoom = getPlayerRoom(state);
    if (newRoom && (!prevRoom || prevRoom.id !== newRoom.id)) {
      onPlayerEnterRoom(state, newRoom);
    }
    updateHazards(state);
    applyTileHazardToPlayer(state);
    updateAlertModule(state);
    updateCloak(state);

    // Stop if player took damage
    if ((state.player.coherence ?? 100) < prevCoherence) {
      state.autoPath = [];
      return true;
    }

    return true;
  }

  state.autoPath = [];
  return false;
}

// ── Admin / Debug helpers ──

export function adminRegenCluster(state: GameState): void {
  const id = state.currentClusterId;
  const newCluster = generateCluster(id);
  const entryPos = placeEntryPoint(newCluster.tiles, newCluster.rooms);
  state.clusters.set(id, newCluster);
  state.player.position = { ...entryPos };
  state.player.clusterId = id;
  state.autoPath = [];
  computeFOV(newCluster, state.player.position);
}

export function adminTeleportToCluster(state: GameState, targetId: number): void {
  if (!state.clusters.has(targetId)) {
    const newCluster = generateCluster(targetId);
    state.clusters.set(targetId, newCluster);
    if (targetId >= state.nextClusterId) state.nextClusterId = targetId + 1;
  }
  const cluster = state.clusters.get(targetId)!;
  const entryPos = placeEntryPoint(cluster.tiles, cluster.rooms);
  state.currentClusterId = targetId;
  state.player.clusterId = targetId;
  state.player.position = { ...entryPos };
  state.autoPath = [];
  computeFOV(cluster, state.player.position);
}

// ── Save / Load ──

export function exportDebugLog(state: GameState): string {
  const header = `Coherence Debug Log — seed=${state.seed} tick=${state.tick} cluster=${state.currentClusterId}\n`;
  const lines = state.debugLog.map(e =>
    `[t${e.tick} c${e.cluster}] ${e.category}/${e.event}${e.detail ? ': ' + e.detail : ''}`
  );
  return header + lines.join('\n');
}

export function exportSave(state: GameState): string {
  return JSON.stringify({ seed: state.seed, actions: state.actionLog });
}

export function loadSave(saveJson: string): GameState {
  const { seed, actions } = JSON.parse(saveJson);
  const newState = createGame(seed);
  for (const action of actions) {
    processAction(newState, action);
  }
  return newState;
}
