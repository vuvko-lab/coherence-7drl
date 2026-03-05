// Hall-first BSP room generator
//
// Algorithm:
//   1. Recursively split space with halls (corridors) as primary structure
//   2. Subdivide remaining blocks into rooms
//   3. Cut halls with walls+doors for chokepoints
//   4. Connect rooms to halls with doors, add extra room-to-room doors
//   5. Place interface exits on left/right outer walls
//   6. Convert walls to box-drawing characters
//
// Usage:
//   npx tsx scripts/gen-halls.ts

declare const process: { argv: string[] };

// ── Types ──

interface Rect {
  x: number; y: number; w: number; h: number;
}

interface Hall {
  id: number;
  rect: Rect;
  orientation: 'vertical' | 'horizontal';
}

interface RoomDef {
  id: number;
  rect: Rect;
  parentHallId: number; // hall this room connects to
}

type BSPNode = {
  kind: 'hall';
  hall: Hall;
  left: BSPNode;
  right: BSPNode;
} | {
  kind: 'rooms';
  rooms: RoomDef[];
  parentHallId: number;
};

type CellType = 'void' | 'floor' | 'wall' | 'hall' | 'door' | 'interface';

interface Grid {
  w: number; h: number;
  cells: CellType[][];
}

// ── Parameters ──

interface GenParams {
  gridW: number;
  gridH: number;
  minRoomSize: number;
  maxRoomSize: number;
  minHallWidth: number;
  maxHallWidth: number;
  cutPercentage: number;
  cutTimes: number;
  extraDoor: number;
  numExitInterface: number;
  smallBlockHallChance: number; // probability of splitting a sub-threshold block with a hall
}

const PARAMS: GenParams = {
  gridW: 48,
  gridH: 28,
  minRoomSize: 2,
  maxRoomSize: 6,
  minHallWidth: 2,
  maxHallWidth: 4,
  cutPercentage: 0.2,
  cutTimes: 2,
  extraDoor: 0.2,
  numExitInterface: 3,
  smallBlockHallChance: 0.4,
};

// ── Helpers ──

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createGrid(): Grid {
  const grid: Grid = { w: PARAMS.gridW, h: PARAMS.gridH, cells: [] };
  for (let y = 0; y < grid.h; y++) {
    grid.cells[y] = [];
    for (let x = 0; x < grid.w; x++) grid.cells[y][x] = 'void';
  }
  return grid;
}

function isAdjacentToOuter(rect: Rect, map: Rect): boolean {
  return rect.x === map.x || rect.y === map.y ||
    rect.x + rect.w === map.x + map.w ||
    rect.y + rect.h === map.y + map.h;
}

// ── Phase 1: Split blocks with halls ──

let nextHallId = 0;
let nextRoomId = 0;

interface SplitResult {
  hall: Hall;
  left: Rect;   // left or top block
  right: Rect;  // right or bottom block
}

function splitWithHall(block: Rect, orientation: 'vertical' | 'horizontal'): SplitResult | null {
  const hallFloor = randInt(PARAMS.minHallWidth, PARAMS.maxHallWidth);
  const totalCut = hallFloor + 2; // floor + 1 wall on each side
  const minEdge = PARAMS.minRoomSize;

  if (orientation === 'vertical') {
    // Vertical hall: runs top-to-bottom, splits left/right
    // Layout: [left block] wall | hall floor | wall [right block]
    if (block.w < minEdge + totalCut + minEdge) return null;
    const minPos = block.x + minEdge;
    const maxPos = block.x + block.w - minEdge - totalCut;
    if (minPos > maxPos) return null;
    const cutStart = randInt(minPos, maxPos);
    return {
      hall: { id: nextHallId++, rect: { x: cutStart + 1, y: block.y, w: hallFloor, h: block.h }, orientation },
      left:  { x: block.x, y: block.y, w: cutStart - block.x, h: block.h },
      right: { x: cutStart + totalCut, y: block.y, w: block.x + block.w - cutStart - totalCut, h: block.h },
    };
  } else {
    // Horizontal hall: runs left-to-right, splits top/bottom
    // Layout: [top block] wall — hall floor — wall [bottom block]
    if (block.h < minEdge + totalCut + minEdge) return null;
    const minPos = block.y + minEdge;
    const maxPos = block.y + block.h - minEdge - totalCut;
    if (minPos > maxPos) return null;
    const cutStart = randInt(minPos, maxPos);
    return {
      hall: { id: nextHallId++, rect: { x: block.x, y: cutStart + 1, w: block.w, h: hallFloor }, orientation },
      left:  { x: block.x, y: block.y, w: block.w, h: cutStart - block.y },
      right: { x: block.x, y: cutStart + totalCut, w: block.w, h: block.y + block.h - cutStart - totalCut },
    };
  }
}

