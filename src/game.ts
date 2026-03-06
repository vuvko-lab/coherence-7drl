import {
  GameState, Entity, Cluster, Position, PlayerAction, Tile,
  TileType, DIR_DELTA, GameMessage, Direction,
  Interactable, DialogChoice,
  ALERT_SUSPICIOUS, ALERT_ENEMY, ROOT_PRIVILEGES, COLORS,
} from './types';
import { generateCluster, placeEntryPoint } from './cluster';
import { computeFOV, floodFillReveal, hasLOS } from './fov';
import { findPath } from './pathfinding';
import { updateHazards, onPlayerEnterRoom, getPlayerRoom, applyTileHazardToPlayer, updateAlertModule } from './hazards';
import { seed as seedRng, generateSeed, randInt, pick } from './rng';
import {
  updateEntityAI, makeChronicler, makeBitMite, makeLogicLeech, makeWhiteHat, makePropEntity, makeGateKeeper, makeRepairScrapper,
} from './ai';
export { makeDamagedBitMite } from './ai';
import { shootingAnimation } from './combat_animations';

const DOOR_CLOSE_DELAY = 5; // ticks before an unoccupied open door auto-closes
export const CORRUPT_M_RANGE = 8;
const MELEE_DAMAGE = 3; // weak unarmed strike (no module)

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

function openDoor(tile: Tile) {
  tile.doorOpen = true;
  tile.walkable = true;
  tile.transparent = true;
  tile.glyph = '▯';
  tile.doorCloseTick = undefined;
}

function closeDoor(tile: Tile) {
  tile.doorOpen = false;
  tile.walkable = false;
  tile.transparent = false;
  tile.glyph = '+';
  tile.doorCloseTick = undefined;
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
    name: 'mesh id',
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
      { id: 'overclock.m', status: 'loaded' },
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
    markedEntities: new Set(),
    rootPrivileges: [],
    killedEntities: [],
    finalClusterId: 5,
    collapseGlitchTiles: new Map(),
    selfPanelRevealed: false,
    smokeEffects: [],
  };

  addMessage(state, 'System boot... ego-fragment loaded from backup.', 'system');
  addMessage(state, 'Navigate to the interface exit [⇨] to transfer between clusters.', 'system');
  addMessage(state, 'Use WASD/arrows to move. Click to pathfind. Enter to transfer.', 'system');

  computeFOV(cluster, player.position);

  // Spawn entities in the starting cluster
  spawnClusterEntities(state, cluster);

  return state;
}

