import {
  GameState, Entity, Cluster, Position, PlayerAction,
  TileType, DIR_DELTA, GameMessage,
} from './types';
import { generateCluster, placeEntryPoint } from './cluster';
import { computeFOV } from './fov';
import { findPath } from './pathfinding';
import { updateHazards, onPlayerEnterRoom, getPlayerRoom, applyTileHazardToPlayer, updateAlertModule } from './hazards';

export function createGame(): GameState {
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
  };

  addMessage(state, 'System boot... ego-fragment loaded from backup.', 'system');
  addMessage(state, 'Navigate to the interface exit [⇋] to transfer between clusters.', 'system');
  addMessage(state, 'Use WASD/arrows to move. Click to pathfind. Enter to transfer.', 'system');

  computeFOV(cluster, player.position);

  return state;
}

export function addMessage(state: GameState, text: string, type: GameMessage['type'] = 'normal') {
  state.messages.push({ text, type, tick: state.tick });
}

function getCurrentCluster(state: GameState): Cluster {
  return state.clusters.get(state.currentClusterId)!;
}

function isWalkable(cluster: Cluster, x: number, y: number): boolean {
  if (x < 0 || x >= cluster.width || y < 0 || y >= cluster.height) return false;
  return cluster.tiles[y][x].walkable;
}

// ── Player actions ──

function tryMove(state: GameState, dx: number, dy: number): boolean {
  const cluster = getCurrentCluster(state);
  const nx = state.player.position.x + dx;
  const ny = state.player.position.y + dy;

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
      newCluster.tiles[entryPos.y][0].glyph = '⇋';
      newCluster.tiles[entryPos.y][0].fg = '#ff8844';
      newCluster.tiles[entryPos.y][0].walkable = true;
    }

    state.clusters.set(newId, newCluster);
    addMessage(state, `Cluster ${newId} generated.`, 'system');
  }

  // Transfer player
  const targetCluster = state.clusters.get(iface.targetClusterId)!;
  state.currentClusterId = iface.targetClusterId;
  state.player.clusterId = iface.targetClusterId;
  state.player.position = { ...iface.targetPosition! };
  state.autoPath = [];

  addMessage(state, `Transferred to cluster ${iface.targetClusterId}.`, 'important');

  computeFOV(targetCluster, state.player.position);
  return true;
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
  }

  if (acted) {
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

    // Update hazards
    updateHazards(state);
    applyTileHazardToPlayer(state);
    updateAlertModule(state);

    // Process other entities (placeholder for speed-based turns)
    for (const entity of state.entities) {
      if (entity.clusterId !== state.currentClusterId) continue;
      entity.energy += 10;
      if (entity.energy >= entity.speed) {
        entity.energy -= entity.speed;
        // Entity AI would go here
      }
    }
  }

  return acted;
}

// ── Click-to-move ──

export function handleMapClick(state: GameState, target: Position): Position[] {
  const cluster = getCurrentCluster(state);

  // If target is the player position, do nothing
  if (target.x === state.player.position.x && target.y === state.player.position.y) {
    state.autoPath = [];
    return [];
  }

  // Only pathfind to visible, walkable tiles
  const tile = cluster.tiles[target.y]?.[target.x];
  if (!tile || !tile.walkable || !tile.seen) {
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
    state.autoPath.shift();
    state.tick++;
    computeFOV(cluster, state.player.position);

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