type PendingBlock = {
  rect: Rect;
  parentHallId: number;
  assignTo: (node: BSPNode) => void;
};

function buildHallTree(mapRect: Rect): { root: BSPNode; halls: Hall[]; pendingBlocks: PendingBlock[] } {
  const maxBlockSize = 2 * PARAMS.maxRoomSize;
  const halls: Hall[] = [];
  const pendingBlocks: PendingBlock[] = [];

  // Start: whole map is one block, first split is vertical
  const initialSplit = splitWithHall(mapRect, 'vertical');
  if (!initialSplit) {
    const placeholder: BSPNode = { kind: 'rooms', rooms: [], parentHallId: -1 };
    pendingBlocks.push({ rect: mapRect, parentHallId: -1, assignTo: () => {} });
    return { root: placeholder, halls, pendingBlocks };
  }

  halls.push(initialSplit.hall);

  const root: BSPNode = {
    kind: 'hall',
    hall: initialSplit.hall,
    left: { kind: 'rooms', rooms: [], parentHallId: initialSplit.hall.id },
    right: { kind: 'rooms', rooms: [], parentHallId: initialSplit.hall.id },
  };

  const queue: PendingBlock[] = [];
  queue.push({
    rect: initialSplit.left,
    parentHallId: initialSplit.hall.id,
    assignTo: (node) => { (root as any).left = node; },
  });
  queue.push({
    rect: initialSplit.right,
    parentHallId: initialSplit.hall.id,
    assignTo: (node) => { (root as any).right = node; },
  });

  while (queue.length > 0) {
    const item = queue.shift()!;
    const block = item.rect;

    // Check if block needs further hall splitting (both dims > maxBlockSize)
    // Or probabilistically split smaller blocks along longest dimension
    const mustSplit = block.w > maxBlockSize && block.h > maxBlockSize;
    const canSplit = !mustSplit && Math.random() < PARAMS.smallBlockHallChance;
    if (mustSplit || canSplit) {
      const orientation = mustSplit
        ? (Math.random() < 0.5 ? 'vertical' as const : 'horizontal' as const)
        : (block.w >= block.h ? 'vertical' as const : 'horizontal' as const);
      const split = splitWithHall(block, orientation);
      if (split) {
        halls.push(split.hall);
        const hallNode: BSPNode = {
          kind: 'hall',
          hall: split.hall,
          left: { kind: 'rooms', rooms: [], parentHallId: split.hall.id },
          right: { kind: 'rooms', rooms: [], parentHallId: split.hall.id },
        };
        item.assignTo(hallNode);

        queue.push({
          rect: split.left,
          parentHallId: split.hall.id,
          assignTo: (node) => { (hallNode as any).left = node; },
        });
        queue.push({
          rect: split.right,
          parentHallId: split.hall.id,
          assignTo: (node) => { (hallNode as any).right = node; },
        });
        continue;
      }
    }

    // Block is small enough for room subdivision — collect for Phase 2
    pendingBlocks.push(item);
    item.assignTo({ kind: 'rooms', rooms: [], parentHallId: item.parentHallId });
  }

  return { root, halls, pendingBlocks };
}

// ── Phase 2: Subdivide blocks into rooms ──

function subdivideAlongLongest(block: Rect, parentHallId: number): RoomDef[] {
  const min = PARAMS.minRoomSize;
  const max = PARAMS.maxRoomSize;
  const rooms: RoomDef[] = [];

  // Pick axis: subdivide along longest dimension
  const horizontal = block.w >= block.h; // true = place vertical walls, sweep left→right

  if (horizontal) {
    let cursor = block.x;
    const end = block.x + block.w;
    while (cursor < end) {
      const remaining = end - cursor;
      if (remaining < min * 2 + 1) {
        // Can't split further — last room takes the rest
        if (remaining >= min) {
          rooms.push({ id: nextRoomId++, rect: { x: cursor, y: block.y, w: remaining, h: block.h }, parentHallId });
        }
        break;
      }
      const size = randInt(min, Math.min(max, remaining - min - 1));
      rooms.push({ id: nextRoomId++, rect: { x: cursor, y: block.y, w: size, h: block.h }, parentHallId });
      cursor += size + 1; // +1 for wall between rooms
    }
  } else {
    let cursor = block.y;
    const end = block.y + block.h;
    while (cursor < end) {
      const remaining = end - cursor;
      if (remaining < min * 2 + 1) {
        if (remaining >= min) {
          rooms.push({ id: nextRoomId++, rect: { x: block.x, y: cursor, w: block.w, h: remaining }, parentHallId });
        }
        break;
      }
      const size = randInt(min, Math.min(max, remaining - min - 1));
      rooms.push({ id: nextRoomId++, rect: { x: block.x, y: cursor, w: block.w, h: size }, parentHallId });
      cursor += size + 1;
    }
  }

  // If no rooms were created (block too small), make a single room
  if (rooms.length === 0 && block.w >= 1 && block.h >= 1) {
    rooms.push({ id: nextRoomId++, rect: { ...block }, parentHallId });
  }

  return rooms;
}