export function addMessage(state: GameState, text: string, type: GameMessage['type'] = 'normal') {
  state.messages.push({ text, type, tick: state.tick });
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
      const x = room.x + 1 + Math.floor(Math.random() * (room.w - 2));
      const y = room.y + 1 + Math.floor(Math.random() * (room.h - 2));
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
        for (let dx2 = -3; dx2 <= 3; dx2++) {
          if (dx2 === 0 && dy2 === 0) continue;
          const nx = ix + dx2, ny2 = iy + dy2;
          if (nx < 0 || nx >= cluster.width || ny2 < 0 || ny2 >= cluster.height) continue;
          const t = cluster.tiles[ny2]?.[nx];
          if (t?.walkable && t.type !== TileType.InterfaceExit) nearby.push({ x: nx, y: ny2 });
        }
      }
      nearby.sort(() => Math.random() - 0.5);
      for (let i = 0; i < Math.min(guardCount, nearby.length); i++) {
        spawned.push(makeBitMite(nearby[i], id));
      }
    }
  }

  // ── Shuffle-and-cooldown spawn loop ──
  // Shuffles all eligible rooms, iterates in random order.
  // Each room gets one spawn roll; after a successful spawn, the next 5 rooms are skipped.
  // Spawn chance scales with room collapse + cluster depth.
  // Entity kind is weighted by room geometry; functional tag modifies entity stats.

  const shuffled = [...allRooms].sort(() => Math.random() - 0.5);
  const baseChance = 0.05 + depth * 0.025; // 0.10 at depth 2, 0.175 at depth 5
  let cooldown = 0;

  for (const room of shuffled) {
    if (cooldown > 0) { cooldown--; continue; }

    const spawnChance = Math.min(0.75, baseChance + room.collapse * 0.35);
    if (Math.random() >= spawnChance) continue;

    const pos = pickWalkableTile(room);
    if (!pos) continue;

    // Pick entity kind: weighted by geometry and room type
    const isPeripheral = room.tags.geometric.has('peripheral') || room.tags.geometric.has('dead_end');
    const inSafeRoom = room.roomType === 'normal';
    const hasEnemies = id >= 2; // enemies only in cluster 2+

    // Weights: [bit_mite, logic_leech, chronicler, white_hat, gate_keeper, repair_scrapper]
    // Logic Leech and Gate-Keeper scale up significantly with cluster depth.
    // White-Hat sentry spawns are rare and capped to avoid friendly flood.
    const leechWeight = hasEnemies
      ? (isPeripheral ? 2 + depth : 1 + depth * 0.5)  // leech loves edges, scales with depth
      : 0;
    const gkWeight = hasEnemies
      ? Math.max(0, (depth - 2) * 1.2) * (room.collapse > 0.5 ? 2 : 1)  // starts cluster 2+, steeper ramp
      : 0;
    // White-Hat: rare overall, capped weight so it never dominates
    const whWeight = hasEnemies && inSafeRoom ? Math.min(0.5, 0.1 * depth) : 0;
    // Repair scrapper: low weight in cluster 1, slightly higher in clusters 4-5
    const rsWeight = id >= 4 ? 1.5 : id >= 2 ? 0.6 : 0.4;
    const w = [
      hasEnemies ? 6 + depth * 1.5 : 0,  // bit_mite: dominant, grows fast with depth
      leechWeight,                         // logic_leech: scales with depth, prefers edges
      hasEnemies ? 1.2 : 0,               // chronicler: constant low neutral presence
      whWeight,                            // white_hat: rare sentry, capped
      gkWeight,                            // gate_keeper: scales from cluster 2+
      rsWeight,                            // repair_scrapper: all clusters 1+
    ];
    const total = w[0] + w[1] + w[2] + w[3] + w[4] + w[5];
    const roll = Math.random() * total;

    let entity: Entity;
    if (roll < w[0]) {
      entity = makeBitMite(pos, id);
    } else if (roll < w[0] + w[1]) {
      entity = makeLogicLeech(pos, id);
    } else if (roll < w[0] + w[1] + w[2]) {
      entity = makeChronicler(pos, id);
    } else if (roll < w[0] + w[1] + w[2] + w[3]) {
      entity = makeWhiteHat(pos, id);
    } else if (roll < w[0] + w[1] + w[2] + w[3] + w[4]) {
      entity = makeGateKeeper(pos, id);
    } else {
      entity = makeRepairScrapper(pos, id);
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
        spawned.push(makeGateKeeper(p.position, id));
      } else {
        spawned.push(makePropEntity(p.position, id, p.glyph, p.fg, p.name, p.propTag));
      }
    }
    room.scenarioState!.pendingProps = []; // clear so we don't re-spawn
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
      const frac = 0.4 + Math.random() * 0.3;
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

const CORRUPT_M_DAMAGE   = 40;
const CORRUPT_M_COOLDOWN = 10; // ticks between shots
const CORRUPT_M_FREE_SHOTS = 2; // shots per cluster with no coherence drain

