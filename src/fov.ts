import { Cluster, Position, TileType } from './types';

// Recursive shadowcasting FOV
// Based on the "symmetric shadowcasting" algorithm

type TransformFn = (row: number, col: number) => Position;

// 4 quadrant transforms for 4-way symmetric FOV
const TRANSFORMS: TransformFn[] = [
  (row, col) => ({ x: col, y: -row }),   // North
  (row, col) => ({ x: col, y: row }),     // South
  (row, col) => ({ x: -row, y: col }),    // West
  (row, col) => ({ x: row, y: col }),     // East
];

function isOpaque(cluster: Cluster, x: number, y: number, origin: Position): boolean {
  if (x < 0 || x >= cluster.width || y < 0 || y >= cluster.height) return true;
  const tile = cluster.tiles[y][x];
  // Doors block LOS unless the player is standing on them
  if (tile.type === TileType.Door) {
    return !(x === origin.x && y === origin.y);
  }
  return !tile.transparent;
}

function reveal(cluster: Cluster, x: number, y: number) {
  if (x < 0 || x >= cluster.width || y < 0 || y >= cluster.height) return;
  cluster.tiles[y][x].visible = true;
  cluster.tiles[y][x].seen = true;
}

interface ShadowRow {
  depth: number;
  startSlope: number;
  endSlope: number;
}

function scanRow(
  cluster: Cluster,
  origin: Position,
  transform: TransformFn,
  row: ShadowRow,
  radius: number,
) {
  const { depth, startSlope, endSlope } = row;
  if (depth > radius) return;

  let prevOpaque = false;
  let currentStart = startSlope;

  const minCol = Math.floor(depth * startSlope + 0.5);
  const maxCol = Math.ceil(depth * endSlope - 0.5);

  for (let col = minCol; col <= maxCol; col++) {
    const slope = col / depth;
    const delta = transform(depth, col);
    const mapX = origin.x + delta.x;
    const mapY = origin.y + delta.y;

    // Distance check (circular FOV)
    if (delta.x * delta.x + delta.y * delta.y > radius * radius) {
      continue;
    }

    const opaque = isOpaque(cluster, mapX, mapY, origin);

    // Reveal this tile if it's within the visible arc
    if (slope >= startSlope && slope <= endSlope) {
      reveal(cluster, mapX, mapY);
    }

    if (opaque && !prevOpaque) {
      // Start of a wall section — scan the next row with narrowed arc
      scanRow(cluster, origin, transform, {
        depth: depth + 1,
        startSlope: currentStart,
        endSlope: (col - 0.5) / depth,
      }, radius);
    } else if (!opaque && prevOpaque) {
      // End of a wall section — adjust start slope
      currentStart = (col - 0.5) / depth;
    }

    prevOpaque = opaque;
  }

  // If the last cell in the row was not opaque, continue scanning
  if (!prevOpaque) {
    scanRow(cluster, origin, transform, {
      depth: depth + 1,
      startSlope: currentStart,
      endSlope,
    }, radius);
  }
}

export function computeFOV(cluster: Cluster, origin: Position, radius: number = 20) {
  // Clear visibility (keep seen state)
  for (let y = 0; y < cluster.height; y++) {
    for (let x = 0; x < cluster.width; x++) {
      cluster.tiles[y][x].visible = false;
    }
  }

  // Origin is always visible
  reveal(cluster, origin.x, origin.y);

  // Scan each quadrant
  for (const transform of TRANSFORMS) {
    scanRow(cluster, origin, transform, {
      depth: 1,
      startSlope: -1,
      endSlope: 1,
    }, radius);
  }
}
