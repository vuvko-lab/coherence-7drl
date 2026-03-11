/**
 * Balancing test suite for Coherence cluster generation.
 *
 * Simulates clusters over time using the game's own logic (no rendering, no input).
 * Extracts metrics to catch balance problems before playtesting.
 *
 * Usage:
 *   npx tsx src/tests/sim-test.ts               # early cluster, seeds 1-50
 *   npx tsx src/tests/sim-test.ts --seeds 200   # stress test
 *   npx tsx src/tests/sim-test.ts --ticks 150   # longer simulation
 */

import { writeFileSync, mkdirSync } from 'fs';
import { createGame, processAction, sampleEntitySpawn, adminTeleportToCluster } from '../game';
import { findPath } from '../pathfinding';
import { generateCluster } from '../cluster';
import { seed as seedRng } from '../rng';
import { tileHazardDamage } from '../hazards';
import { Cluster, Position, TileType, HazardOverlayType, RoomType, RoomScenario, Faction } from '../types';
import type { GameState } from '../types';

// ── Constants ──

const DE_HAZARD_ROOMS = new Set<RoomType>(['corrupted', 'trigger_trap', 'memory_leak', 'gravity_well']);

// ── CLI args ──

const args = process.argv.slice(2);
const getArg = (flag: string, def: number) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? parseInt(args[idx + 1], 10) : def;
};

const SEED_COUNT = getArg('--seeds', 50);
const TOTAL_TICKS = getArg('--ticks', 250);
const SNAPSHOT_INTERVAL = 10;
const CLUSTER_ID = getArg('--cluster', 0); // used for per-seed table
const ALL_CLUSTER_IDS = [0, 1, 2, 3, 4, 5];

// ── Types ──

interface ChokepointStatus {
  roomId: number;
  traversable: boolean;
  connectedToEntry: boolean;
  connectedToExit: boolean;
}

interface SimSnapshot {
  tick: number;
  // Connectivity
  exitReachable: boolean;
  keyTerminalReachable: boolean;
  entryExitPathLength: number;  // Infinity if unreachable
  isolatedRooms: number[];      // room IDs with no walkable path to entry
  // Path analysis
  projectedPathDamage: number;  // coherence damage walking shortest entry→exit path
  hazardRoomsOnCriticalPath: number;
  chokepointStatus: ChokepointStatus[];
  // Entities
  totalEntities: number;
  destroyedEntities: number;    // cumulative since tick 0
  // D-E hazard path analysis
  minDERoomsOnAnyPath: number;  // 0 = safe path exists; 2 = all paths need ≥2 D-E rooms; Infinity = unreachable
  isolatedHighValueRooms: number[]; // key terminal / exit-adjacent rooms isolated from entry
  // Diagnostic
  hazardTileCounts: Record<HazardOverlayType, number>;
  collapsedTileCount: number;   // corruption stage === 2 (collapsed)
  floodLevel: number;           // max floodLevel across all memory_leak rooms
  walkableTiles: number;
  totalTiles: number;
  // Faction entity counts
  factionCounts: Record<Faction, number>;
  // Room emptiness: % of rooms with no entity for 10+ consecutive ticks (after tick 20)
  emptyRoomPct: number;
  // Alert module: does alert.m detect nearby hostile entities?
  alertDetectsEntities: boolean;  // true if alertThreats contains at least one entity-source threat
  alertEntityCount: number;       // number of entity-source threats in alertThreats
}

interface SeedResult {
  seed: number;
  snapshots: SimSnapshot[];
  genTimeMs: number;
  deterministic: boolean;
  quarantineWithoutSwitch: number;  // quarantine rooms with no deactivation interactable
  quarantineUnreachableSwitch: number; // quarantine rooms where switch exists but is unreachable
  quarantineDiagnostics: string[];  // detailed diagnostics for quarantine issues
  totalQuarantine: number;          // total quarantine rooms
}

// ── BFS reachability ──

function bfsReach(cluster: Cluster, from: Position): Set<string> {
  const w = cluster.width;
  const h = cluster.height;
  const visited = new Set<string>();
  const queue: Position[] = [from];
  const key = (p: Position) => `${p.x},${p.y}`;
  visited.add(key(from));

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nk = `${nx},${ny}`;
      if (visited.has(nk)) continue;
      const tile = cluster.tiles[ny][nx];
      if (!tile.walkable && tile.type !== TileType.Door) continue;
      visited.add(nk);
      queue.push({ x: nx, y: ny });
    }
  }
  return visited;
}

function bfsReachMulti(cluster: Cluster, sources: Position[]): Set<string> {
  const w = cluster.width;
  const h = cluster.height;
  const visited = new Set<string>();
  const queue: Position[] = [];
  for (const s of sources) {
    const k = `${s.x},${s.y}`;
    if (!visited.has(k)) { visited.add(k); queue.push(s); }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nk = `${nx},${ny}`;
      if (visited.has(nk)) continue;
      const tile = cluster.tiles[ny][nx];
      if (!tile.walkable && tile.type !== TileType.Door) continue;
      visited.add(nk);
      queue.push({ x: nx, y: ny });
    }
  }
  return visited;
}

// Returns minimum number of distinct D-E hazard rooms on any entry→exit path (capped at 2).
// 0 = a safe route exists; 2 = every route passes through ≥2 D-E rooms; Infinity = unreachable.
function computeMinDERoomsPath(cluster: Cluster, entry: Position, exits: Position[]): number {
  const deRoomIds = new Set(
    cluster.rooms.filter(r => DE_HAZARD_ROOMS.has(r.roomType)).map(r => r.id)
  );
  if (deRoomIds.size === 0) return 0;

  const exitSet = new Set(exits.map(p => `${p.x},${p.y}`));

  function bfsAvoidingDE(allowedDERoomIds: Set<number>): boolean {
    const visited = new Set<string>();
    const queue: Position[] = [{ ...entry }];
    visited.add(`${entry.x},${entry.y}`);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (exitSet.has(`${cur.x},${cur.y}`)) return true;
      for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
        const nx = cur.x + dx, ny = cur.y + dy;
        if (nx < 0 || nx >= cluster.width || ny < 0 || ny >= cluster.height) continue;
        const k = `${nx},${ny}`;
        if (visited.has(k)) continue;
        const tile = cluster.tiles[ny][nx];
        if (!tile.walkable && tile.type !== TileType.Door) continue;
        const rId = tile.roomId;
        if (rId !== undefined && rId >= 0 && deRoomIds.has(rId) && !allowedDERoomIds.has(rId)) continue;
        visited.add(k);
        queue.push({ x: nx, y: ny });
      }
    }
    return false;
  }

  if (bfsAvoidingDE(new Set())) return 0;

  const deRooms = cluster.rooms.filter(r => DE_HAZARD_ROOMS.has(r.roomType));
  for (const r of deRooms) {
    if (bfsAvoidingDE(new Set([r.id]))) return 1;
  }

  return 2; // all paths require ≥2 D-E rooms (or exit unreachable — caller checks exitReachable separately)
}

// Returns IDs of rooms that are "high value": contain key terminal or are adjacent to an interface exit.
function getHighValueRoomIds(cluster: Cluster): Set<number> {
  const ids = new Set<number>();

  for (const t of cluster.terminals) {
    if (!t.hasKey) continue;
    const room = cluster.rooms.find(r =>
      t.position.x >= r.x && t.position.x < r.x + r.w &&
      t.position.y >= r.y && t.position.y < r.y + r.h
    );
    if (room) ids.add(room.id);
  }

  for (const iface of cluster.interfaces) {
    const p = iface.position;
    for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      const tile = cluster.tiles[p.y + dy]?.[p.x + dx];
      if (tile?.roomId !== undefined && tile.roomId >= 0) {
        ids.add(tile.roomId);
        break;
      }
    }
  }

  return ids;
}

function getEntryPos(cluster: Cluster): Position {
  for (let y = 0; y < cluster.height; y++) {
    if (cluster.tiles[y]?.[0]?.type === TileType.InterfaceExit) {
      for (let x = 1; x < cluster.width; x++) {
        if (cluster.tiles[y][x].walkable) return { x, y };
      }
    }
  }
  // Fallback: top-left walkable tile
  for (let y = 0; y < cluster.height; y++) {
    for (let x = 0; x < cluster.width; x++) {
      if (cluster.tiles[y][x].walkable) return { x, y };
    }
  }
  return { x: 1, y: 1 };
}

function getExitPositions(cluster: Cluster): Position[] {
  return cluster.interfaces
    .filter(i => i.position.x > 0)
    .map(i => i.position);
}