function tryShoot(state: GameState, target: Position): boolean {
  const cluster = getCurrentCluster(state);
  const corrupt = state.player.modules?.find(m => m.id === 'corrupt.m' && m.status === 'loaded');
  if (!corrupt) {
    addMessage(state, 'No attack module.', 'alert');
    return false;
  }

  // Cooldown check
  if (corrupt.cooldownUntilTick != null && corrupt.cooldownUntilTick > state.tick) {
    const remaining = corrupt.cooldownUntilTick - state.tick;
    addMessage(state, `corrupt.m reloading — ${remaining} tick${remaining !== 1 ? 's' : ''} remaining.`, 'alert');
    return false;
  }

  const from = state.player.position;
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > CORRUPT_M_RANGE) {
    addMessage(state, 'Target out of range.', 'alert');
    return false;
  }

  const targetTile = cluster.tiles[target.y]?.[target.x];
  if (!targetTile?.visible) {
    addMessage(state, 'No visible target.', 'alert');
    return false;
  }

  if (!hasLOS(cluster, from, target)) {
    addMessage(state, 'No line of sight.', 'alert');
    return false;
  }

  const targetEntity = getEntityAt(state, cluster, target.x, target.y);
  if (!targetEntity || targetEntity.id === state.player.id) {
    addMessage(state, 'Nothing to shoot.', 'normal');
    return false;
  }

  // Track shots and apply coherence drain for shots beyond the free quota
  const shotCount = corrupt.clusterShotCount ?? 0;
  const overQuota = shotCount - CORRUPT_M_FREE_SHOTS + 1; // >0 means this shot drains
  if (overQuota > 0 && state.player.coherence != null && !state.godMode) {
    const drain = overQuota * 3;
    state.player.coherence = Math.max(0, state.player.coherence - drain);
    const rolledState = pick(['heap corruption', 'memmory corruption', 'buffer overflow', 'stack overflow', 'BUG', 'error'])
    addMessage(state, `[LEAK] ${rolledState} in corrupt.m — coherence drain: −${drain} (${state.player.coherence}/${state.player.maxCoherence}).`, 'hazard');
  }

  corrupt.clusterShotCount = shotCount + 1;
  corrupt.cooldownUntilTick = state.tick + CORRUPT_M_COOLDOWN;

  shootingAnimation(state, from, target, 'beam');

  if (targetEntity.coherence !== undefined) {
    targetEntity.coherence = Math.max(0, targetEntity.coherence - CORRUPT_M_DAMAGE);
    addMessage(state,
      `Corrupt shot hits ${targetEntity.name} for ${CORRUPT_M_DAMAGE}. (${targetEntity.coherence}/${targetEntity.maxCoherence})`,
      'combat');
  }

  // Warn when the NEXT shot will start draining coherence
  const newCount = corrupt.clusterShotCount;
  if (newCount === CORRUPT_M_FREE_SHOTS) {
    addMessage(state, '[WARN] detected memory errors in corrupt.m — usage is discouraged.', 'alert');
  }

  return true;
}

// ── Player actions ──

function tryMove(state: GameState, dx: number, dy: number): boolean {
  const cluster = getCurrentCluster(state);
  const nx = state.player.position.x + dx;
  const ny = state.player.position.y + dy;

  if (nx < 0 || nx >= cluster.width || ny < 0 || ny >= cluster.height) return false;

  const targetTile = cluster.tiles[ny][nx];

  // God mode: walk through anything (noclip)
  if (state.godMode) {
    state.player.position.x = nx;
    state.player.position.y = ny;
    if (targetTile.type === TileType.InterfaceExit) {
      addMessage(state, 'Interface exit detected. Press Enter to transfer.', 'important');
    }
    return true;
  }

  // Bump-to-open: closed door → open it, costs a turn, don't move
  if (targetTile.type === TileType.Door && !targetTile.doorOpen && targetTile.glyph === '+') {
    openDoor(targetTile);
    return true;
  }

  // Bump-into-terminal → open it, no turn cost
  if (targetTile.type === TileType.Terminal && targetTile.terminalId) {
    state.openTerminal = { terminalId: targetTile.terminalId, clusterId: state.currentClusterId };
    return false;
  }

  // Bump-into-interactable → open dialog, no turn cost
  const bumped = cluster.interactables.find(
    i => i.position.x === nx && i.position.y === ny && !i.hidden,
  );
  if (bumped) {
    bumped.currentNodeId = 'root';
    state.openInteractable = { id: bumped.id, clusterId: state.currentClusterId };
    return false;
  }

  // Bump-into-entity → melee (hostile), push (friendly), or examine (neutral)
  const bumpedEntity = getEntityAt(state, cluster, nx, ny);
  if (bumpedEntity && bumpedEntity.id !== state.player.id) {
    if (bumpedEntity.ai?.faction === 'aggressive') {
      if (bumpedEntity.coherence !== undefined) {
        bumpedEntity.coherence = Math.max(0, bumpedEntity.coherence - MELEE_DAMAGE);
        addMessage(state,
          `You strike ${bumpedEntity.name} for ${MELEE_DAMAGE}. (${bumpedEntity.coherence}/${bumpedEntity.maxCoherence})`,
          'important');
        if (bumpedEntity.coherence <= 0) {
          const _sf = bumpedEntity.ai?.faction;
          state.smokeEffects.push({
            x: bumpedEntity.position.x, y: bumpedEntity.position.y,
            fg: _sf === 'aggressive' ? '#cc4444' : _sf === 'friendly' ? '#23d2a6' : '#aaaa66',
            spawnTime: performance.now(),
          });
          if (bumpedEntity.ai) state.killedEntities.push({ name: bumpedEntity.name, kind: bumpedEntity.ai.kind });
          state.entities = state.entities.filter(e => e.id !== bumpedEntity.id);
          state.markedEntities.delete(bumpedEntity.id);
        }
      }
      return true; // costs a turn
    } else if (bumpedEntity.ai?.faction === 'friendly') {
      // Try to push the friendly entity aside
      const pushed = tryPushEntity(state, cluster, bumpedEntity, state.player.position);
      if (pushed) {
        state.player.position = { x: nx, y: ny };
        return true;
      }
      addMessage(state, `${bumpedEntity.name} blocks the way.`, 'normal');
      return false;
    } else {
      addMessage(state, `You observe ${bumpedEntity.name}. It does not react.`, 'normal');
      return false;
    }
  }

  if (!isWalkable(cluster, nx, ny)) {
    return false;
  }

  state.player.position.x = nx;
  state.player.position.y = ny;

  // Check for interface exit
  const tile = cluster.tiles[ny][nx];
  if (tile.type === TileType.InterfaceExit) {
    if (cluster.id === 0 && nx < 1) {
      addMessage(state, 'Infomorph sleeving facility. Status: [ERROR]', 'important');
    } else {
      addMessage(state, 'Interface exit [CLOSED]. No way back now.', 'important');
    }
  }

  return true;
}

