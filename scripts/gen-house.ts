// Hall-first BSP room generator
// Based on: https://gamedev.stackexchange.com/questions/47917
// Pseudocode: https://pastebin.com/Nr8PjmKF
//
// Algorithm:
//   1. Recursively split space into chunks, creating hall strips at each split
//      (halls are corridors created as byproduct of splits)
//   2. Stop splitting when hall area reaches target % of total area
//   3. Further subdivide large blocks into rooms
//   4. Connect rooms: rooms touching halls get doors to halls,
//      remaining rooms connect to reachable neighbors
//
// This naturally creates a tree-like hall backbone with rooms attached,
// which should produce chokepoints for hazard placement.
//
// Usage:
//   npx tsx scripts/gen-house.ts              # 5 visual samples
//   npx tsx scripts/gen-house.ts --stats      # 500 samples, topology metrics
//   npx tsx scripts/gen-house.ts --sweep      # parameter sweep

// ── Types ──

interface Rect {
  x: number; y: number; w: number; h: number;
}

interface Hall {
  id: number;
  rect: Rect;
}

interface Room {
  id: number;
  rect: Rect;
  hallDoors: number[]; // hall IDs this room has doors to
  roomDoors: number[]; // room IDs this room connects to directly
}

type CellType = 'void' | 'floor' | 'wall' | 'hall' | 'door';

interface Grid {
  w: number; h: number;
  cells: CellType[][];
}

function random(n: number): number { return Math.floor(Math.random() * n); }
function randInt(min: number, max: number): number { return random(max - min + 1) + min; }

function rectArea(r: Rect): number { return r.w * r.h; }

// ── Configurable parameters ──

interface GenParams {
  gridW: number;
  gridH: number;
  maxHallRate: number;       // target hall area as fraction of total (0.15-0.40)
  minSplittableArea: number; // minimum chunk area to split further
  hallWidth: number;         // width of hall corridors (1 or 2)
  minRoomDim: number;        // minimum room dimension
  minBlockArea: number;      // minimum block area before it becomes a room
}

const DEFAULT_PARAMS: GenParams = {
  gridW: 48,
  gridH: 28,
  maxHallRate: 0.25,
  minSplittableArea: 30,
  hallWidth: 1,
  minRoomDim: 3,
  minBlockArea: 12,
};

let PARAMS: GenParams = { ...DEFAULT_PARAMS };

// ── Phase 1: Chunks → Blocks (creating halls) ──

interface SplitResult {
  chunks: Rect[];
  hall: Rect;
}

function splitChunkHorizontal(chunk: Rect, hallW: number): SplitResult | null {
  // Split horizontally: hall runs left-right
  const minH = PARAMS.minRoomDim;
  if (chunk.h < minH * 2 + hallW) return null;

  const splitAt = randInt(minH, chunk.h - minH - hallW);

  return {
    chunks: [
      { x: chunk.x, y: chunk.y, w: chunk.w, h: splitAt },
      { x: chunk.x, y: chunk.y + splitAt + hallW, w: chunk.w, h: chunk.h - splitAt - hallW },
    ],
    hall: { x: chunk.x, y: chunk.y + splitAt, w: chunk.w, h: hallW },
  };
}

function splitChunkVertical(chunk: Rect, hallW: number): SplitResult | null {
  const minW = PARAMS.minRoomDim;
  if (chunk.w < minW * 2 + hallW) return null;

  const splitAt = randInt(minW, chunk.w - minW - hallW);

  return {
    chunks: [
      { x: chunk.x, y: chunk.y, w: splitAt, h: chunk.h },
      { x: chunk.x + splitAt + hallW, y: chunk.y, w: chunk.w - splitAt - hallW, h: chunk.h },
    ],
    hall: { x: chunk.x + splitAt, y: chunk.y, w: hallW, h: chunk.h },
  };
}