function computePathDamage(cluster: Cluster, path: Position[]): number {
  return path.reduce((sum, pos) => sum + tileHazardDamage(cluster.tiles[pos.y]?.[pos.x]?.hazardOverlay), 0);
}

// ── Snapshot extraction ──

function snapshotCluster(
  state: GameState,
  clusterId: number,
  entryPos: Position,
  initialEntityCount: number,
  currentEntityCount: number,
  roomLastEntityTick?: Map<number, number>,
): SimSnapshot {
  const cluster = state.clusters.get(clusterId)!;
  const reachable = bfsReach(cluster, entryPos);
  const exitPositions = getExitPositions(cluster);
  const reachableFromExit = exitPositions.length > 0 ? bfsReachMulti(cluster, exitPositions) : new Set<string>();

  // Exit reachability
  const exitReachable = exitPositions.some(p => reachable.has(`${p.x},${p.y}`));

  // Shortest entry→exit path
  let entryExitPathLength = Infinity;
  let shortestPath: Position[] = [];
  for (const exitPos of exitPositions) {
    const path = findPath(cluster, entryPos, exitPos);
    if (path !== null && path.length < entryExitPathLength) {
      entryExitPathLength = path.length;
      shortestPath = path;
    }
  }

  // Key terminal reachability — terminal tile itself is non-walkable, so check adjacency
  const keyTerminal = cluster.terminals.find(t => t.hasKey);
  const keyTerminalReachable = keyTerminal
    ? [[0,-1],[0,1],[-1,0],[1,0]].some(([dx,dy]) =>
        reachable.has(`${keyTerminal.position.x+dx},${keyTerminal.position.y+dy}`))
    : true; // no key terminal in this cluster

  // Isolated rooms: rooms with no tile reachable from entry
  const isolatedRooms: number[] = [];
  for (const room of cluster.rooms) {
    let hasReachable = false;
    for (let y = room.y; y < room.y + room.h && !hasReachable; y++) {
      for (let x = room.x; x < room.x + room.w && !hasReachable; x++) {
        if (reachable.has(`${x},${y}`)) hasReachable = true;
      }
    }
    if (!hasReachable) isolatedRooms.push(room.id);
  }

  // Projected path damage
  const projectedPathDamage = computePathDamage(cluster, shortestPath);

  // Hazard rooms on critical path
  const pathRoomIds = new Set<number>();
  for (const pos of shortestPath) {
    const roomId = cluster.tiles[pos.y]?.[pos.x]?.roomId;
    if (roomId !== undefined && roomId >= 0) pathRoomIds.add(roomId);
  }
  const hazardRoomsOnCriticalPath = [...pathRoomIds].filter(rid => {
    const room = cluster.rooms.find(r => r.id === rid);
    return room && room.roomType !== 'normal' && room.roomType !== 'echo_chamber';
  }).length;

  // Chokepoint status
  const chokepointStatus: ChokepointStatus[] = cluster.rooms
    .filter(r => r.tags.geometric.has('chokepoint'))
    .map(room => {
      let traversable = false;
      let connectedToEntry = false;
      let connectedToExit = false;
      for (let y = room.y; y < room.y + room.h; y++) {
        for (let x = room.x; x < room.x + room.w; x++) {
          const tile = cluster.tiles[y]?.[x];
          if (!tile) continue;
          if (tile.walkable || tile.type === TileType.Door) traversable = true;
          if (reachable.has(`${x},${y}`)) connectedToEntry = true;
          if (reachableFromExit.has(`${x},${y}`)) connectedToExit = true;
        }
      }
      return { roomId: room.id, traversable, connectedToEntry, connectedToExit };
    });

  // D-E path analysis
  const minDERoomsOnAnyPath = exitReachable ? computeMinDERoomsPath(cluster, entryPos, exitPositions) : Infinity;

  // High-value room isolation
  const hvRoomIds = getHighValueRoomIds(cluster);
  const isolatedHighValueRooms: number[] = [];
  for (const hvId of hvRoomIds) {
    const room = cluster.rooms.find(r => r.id === hvId);
    if (!room) continue;
    let hasReachable = false;
    for (let y = room.y; y < room.y + room.h && !hasReachable; y++) {
      for (let x = room.x; x < room.x + room.w && !hasReachable; x++) {
        if (reachable.has(`${x},${y}`)) hasReachable = true;
      }
    }
    if (!hasReachable) isolatedHighValueRooms.push(hvId);
  }

  // Diagnostic: hazard tile counts
  const hazardTileCounts: Record<HazardOverlayType, number> = {
    corruption: 0, flood: 0, spark: 0, scorch: 0, beam: 0, gravity: 0,
  };
  let collapsedTileCount = 0;
  let walkableTiles = 0;
  let totalTiles = 0;

  for (let y = 0; y < cluster.height; y++) {
    for (let x = 0; x < cluster.width; x++) {
      const tile = cluster.tiles[y][x];
      if (tile.type === TileType.Void) continue;
      totalTiles++;
      if (tile.walkable) walkableTiles++;
      if (tile.hazardOverlay) {
        hazardTileCounts[tile.hazardOverlay.type]++;
        if (tile.hazardOverlay.type === 'corruption' && tile.hazardOverlay.stage === 2) {
          collapsedTileCount++;
        }
      }
    }
  }

  // Faction entity counts
  const factionCounts: Record<Faction, number> = { neutral: 0, aggressive: 0, friendly: 0, titan: 0, player: 0 };
  for (const e of state.entities) {
    if (e.clusterId !== clusterId) continue;
    const faction = e.ai?.faction ?? 'neutral';
    if (faction in factionCounts) factionCounts[faction]++;
  }

  // Diagnostic: max flood level across all memory_leak rooms
  let floodLevel = 0;
  for (const room of cluster.rooms) {
    if (room.roomType === 'memory_leak' && room.hazardState?.floodLevel !== undefined) {
      floodLevel = Math.max(floodLevel, room.hazardState.floodLevel);
    }
  }

  // Room emptiness: % of non-hall rooms that are truly empty (no hazard, no terminal,
  // no interactable, and no entity for 10+ consecutive ticks) after tick 20
  let emptyRoomPct = 0;
  if (state.tick >= 20 && roomLastEntityTick) {
    const terminalRoomIds = new Set(cluster.terminals.map(t => t.roomId));
    const interactableRoomIds = new Set(
      cluster.interactables.filter(i => !i.hidden).map(i => i.roomId)
    );
    const nonHallRooms = cluster.rooms.filter(r => !r.tags.geometric.has('hall'));
    const emptyCount = nonHallRooms.filter(r => {
      // Has hazard?
      if (r.roomType !== 'normal') return false;
      // Has terminal?
      if (terminalRoomIds.has(r.id)) return false;
      // Has visible interactable?
      if (interactableRoomIds.has(r.id)) return false;
      // Has had an entity in the last 10 ticks?
      const lastTick = roomLastEntityTick.get(r.id) ?? -1;
      return state.tick - lastTick >= 10;
    }).length;
    emptyRoomPct = nonHallRooms.length > 0 ? (emptyCount / nonHallRooms.length) * 100 : 0;
  }

  // Alert module entity detection
  const entityThreats = (state.alertThreats ?? []).filter(t => t.source === 'entity');
  const alertDetectsEntities = entityThreats.length > 0;
  const alertEntityCount = entityThreats.length;

  return {
    tick: state.tick,
    exitReachable,
    keyTerminalReachable,
    entryExitPathLength,
    isolatedRooms,
    projectedPathDamage,
    hazardRoomsOnCriticalPath,
    chokepointStatus,
    totalEntities: currentEntityCount,
    destroyedEntities: initialEntityCount - currentEntityCount,
    minDERoomsOnAnyPath,
    isolatedHighValueRooms,
    hazardTileCounts,
    collapsedTileCount,
    floodLevel,
    walkableTiles,
    totalTiles,
    factionCounts,
    emptyRoomPct,
    alertDetectsEntities,
    alertEntityCount,
  };
}

// ── Simulation ──