function tryTransfer(state: GameState): boolean {
  const cluster = getCurrentCluster(state);
  const { x, y } = state.player.position;
  const tile = cluster.tiles[y][x];

  if (tile.type !== TileType.InterfaceExit) {
    addMessage(state, 'No interface connection here.');
    return false;
  }

  // Find the interface exit
  const iface = cluster.interfaces.find(
    i => i.position.x === x && i.position.y === y
  );
  if (!iface) return false;

  // Block backtracking through entry interface (x=0 in all clusters except the first)
  if (iface.position.x === 0 && cluster.id > 0) {
    addMessage(state, '[ERROR] Interface blocked — no way back.', 'important');
    return false;
  }

  // Victory: exiting the final cluster triggers the end screen
  if (cluster.id === state.finalClusterId && x > 0) {
    state.gameOver = true;
    addMessage(state, 'COHERENCE RESTORED. System integration complete.', 'important');
    return false;
  }

  // Forward exits (x > 0; x=0 is always the back-entry) require authorization
  if (x > 0 && cluster.exitLocked) {
    addMessage(state, 'Exit locked — authorization required. Find and activate a terminal.', 'hazard');
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

  if (cluster.id === 0) {
    addMessage(state, 'Infomorph sleeving facility. Status: [ERROR]', 'important');
  } else {
    addMessage(state, `Transferred to cluster ${iface.targetClusterId}.`, 'important');
  }

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
  let acted = false;

  switch (action.kind) {
    case 'move': {
      const delta = DIR_DELTA[action.dir];
      acted = tryMove(state, delta.x, delta.y);
      break;
    }
    case 'transfer':
      acted = tryTransfer(state);
      break;
    case 'wait':
      acted = true;
      break;
    case 'shoot':
      acted = tryShoot(state, action.target);
      break;
    case 'interact': {
      // Check adjacent tiles for terminals
      const cluster = getCurrentCluster(state);
      const pp = state.player.position;
      const dirs = [[-1,0],[1,0],[0,-1],[0,1]] as const;
      for (const [dx, dy] of dirs) {
        const t = cluster.tiles[pp.y + dy]?.[pp.x + dx];
        if (t?.type === TileType.Terminal && t.terminalId) {
          state.openTerminal = { terminalId: t.terminalId, clusterId: state.currentClusterId };
          break;
        }
      }
      // interact doesn't cost a turn (opening terminal is a menu action)
      acted = false;
      break;
    }
  }

  if (acted) {
    state.actionLog.push(action);

    // Track room change for entry triggers
    const prevRoom = getPlayerRoom(state);

    state.tick++;

    // Update FOV
    const cluster = getCurrentCluster(state);
    computeFOV(cluster, state.player.position);

    // Check room entry
    const newRoom = getPlayerRoom(state);
    if (newRoom && (!prevRoom || prevRoom.id !== newRoom.id)) {
      onPlayerEnterRoom(state, newRoom);
    }

    // Update doors (auto-close), recompute FOV if any closed
    if (updateDoors(state)) {
      computeFOV(cluster, state.player.position);
    }

    // Update hazards
    updateHazards(state);
    applyTileHazardToPlayer(state);
    updateAlertModule(state);

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
        if (Math.random() < 0.004) {
          item.hidden = true;
          item.hiddenUntilTick = state.tick + randInt(6, 22);
        }
      }
    }

    // Process other entities (speed-based turns)
    for (const entity of state.entities) {
      if (entity.clusterId !== state.currentClusterId) continue;
      entity.energy += 10;
      if (entity.energy >= entity.speed) {
        entity.energy -= entity.speed;
        updateEntityAI(state, entity);
      }
    }
    // Remove dead entities (coherence <= 0) — spawn smoke for any not yet handled
    for (const e of state.entities) {
      if ((e.coherence ?? 1) <= 0 && e.id !== state.player.id) {
        if (!state.smokeEffects.some(s => s.x === e.position.x && s.y === e.position.y)) {
          const _sf = e.ai?.faction;
          state.smokeEffects.push({
            x: e.position.x, y: e.position.y,
            fg: _sf === 'aggressive' ? '#cc4444' : _sf === 'friendly' ? '#23d2a6' : '#aaaa66',
            spawnTime: performance.now(),
          });
        }
      }
    }
    state.entities = state.entities.filter(e => (e.coherence ?? 1) > 0);
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
      addMessage(state, `[TERMINAL LOCKED] Access suspended. Wait ${terminal.lockModeUntilTick - state.tick} ticks.`, 'hazard');
      state.openTerminal = undefined;
      return;
    }
    const needed = ROOT_PRIVILEGES.length;
    if (state.rootPrivileges.length >= needed) {
      terminal.activated = true;
      cluster.exitLocked = false;
      addMessage(state, `Privilege chain verified [${state.rootPrivileges.join(' · ')}]. Egress unlocked.`, 'important');
    } else {
      const missing = ROOT_PRIVILEGES.filter(p => !state.rootPrivileges.includes(p));
      addMessage(state, `PRIVILEGE CHAIN INCOMPLETE. Missing: ${missing.join(', ')}. Use HACK to override.`, 'hazard');
    }
    state.openTerminal = undefined;
    return;
  }

  terminal.activated = true;
  if (!terminal.hasKey) {
    addMessage(state, 'No exit key found on this terminal.', 'normal');
    state.openTerminal = undefined;
    return;
  }
  cluster.exitLocked = false;
  addMessage(state, 'Exit authorization granted. Cluster egress unlocked.', 'important');
  state.openTerminal = undefined;
}