function splitChunk(chunk: Rect, hallW: number): SplitResult | null {
  // Choose split direction: prefer splitting longer dimension
  const ratio = chunk.w / chunk.h;
  let preferVertical: boolean;
  if (ratio > 1.5) preferVertical = true;
  else if (ratio < 0.67) preferVertical = false;
  else preferVertical = random(2) === 0;

  if (preferVertical) {
    return splitChunkVertical(chunk, hallW) ?? splitChunkHorizontal(chunk, hallW);
  } else {
    return splitChunkHorizontal(chunk, hallW) ?? splitChunkVertical(chunk, hallW);
  }
}

function chunksToBlocks(house: Rect): { blocks: Rect[]; halls: Hall[] } {
  const totalArea = rectArea(house);
  let totalHallArea = 0;
  const chunks: Rect[] = [house];
  const blocks: Rect[] = [];
  const halls: Hall[] = [];
  let hallId = 0;

  while (chunks.length > 0) {
    const chunk = chunks.shift()!;

    if (rectArea(chunk) < PARAMS.minSplittableArea ||
        totalHallArea / totalArea >= PARAMS.maxHallRate) {
      blocks.push(chunk);
      continue;
    }

    const result = splitChunk(chunk, PARAMS.hallWidth);
    if (!result) {
      blocks.push(chunk);
      continue;
    }

    halls.push({ id: hallId++, rect: result.hall });
    totalHallArea += rectArea(result.hall);
    chunks.push(...result.chunks);
  }

  return { blocks, halls };
}

// ── Phase 2: Blocks → Rooms ──

function splitBlock(block: Rect): Rect[] {
  if (rectArea(block) < PARAMS.minBlockArea * 2) return [block];
  if (block.w < PARAMS.minRoomDim * 2 + 1 && block.h < PARAMS.minRoomDim * 2 + 1) return [block];

  // Split the block, consuming 1 cell for wall
  const ratio = block.w / block.h;
  let preferVertical: boolean;
  if (ratio > 1.3) preferVertical = true;
  else if (ratio < 0.77) preferVertical = false;
  else preferVertical = random(2) === 0;

  if (preferVertical && block.w >= PARAMS.minRoomDim * 2 + 1) {
    const splitAt = randInt(PARAMS.minRoomDim, block.w - PARAMS.minRoomDim - 1);
    return [
      { x: block.x, y: block.y, w: splitAt, h: block.h },
      { x: block.x + splitAt + 1, y: block.y, w: block.w - splitAt - 1, h: block.h },
    ];
  } else if (!preferVertical && block.h >= PARAMS.minRoomDim * 2 + 1) {
    const splitAt = randInt(PARAMS.minRoomDim, block.h - PARAMS.minRoomDim - 1);
    return [
      { x: block.x, y: block.y, w: block.w, h: splitAt },
      { x: block.x, y: block.y + splitAt + 1, w: block.w, h: block.h - splitAt - 1 },
    ];
  }

  // Try the other direction
  if (!preferVertical && block.w >= PARAMS.minRoomDim * 2 + 1) {
    const splitAt = randInt(PARAMS.minRoomDim, block.w - PARAMS.minRoomDim - 1);
    return [
      { x: block.x, y: block.y, w: splitAt, h: block.h },
      { x: block.x + splitAt + 1, y: block.y, w: block.w - splitAt - 1, h: block.h },
    ];
  } else if (preferVertical && block.h >= PARAMS.minRoomDim * 2 + 1) {
    const splitAt = randInt(PARAMS.minRoomDim, block.h - PARAMS.minRoomDim - 1);
    return [
      { x: block.x, y: block.y, w: block.w, h: splitAt },
      { x: block.x, y: block.y + splitAt + 1, w: block.w, h: block.h - splitAt - 1 },
    ];
  }

  return [block];
}