function simulateCluster(seed: number, ticks: number, clusterId: number): { snapshots: SimSnapshot[]; genTimeMs: number; quarantineWithoutSwitch: number; quarantineUnreachableSwitch: number; quarantineDiagnostics: string[]; totalQuarantine: number } {
  const t0 = performance.now();
  const state = createGame(seed);

  // For non-zero cluster IDs, teleport directly — simulates that cluster's generation rules
  // (bypasses cluster 0's tutorial intro so each depth is tested in isolation)
  if (clusterId > 0) {
    adminTeleportToCluster(state, clusterId);
    // Spawn entities for the teleported cluster (adminTeleport skips this)
    const newCluster = state.clusters.get(clusterId)!;
    const mockSpawns = sampleEntitySpawn(clusterId, seed);
    for (const e of mockSpawns) state.entities.push(e);
    state.player.clusterId = clusterId;
    newCluster; // used above
  }
  const genTimeMs = performance.now() - t0;

  if (!state.clusters.has(clusterId)) {
    return { snapshots: [], genTimeMs, quarantineWithoutSwitch: 0, quarantineUnreachableSwitch: 0, quarantineDiagnostics: [], totalQuarantine: 0 };
  }

  const cluster = state.clusters.get(clusterId)!;
  const entryPos = getEntryPos(cluster);
  const initialEntityCount = state.entities.length;

  // Track last tick each room had an entity present (for empty room metric)
  const roomLastEntityTick = new Map<number, number>();

  function updateRoomEntityPresence() {
    for (const e of state.entities) {
      if (e.clusterId !== clusterId) continue;
      const tile = cluster.tiles[e.position.y]?.[e.position.x];
      if (tile?.roomId != null && tile.roomId >= 0) {
        roomLastEntityTick.set(tile.roomId, state.tick);
      }
    }
  }

  updateRoomEntityPresence();
  const snapshots: SimSnapshot[] = [];
  snapshots.push(snapshotCluster(state, clusterId, entryPos, initialEntityCount, state.entities.length, roomLastEntityTick));

  for (let t = 0; t < ticks; t++) {
    processAction(state, { kind: 'wait' });
    updateRoomEntityPresence();
    if ((t + 1) % SNAPSHOT_INTERVAL === 0) {
      snapshots.push(snapshotCluster(state, clusterId, entryPos, initialEntityCount, state.entities.length, roomLastEntityTick));
    }
  }

  // Check quarantine rooms have reachable deactivation switches
  const quarantineRooms = cluster.rooms.filter(r => r.roomType === 'quarantine');
  const totalQuarantine = quarantineRooms.length;
  let quarantineWithoutSwitch = 0;
  let quarantineUnreachableSwitch = 0;
  const quarantineDiagnostics: string[] = [];

  // BFS from entry, respecting sealed doors (quarantine doors are not walkable)
  const reachable = bfsReach(cluster, entryPos);
  const quarantineRoomIds = new Set(quarantineRooms.map(r => r.id));

  for (const qRoom of quarantineRooms) {
    // Find all interactables that can deactivate this quarantine room
    const switches = cluster.interactables.filter(ia =>
      ia.dialog.some(n => n.choices.some(c => c.deactivatesHazardRoomId === qRoom.id))
    );
    // Also check terminals with hazardOverrides
    const termSwitches = cluster.terminals.filter(t =>
      t.hazardOverrides?.some(o => o.hazardRoomId === qRoom.id)
    );
    const totalSwitches = switches.length + termSwitches.length;

    if (totalSwitches === 0) {
      quarantineWithoutSwitch++;
      const hasKey = cluster.terminals.some(t => t.hasKey && t.roomId === qRoom.id);
      quarantineDiagnostics.push(
        `  [NO SWITCH] seed=${seed} cluster=${clusterId} quarantine room ${qRoom.id} (${qRoom.w}x${qRoom.h})` +
        `${hasKey ? ' [HAS KEY TERMINAL]' : ''} — no deactivation assigned`
      );
      continue;
    }

    // Check if any switch (interactable or terminal) is reachable from entry
    let anyReachable = false;
    let anyUsableSwitch = false;
    const switchDetails: string[] = [];

    for (const sw of switches) {
      const posKey = `${sw.position.x},${sw.position.y}`;
      const isReachableTile = reachable.has(posKey);
      const swRoom = cluster.rooms.find(r => r.id === sw.roomId);
      const inQuarantine = swRoom ? quarantineRoomIds.has(swRoom.id) : false;
      const reachableStatus = isReachableTile ? 'REACHABLE' : 'UNREACHABLE';
      switchDetails.push(
        `    ia-switch ${sw.id} (${sw.kind}) in room ${sw.roomId} ` +
        `[${swRoom?.roomType ?? '?'}] @ (${sw.position.x},${sw.position.y}) → ${reachableStatus}` +
        `${inQuarantine ? ' [INSIDE QUARANTINE]' : ''}` +
        `${sw.isDataArchive ? ' [DATA ARCHIVE]' : ''}`
      );
      if (isReachableTile) anyReachable = true;

      // Check usability: data archives render deactivation from ia.dialog directly;
      // standard interactables need a root menu link
      if (isReachableTile) {
        if (sw.isDataArchive) {
          anyUsableSwitch = true;
        } else {
          const rootNode = sw.dialog.find(n => n.id === 'root');
          if (rootNode?.choices.some(c => c.nodeId === `deactivate_${qRoom.id}`)) {
            anyUsableSwitch = true;
          } else {
            switchDetails.push(`    ⚠ ia-switch ${sw.id} — deactivate node exists but NOT linked from root menu`);
          }
        }
      }
    }

    for (const ts of termSwitches) {
      const posKey = `${ts.position.x},${ts.position.y}`;
      // Terminal tile is not walkable, check adjacent tiles for reachability
      const adjReachable = [[0,-1],[0,1],[-1,0],[1,0]].some(([dx,dy]) =>
        reachable.has(`${ts.position.x+dx},${ts.position.y+dy}`)
      );
      const tsRoom = cluster.rooms.find(r => r.id === ts.roomId);
      const inQuarantine = tsRoom ? quarantineRoomIds.has(tsRoom.id) : false;
      switchDetails.push(
        `    term-switch ${ts.id} in room ${ts.roomId} ` +
        `[${tsRoom?.roomType ?? '?'}] @ (${ts.position.x},${ts.position.y}) → ${adjReachable ? 'REACHABLE' : 'UNREACHABLE'}` +
        `${inQuarantine ? ' [INSIDE QUARANTINE]' : ''}`
      );
      if (adjReachable) { anyReachable = true; anyUsableSwitch = true; }
    }

    if (!anyReachable) {
      quarantineUnreachableSwitch++;
      const hasKey = cluster.terminals.some(t => t.hasKey && t.roomId === qRoom.id);
      quarantineDiagnostics.push(
        `  [UNREACHABLE] seed=${seed} cluster=${clusterId} quarantine room ${qRoom.id}` +
        `${hasKey ? ' [HAS KEY TERMINAL]' : ''} — ${totalSwitches} switch(es) exist but none reachable:`,
        ...switchDetails
      );
    } else if (!anyUsableSwitch) {
      quarantineUnreachableSwitch++;  // effectively unreachable — no usable dialog path
      const hasKey = cluster.terminals.some(t => t.hasKey && t.roomId === qRoom.id);
      quarantineDiagnostics.push(
        `  [NO USABLE SWITCH] seed=${seed} cluster=${clusterId} quarantine room ${qRoom.id}` +
        `${hasKey ? ' [HAS KEY TERMINAL]' : ''} — ${totalSwitches} switch(es) assigned but ALL lack root menu link (e.g. archive echoes):`,
        ...switchDetails.filter(l => l.includes('⚠'))
      );
    } else {
      // Still report if there are usability warnings
      const warnings = switchDetails.filter(l => l.includes('⚠'));
      if (warnings.length > 0) {
        const hasKey = cluster.terminals.some(t => t.hasKey && t.roomId === qRoom.id);
        quarantineDiagnostics.push(
          `  [WARNING] seed=${seed} cluster=${clusterId} quarantine room ${qRoom.id}` +
          `${hasKey ? ' [HAS KEY TERMINAL]' : ''} — some switches have issues (but at least one is usable):`,
          ...warnings
        );
      }
    }
  }

  return { snapshots, genTimeMs, quarantineWithoutSwitch, quarantineUnreachableSwitch, quarantineDiagnostics, totalQuarantine };
}

// ── Determinism check ──

function checkDeterminism(seed: number): boolean {
  const r1 = simulateCluster(seed, 0, CLUSTER_ID);
  const r2 = simulateCluster(seed, 0, CLUSTER_ID);
  if (r1.snapshots.length === 0 || r2.snapshots.length === 0) return false;
  const s1 = r1.snapshots[0];
  const s2 = r2.snapshots[0];
  return (
    s1.walkableTiles === s2.walkableTiles &&
    s1.totalTiles === s2.totalTiles &&
    s1.entryExitPathLength === s2.entryExitPathLength &&
    s1.exitReachable === s2.exitReachable
  );
}

// ── Statistics ──

function mean(vals: number[]): number {
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function stddev(vals: number[]): number {
  if (vals.length < 2) return 0;
  const m = mean(vals);
  return Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length);
}

function cv(vals: number[]): number {
  const m = mean(vals);
  return m === 0 ? 0 : stddev(vals) / m;
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return 'N/A';
  return ((numerator / denominator) * 100).toFixed(1) + '%';
}

