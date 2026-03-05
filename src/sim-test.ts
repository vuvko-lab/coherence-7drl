/**
 * Balancing test suite for Coherence cluster generation.
 *
 * Simulates clusters over time using the game's own logic (no rendering, no input).
 * Extracts metrics to catch balance problems before playtesting.
 *
 * Usage:
 *   npx tsx src/sim-test.ts               # early cluster, seeds 1-50
 *   npx tsx src/sim-test.ts --seeds 200   # stress test
 *   npx tsx src/sim-test.ts --ticks 150   # longer simulation
 */

import { writeFileSync } from 'fs';
import { createGame, processAction } from './game';
import { findPath } from './pathfinding';
import { Cluster, Position, TileType, HazardOverlayType, RoomType } from './types';
import type { GameState } from './types';

// ── Constants ──

const DE_HAZARD_ROOMS = new Set<RoomType>(['corrupted', 'trigger_trap', 'memory_leak', 'gravity_well']);

// ── CLI args ──

const args = process.argv.slice(2);
const getArg = (flag: string, def: number) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? parseInt(args[idx + 1], 10) : def;
};

const SEED_COUNT = getArg('--seeds', 50);
const TOTAL_TICKS = getArg('--ticks', 100);
const SNAPSHOT_INTERVAL = 10;
const CLUSTER_ID = 0;

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
}

interface SeedResult {
  seed: number;
  snapshots: SimSnapshot[];
  genTimeMs: number;
  deterministic: boolean;
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

// ── Tile hazard damage (mirrors applyTileHazardToPlayer without mutating state) ──

function tileDamage(cluster: Cluster, pos: Position): number {
  const overlay = cluster.tiles[pos.y]?.[pos.x]?.hazardOverlay;
  if (!overlay) return 0;
  switch (overlay.type) {
    case 'corruption':
      if (overlay.stage === 0) return 1;
      if (overlay.stage === 1) return 3;
      return 0; // collapsed — path shouldn't cross these
    case 'flood':
      if (overlay.stage === 0) return 1;
      return 2;
    case 'gravity':
      if (overlay.stage === 2) return 5;
      return 0;
    default:
      return 0;
  }
}

function computePathDamage(cluster: Cluster, path: Position[]): number {
  return path.reduce((sum, pos) => sum + tileDamage(cluster, pos), 0);
}

// ── Snapshot extraction ──

function snapshotCluster(
  state: GameState,
  clusterId: number,
  entryPos: Position,
  initialEntityCount: number,
  currentEntityCount: number,
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

  // Key terminal reachability
  const keyTerminal = cluster.terminals.find(t => t.hasKey);
  const keyTerminalReachable = keyTerminal
    ? reachable.has(`${keyTerminal.position.x},${keyTerminal.position.y}`)
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

  // Diagnostic: max flood level across all memory_leak rooms
  let floodLevel = 0;
  for (const room of cluster.rooms) {
    if (room.roomType === 'memory_leak' && room.hazardState?.floodLevel !== undefined) {
      floodLevel = Math.max(floodLevel, room.hazardState.floodLevel);
    }
  }

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
  };
}

// ── Simulation ──

function simulateCluster(seed: number, ticks: number, clusterId: number): { snapshots: SimSnapshot[]; genTimeMs: number } {
  const t0 = performance.now();
  const state = createGame(seed);
  const genTimeMs = performance.now() - t0;

  // Move to the target cluster if needed (currently only cluster 0 is pre-generated)
  if (!state.clusters.has(clusterId)) {
    return { snapshots: [], genTimeMs };
  }

  const cluster = state.clusters.get(clusterId)!;
  const entryPos = getEntryPos(cluster);
  const initialEntityCount = state.entities.length;

  const snapshots: SimSnapshot[] = [];
  snapshots.push(snapshotCluster(state, clusterId, entryPos, initialEntityCount, state.entities.length));

  for (let t = 0; t < ticks; t++) {
    processAction(state, { kind: 'wait' });
    if ((t + 1) % SNAPSHOT_INTERVAL === 0) {
      snapshots.push(snapshotCluster(state, clusterId, entryPos, initialEntityCount, state.entities.length));
    }
  }

  return { snapshots, genTimeMs };
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

// ── Main ──

async function main() {
  console.log(`\n${BOLD}=== Coherence Balancing Test Suite ===${RESET}`);
  console.log(`Seeds: 1–${SEED_COUNT} | Ticks: ${TOTAL_TICKS} | Cluster: ${CLUSTER_ID}\n`);

  const seeds = Array.from({ length: SEED_COUNT }, (_, i) => i + 1);
  const results: SeedResult[] = [];

  // ── Run simulations ──
  process.stdout.write('Simulating');
  for (const seed of seeds) {
    const { snapshots, genTimeMs } = simulateCluster(seed, TOTAL_TICKS, CLUSTER_ID);
    const deterministic = checkDeterminism(seed);
    results.push({ seed, snapshots, genTimeMs, deterministic });
    if (seed % 10 === 0) process.stdout.write('.');
  }
  console.log(' done\n');

  // ── Per-seed table ──
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

  // ── Aggregate metrics ──
  console.log(`\n${BOLD}=== Aggregate Metrics ===${RESET}\n`);

  const validResults = results.filter(r => r.snapshots.length > 0);
  const N = validResults.length;

  const getSnap = (r: SeedResult, tick: number) => {
    const exact = r.snapshots.find(s => s.tick === tick);
    if (exact) return exact;
    // Closest tick (snapshots are at 0, 10, 20, ..., TOTAL_TICKS)
    const target = Math.round(tick / SNAPSHOT_INTERVAL) * SNAPSHOT_INTERVAL;
    return r.snapshots.find(s => s.tick === target) ?? r.snapshots[r.snapshots.length - 1];
  };

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

  // Entity counts
  const allDeadBy40 = validResults.filter(r => {
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
  printMetric('All entities dead before tick 40', `${allDeadBy40}/${N} seeds`, allDeadBy40 / N <= 0.10, 'medium');

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