function blocksToRooms(blocks: Rect[]): Room[] {
  const queue = [...blocks];
  const rooms: Room[] = [];
  let roomId = 0;

  while (queue.length > 0) {
    const block = queue.shift()!;

    if (rectArea(block) > PARAMS.minBlockArea * 1.8 &&
        (block.w >= PARAMS.minRoomDim * 2 + 1 || block.h >= PARAMS.minRoomDim * 2 + 1)) {
      const parts = splitBlock(block);
      if (parts.length > 1) {
        queue.push(...parts);
        continue;
      }
    }

    if (block.w >= PARAMS.minRoomDim && block.h >= PARAMS.minRoomDim) {
      rooms.push({ id: roomId++, rect: block, hallDoors: [], roomDoors: [] });
    }
  }

  return rooms;
}

// ── Phase 3: Connectivity ──

function rectTouches(a: Rect, b: Rect): boolean {
  // Check if a and b share an edge (adjacent, not overlapping)
  // Horizontal adjacency: one is directly left of the other
  if (a.x + a.w === b.x || b.x + b.w === a.x) {
    const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return overlapY > 0;
  }
  // Vertical adjacency
  if (a.y + a.h === b.y || b.y + b.h === a.y) {
    const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    return overlapX > 0;
  }
  return false;
}

// Check adjacency with 1 cell gap (for wall between them)
function rectTouchesWithGap(a: Rect, b: Rect, gap: number): boolean {
  // Horizontal: gap cells between them
  if (a.x + a.w + gap === b.x || b.x + b.w + gap === a.x) {
    const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return overlapY > 0;
  }
  if (a.y + a.h + gap === b.y || b.y + b.h + gap === a.y) {
    const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    return overlapX > 0;
  }
  return false;
}

function findSharedEdge(a: Rect, b: Rect): { x: number; y: number } | null {
  // Direct adjacency (touching)
  if (a.x + a.w === b.x) {
    const minY = Math.max(a.y, b.y);
    const maxY = Math.min(a.y + a.h, b.y + b.h);
    if (maxY - minY > 0) {
      const doorY = randInt(minY, maxY - 1);
      return { x: a.x + a.w - 1, y: doorY }; // door on a's right edge
    }
  }
  if (b.x + b.w === a.x) {
    const minY = Math.max(a.y, b.y);
    const maxY = Math.min(a.y + a.h, b.y + b.h);
    if (maxY - minY > 0) {
      const doorY = randInt(minY, maxY - 1);
      return { x: a.x, y: doorY }; // door on a's left edge
    }
  }
  if (a.y + a.h === b.y) {
    const minX = Math.max(a.x, b.x);
    const maxX = Math.min(a.x + a.w, b.x + b.w);
    if (maxX - minX > 0) {
      const doorX = randInt(minX, maxX - 1);
      return { x: doorX, y: a.y + a.h - 1 };
    }
  }
  if (b.y + b.h === a.y) {
    const minX = Math.max(a.x, b.x);
    const maxX = Math.min(a.x + a.w, b.x + b.w);
    if (maxX - minX > 0) {
      const doorX = randInt(minX, maxX - 1);
      return { x: doorX, y: a.y };
    }
  }
  return null;
}

function findDoorPosition(a: Rect, b: Rect, gap: number): { x: number; y: number } | null {
  // Find a door position between a and b separated by `gap` cells
  if (a.x + a.w + gap === b.x) {
    const minY = Math.max(a.y, b.y);
    const maxY = Math.min(a.y + a.h, b.y + b.h);
    if (maxY - minY > 0) {
      return { x: a.x + a.w + Math.floor(gap / 2), y: randInt(minY, maxY - 1) };
    }
  }
  if (b.x + b.w + gap === a.x) {
    const minY = Math.max(a.y, b.y);
    const maxY = Math.min(a.y + a.h, b.y + b.h);
    if (maxY - minY > 0) {
      return { x: b.x + b.w + Math.floor(gap / 2), y: randInt(minY, maxY - 1) };
    }
  }
  if (a.y + a.h + gap === b.y) {
    const minX = Math.max(a.x, b.x);
    const maxX = Math.min(a.x + a.w, b.x + b.w);
    if (maxX - minX > 0) {
      return { x: randInt(minX, maxX - 1), y: a.y + a.h + Math.floor(gap / 2) };
    }
  }
  if (b.y + b.h + gap === a.y) {
    const minX = Math.max(a.x, b.x);
    const maxX = Math.min(a.x + a.w, b.x + b.w);
    if (maxX - minX > 0) {
      return { x: randInt(minX, maxX - 1), y: b.y + b.h + Math.floor(gap / 2) };
    }
  }
  return null;
}