function processBlocks(pendingBlocks: PendingBlock[], mapRect: Rect): RoomDef[] {
  const allRooms: RoomDef[] = [];
  const queue = [...pendingBlocks];

  while (queue.length > 0) {
    const item = queue.shift()!;
    const block = item.rect;

    // Skip degenerate blocks
    if (block.w < 1 || block.h < 1) continue;

    // Step 2.3: check if adjacent to outer wall
    if (isAdjacentToOuter(block, mapRect)) {
      // Step 2.5: directly subdivide into rooms
      const rooms = subdivideAlongLongest(block, item.parentHallId);
      allRooms.push(...rooms);
      item.assignTo({ kind: 'rooms', rooms, parentHallId: item.parentHallId });
    } else {
      // Step 2.4: interior block — try subdivision first, then wall cut
      const min = PARAMS.minRoomSize;

      // Can we subdivide? (need at least 2*min+1 in one dimension)
      const canSubdivide = block.w >= min * 2 + 1 || block.h >= min * 2 + 1;

      if (canSubdivide) {
        const rooms = subdivideAlongLongest(block, item.parentHallId);
        allRooms.push(...rooms);
        item.assignTo({ kind: 'rooms', rooms, parentHallId: item.parentHallId });
      } else if (block.w >= min && block.h >= min) {
        // Too small to subdivide — single room
        const room: RoomDef = { id: nextRoomId++, rect: { ...block }, parentHallId: item.parentHallId };
        allRooms.push(room);
        item.assignTo({ kind: 'rooms', rooms: [room], parentHallId: item.parentHallId });
      }
      // else: block too small for even a single room, discard
    }
  }

  return allRooms;
}

// ── Phase 2b: Merge small rooms (eliminate dimension < 2) ──

function tryMergeRects(a: Rect, b: Rect): Rect | null {
  // Horizontal adjacency: a-[wall]-b or b-[wall]-a, same y range
  if (a.y === b.y && a.h === b.h) {
    if (a.x + a.w + 1 === b.x) {
      return { x: a.x, y: a.y, w: b.x + b.w - a.x, h: a.h };
    }
    if (b.x + b.w + 1 === a.x) {
      return { x: b.x, y: b.y, w: a.x + a.w - b.x, h: b.h };
    }
  }

  // Vertical adjacency: a-[wall]-b or b-[wall]-a, same x range
  if (a.x === b.x && a.w === b.w) {
    if (a.y + a.h + 1 === b.y) {
      return { x: a.x, y: a.y, w: a.w, h: b.y + b.h - a.y };
    }
    if (b.y + b.h + 1 === a.y) {
      return { x: b.x, y: b.y, w: b.w, h: a.y + a.h - b.y };
    }
  }

  return null;
}

function mergeSmallRooms(rooms: RoomDef[]): RoomDef[] {
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = rooms.length - 1; i >= 0; i--) {
      const r = rooms[i];
      if (r.rect.w >= 2 && r.rect.h >= 2) continue;

      // Find merge partner: prefer sibling (same parentHallId)
      let bestJ = -1;
      let bestRect: Rect | null = null;

      for (let j = 0; j < rooms.length; j++) {
        if (i === j) continue;
        const result = tryMergeRects(r.rect, rooms[j].rect);
        if (result) {
          bestJ = j;
          bestRect = result;
          if (rooms[j].parentHallId === r.parentHallId) break; // prefer sibling
        }
      }

      if (bestJ >= 0 && bestRect) {
        rooms[bestJ].rect = bestRect;
        rooms.splice(i, 1);
        changed = true;
        break; // restart scan
      } else {
        // Fallback: expand to minimum 2 in each dimension
        if (r.rect.w < 2) r.rect.w = 2;
        if (r.rect.h < 2) r.rect.h = 2;
      }
    }
  }
  return rooms;
}

// ── Phase 3: Carve to grid ──

