/**
 * Graph topology diagnostic for Coherence cluster generation.
 *
 * Usage:
 *   npx tsx scripts/graph-stats.ts              # baseline (current EXTRA_DOOR_CHANCE)
 *   npx tsx scripts/graph-stats.ts --sweep      # sweep extra door chance 0.2–0.8
 *   npx tsx scripts/graph-stats.ts --chance 0.5  # single run with specific chance
 */

import { generateCluster, getExtraDoorChance, setExtraDoorChance } from '../src/cluster';
import type { Cluster } from '../src/types';

// ── Metric computation ──

interface Metrics {
  roomCount: number;
  edgeCount: number;
  cycleCount: number;
  simplePaths: number;
  articulationPoints: number;
  minVertexCut: number;
  avgDegree: number;
  maxDegree: number;
  deadEnds: number;
}

function findEntryExitIds(cluster: Cluster): { entry: number; exit: number } {
  // Entry: leftmost room
  const sorted = [...cluster.rooms].sort((a, b) => a.x - b.x);
  const entry = sorted[0].id;

  // Exit: room containing the interface exit tile, or rightmost
  let exit = sorted[sorted.length - 1].id;
  if (cluster.interfaces.length > 0) {
    const exitPos = cluster.interfaces[0].position;
    // Find room closest to exit (interface is on the wall, look 1-2 tiles inward)
    for (const room of cluster.rooms) {
      if (exitPos.y >= room.y && exitPos.y < room.y + room.h &&
          exitPos.x >= room.x - 1 && exitPos.x <= room.x + room.w) {
        exit = room.id;
        break;
      }
    }
  }

  return { entry, exit };
}

const PATH_COUNT_CAP = 10000;

function countSimplePaths(
  adj: Map<number, number[]>,
  start: number,
  end: number,
): number {
  const visited = new Set<number>();
  let count = 0;

  function dfs(current: number) {
    if (count >= PATH_COUNT_CAP) return;
    if (current === end) { count++; return; }
    visited.add(current);
    for (const neighbor of (adj.get(current) ?? [])) {
      if (count >= PATH_COUNT_CAP) return;
      if (!visited.has(neighbor)) dfs(neighbor);
    }
    visited.delete(current);
  }

  dfs(start);
  return count;
}