function connectRooms(rooms: Room[], halls: Hall[]): { doors: { x: number; y: number }[] } {
  const doors: { x: number; y: number }[] = [];
  const reachable = new Set<number>();
  const unreachable = new Set<number>(rooms.map(r => r.id));

  // Pass 1: connect rooms that touch halls
  for (const room of rooms) {
    for (const hall of halls) {
      if (rectTouches(room.rect, hall.rect)) {
        const doorPos = findSharedEdge(room.rect, hall.rect);
        if (doorPos) {
          room.hallDoors.push(hall.id);
          reachable.add(room.id);
          unreachable.delete(room.id);
          doors.push(doorPos);
          break; // one door per room to hall is enough
        }
      }
    }
  }

  // Pass 2: connect unreachable rooms to reachable rooms
  let changed = true;
  let passes = 0;
  while (changed && passes < 50) {
    changed = false;
    passes++;
    for (const rid of [...unreachable]) {
      const room = rooms.find(r => r.id === rid)!;

      // Try connecting to a reachable room (with 1-cell wall gap)
      for (const otherRid of reachable) {
        const other = rooms.find(r => r.id === otherRid)!;
        if (rectTouchesWithGap(room.rect, other.rect, 1)) {
          const doorPos = findDoorPosition(room.rect, other.rect, 1);
          if (doorPos) {
            room.roomDoors.push(other.id);
            other.roomDoors.push(room.id);
            reachable.add(room.id);
            unreachable.delete(room.id);
            doors.push(doorPos);
            changed = true;
            break;
          }
        }
      }

      // If still unreachable, try connecting to any hall with a gap
      if (unreachable.has(rid)) {
        for (const hall of halls) {
          if (rectTouchesWithGap(room.rect, hall.rect, 1)) {
            const doorPos = findDoorPosition(room.rect, hall.rect, 1);
            if (doorPos) {
              room.hallDoors.push(hall.id);
              reachable.add(room.id);
              unreachable.delete(room.id);
              doors.push(doorPos);
              changed = true;
              break;
            }
          }
        }
      }
    }
  }

  return { doors };
}

// ── Grid rendering ──

function createGrid(): Grid {
  const grid: Grid = { w: PARAMS.gridW, h: PARAMS.gridH, cells: [] };
  for (let y = 0; y < grid.h; y++) {
    grid.cells[y] = [];
    for (let x = 0; x < grid.w; x++) grid.cells[y][x] = 'void';
  }
  return grid;
}

function carveToGrid(grid: Grid, rooms: Room[], halls: Hall[], doors: { x: number; y: number }[]) {
  // Carve halls
  for (const hall of halls) {
    for (let y = hall.rect.y; y < hall.rect.y + hall.rect.h; y++) {
      for (let x = hall.rect.x; x < hall.rect.x + hall.rect.w; x++) {
        if (y >= 0 && y < grid.h && x >= 0 && x < grid.w) {
          grid.cells[y][x] = 'hall';
        }
      }
    }
  }

  // Carve rooms
  for (const room of rooms) {
    for (let y = room.rect.y; y < room.rect.y + room.rect.h; y++) {
      for (let x = room.rect.x; x < room.rect.x + room.rect.w; x++) {
        if (y >= 0 && y < grid.h && x >= 0 && x < grid.w) {
          grid.cells[y][x] = 'floor';
        }
      }
    }
  }

  // Place walls between rooms (cells that are void and adjacent to floor/hall)
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      if (grid.cells[y][x] !== 'void') continue;
      let adjOpen = false;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const ny = y + dy, nx = x + dx;
        if (ny >= 0 && ny < grid.h && nx >= 0 && nx < grid.w) {
          if (grid.cells[ny][nx] === 'floor' || grid.cells[ny][nx] === 'hall') {
            adjOpen = true;
            break;
          }
        }
      }
      if (adjOpen) grid.cells[y][x] = 'wall';
    }
  }

  // Place doors
  for (const d of doors) {
    if (d.y >= 0 && d.y < grid.h && d.x >= 0 && d.x < grid.w) {
      grid.cells[d.y][d.x] = 'door';
    }
  }
}