/** Hack the final terminal once per missing privilege. Each hack spawns more mites and costs coherence. */
export function hackFinalTerminal(state: GameState, terminalId: string, clusterId: number) {
  const cluster = state.clusters.get(clusterId);
  if (!cluster) return;
  const terminal = cluster.terminals.find(t => t.id === terminalId);
  if (!terminal?.isFinalTerminal) return;
  if (terminal.lockModeUntilTick != null && terminal.lockModeUntilTick > state.tick) {
    addMessage(state, '[TERMINAL LOCKED] Cannot hack — still in lockdown.', 'hazard');
    return;
  }

  const missing = ROOT_PRIVILEGES.filter(p => !state.rootPrivileges.includes(p));
  const hacksDone = terminal.hackCount ?? 0;

  if (hacksDone >= missing.length) {
    // All missing privs already hacked — unlock
    terminal.activated = true;
    cluster.exitLocked = false;
    addMessage(state, 'Override chain complete. Egress unlocked.', 'important');
    state.openTerminal = undefined;
    return;
  }

  // Each successive hack costs more coherence and spawns more mites
  const hackNum = hacksDone + 1;
  const cohCost = 5 * hackNum;
  if (state.player.coherence != null && !state.godMode) {
    state.player.coherence = Math.max(0, state.player.coherence - cohCost);
    addMessage(state, `Override ${hackNum}/${missing.length}: ${missing[hacksDone]} bypassed. Coherence drain: −${cohCost}.`, 'hazard');
  }

  // Spawn hackNum mites near the terminal
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
  for (let i = 0; i < hackNum && i < candidates.length; i++) {
    const pos = candidates[i];
    const enemy = makeBitMite(pos, clusterId);
    enemy.id = Date.now() % 100000 + Math.floor(Math.random() * 1000) + i;
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
    addMessage(state, 'Override chain complete. Egress unlocked.', 'important');
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
  if (terminal) terminal.activated = true;
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
  addMessage(state, 'Coherence field destabilised — corruption hazard spawned!', 'hazard');
}

/** Execute a dialog choice action for an interactable. Returns true if the overlay should close. */
export function executeInteractableAction(
  state: GameState,
  itemId: string,
  clusterId: number,
  action: NonNullable<DialogChoice['action']>,
): boolean {
  if (action === 'close') return true;

  const cluster = state.clusters.get(clusterId);
  if (!cluster) return true;
  const item = cluster.interactables.find(i => i.id === itemId) as Interactable | undefined;
  if (!item) return true;

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
      if (item.kind === 'lost_echo') {
        item.echoFadeAtTime = performance.now() + randInt(2000, 5000);
      }

      if ((item.alertCost ?? 0) > 0) {
        const prev = state.alertLevel;
        state.alertLevel += item.alertCost!;
        addMessage(state, `Antivirus alert level: ${state.alertLevel}.`, 'alert');
        if (prev < ALERT_SUSPICIOUS && state.alertLevel >= ALERT_SUSPICIOUS)
          addMessage(state, 'WARNING: Flagged as suspicious entity. Antivirus is tracking.', 'alert');
        else if (prev < ALERT_ENEMY && state.alertLevel >= ALERT_ENEMY)
          addMessage(state, 'CRITICAL: Designated hostile entity. Antivirus hunting.', 'alert');
      }
      if (item.hasExitCode) {
        cluster.exitLocked = false;
        addMessage(state, 'Exit code extracted. Cluster egress unlocked.', 'important');
      }
      if (item.spawnHazardOnExtract) {
        spawnCorruptionAtRoom(state, cluster, item.roomId);
      }
      if (item.revealTerminals) {
        const unvisited = cluster.terminals.filter(t => !t.activated);
        if (unvisited.length > 0) {
          const t = unvisited[Math.floor(Math.random() * unvisited.length)];
          applyReveal(state, cluster, floodFillReveal(cluster, t.position, 2), 10);
          addMessage(state, 'Data fragment points to an unvisited terminal.', 'normal');
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
      const hazardRoomId = item.deactivatesHazardRoomId;
      if (hazardRoomId == null) break;
      const hazardRoom = cluster.rooms.find(r => r.id === hazardRoomId);
      if (!hazardRoom) break;
      const wasQuarantine = hazardRoom.roomType === 'quarantine';
      hazardRoom.roomType = 'normal';
      hazardRoom.hazardState = undefined;
      for (let ry = hazardRoom.y; ry < hazardRoom.y + hazardRoom.h; ry++) {
        for (let rx = hazardRoom.x; rx < hazardRoom.x + hazardRoom.w; rx++) {
          const tile = cluster.tiles[ry]?.[rx];
          if (!tile) continue;
          tile.hazardOverlay = undefined;
          if (wasQuarantine && tile.type === TileType.Door && !tile.walkable) {
            tile.walkable = true;
            tile.glyph = '+';
            tile.fg = COLORS.door;
            tile.doorOpen = false;
          }
        }
      }
      addMessage(state, '[OVERRIDE] Hazard subsystem neutralized.', 'important');
      return true; // close dialog
    }
    case 'hack_terminal': {
      // Handled separately via hackFinalTerminal() — should not reach here
      break;
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
      addMessage(state, 'Terminal lockdown expired. Cluster egress unlocked.', 'important');
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

export function handleMapClick(state: GameState, target: Position): Position[] {
  const cluster = getCurrentCluster(state);

  // If target is the player position, do nothing
  if (target.x === state.player.position.x && target.y === state.player.position.y) {
    state.autoPath = [];
    return [];
  }

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
      const p = findPath(cluster, pp, a);
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

  const path = findPath(cluster, state.player.position, target);
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

  // Check if next step is a closed door — bump to open it
  const nextTile = cluster.tiles[next.y]?.[next.x];
  if (nextTile?.type === TileType.Door && !nextTile.doorOpen && nextTile.glyph === '+') {
    const bumpDx = next.x - state.player.position.x;
    const bumpDy = next.y - state.player.position.y;
    state.actionLog.push({ kind: 'move', dir: deltaToDir(bumpDx, bumpDy) });
    openDoor(nextTile);
    // Don't shift path — we'll walk through on the next step
    state.tick++;
    computeFOV(cluster, state.player.position);
    if (updateDoors(state)) computeFOV(cluster, state.player.position);
    updateHazards(state);
    applyTileHazardToPlayer(state);
    updateAlertModule(state);
    return true;
  }

  // Verify next step is still walkable
  if (!isWalkable(cluster, next.x, next.y)) {
    state.autoPath = [];
    addMessage(state, 'Path blocked.');
    return false;
  }

  const dx = next.x - state.player.position.x;
  const dy = next.y - state.player.position.y;

  const prevRoom = getPlayerRoom(state);

  if (tryMove(state, dx, dy)) {
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
