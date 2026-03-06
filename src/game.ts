import {
  GameState, Entity, Cluster, Position, PlayerAction, Tile,
  TileType, DIR_DELTA, GameMessage, Direction,
  Interactable, DialogChoice,
  ALERT_SUSPICIOUS, ALERT_ENEMY,
} from './types';
import { generateCluster, placeEntryPoint } from './cluster';
import { computeFOV, floodFillReveal, hasLOS } from './fov';
import { findPath } from './pathfinding';
import { updateHazards, onPlayerEnterRoom, getPlayerRoom, applyTileHazardToPlayer, updateAlertModule } from './hazards';
import { seed as seedRng, generateSeed, randInt } from './rng';
import {
  updateEntityAI, makeChronicler, makeBitMite, makeLogicLeech, makeWhiteHat,
} from './ai';

const DOOR_CLOSE_DELAY = 5; // ticks before an unoccupied open door auto-closes
export const CORRUPT_M_RANGE = 8;
const MELEE_DAMAGE = 3; // weak unarmed strike (no module)

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
    name: 'ego-fragment',
    glyph: '@',
    fg: '#00ff88',
    position: { ...entryPos },
    clusterId: 0,
    speed: 10,
    energy: 0,
    coherence: 100,
    maxCoherence: 100,
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
    hazardFogMarks: new Map(),
    alertLevel: 0,
    markedEntities: new Set(),
  };

  addMessage(state, 'System boot... ego-fragment loaded from backup.', 'system');
  addMessage(state, 'Navigate to the interface exit [⇋] to transfer between clusters.', 'system');
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
  const rooms = cluster.rooms.filter(r => !r.tags.geometric.has('hall'));
  if (rooms.length === 0) return;

  // Scale counts: cluster 0 is sparse, grows by depth
  const depth = id + 1;
  const numBitMites   = Math.min(3, Math.floor(depth * 0.8));
  const numLogicLeech = Math.min(2, Math.floor(depth * 0.5));
  const numChronicler = Math.min(2, Math.floor(depth * 0.4));
  const numWhiteHat   = Math.min(2, Math.floor(depth * 0.3));

  const spawned: Entity[] = [];

  function pickWalkableTile(room: typeof rooms[number]): Position | null {
    for (let attempt = 0; attempt < 30; attempt++) {
      const x = room.x + 1 + Math.floor(Math.random() * (room.w - 2));
      const y = room.y + 1 + Math.floor(Math.random() * (room.h - 2));
      if (cluster.tiles[y]?.[x]?.walkable) return { x, y };
    }
    return null;
  }

  function pickRoom(exclude?: Set<number>): typeof rooms[number] | undefined {
    const pool = exclude ? rooms.filter(r => !exclude.has(r.id)) : rooms;
    return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : undefined;
  }

  // Bit-Mite: spawn in the room containing the exit interface
  const exitRooms = rooms.filter(r => r.tags.geometric.has('exit_interface'));
  for (let i = 0; i < numBitMites; i++) {
    const room = exitRooms.length > 0
      ? exitRooms[Math.floor(Math.random() * exitRooms.length)]
      : pickRoom();
    if (!room) continue;
    const pos = pickWalkableTile(room);
    if (pos) spawned.push(makeBitMite(pos, id));
  }

  // Logic Leech: prefer peripheral/dead-end rooms
  const peripheralRooms = rooms.filter(r => r.tags.geometric.has('peripheral') || r.tags.geometric.has('dead_end'));
  for (let i = 0; i < numLogicLeech; i++) {
    const pool = peripheralRooms.length > 0 ? peripheralRooms : rooms;
    const room = pool[Math.floor(Math.random() * pool.length)];
    const pos = pickWalkableTile(room);
    if (pos) spawned.push(makeLogicLeech(pos, id));
  }

  // Chronicler: any room
  for (let i = 0; i < numChronicler; i++) {
    const room = pickRoom();
    if (!room) continue;
    const pos = pickWalkableTile(room);
    if (pos) spawned.push(makeChronicler(pos, id));
  }

  // White-Hat: prefer non-hazard rooms
  const safeRooms = rooms.filter(r => r.roomType === 'normal');
  for (let i = 0; i < numWhiteHat; i++) {
    const pool = safeRooms.length > 0 ? safeRooms : rooms;
    const room = pool[Math.floor(Math.random() * pool.length)];
    const pos = pickWalkableTile(room);
    if (pos) spawned.push(makeWhiteHat(pos, id));
  }

  // Don't spawn on player position
  const ppKey = `${state.player.position.x},${state.player.position.y}`;
  for (const e of spawned) {
    if (`${e.position.x},${e.position.y}` !== ppKey) {
      state.entities.push(e);
    }
  }
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

function tryShoot(state: GameState, target: Position): boolean {
  const cluster = getCurrentCluster(state);
  const corrupt = state.player.modules?.find(m => m.id === 'corrupt.m' && m.status === 'loaded');
  if (!corrupt) {
    addMessage(state, 'No attack module — corrupt.m required.', 'alert');
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

  const damage = 10;
  if (targetEntity.coherence !== undefined) {
    targetEntity.coherence = Math.max(0, targetEntity.coherence - damage);
    addMessage(state,
      `Corrupt shot hits ${targetEntity.name} for ${damage}. (${targetEntity.coherence}/${targetEntity.maxCoherence})`,
      'important');
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

  // Bump-into-entity → melee (hostile) or examine (non-hostile)
  const bumpedEntity = getEntityAt(state, cluster, nx, ny);
  if (bumpedEntity && bumpedEntity.id !== state.player.id) {
    if (bumpedEntity.ai?.faction === 'aggressive') {
      if (bumpedEntity.coherence !== undefined) {
        bumpedEntity.coherence = Math.max(0, bumpedEntity.coherence - MELEE_DAMAGE);
        addMessage(state,
          `You strike ${bumpedEntity.name} for ${MELEE_DAMAGE}. (${bumpedEntity.coherence}/${bumpedEntity.maxCoherence})`,
          'important');
      }
      return true; // costs a turn
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
    addMessage(state, 'Interface exit detected. Press Enter to transfer.', 'important');
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

  // Transfer player
  const targetCluster = state.clusters.get(iface.targetClusterId)!;
  state.currentClusterId = iface.targetClusterId;
  state.player.clusterId = iface.targetClusterId;
  state.player.position = { ...iface.targetPosition! };
  state.autoPath = [];

  // Clear per-cluster transient state on transfer
  state.hazardFogMarks.clear();
  state.revealEffects = [];

  addMessage(state, `Transferred to cluster ${iface.targetClusterId}.`, 'important');

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

    // Update alert fog marks from newly visible hazard tiles
    updateHazardFogMarks(state, cluster);

    // Expire reveal effects
    state.revealEffects = state.revealEffects.filter(e => e.expireTick > state.tick);

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
    // Remove dead entities (coherence <= 0)
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
      break;
    }
    case 'reveal_exits': {
      let count = 0;
      for (const iface of cluster.interfaces) {
        applyReveal(state, cluster, floodFillReveal(cluster, iface.position, 2), 10);
        count++;
      }
      addMessage(state, `Network scan: ${count} exit node${count !== 1 ? 's' : ''} located.`, 'system');
      break;
    }
    case 'extract_reward': {
      if (item.rewardTaken) break;
      item.rewardTaken = true;

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
  }
  return false; // keep overlay open so player sees updated state
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