function renderGrid(grid: Grid): string {
  const lines: string[] = [];
  for (let y = 0; y < grid.h; y++) {
    let line = '';
    for (let x = 0; x < grid.w; x++) {
      switch (grid.cells[y][x]) {
        case 'floor': line += '·'; break;
        case 'hall':  line += '·'; break;
        case 'wall':  line += '#'; break;
        case 'door':  line += '+'; break;
        default:      line += ' '; break;
      }
    }
    lines.push(line);
  }
  return lines.join('\n');
}

// ── Full generation ──

interface GeneratedHouse {
  rooms: Room[];
  halls: Hall[];
  doors: { x: number; y: number }[];
  adj: Map<number, number[]>;
}

function buildRoomAdj(rooms: Room[], halls: Hall[]): Map<number, number[]> {
  // Build a cell ownership grid, then cut halls at intersections with other halls
  // so each hall segment is isolated. Rooms touching the same segment are adjacent.
  // Rooms at hall intersections become bridge nodes (chokepoints).

  const cellOwner: number[][] = [];
  for (let y = 0; y < PARAMS.gridH; y++) {
    cellOwner[y] = [];
    for (let x = 0; x < PARAMS.gridW; x++) cellOwner[y][x] = -2; // void
  }

  // Mark hall cells with hall ID (negative, offset by -100 to avoid collision)
  for (const hall of halls) {
    for (let y = hall.rect.y; y < hall.rect.y + hall.rect.h; y++) {
      for (let x = hall.rect.x; x < hall.rect.x + hall.rect.w; x++) {
        if (y >= 0 && y < PARAMS.gridH && x >= 0 && x < PARAMS.gridW) {
          cellOwner[y][x] = -(hall.id + 100);
        }
      }
    }
  }

  // CUT halls at intersections: where two halls overlap, place a wall
  for (let i = 0; i < halls.length; i++) {
    for (let j = i + 1; j < halls.length; j++) {
      const a = halls[i].rect, b = halls[j].rect;
      // Find overlap region
      const ox1 = Math.max(a.x, b.x);
      const oy1 = Math.max(a.y, b.y);
      const ox2 = Math.min(a.x + a.w, b.x + b.w);
      const oy2 = Math.min(a.y + a.h, b.y + b.h);
      if (ox1 < ox2 && oy1 < oy2) {
        // Halls overlap — wall off the intersection
        for (let y = oy1; y < oy2; y++) {
          for (let x = ox1; x < ox2; x++) {
            cellOwner[y][x] = -3; // wall (cut point)
          }
        }
      }
      // Also cut where halls are adjacent (touching edges)
      // Horizontal adjacency
      if (a.x + a.w === b.x || b.x + b.w === a.x) {
        const minY = Math.max(a.y, b.y);
        const maxY = Math.min(a.y + a.h, b.y + b.h);
        if (maxY > minY) {
          const cutX = (a.x + a.w === b.x) ? a.x + a.w - 1 : b.x + b.w - 1;
          for (let y = minY; y < maxY; y++) {
            if (cutX >= 0 && cutX < PARAMS.gridW) cellOwner[y][cutX] = -3;
          }
        }
      }
      // Vertical adjacency
      if (a.y + a.h === b.y || b.y + b.h === a.y) {
        const minX = Math.max(a.x, b.x);
        const maxX = Math.min(a.x + a.w, b.x + b.w);
        if (maxX > minX) {
          const cutY = (a.y + a.h === b.y) ? a.y + a.h - 1 : b.y + b.h - 1;
          for (let x = minX; x < maxX; x++) {
            if (cutY >= 0 && cutY < PARAMS.gridH) cellOwner[cutY][x] = -3;
          }
        }
      }
    }
  }

  // Mark room cells (rooms override hall markings in their area)
  for (const room of rooms) {
    for (let y = room.rect.y; y < room.rect.y + room.rect.h; y++) {
      for (let x = room.rect.x; x < room.rect.x + room.rect.w; x++) {
        if (y >= 0 && y < PARAMS.gridH && x >= 0 && x < PARAMS.gridW) {
          cellOwner[y][x] = room.id;
        }
      }
    }
  }

  // BFS from each room through hall cells (but NOT through cut points or other rooms)
  const adj = new Map<number, number[]>();
  for (const r of rooms) adj.set(r.id, []);

  for (const room of rooms) {
    const visited = new Set<string>();
    const queue: [number, number][] = [];

    // Seed BFS from hall cells adjacent to this room
    for (let y = room.rect.y - 1; y <= room.rect.y + room.rect.h; y++) {
      for (let x = room.rect.x - 1; x <= room.rect.x + room.rect.w; x++) {
        if (y < 0 || y >= PARAMS.gridH || x < 0 || x >= PARAMS.gridW) continue;
        const c = cellOwner[y][x];
        if (c <= -100) { // hall cell
          const key = `${x},${y}`;
          if (!visited.has(key)) { visited.add(key); queue.push([x, y]); }
        }
      }
    }

    while (queue.length > 0) {
      const [cx, cy] = queue.shift()!;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= PARAMS.gridW || ny < 0 || ny >= PARAMS.gridH) continue;
        const key = `${nx},${ny}`;
        if (visited.has(key)) continue;
        const owner = cellOwner[ny][nx];
        if (owner <= -100) {
          // Another hall cell — continue flood
          visited.add(key);
          queue.push([nx, ny]);
        } else if (owner >= 0 && owner !== room.id) {
          // Reached another room
          visited.add(key);
          if (!adj.get(room.id)!.includes(owner)) {
            adj.get(room.id)!.push(owner);
            adj.get(owner)!.push(room.id);
          }
        }
        // owner === -3 (cut wall) or -2 (void) → stop
      }
    }
  }

  // Also add direct room-to-room door connections
  for (const room of rooms) {
    for (const otherRid of room.roomDoors) {
      if (!adj.get(room.id)!.includes(otherRid)) {
        adj.get(room.id)!.push(otherRid);
        adj.get(otherRid)!.push(room.id);
      }
    }
  }

  return adj;
}