// ── Reporting ──

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';


function critical(msg: string) { console.log(`${BOLD}${RED}[CRITICAL] ${msg}${RESET}`); }

// ── Plot generation ──

function generatePlots(
  allClusterResults: Map<number, SeedResult[]>,
  hazardData: Map<number, Record<string, number>>,
  hazardRoomCounts: Map<number, number>,
  scenarioData: Map<number, Record<string, number>>,
  factionTimeData: Map<number, Map<number, Record<string, number>>>,
) {
  const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'];
  const W = 800, H = 320, PAD = { top: 40, right: 20, bottom: 60, left: 50 };

  function barChart(title: string, categories: string[], series: { label: string; values: number[]; color: string }[], threshold?: { value: number; label: string }): string {
    const maxVal = Math.max(1, ...series.flatMap(s => s.values));
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const groupW = plotW / categories.length;
    const barW = Math.min(groupW * 0.7 / series.length, 30);
    let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="background:#1a1a2e;border-radius:8px;margin:8px">`;
    svg += `<text x="${W/2}" y="24" text-anchor="middle" fill="#e0e0e0" font-size="14" font-weight="bold">${title}</text>`;
    // Y axis
    for (let i = 0; i <= 4; i++) {
      const y = PAD.top + plotH - (i / 4) * plotH;
      const val = (maxVal * i / 4).toFixed(1);
      svg += `<line x1="${PAD.left}" y1="${y}" x2="${W-PAD.right}" y2="${y}" stroke="#333" stroke-width="0.5"/>`;
      svg += `<text x="${PAD.left-4}" y="${y+4}" text-anchor="end" fill="#888" font-size="10">${val}</text>`;
    }
    // Bars
    for (let ci = 0; ci < categories.length; ci++) {
      const gx = PAD.left + ci * groupW + (groupW - barW * series.length) / 2;
      for (let si = 0; si < series.length; si++) {
        const val = series[si].values[ci] ?? 0;
        const barH = (val / maxVal) * plotH;
        const x = gx + si * barW;
        const y = PAD.top + plotH - barH;
        svg += `<rect x="${x}" y="${y}" width="${barW-1}" height="${barH}" fill="${series[si].color}" opacity="0.85"/>`;
        if (barH > 12) svg += `<text x="${x+barW/2}" y="${y+12}" text-anchor="middle" fill="white" font-size="9">${val.toFixed(1)}</text>`;
      }
      svg += `<text x="${PAD.left + ci * groupW + groupW/2}" y="${H-PAD.bottom+14}" text-anchor="middle" fill="#aaa" font-size="10" transform="rotate(-25, ${PAD.left + ci * groupW + groupW/2}, ${H-PAD.bottom+14})">${categories[ci]}</text>`;
    }
    // Threshold line
    if (threshold) {
      const y = PAD.top + plotH - (threshold.value / maxVal) * plotH;
      svg += `<line x1="${PAD.left}" y1="${y}" x2="${W-PAD.right}" y2="${y}" stroke="#ff6b6b" stroke-width="1.5" stroke-dasharray="6,3"/>`;
      svg += `<text x="${W-PAD.right-4}" y="${y-4}" text-anchor="end" fill="#ff6b6b" font-size="10">${threshold.label}</text>`;
    }
    // Legend
    const legendY = H - 12;
    for (let si = 0; si < series.length; si++) {
      const lx = PAD.left + si * 100;
      svg += `<rect x="${lx}" y="${legendY-8}" width="10" height="10" fill="${series[si].color}"/>`;
      svg += `<text x="${lx+14}" y="${legendY}" fill="#aaa" font-size="10">${series[si].label}</text>`;
    }
    svg += '</svg>';
    return svg;
  }

  function lineChart(title: string, xLabels: number[], series: { label: string; values: number[]; color: string }[], threshold?: { value: number; label: string }): string {
    const maxVal = Math.max(1, ...series.flatMap(s => s.values));
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="background:#1a1a2e;border-radius:8px;margin:8px">`;
    svg += `<text x="${W/2}" y="24" text-anchor="middle" fill="#e0e0e0" font-size="14" font-weight="bold">${title}</text>`;
    // Grid
    for (let i = 0; i <= 4; i++) {
      const y = PAD.top + plotH - (i / 4) * plotH;
      svg += `<line x1="${PAD.left}" y1="${y}" x2="${W-PAD.right}" y2="${y}" stroke="#333" stroke-width="0.5"/>`;
      svg += `<text x="${PAD.left-4}" y="${y+4}" text-anchor="end" fill="#888" font-size="10">${(maxVal * i / 4).toFixed(1)}</text>`;
    }
    // X labels
    for (let i = 0; i < xLabels.length; i++) {
      const x = PAD.left + (i / Math.max(1, xLabels.length - 1)) * plotW;
      svg += `<text x="${x}" y="${H-PAD.bottom+14}" text-anchor="middle" fill="#aaa" font-size="10">${xLabels[i]}</text>`;
    }
    // Lines
    for (const s of series) {
      const points = s.values.map((v, i) => {
        const x = PAD.left + (i / Math.max(1, xLabels.length - 1)) * plotW;
        const y = PAD.top + plotH - (v / maxVal) * plotH;
        return `${x},${y}`;
      }).join(' ');
      svg += `<polyline points="${points}" fill="none" stroke="${s.color}" stroke-width="2"/>`;
      // Dots
      for (let i = 0; i < s.values.length; i++) {
        const x = PAD.left + (i / Math.max(1, xLabels.length - 1)) * plotW;
        const y = PAD.top + plotH - (s.values[i] / maxVal) * plotH;
        svg += `<circle cx="${x}" cy="${y}" r="3" fill="${s.color}"/>`;
      }
    }
    // Threshold
    if (threshold) {
      const y = PAD.top + plotH - (threshold.value / maxVal) * plotH;
      svg += `<line x1="${PAD.left}" y1="${y}" x2="${W-PAD.right}" y2="${y}" stroke="#ff6b6b" stroke-width="1.5" stroke-dasharray="6,3"/>`;
      svg += `<text x="${W-PAD.right-4}" y="${y-4}" text-anchor="end" fill="#ff6b6b" font-size="10">${threshold.label}</text>`;
    }
    // Legend
    const legendY = H - 12;
    for (let si = 0; si < series.length; si++) {
      const lx = PAD.left + si * 100;
      svg += `<rect x="${lx}" y="${legendY-8}" width="10" height="10" fill="${series[si].color}"/>`;
      svg += `<text x="${lx+14}" y="${legendY}" fill="#aaa" font-size="10">${series[si].label}</text>`;
    }
    svg += '</svg>';
    return svg;
  }

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sim-Test Plots</title>
<style>body{background:#0d0d1a;color:#e0e0e0;font-family:monospace;padding:20px}h1,h2{color:#7ec8e3}svg{display:inline-block;vertical-align:top}</style></head><body>
<h1>Coherence Sim-Test Plots</h1><p>Generated: ${new Date().toISOString()} | Seeds: ${SEED_COUNT} | Ticks: ${TOTAL_TICKS}</p>`;

  // 1. Hazard room type distribution per cluster
  html += '<h2>Hazard Room Types (avg per cluster)</h2>';
  const HAZARD_TYPES: RoomType[] = ['corrupted', 'trigger_trap', 'memory_leak', 'firewall', 'unstable', 'quarantine', 'echo_chamber', 'gravity_well'];
  for (const cid of ALL_CLUSTER_IDS) {
    const counts = hazardData.get(cid);
    if (!counts) continue;
    const nSeeds = SEED_COUNT;
    html += barChart(
      `Cluster ${cid} Hazard Rooms (avg of ${nSeeds} seeds)`,
      HAZARD_TYPES.map(h => h.replace('_', ' ')),
      [{ label: 'count', values: HAZARD_TYPES.map(h => (counts[h] ?? 0) / nSeeds), color: COLORS[0] }],
    );
  }

  // 2. Scenario generation rates
  html += '<h2>Room Scenario Generation Rates (clusters 1+)</h2>';
  const ALL_SCENARIOS: RoomScenario[] = ['stuck_echo', 'spooky_astronauts', 'broken_sleever', 'whispering_wall', 'lost_expedition', 'silent_alarm', 'corruption_ritual'];
  for (const cid of ALL_CLUSTER_IDS) {
    if (cid < 1) continue;
    const counts = scenarioData.get(cid);
    if (!counts) continue;
    html += barChart(
      `Cluster ${cid} Scenarios (% of seeds)`,
      ALL_SCENARIOS.map(s => s.replace('_', ' ')),
      [{ label: '% seeds', values: ALL_SCENARIOS.map(s => ((counts[s] ?? 0) / SEED_COUNT) * 100), color: COLORS[1] }],
      { value: 50, label: '50% target' },
    );
  }

  // 3. Faction balance over time
  html += '<h2>Faction Balance Over Time</h2>';
  const FACTIONS_PLOT: Faction[] = ['neutral', 'aggressive', 'friendly', 'titan'];
  const factionColors: Record<string, string> = { neutral: '#95a5a6', aggressive: '#e74c3c', friendly: '#2ecc71', titan: '#9b59b6' };
  for (const cid of ALL_CLUSTER_IDS) {
    const tickData = factionTimeData.get(cid);
    if (!tickData || tickData.size === 0) continue;
    const ticks = [...tickData.keys()].sort((a, b) => a - b);
    html += lineChart(
      `Cluster ${cid} Faction Counts Over Time`,
      ticks,
      FACTIONS_PLOT.map(f => ({
        label: f,
        values: ticks.map(t => tickData.get(t)?.[f] ?? 0),
        color: factionColors[f],
      })),
    );
  }

  // 4. Aggressive-Friendly diff over time
  html += '<h2>Aggressive - Friendly Difference Over Time</h2>';
  for (const cid of ALL_CLUSTER_IDS) {
    const tickData = factionTimeData.get(cid);
    if (!tickData || tickData.size === 0) continue;
    const ticks = [...tickData.keys()].sort((a, b) => a - b);
    html += lineChart(
      `Cluster ${cid} |Aggressive - Friendly|`,
      ticks,
      [{ label: 'diff', values: ticks.map(t => {
        const d = tickData.get(t);
        return Math.abs((d?.aggressive ?? 0) - (d?.friendly ?? 0));
      }), color: '#f39c12' }],
      { value: 3, label: 'target ≤ 3' },
    );
  }

  // 5. Empty room % over time
  html += '<h2>Empty Rooms Over Time (% rooms with no entity for 10+ ticks)</h2>';
  for (const cid of ALL_CLUSTER_IDS) {
    const cidResults = allClusterResults.get(cid);
    if (!cidResults) continue;
    const valid = cidResults.filter(r => r.snapshots.length > 1);
    if (valid.length === 0) continue;
    const snapshotTicks = valid[0].snapshots.map(s => s.tick);
    html += lineChart(
      `Cluster ${cid} Empty Room %`,
      snapshotTicks,
      [{ label: 'empty %', values: snapshotTicks.map((_, si) => {
        const vals = valid.map(r => r.snapshots[si]?.emptyRoomPct ?? 0);
        return vals.reduce((a, b) => a + b, 0) / vals.length;
      }), color: '#e67e22' }],
    );
  }

  html += '</body></html>';

  mkdirSync('sim-plots', { recursive: true });
  writeFileSync('sim-plots/index.html', html, 'utf8');
  console.log(`\nPlots written to sim-plots/index.html`);
}

// ── Main ──

async function main() {
  console.log(`\n${BOLD}=== Coherence Balancing Test Suite ===${RESET}`);
  console.log(`Seeds: 1–${SEED_COUNT} | Ticks: ${TOTAL_TICKS} | Detail cluster: ${CLUSTER_ID}\n`);

  const seeds = Array.from({ length: SEED_COUNT }, (_, i) => i + 1);

  // ── Per-cluster aggregate table ──
  console.log(`${BOLD}=== Per-Cluster Aggregate (avg across ${SEED_COUNT} seeds) ===${RESET}`);
  const pcColW = 8;
  const pcHeader = [
    'cluster'.padEnd(10),
    'exit%'.padEnd(pcColW),
    'key%'.padEnd(pcColW),
    'pathLen'.padEnd(pcColW),
    'dmg@50'.padEnd(pcColW),
    'iso@0'.padEnd(pcColW),
    'ent@0'.padEnd(pcColW),
    'ent@100'.padEnd(pcColW),
    'empty%'.padEnd(pcColW),
    'genMs'.padEnd(pcColW),
  ].join(' ');
  console.log(pcHeader);
  console.log('-'.repeat(pcHeader.length));

  const getSnap = (r: SeedResult, tick: number) => {
    const exact = r.snapshots.find(s => s.tick === tick);
    if (exact) return exact;
    const target = Math.round(tick / SNAPSHOT_INTERVAL) * SNAPSHOT_INTERVAL;
    return r.snapshots.find(s => s.tick === target) ?? r.snapshots[r.snapshots.length - 1];
  };

  const allClusterResults: Map<number, SeedResult[]> = new Map();

  for (const cid of ALL_CLUSTER_IDS) {
    const cidResults: SeedResult[] = [];
    const origLog2 = console.log;
    console.log = () => {};  // suppress cluster-gen logs during simulation runs
    for (const seed of seeds) {
      const { snapshots, genTimeMs, quarantineWithoutSwitch, quarantineUnreachableSwitch, quarantineDiagnostics, totalQuarantine } = simulateCluster(seed, TOTAL_TICKS, cid);
      const deterministic = checkDeterminism(seed);
      cidResults.push({ seed, snapshots, genTimeMs, deterministic, quarantineWithoutSwitch, quarantineUnreachableSwitch, quarantineDiagnostics, totalQuarantine });
    }
    console.log = origLog2;
    allClusterResults.set(cid, cidResults);

    const valid = cidResults.filter(r => r.snapshots.length > 0);
    const N = valid.length;
    if (N === 0) { console.log(`  cluster ${cid}: no data`); continue; }

    const exitPct = valid.filter(r => getSnap(r, 100)?.exitReachable).length / N * 100;
    const keyPct  = valid.filter(r => getSnap(r, 100)?.keyTerminalReachable).length / N * 100;
    const avgPath = mean(valid.map(r => {
      const pl = getSnap(r, 0)?.entryExitPathLength ?? Infinity;
      return pl === Infinity ? 0 : pl;
    }));
    const avgDmg50 = mean(valid.map(r => getSnap(r, 50)?.projectedPathDamage ?? 0));
    const isoCount = valid.filter(r => (getSnap(r, 0)?.isolatedRooms.length ?? 0) > 0).length;
    const avgEnt0   = mean(valid.map(r => getSnap(r, 0)?.totalEntities ?? 0));
    const avgEnt100 = mean(valid.map(r => getSnap(r, 100)?.totalEntities ?? 0));
    const avgEmpty  = mean(valid.map(r => r.snapshots[r.snapshots.length - 1]?.emptyRoomPct ?? 0));
    const avgGen    = mean(valid.map(r => r.genTimeMs));

    const exitColor = exitPct >= 95 ? GREEN : RED;
    const isoColor  = isoCount === 0 ? GREEN : RED;
    const entColor  = avgEnt0 > 20 ? YELLOW : avgEnt0 > 35 ? RED : GREEN;
    const row = [
      `cluster ${cid}`.padEnd(10),
      `${exitColor}${exitPct.toFixed(0)}%${RESET}`.padEnd(pcColW + exitColor.length + RESET.length),
      `${keyPct.toFixed(0)}%`.padEnd(pcColW),
      avgPath.toFixed(0).padEnd(pcColW),
      avgDmg50.toFixed(1).padEnd(pcColW),
      `${isoColor}${isoCount}${RESET}`.padEnd(pcColW + isoColor.length + RESET.length),
      `${entColor}${avgEnt0.toFixed(1)}${RESET}`.padEnd(pcColW + entColor.length + RESET.length),
      avgEnt100.toFixed(1).padEnd(pcColW),
      `${avgEmpty.toFixed(0)}%`.padEnd(pcColW),
      avgGen.toFixed(1).padEnd(pcColW),
    ].join(' ');
    console.log(row);
    process.stdout.write('');
  }
  console.log();

  // ── Per-seed table for CLUSTER_ID ──
  const results = allClusterResults.get(CLUSTER_ID) ?? [];
  console.log(`\n${BOLD}=== Per-Seed Detail: Cluster ${CLUSTER_ID} ===${RESET}`);
  const snapshotAt = (result: SeedResult, tick: number) =>
    result.snapshots.find(s => s.tick === tick) ?? result.snapshots[result.snapshots.length - 1];

  const COL = { seed: 5, exit: 10, key: 10, pathLen: 10, damage50: 10, isolated: 9, gen: 8, det: 5 };
  const header = [
    'seed'.padEnd(COL.seed),
    'exit@100'.padEnd(COL.exit),
    'key@100'.padEnd(COL.key),
    'pathLen@0'.padEnd(COL.pathLen),
    'dmg@50'.padEnd(COL.damage50),
    'iso@0'.padEnd(COL.isolated),
    'genMs'.padEnd(COL.gen),
    'det'.padEnd(COL.det),
  ].join(' | ');
  console.log(header);
  console.log('-'.repeat(header.length));

  const criticalFailures: string[] = [];

  for (const r of results) {
    const s0 = snapshotAt(r, 0);
    const s50 = snapshotAt(r, 50);
    const s100 = snapshotAt(r, 100);
    if (!s0 || !s50 || !s100) continue;

    const exitStr = s100.exitReachable ? 'yes' : `${RED}NO${RESET}`;
    const keyStr = s100.keyTerminalReachable ? 'yes' : `${RED}NO${RESET}`;
    const pathStr = s0.entryExitPathLength === Infinity ? `${RED}∞${RESET}` : String(s0.entryExitPathLength);
    const dmgStr = s50.projectedPathDamage > 60 ? `${YELLOW}${s50.projectedPathDamage}${RESET}` : String(s50.projectedPathDamage);
    const isoStr = s0.isolatedRooms.length > 0 ? `${RED}${s0.isolatedRooms.length}${RESET}` : '0';
    const detStr = r.deterministic ? 'ok' : `${RED}FAIL${RESET}`;

    console.log([
      String(r.seed).padEnd(COL.seed),
      exitStr.padEnd(COL.exit + (exitStr.length - exitStr.replace(/\x1b\[[0-9;]*m/g, '').length)),
      keyStr.padEnd(COL.key + (keyStr.length - keyStr.replace(/\x1b\[[0-9;]*m/g, '').length)),
      pathStr.padEnd(COL.pathLen),
      dmgStr.padEnd(COL.damage50 + (dmgStr.length - dmgStr.replace(/\x1b\[[0-9;]*m/g, '').length)),
      isoStr.padEnd(COL.isolated + (isoStr.length - isoStr.replace(/\x1b\[[0-9;]*m/g, '').length)),
      r.genTimeMs.toFixed(1).padEnd(COL.gen),
      detStr.padEnd(COL.det + (detStr.length - detStr.replace(/\x1b\[[0-9;]*m/g, '').length)),
    ].join(' | '));

    // Collect critical failures
    if (!r.deterministic) criticalFailures.push(`seed ${r.seed}: non-deterministic generation`);
    if (s0.isolatedRooms.length > 0) criticalFailures.push(`seed ${r.seed}: ${s0.isolatedRooms.length} rooms isolated at tick 0`);
    if (!s0.exitReachable) criticalFailures.push(`seed ${r.seed}: exit unreachable at tick 0`);
    if (!s0.keyTerminalReachable) criticalFailures.push(`seed ${r.seed}: key terminal unreachable at tick 0`);

    const blockedChokepoints = s0.chokepointStatus.filter(c => !c.traversable);
    if (blockedChokepoints.length > 0) {
      criticalFailures.push(`seed ${r.seed}: chokepoint(s) blocked at tick 0 (rooms: ${blockedChokepoints.map(c => c.roomId).join(', ')})`);
    }
  }

  // ── Aggregate metrics for CLUSTER_ID ──
  console.log(`\n${BOLD}=== Aggregate Metrics: Cluster ${CLUSTER_ID} ===${RESET}\n`);

  const validResults = results.filter(r => r.snapshots.length > 0);
  const N = validResults.length;

  // Exit reachability @100
  const exitAt100 = validResults.filter(r => getSnap(r, 100)?.exitReachable).length;
  const exitPct = exitAt100 / N;

  // Key terminal reachability @100 and @0
  const keyAt100 = validResults.filter(r => getSnap(r, 100)?.keyTerminalReachable).length;
  const keyAt0 = validResults.filter(r => getSnap(r, 0)?.keyTerminalReachable).length;

  // Room isolation @0
  const isoAt0 = validResults.filter(r => (getSnap(r, 0)?.isolatedRooms.length ?? 0) > 0).length;

  // Chokepoints traversable @100
  const chokeFailed100 = validResults.filter(r => {
    const s = getSnap(r, 100);
    return s?.chokepointStatus.some(c => !c.traversable);
  }).length;
  const chokePct = (N - chokeFailed100) / N;

  // Path damage @0 and @50
  const damageAt0 = validResults.map(r => getSnap(r, 0)?.projectedPathDamage ?? 0);
  const damageAt50 = validResults.map(r => getSnap(r, 50)?.projectedPathDamage ?? 0);
  const seedsOver50atTick0 = damageAt0.filter(d => d > 50).length;
  const seedsOver35atTick50 = damageAt50.filter(d => d > 35).length;

  // Path damage growth
  const damageGrowth = validResults.map(r => {
    const d0 = getSnap(r, 0)?.projectedPathDamage ?? 0;
    const d25 = getSnap(r, 25)?.projectedPathDamage ?? 0;
    const d50 = getSnap(r, 50)?.projectedPathDamage ?? 0;
    const d75 = getSnap(r, 75)?.projectedPathDamage ?? 0;
    return Math.max(d25 - d0, d50 - d25, d75 - d50);
  });
  const fastGrowthSeeds = damageGrowth.filter(g => g > 30).length;

  // D-E path analysis
  const noSafePath100 = validResults.filter(r => (getSnap(r, 100)?.minDERoomsOnAnyPath ?? 0) > 0).length;
  const allPathsDE2at100 = validResults.filter(r => (getSnap(r, 100)?.minDERoomsOnAnyPath ?? 0) >= 2).length;
  const hvIsolated100 = validResults.filter(r => (getSnap(r, 100)?.isolatedHighValueRooms.length ?? 0) > 0).length;

  // Entity counts — only count seeds that actually started with entities
  const resultsWithEntities = validResults.filter(r => (getSnap(r, 0)?.totalEntities ?? 0) > 0);
  const allDeadBy40 = resultsWithEntities.filter(r => {
    const s = getSnap(r, 40);
    return (s?.totalEntities ?? 1) === 0;
  }).length;

  // Path length variance
  const pathLengths0 = validResults.map(r => {
    const pl = getSnap(r, 0)?.entryExitPathLength ?? Infinity;
    return pl === Infinity ? 0 : pl;
  });

  // Seed variance CVs
  const cvDamage = cv(damageAt50.filter(d => isFinite(d)));
  const cvPathLen = cv(pathLengths0.filter(d => d > 0));

  // Generation time
  const genTimes = validResults.map(r => r.genTimeMs);
  const genP50 = [...genTimes].sort((a, b) => a - b)[Math.floor(N * 0.5)];
  const genP95 = [...genTimes].sort((a, b) => a - b)[Math.floor(N * 0.95)];

  // Determinism
  const nonDeterministicCount = validResults.filter(r => !r.deterministic).length;

  // ── Print aggregate table ──
  const printMetric = (label: string, value: string | number, pass_: boolean, severity: 'critical' | 'high' | 'medium' | 'low') => {
    const statusColor = pass_ ? GREEN : (severity === 'critical' ? RED : severity === 'high' ? RED : YELLOW);
    const status = pass_ ? 'PASS' : 'FAIL';
    const sev = pass_ ? '' : ` [${severity.toUpperCase()}]`;
    console.log(`  ${statusColor}${status}${sev}${RESET}  ${label}: ${BOLD}${value}${RESET}`);
  };

  console.log('Connectivity:');
  printMetric('Exit reachable @100', pct(exitAt100, N), exitPct >= 0.95, 'critical');
  printMetric('Key terminal reachable @100', pct(keyAt100, N), keyAt100 / N >= 0.98, 'critical');
  printMetric('Key terminal reachable @0', pct(keyAt0, N), keyAt0 === N, 'critical');
  printMetric('Rooms isolated @0', `${isoAt0}/${N} seeds affected`, isoAt0 === 0, 'critical');
  printMetric('Chokepoints traversable @100', pct(N - chokeFailed100, N), chokePct >= 0.90, 'high');
  printMetric('High-value rooms isolated @100', `${hvIsolated100}/${N} seeds affected`, hvIsolated100 === 0, 'high');

  console.log('\nPath damage:');
  printMetric('Path damage @0 > 50 (lethal start)', `${seedsOver50atTick0}/${N} seeds`, seedsOver50atTick0 === 0, 'high');
  printMetric('Path damage (grade D) > 35 @50', `${seedsOver35atTick50}/${N} seeds`, seedsOver35atTick50 / N <= 0.25, 'medium');
  printMetric('Path damage grows > 30 per 25 ticks', `${fastGrowthSeeds}/${N} seeds`, fastGrowthSeeds / N <= 0.20, 'medium');
  printMetric('No safe path (all routes hit D-E room) @100', `${noSafePath100}/${N} seeds`, noSafePath100 / N <= 0.10, 'medium');
  printMetric('All paths need ≥2 D-E rooms @100', `${allPathsDE2at100}/${N} seeds`, allPathsDE2at100 === 0, 'high');

  console.log('\nEntities:');
  const NE = resultsWithEntities.length;
  printMetric('All entities dead before tick 40', `${allDeadBy40}/${NE} seeds with initial entities`, NE === 0 || allDeadBy40 / NE <= 0.10, 'medium');

  // Empty room metric: avg % of non-hall rooms with no entity for 10+ ticks, at final snapshot
  const finalEmptyPcts = validResults.map(r => {
    const last = r.snapshots[r.snapshots.length - 1];
    return last?.emptyRoomPct ?? 0;
  });
  const avgEmptyPct = mean(finalEmptyPcts);
  printMetric(`Avg empty rooms (no entity 10+ ticks) @${TOTAL_TICKS}`, `${avgEmptyPct.toFixed(1)}%`, true, 'low');

  // Alert module entity detection check: on seeds with hostile entities nearby,
  // alert.m should detect them as entity-source threats
  const seedsWithEntitiesAt50 = validResults.filter(r => {
    const snap = getSnap(r, 50);
    return snap && (snap.factionCounts.aggressive > 0 || snap.factionCounts.titan > 0);
  });
  const seedsWithEntityAlerts = seedsWithEntitiesAt50.filter(r => {
    const snap = getSnap(r, 50);
    return snap?.alertDetectsEntities;
  });
  const alertEntityPct = seedsWithEntitiesAt50.length > 0
    ? seedsWithEntityAlerts.length / seedsWithEntitiesAt50.length : 1;
  console.log('\nAlert module:');
  printMetric(
    'alert.m detects hostile entities @50',
    `${seedsWithEntityAlerts.length}/${seedsWithEntitiesAt50.length} seeds with hostiles`,
    alertEntityPct >= 0.30, 'high',
  );

  // Quarantine deactivation check
  const totalQRooms = validResults.reduce((s, r) => s + r.totalQuarantine, 0);
  const missingQSwitches = validResults.reduce((s, r) => s + r.quarantineWithoutSwitch, 0);
  const unreachableQSwitches = validResults.reduce((s, r) => s + r.quarantineUnreachableSwitch, 0);
  const allQDiagnostics = validResults.flatMap(r => r.quarantineDiagnostics);
  console.log('\nHazard integrity:');
  printMetric('Quarantine rooms without deactivation switch', `${missingQSwitches}/${totalQRooms}`, missingQSwitches === 0, 'high');
  printMetric('Quarantine rooms with unreachable switch', `${unreachableQSwitches}/${totalQRooms}`, unreachableQSwitches === 0, 'high');
  if (allQDiagnostics.length > 0) {
    console.log('\n  Quarantine diagnostics:');
    for (const line of allQDiagnostics) console.log(line);
  }

  console.log('\nSeed variance:');
  printMetric('CV path damage @50', cvDamage.toFixed(3), cvDamage <= 0.4, 'medium');
  printMetric('CV path length @0', cvPathLen.toFixed(3), cvPathLen <= 0.35, 'medium');

  console.log('\nGeneration:');
  printMetric('Non-deterministic seeds', String(nonDeterministicCount), nonDeterministicCount === 0, 'critical');
  printMetric('Gen time p50', `${genP50?.toFixed(1)}ms`, true, 'low');
  printMetric(`Gen time p95 (target ≤50ms)`, `${genP95?.toFixed(1)}ms`, (genP95 ?? 0) <= 50, 'low');

  // Diagnostic summary
  const allSnapshots100 = validResults.map(r => getSnap(r, 100)).filter(Boolean) as SimSnapshot[];
  const avgHazard: Record<HazardOverlayType, number> = { corruption: 0, flood: 0, spark: 0, scorch: 0, beam: 0, gravity: 0 };
  for (const s of allSnapshots100) {
    for (const [type, count] of Object.entries(s.hazardTileCounts)) {
      avgHazard[type as HazardOverlayType] += count / N;
    }
  }
  const avgWalkable = mean(allSnapshots100.map(s => s.walkableTiles));
  const avgTotal = mean(allSnapshots100.map(s => s.totalTiles));
  const avgFlood = mean(allSnapshots100.map(s => s.floodLevel));
  const avgCollapsed = mean(allSnapshots100.map(s => s.collapsedTileCount));

  console.log(`\n${BOLD}=== Diagnostic Data @tick 100 (avg across ${N} seeds) ===${RESET}`);
  console.log(`  Walkable tiles: ${avgWalkable.toFixed(0)} / ${avgTotal.toFixed(0)} (${pct(avgWalkable, avgTotal)} of total)`);
  console.log(`  Collapsed tiles (corruption stage 2): ${avgCollapsed.toFixed(1)}`);
  console.log(`  Max flood level: ${avgFlood.toFixed(1)}`);
  console.log('  Hazard tile counts:');
  for (const [type, avg] of Object.entries(avgHazard)) {
    if (avg > 0) console.log(`    ${type}: ${avg.toFixed(1)}`);
  }

  // ── Write sim-results.json ──
  const failingSeeds = results
    .filter(r => {
      const s0 = snapshotAt(r, 0);
      const s100 = snapshotAt(r, 100);
      return !r.deterministic ||
        (s0?.isolatedRooms.length ?? 0) > 0 ||
        !s0?.exitReachable ||
        !s0?.keyTerminalReachable ||
        !s100?.exitReachable ||
        !s100?.keyTerminalReachable ||
        (s100?.isolatedHighValueRooms.length ?? 0) > 0 ||
        (s100?.minDERoomsOnAnyPath ?? 0) >= 2;
    })
    .map(r => ({
      seed: r.seed,
      url: `#seed=${r.seed}`,
      issues: [
        ...(r.deterministic ? [] : ['non-deterministic']),
        ...((snapshotAt(r, 0)?.isolatedRooms.length ?? 0) > 0 ? [`${snapshotAt(r, 0)!.isolatedRooms.length} rooms isolated @0`] : []),
        ...(snapshotAt(r, 0)?.exitReachable === false ? ['exit unreachable @0'] : []),
        ...(snapshotAt(r, 100)?.exitReachable === false ? ['exit unreachable @100'] : []),
        ...(snapshotAt(r, 100)?.keyTerminalReachable === false ? ['key terminal unreachable @100'] : []),
        ...((snapshotAt(r, 100)?.isolatedHighValueRooms.length ?? 0) > 0 ? ['high-value rooms isolated @100'] : []),
        ...((snapshotAt(r, 100)?.minDERoomsOnAnyPath ?? 0) >= 2 ? ['all paths need ≥2 D-E rooms @100'] : []),
      ],
    }));

  if (failingSeeds.length > 0) {
    const out = JSON.stringify(
      { timestamp: new Date().toISOString(), params: { seeds: SEED_COUNT, ticks: TOTAL_TICKS }, failingSeeds },
      null, 2
    );
    writeFileSync('sim-results.json', out, 'utf8');
    console.log(`\nFailing seeds written to sim-results.json (${failingSeeds.length} seeds).`);
  }

  // ── Entity Spawn Analysis ──
  console.log(`\n${BOLD}=== Entity Spawn Analysis (t=0, ${SEED_COUNT} seeds each cluster) ===${RESET}`);

  const SPAWN_CLUSTER_IDS = [0, 1, 2, 3, 4, 5];
  const ENTITY_KINDS = ['bit_mite', 'logic_leech', 'chronicler', 'sentry', 'gate_keeper', 'repair_scrapper', 'titan_spawn', 'prop'];

  // Header row
  const colW = 8;
  const spawnHeader = [
    'cluster'.padEnd(9),
    'total'.padEnd(colW),
    ...ENTITY_KINDS.map(k => k.slice(0, colW - 1).padEnd(colW)),
    'max'.padEnd(colW),
    'min'.padEnd(colW),
  ].join(' ');
  console.log('  ' + spawnHeader);
  console.log('  ' + '-'.repeat(spawnHeader.length));

  for (const cid of SPAWN_CLUSTER_IDS) {
    const counts: number[] = [];
    const kindTotals: Record<string, number> = {};
    for (const k of ENTITY_KINDS) kindTotals[k] = 0;

    const origLog = console.log;
    console.log = () => {};  // suppress cluster-gen logs during batch spawn sampling
    for (const seed of seeds) {
      const entities = sampleEntitySpawn(cid, seed);
      counts.push(entities.length);
      for (const e of entities) {
        const kind = e.ai?.kind ?? 'prop';
        if (kind in kindTotals) kindTotals[kind] += 1;
      }
    }
    console.log = origLog;

    const avg = mean(counts);
    const maxC = Math.max(...counts);
    const minC = Math.min(...counts);
    const N2 = counts.length;

    const avgTotal = avg.toFixed(1);
    const row = [
      `cluster ${cid}`.padEnd(9),
      avgTotal.padEnd(colW),
      ...ENTITY_KINDS.map(k => (kindTotals[k] / N2).toFixed(1).padEnd(colW)),
      String(maxC).padEnd(colW),
      String(minC).padEnd(colW),
    ].join(' ');

    const hilight = avg > 20 ? YELLOW : avg > 35 ? RED : GREEN;
    console.log(`  ${hilight}${row}${RESET}`);
  }
  console.log('  (values = avg count spawned per cluster; 0 expected for clusters 0 and 1)\n');

  // ── Hazard Room Type Analysis ──
  console.log(`\n${BOLD}=== Hazard Room Type Analysis (${SEED_COUNT} seeds each cluster) ===${RESET}`);
  const HAZARD_TYPES: RoomType[] = ['corrupted', 'trigger_trap', 'memory_leak', 'firewall', 'unstable', 'quarantine', 'echo_chamber', 'gravity_well'];
  const plotHazardData: Map<number, Record<string, number>> = new Map();
  const plotHazardRoomCounts: Map<number, number> = new Map();
  {
    const hColW = 10;
    const hHeader = ['cluster'.padEnd(9), 'rooms'.padEnd(6), ...HAZARD_TYPES.map(h => h.slice(0, hColW - 1).padEnd(hColW))].join(' ');
    console.log('  ' + hHeader);
    console.log('  ' + '-'.repeat(hHeader.length));

    for (const cid of ALL_CLUSTER_IDS) {
      const typeCounts: Record<string, number> = {};
      for (const h of HAZARD_TYPES) typeCounts[h] = 0;
      let totalRooms = 0;

      const origLog = console.log;
      console.log = () => {};
      for (const seed of seeds) {
        seedRng(seed);
        const cluster = generateCluster(cid);
        totalRooms += cluster.rooms.length;
        for (const room of cluster.rooms) {
          if (room.roomType !== 'normal' && room.roomType in typeCounts) {
            typeCounts[room.roomType]++;
          }
        }
      }
      console.log = origLog;

      plotHazardData.set(cid, { ...typeCounts });
      plotHazardRoomCounts.set(cid, totalRooms);

      const avgRooms = (totalRooms / seeds.length).toFixed(0);
      const row = [
        `cluster ${cid}`.padEnd(9),
        avgRooms.padEnd(6),
        ...HAZARD_TYPES.map(h => (typeCounts[h] / seeds.length).toFixed(1).padEnd(hColW)),
      ].join(' ');
      console.log('  ' + row);
    }
  }

  // ── Room Scenario Analysis ──
  console.log(`\n${BOLD}=== Room Scenario Analysis (${SEED_COUNT} seeds, clusters 1+) ===${RESET}`);
  const ALL_SCENARIOS: RoomScenario[] = ['stuck_echo', 'spooky_astronauts', 'broken_sleever', 'whispering_wall', 'lost_expedition', 'silent_alarm', 'corruption_ritual'];
  const plotScenarioData: Map<number, Record<string, number>> = new Map();
  {
    const sColW = 12;
    const sHeader = ['cluster'.padEnd(9), ...ALL_SCENARIOS.map(s => s.slice(0, sColW - 1).padEnd(sColW))].join(' ');
    console.log('  ' + sHeader);
    console.log('  ' + '-'.repeat(sHeader.length));

    const scenarioFailures: string[] = [];
    // Track across all clusters for aggregate check
    const globalScenarioCounts: Record<string, number> = {};
    for (const s of ALL_SCENARIOS) globalScenarioCounts[s] = 0;
    let globalSeeds = 0;

    for (const cid of ALL_CLUSTER_IDS) {
      if (cid < 1) continue; // scenarios only in clusters 1+
      const scenarioCounts: Record<string, number> = {};
      for (const s of ALL_SCENARIOS) scenarioCounts[s] = 0;

      const origLog = console.log;
      console.log = () => {};
      for (const seed of seeds) {
        seedRng(seed);
        const cluster = generateCluster(cid);
        for (const room of cluster.rooms) {
          if (room.scenario && room.scenario in scenarioCounts) {
            scenarioCounts[room.scenario]++;
            globalScenarioCounts[room.scenario]++;
          }
        }
      }
      console.log = origLog;
      globalSeeds += seeds.length;
      plotScenarioData.set(cid, { ...scenarioCounts });

      const row = [
        `cluster ${cid}`.padEnd(9),
        ...ALL_SCENARIOS.map(s => {
          const pctVal = (scenarioCounts[s] / seeds.length * 100).toFixed(0) + '%';
          const color = scenarioCounts[s] / seeds.length >= 0.5 ? GREEN : YELLOW;
          return `${color}${pctVal}${RESET}`.padEnd(sColW + color.length + RESET.length);
        }),
      ].join(' ');
      console.log('  ' + row);
    }

    // Check: each scenario should appear in ≥50% of seeds across clusters 1+
    console.log();
    for (const s of ALL_SCENARIOS) {
      const rate = globalScenarioCounts[s] / globalSeeds;
      const pass = rate >= 0.5;
      printMetric(`Scenario '${s}' gen rate (clusters 1+)`, pct(globalScenarioCounts[s], globalSeeds), pass, 'medium');
      if (!pass) scenarioFailures.push(`Scenario '${s}' only appears in ${pct(globalScenarioCounts[s], globalSeeds)} of seeds (target ≥50%)`);
    }
  }

  // ── Faction Balance Over Time ──
  console.log(`\n${BOLD}=== Faction Balance Over Time (avg across ${SEED_COUNT} seeds) ===${RESET}`);
  const FACTIONS: Faction[] = ['neutral', 'aggressive', 'friendly', 'titan'];
  const FACTION_TICKS = Array.from({ length: Math.floor((TOTAL_TICKS - 40) / 20) + 1 }, (_, i) => 40 + i * 20).filter(t => t <= TOTAL_TICKS);
  const plotFactionData: Map<number, Map<number, Record<string, number>>> = new Map();
  {
    const fColW = 10;
    const fHeader = ['cluster'.padEnd(9), 'tick'.padEnd(6), ...FACTIONS.map(f => f.slice(0, fColW - 1).padEnd(fColW)), 'agg-fri'.padEnd(fColW)].join(' ');
    console.log('  ' + fHeader);
    console.log('  ' + '-'.repeat(fHeader.length));

    let maxAggrFriDiff = 0;
    let maxAggrFriInfo = '';

    for (const cid of ALL_CLUSTER_IDS) {
      const cidResults = allClusterResults.get(cid) ?? [];
      const valid = cidResults.filter(r => r.snapshots.length > 0);
      if (valid.length === 0) continue;

      for (const tick of FACTION_TICKS) {
        const avgFaction: Record<string, number> = {};
        for (const f of FACTIONS) avgFaction[f] = 0;

        for (const r of valid) {
          const snap = getSnap(r, tick);
          if (!snap) continue;
          for (const f of FACTIONS) {
            avgFaction[f] += (snap.factionCounts[f] ?? 0);
          }
        }
        for (const f of FACTIONS) avgFaction[f] /= valid.length;

        if (!plotFactionData.has(cid)) plotFactionData.set(cid, new Map());
        plotFactionData.get(cid)!.set(tick, { ...avgFaction });

        const diff = Math.abs(avgFaction.aggressive - avgFaction.friendly);
        if (diff > maxAggrFriDiff) {
          maxAggrFriDiff = diff;
          maxAggrFriInfo = `cluster ${cid} tick ${tick}`;
        }

        const diffColor = diff > 3 ? RED : GREEN;
        const row = [
          `cluster ${cid}`.padEnd(9),
          String(tick).padEnd(6),
          ...FACTIONS.map(f => avgFaction[f].toFixed(1).padEnd(fColW)),
          `${diffColor}${diff.toFixed(1)}${RESET}`.padEnd(fColW + diffColor.length + RESET.length),
        ].join(' ');
        console.log('  ' + row);
      }
    }
    console.log();
    printMetric(
      `Max avg |aggressive - friendly| (at ${maxAggrFriInfo})`,
      maxAggrFriDiff.toFixed(1),
      maxAggrFriDiff <= 3,
      'medium',
    );
  }

  // ── Generate plots ──
  generatePlots(allClusterResults, plotHazardData, plotHazardRoomCounts, plotScenarioData, plotFactionData);

  // ── Critical failure summary ──
  if (criticalFailures.length > 0) {
    console.log(`\n${BOLD}${RED}=== CRITICAL FAILURES ===${RESET}`);
    for (const f of criticalFailures) {
      critical(f);
    }
    process.exit(1);
  } else {
    console.log(`\n${BOLD}${GREEN}All critical checks passed.${RESET}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