function carveToGrid(grid: Grid, halls: Hall[], rooms: RoomDef[]) {
  // Carve halls
  for (const hall of halls) {
    const r = hall.rect;
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (y >= 0 && y < grid.h && x >= 0 && x < grid.w) {
          grid.cells[y][x] = 'hall';
        }
      }
    }
  }

  // Carve rooms
  for (const room of rooms) {
    const r = room.rect;
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (y >= 0 && y < grid.h && x >= 0 && x < grid.w) {
          grid.cells[y][x] = 'floor';
        }
      }
    }
  }

  // Generate walls: any void cell adjacent to floor or hall becomes a wall
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      if (grid.cells[y][x] !== 'void') continue;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const ny = y + dy, nx = x + dx;
        if (ny >= 0 && ny < grid.h && nx >= 0 && nx < grid.w) {
          const c = grid.cells[ny][nx];
          if (c === 'floor' || c === 'hall') {
            grid.cells[y][x] = 'wall';
            break;
          }
        }
      }
    }
  }
}

// ── Phase 4: Hall cuts (step 3) ──

function cutHalls(grid: Grid, halls: Hall[]) {
  for (const hall of halls) {
    if (Math.random() >= PARAMS.cutPercentage) continue;
    const r = hall.rect;

    for (let cut = 0; cut < PARAMS.cutTimes; cut++) {
      if (hall.orientation === 'vertical') {
        // Hall runs vertically — cut horizontally (place a horizontal wall row with one door)
        if (r.h < 3) continue;
        const cutY = randInt(r.y + 1, r.y + r.h - 2);
        const doorX = randInt(r.x, r.x + r.w - 1);
        for (let x = r.x; x < r.x + r.w; x++) {
          if (x >= 0 && x < grid.w && cutY >= 0 && cutY < grid.h) {
            grid.cells[cutY][x] = (x === doorX) ? 'door' : 'wall';
          }
        }
      } else {
        // Hall runs horizontally — cut vertically
        if (r.w < 3) continue;
        const cutX = randInt(r.x + 1, r.x + r.w - 2);
        const doorY = randInt(r.y, r.y + r.h - 1);
        for (let y = r.y; y < r.y + r.h; y++) {
          if (y >= 0 && y < grid.h && cutX >= 0 && cutX < grid.w) {
            grid.cells[y][cutX] = (y === doorY) ? 'door' : 'wall';
          }
        }
      }
    }
  }
}

// ── Phase 4b: Hall endpoint doors ──
// Each hall end should have either an outer wall or a door to whatever is beyond.

function placeHallEndDoors(grid: Grid, halls: Hall[]) {
  for (const hall of halls) {
    const r = hall.rect;

    if (hall.orientation === 'vertical') {
      // Top end: wall row at y=r.y-1, check if hall/floor at y=r.y-2
      tryPlaceEndDoor(grid, r.x, r.w, r.y - 1, r.y - 2, true);
      // Bottom end: wall row at y=r.y+r.h, check beyond at y=r.y+r.h+1
      tryPlaceEndDoor(grid, r.x, r.w, r.y + r.h, r.y + r.h + 1, true);
    } else {
      // Left end: wall col at x=r.x-1, check beyond at x=r.x-2
      tryPlaceEndDoor(grid, r.y, r.h, r.x - 1, r.x - 2, false);
      // Right end: wall col at x=r.x+r.w, check beyond at x=r.x+r.w+1
      tryPlaceEndDoor(grid, r.y, r.h, r.x + r.w, r.x + r.w + 1, false);
    }
  }
}

function tryPlaceEndDoor(
  grid: Grid, start: number, len: number,
  wallPos: number, beyondPos: number, horizontal: boolean
) {
  const candidates: { x: number; y: number }[] = [];

  for (let i = start; i < start + len; i++) {
    const wx = horizontal ? i : wallPos;
    const wy = horizontal ? wallPos : i;
    const bx = horizontal ? i : beyondPos;
    const by = horizontal ? beyondPos : i;

    if (wx < 0 || wx >= grid.w || wy < 0 || wy >= grid.h) continue;
    if (bx < 0 || bx >= grid.w || by < 0 || by >= grid.h) continue;

    if (grid.cells[wy][wx] === 'wall') {
      const bc = grid.cells[by][bx];
      if (bc === 'hall' || bc === 'floor') {
        candidates.push({ x: wx, y: wy });
      }
    }
  }

  if (candidates.length > 0) {
    const pos = candidates[Math.floor(Math.random() * candidates.length)];
    grid.cells[pos.y][pos.x] = 'door';
  }
}

// ── Phase 5: Door placement (step 4) ──