function generate(): GeneratedHouse {
  const house: Rect = { x: 0, y: 0, w: PARAMS.gridW, h: PARAMS.gridH };

  const { blocks, halls } = chunksToBlocks(house);
  const rooms = blocksToRooms(blocks);
  const { doors } = connectRooms(rooms, halls);
  const adj = buildRoomAdj(rooms, halls);

  return { rooms, halls, doors, adj };
}

// ── Topology metrics ──

const PATH_CAP = 1000;
const PATH_TIMEOUT_MS = 50;

function countPaths(adj: Map<number, number[]>, start: number, end: number): number {
  const visited = new Set<number>();
  let count = 0;
  const deadline = Date.now() + PATH_TIMEOUT_MS;
  let aborted = false;
  function dfs(cur: number) {
    if (count >= PATH_CAP || aborted) return;
    if (Date.now() > deadline) { aborted = true; count = PATH_CAP; return; }
    if (cur === end) { count++; return; }
    visited.add(cur);
    for (const n of (adj.get(cur) ?? [])) {
      if (count >= PATH_CAP || aborted) return;
      if (!visited.has(n)) dfs(n);
    }
    visited.delete(cur);
  }
  dfs(start);
  return count;
}

function bfsReachable(adj: Map<number, number[]>, start: number, exclude: number): Set<number> {
  const visited = new Set<number>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const n of (adj.get(node) ?? [])) {
      if (n !== exclude && !visited.has(n)) { visited.add(n); queue.push(n); }
    }
  }
  return visited;
}

