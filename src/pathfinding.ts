import { Cluster, Position } from './types';

// BFS pathfinding on walkable tiles (4-directional)

const DIRS: Position[] = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
];

export function findPath(cluster: Cluster, from: Position, to: Position): Position[] | null {
  if (from.x === to.x && from.y === to.y) return [];

  const w = cluster.width;
  const h = cluster.height;

  // Target must be walkable
  if (!cluster.tiles[to.y]?.[to.x]?.walkable) return null;

  const visited = new Set<string>();
  const parent = new Map<string, string>();
  const queue: Position[] = [from];
  const key = (p: Position) => `${p.x},${p.y}`;

  visited.add(key(from));

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.x === to.x && current.y === to.y) {
      // Reconstruct path
      const path: Position[] = [];
      let k = key(to);
      while (k !== key(from)) {
        const [px, py] = k.split(',').map(Number);
        path.unshift({ x: px, y: py });
        k = parent.get(k)!;
      }
      return path;
    }

    for (const dir of DIRS) {
      const nx = current.x + dir.x;
      const ny = current.y + dir.y;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nk = key({ x: nx, y: ny });
      if (visited.has(nk)) continue;
      if (!cluster.tiles[ny][nx].walkable) continue;

      visited.add(nk);
      parent.set(nk, key(current));
      queue.push({ x: nx, y: ny });
    }
  }

  return null; // No path found
}