function findDoorToHall(grid: Grid, room: RoomDef, hall: Hall): { x: number; y: number } | null {
  const rr = room.rect;
  const hr = hall.rect;

  // Collect wall cells between room and hall
  const candidates: { x: number; y: number }[] = [];

  // Check right edge of room → left edge of hall
  if (rr.x + rr.w <= hr.x && rr.x + rr.w + 1 >= hr.x) {
    const wallX = rr.x + rr.w; // wall column between them
    const minY = Math.max(rr.y, hr.y);
    const maxY = Math.min(rr.y + rr.h, hr.y + hr.h);
    for (let y = minY; y < maxY; y++) {
      if (wallX >= 0 && wallX < grid.w && y >= 0 && y < grid.h && grid.cells[y][wallX] === 'wall') {
        candidates.push({ x: wallX, y });
      }
    }
  }
  // Check left edge of room → right edge of hall
  if (hr.x + hr.w <= rr.x && hr.x + hr.w + 1 >= rr.x) {
    const wallX = rr.x - 1;
    const minY = Math.max(rr.y, hr.y);
    const maxY = Math.min(rr.y + rr.h, hr.y + hr.h);
    for (let y = minY; y < maxY; y++) {
      if (wallX >= 0 && wallX < grid.w && y >= 0 && y < grid.h && grid.cells[y][wallX] === 'wall') {
        candidates.push({ x: wallX, y });
      }
    }
  }
  // Check bottom edge of room → top edge of hall
  if (rr.y + rr.h <= hr.y && rr.y + rr.h + 1 >= hr.y) {
    const wallY = rr.y + rr.h;
    const minX = Math.max(rr.x, hr.x);
    const maxX = Math.min(rr.x + rr.w, hr.x + hr.w);
    for (let x = minX; x < maxX; x++) {
      if (wallY >= 0 && wallY < grid.h && x >= 0 && x < grid.w && grid.cells[wallY][x] === 'wall') {
        candidates.push({ x, y: wallY });
      }
    }
  }
  // Check top edge of room → bottom edge of hall
  if (hr.y + hr.h <= rr.y && hr.y + hr.h + 1 >= rr.y) {
    const wallY = rr.y - 1;
    const minX = Math.max(rr.x, hr.x);
    const maxX = Math.min(rr.x + rr.w, hr.x + hr.w);
    for (let x = minX; x < maxX; x++) {
      if (wallY >= 0 && wallY < grid.h && x >= 0 && x < grid.w && grid.cells[wallY][x] === 'wall') {
        candidates.push({ x, y: wallY });
      }
    }
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function findDoorBetweenRooms(grid: Grid, a: RoomDef, b: RoomDef): { x: number; y: number } | null {
  const ar = a.rect, br = b.rect;
  const candidates: { x: number; y: number }[] = [];

  // Check all four adjacency directions (with 1-cell wall gap)
  // a right → b left
  if (ar.x + ar.w + 1 === br.x) {
    const wallX = ar.x + ar.w;
    const minY = Math.max(ar.y, br.y);
    const maxY = Math.min(ar.y + ar.h, br.y + br.h);
    for (let y = minY; y < maxY; y++) {
      if (wallX >= 0 && wallX < grid.w && y >= 0 && y < grid.h && grid.cells[y][wallX] === 'wall') {
        candidates.push({ x: wallX, y });
      }
    }
  }
  // b right → a left
  if (br.x + br.w + 1 === ar.x) {
    const wallX = br.x + br.w;
    const minY = Math.max(ar.y, br.y);
    const maxY = Math.min(ar.y + ar.h, br.y + br.h);
    for (let y = minY; y < maxY; y++) {
      if (wallX >= 0 && wallX < grid.w && y >= 0 && y < grid.h && grid.cells[y][wallX] === 'wall') {
        candidates.push({ x: wallX, y });
      }
    }
  }
  // a bottom → b top
  if (ar.y + ar.h + 1 === br.y) {
    const wallY = ar.y + ar.h;
    const minX = Math.max(ar.x, br.x);
    const maxX = Math.min(ar.x + ar.w, br.x + br.w);
    for (let x = minX; x < maxX; x++) {
      if (wallY >= 0 && wallY < grid.h && x >= 0 && x < grid.w && grid.cells[wallY][x] === 'wall') {
        candidates.push({ x, y: wallY });
      }
    }
  }
  // b bottom → a top
  if (br.y + br.h + 1 === ar.y) {
    const wallY = br.y + br.h;
    const minX = Math.max(ar.x, br.x);
    const maxX = Math.min(ar.x + ar.w, br.x + br.w);
    for (let x = minX; x < maxX; x++) {
      if (wallY >= 0 && wallY < grid.h && x >= 0 && x < grid.w && grid.cells[wallY][x] === 'wall') {
        candidates.push({ x, y: wallY });
      }
    }
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function placeDoors(grid: Grid, rooms: RoomDef[], halls: Hall[]) {
  const hallMap = new Map(halls.map(h => [h.id, h]));

  // Each room gets one door to its parent hall
  for (const room of rooms) {
    const hall = hallMap.get(room.parentHallId);
    if (!hall) continue;
    const pos = findDoorToHall(grid, room, hall);
    if (pos) {
      grid.cells[pos.y][pos.x] = 'door';
    }
  }

  // Extra doors between adjacent rooms (same parent hall = siblings)
  const byHall = new Map<number, RoomDef[]>();
  for (const room of rooms) {
    if (!byHall.has(room.parentHallId)) byHall.set(room.parentHallId, []);
    byHall.get(room.parentHallId)!.push(room);
  }

  for (const siblings of byHall.values()) {
    for (let i = 0; i < siblings.length; i++) {
      if (Math.random() >= PARAMS.extraDoor) continue;
      // Try to find an adjacent sibling
      for (let j = 0; j < siblings.length; j++) {
        if (i === j) continue;
        const pos = findDoorBetweenRooms(grid, siblings[i], siblings[j]);
        if (pos) {
          grid.cells[pos.y][pos.x] = 'door';
          break;
        }
      }
    }
  }
}

// ── Phase 6: Interfaces (steps 5–6) ──

interface EdgeRegion {
  kind: 'hall' | 'room';
  id: number;
  yMin: number;
  yMax: number; // inclusive
}

function collectEdgeRegions(halls: Hall[], rooms: RoomDef[], mapRect: Rect, side: 'left' | 'right'): EdgeRegion[] {
  const regions: EdgeRegion[] = [];

  for (const hall of halls) {
    const touches = side === 'left'
      ? hall.rect.x === mapRect.x
      : hall.rect.x + hall.rect.w === mapRect.x + mapRect.w;
    if (touches) {
      regions.push({ kind: 'hall', id: hall.id, yMin: hall.rect.y, yMax: hall.rect.y + hall.rect.h - 1 });
    }
  }

  for (const room of rooms) {
    const touches = side === 'left'
      ? room.rect.x === mapRect.x
      : room.rect.x + room.rect.w === mapRect.x + mapRect.w;
    if (touches) {
      regions.push({ kind: 'room', id: room.id, yMin: room.rect.y, yMax: room.rect.y + room.rect.h - 1 });
    }
  }

  return regions;
}

function fallbackEdgeY(grid: Grid, _wallX: number, innerX: number): number | null {
  // Scan for any walkable cell on the inner column, return its y
  const candidates: number[] = [];
  for (let y = 1; y < grid.h - 1; y++) {
    const c = grid.cells[y][innerX];
    if (c === 'floor' || c === 'hall') {
      candidates.push(y);
    }
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function placeInterfaces(grid: Grid, halls: Hall[], rooms: RoomDef[], mapRect: Rect) {
  // --- Left wall (x=0): place 1 entry interface ---
  const leftRegions = collectEdgeRegions(halls, rooms, mapRect, 'left');

  if (leftRegions.length > 0) {
    const region = leftRegions[Math.floor(Math.random() * leftRegions.length)];
    const y = randInt(region.yMin, region.yMax);
    if (y >= 0 && y < grid.h) {
      grid.cells[y][0] = 'interface';
    }
  } else {
    // Fallback: find any walkable cell adjacent to left wall
    const y = fallbackEdgeY(grid, 0, mapRect.x);
    if (y !== null) grid.cells[y][0] = 'interface';
  }

  // --- Right wall (x=gridW-1): place 1..numExitInterface exit interfaces, each in a separate region ---
  const rightRegions = collectEdgeRegions(halls, rooms, mapRect, 'right');
  const numExits = randInt(1, PARAMS.numExitInterface);
  const usedRegionIds = new Set<string>(); // "kind:id" to ensure separate regions

  // Shuffle regions for variety
  const shuffled = [...rightRegions].sort(() => Math.random() - 0.5);

  let placed = 0;
  for (const region of shuffled) {
    if (placed >= numExits) break;
    const key = `${region.kind}:${region.id}`;
    if (usedRegionIds.has(key)) continue;
    const y = randInt(region.yMin, region.yMax);
    if (y >= 0 && y < grid.h) {
      grid.cells[y][grid.w - 1] = 'interface';
      usedRegionIds.add(key);
      placed++;
    }
  }

  // Fallback: if we couldn't place enough from regions, scan for walkable cells
  if (placed < numExits) {
    const innerX = mapRect.x + mapRect.w - 1;
    for (let attempts = 0; attempts < 20 && placed < numExits; attempts++) {
      const y = fallbackEdgeY(grid, grid.w - 1, innerX);
      if (y !== null && grid.cells[y][grid.w - 1] !== 'interface') {
        grid.cells[y][grid.w - 1] = 'interface';
        placed++;
      }
    }
  }
}

// ── Phase 6b: Connectivity guarantee (left interface → all right interfaces) ──

function floodFill(grid: Grid, startX: number, startY: number): Set<string> {
  const visited = new Set<string>();
  const queue: { x: number; y: number }[] = [{ x: startX, y: startY }];
  visited.add(`${startX},${startY}`);

  while (queue.length > 0) {
    const { x, y } = queue.shift()!;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy;
      const key = `${nx},${ny}`;
      if (nx < 0 || nx >= grid.w || ny < 0 || ny >= grid.h) continue;
      if (visited.has(key)) continue;
      const c = grid.cells[ny][nx];
      if (c === 'floor' || c === 'hall' || c === 'door' || c === 'interface') {
        visited.add(key);
        queue.push({ x: nx, y: ny });
      }
    }
  }

  return visited;
}

function ensureConnectivity(grid: Grid, rooms: RoomDef[]) {
  // Find left interface
  let leftInterface: { x: number; y: number } | null = null;
  for (let y = 0; y < grid.h; y++) {
    if (grid.cells[y][0] === 'interface') { leftInterface = { x: 0, y }; break; }
  }
  if (!leftInterface) return;

  // Repeat: flood from left interface, find any interior wall cell that separates
  // reachable from unreachable walkable cells, place a door, re-flood.
  for (let pass = 0; pass < 50; pass++) {
    const reachable = floodFill(grid, leftInterface.x, leftInterface.y);

    // Check if all rooms are reachable
    let allReachable = true;
    for (const room of rooms) {
      const r = room.rect;
      let found = false;
      for (let ry = r.y; ry < r.y + r.h && !found; ry++) {
        for (let rx = r.x; rx < r.x + r.w && !found; rx++) {
          if (reachable.has(`${rx},${ry}`)) found = true;
        }
      }
      if (!found) { allReachable = false; break; }
    }

    // Also check right interfaces
    if (allReachable) {
      for (let y = 0; y < grid.h; y++) {
        if (grid.cells[y][grid.w - 1] === 'interface' && !reachable.has(`${grid.w - 1},${y}`)) {
          allReachable = false;
          break;
        }
      }
    }

    if (allReachable) break;

    // Find an interior wall cell that has a reachable walkable neighbor on one side
    // and an unreachable walkable neighbor on the other side
    let placed = false;
    for (let y = 1; y < grid.h - 1 && !placed; y++) {
      for (let x = 1; x < grid.w - 1 && !placed; x++) {
        if (grid.cells[y][x] !== 'wall') continue;
        let adjReachable = false;
        let adjUnreachable = false;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= grid.w || ny < 0 || ny >= grid.h) continue;
          const c = grid.cells[ny][nx];
          if (c === 'floor' || c === 'hall' || c === 'door' || c === 'interface') {
            const key = `${nx},${ny}`;
            if (reachable.has(key)) adjReachable = true;
            else adjUnreachable = true;
          }
        }
        if (adjReachable && adjUnreachable) {
          grid.cells[y][x] = 'door';
          placed = true;
        }
      }
    }

    if (!placed) break; // No wall separates the components — shouldn't happen
  }
}

// ── Phase 7: Box-drawing wall glyphs (adapted from src/cluster.ts) ──

function isOuterWall(grid: Grid, y: number, x: number): boolean {
  // A wall is "outer" if it's on the grid boundary or adjacent to void
  if (y === 0 || y === grid.h - 1 || x === 0 || x === grid.w - 1) return true;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const ny = y + dy, nx = x + dx;
    if (ny >= 0 && ny < grid.h && nx >= 0 && nx < grid.w) {
      if (grid.cells[ny][nx] === 'void') return true;
    }
  }
  return false;
}

function wallGlyph(grid: Grid, x: number, y: number, outer: boolean): string {
  const isWall = (ty: number, tx: number) => {
    if (ty < 0 || ty >= grid.h || tx < 0 || tx >= grid.w) return true;
    const c = grid.cells[ty][tx];
    return c === 'wall' || c === 'door' || c === 'interface';
  };

  const n = isWall(y - 1, x);
  const s = isWall(y + 1, x);
  const e = isWall(y, x + 1);
  const w = isWall(y, x - 1);

  if (outer) {
    if (n && s && e && w) return '╬';
    if (n && s && e) return '╠';
    if (n && s && w) return '╣';
    if (n && e && w) return '╩';
    if (s && e && w) return '╦';
    if (n && s) return '║';
    if (e && w) return '═';
    if (s && e) return '╔';
    if (s && w) return '╗';
    if (n && e) return '╚';
    if (n && w) return '╝';
    if (n || s) return '║';
    return '═';
  }

  // Mixed junctions: inner wall meeting outer wall neighbor
  const nOuter = isOuterWall(grid, y - 1, x) && isWall(y - 1, x);
  const sOuter = isOuterWall(grid, y + 1, x) && isWall(y + 1, x);
  const eOuter = isOuterWall(grid, y, x + 1) && isWall(y, x + 1);
  const wOuter = isOuterWall(grid, y, x - 1) && isWall(y, x - 1);

  if (nOuter || sOuter) {
    if (e && w) return nOuter ? '╤' : '╧';
  }
  if (eOuter || wOuter) {
    if (n && s) return eOuter ? '╟' : '╢';
  }

  if (n && s && e && w) return '┼';
  if (n && s && e) return '├';
  if (n && s && w) return '┤';
  if (n && e && w) return '┴';
  if (s && e && w) return '┬';
  if (n && s) return '│';
  if (e && w) return '─';
  if (s && e) return '┌';
  if (s && w) return '┐';
  if (n && e) return '└';
  if (n && w) return '┘';
  if (n || s) return '│';
  return '─';
}

// ── Rendering ──

function renderGrid(grid: Grid): string {
  const lines: string[] = [];
  for (let y = 0; y < grid.h; y++) {
    let line = '';
    for (let x = 0; x < grid.w; x++) {
      const cell = grid.cells[y][x];
      switch (cell) {
        case 'floor': line += '·'; break;
        case 'hall':  line += '·'; break;
        case 'door':  line += '+'; break;
        case 'interface': line += '⇋'; break;
        case 'wall': {
          const outer = isOuterWall(grid, y, x);
          line += wallGlyph(grid, x, y, outer);
          break;
        }
        default: line += ' '; break;
      }
    }
    lines.push(line);
  }
  return lines.join('\n');
}

// ── Full generation ──

const PAD = 1; // 1-cell border padding for outer walls

function generate(): { grid: Grid; rooms: RoomDef[]; halls: Hall[] } {
  // Reset IDs
  nextHallId = 0;
  nextRoomId = 0;

  // Interior rect (inside the outer wall border)
  const mapRect: Rect = { x: PAD, y: PAD, w: PARAMS.gridW - 2 * PAD, h: PARAMS.gridH - 2 * PAD };

  // Phase 1: Build hall tree
  const { halls, pendingBlocks } = buildHallTree(mapRect);

  // Phase 2: Subdivide blocks into rooms
  const rooms = processBlocks(pendingBlocks, mapRect);

  // Phase 2b: Merge small rooms (eliminate dimension < 2)
  mergeSmallRooms(rooms);

  // Phase 3: Carve to grid
  const grid = createGrid();

  // Place outer wall border first
  for (let x = 0; x < grid.w; x++) { grid.cells[0][x] = 'wall'; grid.cells[grid.h - 1][x] = 'wall'; }
  for (let y = 0; y < grid.h; y++) { grid.cells[y][0] = 'wall'; grid.cells[y][grid.w - 1] = 'wall'; }

  carveToGrid(grid, halls, rooms);

  // Phase 4: Cut halls
  cutHalls(grid, halls);

  // Phase 4b: Hall endpoint doors (connect halls to adjacent halls/rooms at their ends)
  placeHallEndDoors(grid, halls);

  // Phase 5: Place doors
  placeDoors(grid, rooms, halls);

  // Phase 6: Place interfaces
  placeInterfaces(grid, halls, rooms, mapRect);

  // Phase 6b: Ensure connectivity (left interface → all rooms & right interfaces)
  ensureConnectivity(grid, rooms);

  return { grid, rooms, halls };
}

// ── Exports (for testing) ──

export { generate, renderGrid, floodFill };
export type { Grid, RoomDef, Hall };

// ── Main: output to stdout ──
// Only runs when executed directly: npx tsx scripts/gen-halls.ts [count]

if (import.meta.url === `file://${process.argv[1]}`) {
  const numSamples = parseInt(process.argv[2] || '5', 10);

  for (let i = 0; i < numSamples; i++) {
    const { grid, rooms, halls } = generate();
    console.log(`=== Hall-BSP Sample ${i + 1} (${rooms.length} rooms, ${halls.length} halls) ===`);
    console.log(renderGrid(grid));
    console.log('');
  }
}