interface Metrics {
  roomCount: number;
  edgeCount: number;
  cycleCount: number;
  simplePaths: number;
  articulationPoints: number;
  avgDegree: number;
  maxDegree: number;
  deadEnds: number;
  disconnected: boolean;
  hallCount: number;
  unreachableRooms: number;
}

function computeMetrics(house: GeneratedHouse): Metrics {
  const { rooms, halls, adj } = house;
  const ids = rooms.map(r => r.id);
  const roomCount = ids.length;

  let edgeCount = 0;
  for (const ns of adj.values()) edgeCount += ns.length;
  edgeCount /= 2;

  const cycleCount = edgeCount - (roomCount - 1);
  const degrees = ids.map(id => (adj.get(id) ?? []).length);
  const avgDegree = roomCount > 0 ? degrees.reduce((a, b) => a + b, 0) / roomCount : 0;
  const maxDegree = Math.max(0, ...degrees);
  const deadEnds = degrees.filter(d => d <= 1).length;

  // Entry = top-left-most room, exit = bottom-right-most
  const sorted = [...rooms].sort((a, b) => (a.rect.x + a.rect.y) - (b.rect.x + b.rect.y));
  const entry = sorted[0]?.id ?? 0;
  const exit = sorted[sorted.length - 1]?.id ?? entry;

  // Count rooms with no connections
  const unreachableRooms = degrees.filter(d => d === 0).length;

  const reachable = bfsReachable(adj, entry, -1);
  const disconnected = !reachable.has(exit);
  const simplePaths = disconnected ? 0 : countPaths(adj, entry, exit);

  let articulationPoints = 0;
  if (!disconnected) {
    for (const id of ids) {
      if (id === entry || id === exit) continue;
      const r = bfsReachable(adj, entry, id);
      if (!r.has(exit)) articulationPoints++;
    }
  }

  return {
    roomCount,
    edgeCount: Math.round(edgeCount * 100) / 100,
    cycleCount,
    simplePaths,
    articulationPoints,
    avgDegree: Math.round(avgDegree * 100) / 100,
    maxDegree,
    deadEnds,
    disconnected,
    hallCount: halls.length,
    unreachableRooms,
  };
}

// ── Stats runner ──

interface StatsSummary { mean: number; min: number; max: number; p50: number; p95: number }

function calcStats(values: number[]): StatsSummary {
  const s = [...values].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return {
    mean: Math.round(mean * 100) / 100,
    min: s[0], max: s[s.length - 1],
    p50: s[Math.floor(s.length * 0.5)],
    p95: s[Math.floor(s.length * 0.95)],
  };
}