function bfsReachable(
  adj: Map<number, number[]>,
  start: number,
  exclude: number,
): Set<number> {
  const visited = new Set<number>();
  const queue = [start];
  visited.add(start);
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const neighbor of (adj.get(node) ?? [])) {
      if (neighbor !== exclude && !visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited;
}

function computeMetrics(cluster: Cluster): Metrics {
  const adj = cluster.roomAdjacency;
  const roomIds = cluster.rooms.map(r => r.id);
  const { entry, exit } = findEntryExitIds(cluster);

  // Edge count (undirected)
  let edgeCount = 0;
  for (const neighbors of adj.values()) edgeCount += neighbors.length;
  edgeCount /= 2;

  const roomCount = roomIds.length;
  const cycleCount = edgeCount - (roomCount - 1);

  // Degree stats
  const degrees = roomIds.map(id => (adj.get(id) ?? []).length);
  const avgDegree = degrees.reduce((a, b) => a + b, 0) / roomCount;
  const maxDegree = Math.max(...degrees);
  const deadEnds = degrees.filter(d => d <= 1).length;

  // Simple paths entry→exit
  const simplePaths = countSimplePaths(adj, entry, exit);

  // Articulation points (relevant to entry↔exit connectivity)
  let articulationPoints = 0;
  for (const roomId of roomIds) {
    if (roomId === entry || roomId === exit) continue;
    const reachable = bfsReachable(adj, entry, roomId);
    if (!reachable.has(exit)) articulationPoints++;
  }

  // Min vertex cut: greedily remove highest-degree rooms until disconnected
  // (approximation — exact would require max-flow with node splitting)
  let minVertexCut = 0;
  const removed = new Set<number>();

  // Try removing rooms in order of their frequency on shortest paths
  // Simple heuristic: try each room, see if removing it disconnects
  const candidateRooms = roomIds
    .filter(id => id !== entry && id !== exit)
    .sort((a, b) => (adj.get(b)?.length ?? 0) - (adj.get(a)?.length ?? 0));

  // Build a mutable adjacency for progressive removal
  const mutableAdj = new Map<number, number[]>();
  for (const [k, v] of adj) mutableAdj.set(k, [...v]);

  for (const roomId of candidateRooms) {
    removed.add(roomId);
    // Check if entry can still reach exit without removed rooms
    const reachable = new Set<number>();
    const queue = [entry];
    reachable.add(entry);
    while (queue.length > 0) {
      const node = queue.shift()!;
      for (const neighbor of (adj.get(node) ?? [])) {
        if (!removed.has(neighbor) && !reachable.has(neighbor)) {
          reachable.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    if (!reachable.has(exit)) {
      minVertexCut = removed.size;
      break;
    }
  }
  if (minVertexCut === 0) minVertexCut = removed.size; // couldn't disconnect

  return {
    roomCount,
    edgeCount,
    cycleCount,
    simplePaths,
    articulationPoints,
    minVertexCut,
    avgDegree: Math.round(avgDegree * 100) / 100,
    maxDegree,
    deadEnds,
  };
}

// ── Statistics ──

interface Stats {
  mean: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
}

function computeStats(values: number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return {
    mean: Math.round(mean * 100) / 100,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
  };
}

function runBatch(samples: number, label: string): Map<string, Stats> {
  const allMetrics: Metrics[] = [];

  for (let i = 0; i < samples; i++) {
    const cluster = generateCluster(i);
    allMetrics.push(computeMetrics(cluster));
  }

  const keys: (keyof Metrics)[] = [
    'roomCount', 'edgeCount', 'cycleCount', 'simplePaths',
    'articulationPoints', 'minVertexCut', 'avgDegree', 'maxDegree', 'deadEnds',
  ];

  const results = new Map<string, Stats>();
  for (const key of keys) {
    results.set(key, computeStats(allMetrics.map(m => m[key])));
  }

  // Derived: % with simplePaths >= 3, cycleCount >= 2, minVertexCut >= 2
  const pctPaths3 = Math.round(allMetrics.filter(m => m.simplePaths >= 3).length / samples * 100);
  const pctCycles2 = Math.round(allMetrics.filter(m => m.cycleCount >= 2).length / samples * 100);
  const pctMVC2 = Math.round(allMetrics.filter(m => m.minVertexCut >= 2).length / samples * 100);
  const pctLinear = Math.round(allMetrics.filter(m => m.simplePaths <= 1).length / samples * 100);

  // Print table
  console.log(`\n═══ ${label} (${samples} samples) ═══`);
  console.log('Metric              Mean    Min   Max   p50   p95');
  console.log('─'.repeat(55));
  for (const key of keys) {
    const s = results.get(key)!;
    const name = key.padEnd(20);
    console.log(`${name} ${String(s.mean).padStart(5)}  ${String(s.min).padStart(5)} ${String(s.max).padStart(5)} ${String(s.p50).padStart(5)} ${String(s.p95).padStart(5)}`);
  }
  console.log('─'.repeat(55));
  console.log(`Linear (paths≤1):  ${pctLinear}%`);
  console.log(`Paths ≥ 3:         ${pctPaths3}%   (target: ≥80%)`);
  console.log(`Cycles ≥ 2:        ${pctCycles2}%   (target: ≥70%)`);
  console.log(`MinVertexCut ≥ 2:  ${pctMVC2}%   (target: ≥60%)`);

  return results;
}

// ── Main ──

const args = process.argv.slice(2);

if (args.includes('--sweep')) {
  const chances = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  console.log('Parameter sweep: EXTRA_DOOR_CHANCE');
  for (const chance of chances) {
    setExtraDoorChance(chance);
    runBatch(500, `EXTRA_DOOR_CHANCE = ${chance}`);
  }
} else {
  const chanceIdx = args.indexOf('--chance');
  if (chanceIdx >= 0 && args[chanceIdx + 1]) {
    const chance = parseFloat(args[chanceIdx + 1]);
    setExtraDoorChance(chance);
    runBatch(1000, `EXTRA_DOOR_CHANCE = ${chance}`);
  } else {
    runBatch(1000, `Baseline (EXTRA_DOOR_CHANCE = ${getExtraDoorChance()})`);
  }
}