function runStats(samples: number, label: string) {
  const all: Metrics[] = [];
  let disconnectedCount = 0;

  for (let i = 0; i < samples; i++) {
    const house = generate();
    const m = computeMetrics(house);
    all.push(m);
    if (m.disconnected) disconnectedCount++;
  }

  const keys: (keyof Metrics)[] = [
    'roomCount', 'hallCount', 'edgeCount', 'cycleCount', 'simplePaths',
    'articulationPoints', 'avgDegree', 'maxDegree', 'deadEnds', 'unreachableRooms',
  ];

  console.log(`\n═══ ${label} (${samples} samples) ═══`);
  console.log(`Grid: ${PARAMS.gridW}×${PARAMS.gridH} hallRate=${PARAMS.maxHallRate} minSplit=${PARAMS.minSplittableArea} hallW=${PARAMS.hallWidth} minRoom=${PARAMS.minRoomDim}`);
  console.log('Metric              Mean    Min   Max   p50   p95');
  console.log('─'.repeat(55));
  for (const key of keys) {
    const s = calcStats(all.map(m => m[key] as number));
    const name = key.padEnd(20);
    console.log(`${name} ${String(s.mean).padStart(5)}  ${String(s.min).padStart(5)} ${String(s.max).padStart(5)} ${String(s.p50).padStart(5)} ${String(s.p95).padStart(5)}`);
  }

  const pctPaths3 = Math.round(all.filter(m => m.simplePaths >= 3).length / samples * 100);
  const pctCycles2 = Math.round(all.filter(m => m.cycleCount >= 2).length / samples * 100);
  const pctDisconnected = Math.round(disconnectedCount / samples * 100);
  const pctLinear = Math.round(all.filter(m => m.simplePaths <= 1).length / samples * 100);
  const pctAP = Math.round(all.filter(m => m.articulationPoints >= 1).length / samples * 100);
  const pctMVC2 = Math.round(all.filter(m => {
    if (m.disconnected) return false;
    // Approximate: if articulationPoints > 0, MVC is likely 1
    return m.articulationPoints === 0 && m.simplePaths >= 2;
  }).length / samples * 100);

  console.log('─'.repeat(55));
  console.log(`Disconnected:      ${pctDisconnected}%`);
  console.log(`Linear (paths≤1):  ${pctLinear}%`);
  console.log(`Paths ≥ 3:         ${pctPaths3}%   (target: ≥80%)`);
  console.log(`Cycles ≥ 2:        ${pctCycles2}%   (target: ≥70%)`);
  console.log(`Has chokepoints:   ${pctAP}%`);
}

// ── Main ──

const args = process.argv.slice(2);

if (args.includes('--sweep')) {
  const N = 300;

  console.log('\n\n========== SWEEP: Hall Rate ==========');
  for (const rate of [0.10, 0.15, 0.20, 0.25, 0.30, 0.40]) {
    PARAMS = { ...DEFAULT_PARAMS, maxHallRate: rate };
    runStats(N, `hallRate=${rate}`);
  }

  console.log('\n\n========== SWEEP: Min Splittable Area ==========');
  for (const area of [15, 20, 30, 50, 80]) {
    PARAMS = { ...DEFAULT_PARAMS, minSplittableArea: area };
    runStats(N, `minSplit=${area}`);
  }

  console.log('\n\n========== SWEEP: Hall Width ==========');
  for (const w of [1, 2, 3]) {
    PARAMS = { ...DEFAULT_PARAMS, hallWidth: w };
    runStats(N, `hallWidth=${w}`);
  }

  console.log('\n\n========== SWEEP: Min Room Dim ==========');
  for (const dim of [2, 3, 4, 5]) {
    PARAMS = { ...DEFAULT_PARAMS, minRoomDim: dim };
    runStats(N, `minRoom=${dim}`);
  }

} else if (args.includes('--stats')) {
  PARAMS = { ...DEFAULT_PARAMS };
  runStats(500, 'House Generator Default');
} else {
  PARAMS = { ...DEFAULT_PARAMS };
  for (let i = 0; i < 5; i++) {
    const house = generate();
    const grid = createGrid();
    carveToGrid(grid, house.rooms, house.halls, house.doors);

    console.log(`=== House Sample ${i + 1} (${house.rooms.length} rooms, ${house.halls.length} halls) ===`);
    console.log(renderGrid(grid));

    const adjStr: string[] = [];
    for (const r of house.rooms) {
      const ns = house.adj.get(r.id);
      if (ns) adjStr.push(`${r.id}→[${ns.sort((a,b)=>a-b).join(',')}]`);
    }
    console.log(`Adjacency: ${adjStr.join('  ')}`);
    console.log();
  }
}
