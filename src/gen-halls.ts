// Hall-first BSP room generator for game use
//
// Algorithm:
//   1. Recursively split space with halls (corridors) as primary structure
//   2. Subdivide remaining blocks into rooms
//   3. Cut halls with walls+doors for chokepoints
//   4. Connect rooms to halls with doors, add extra room-to-room doors
//   5. Place interface exits on left/right outer walls
//   6. Ensure full connectivity from left interface to all rooms

import { CLUSTER_WIDTH, CLUSTER_HEIGHT } from './types';
import { random, randInt as rngRandInt } from './rng';

// ── Types ──

export interface Rect {
  x: number; y: number; w: number; h: number;
}

export interface Hall {
  id: number;
  rect: Rect;
  orientation: 'vertical' | 'horizontal';
}

export interface RoomDef {
  id: number;
  rect: Rect;
  parentHallId: number;
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

export type CellType = 'void' | 'floor' | 'wall' | 'hall' | 'door' | 'interface';

export interface Grid {
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
  smallBlockHallChance: number;
}

const PARAMS: GenParams = {
  gridW: CLUSTER_WIDTH,
  gridH: CLUSTER_HEIGHT,
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

const randInt = rngRandInt;

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
  left: Rect;
  right: Rect;
}

function splitWithHall(block: Rect, orientation: 'vertical' | 'horizontal'): SplitResult | null {
  const hallFloor = randInt(PARAMS.minHallWidth, PARAMS.maxHallWidth);
  const totalCut = hallFloor + 2;
  const minEdge = PARAMS.minRoomSize;

  if (orientation === 'vertical') {
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

    const mustSplit = block.w > maxBlockSize && block.h > maxBlockSize;
    const canSplit = !mustSplit && random() < PARAMS.smallBlockHallChance;
    if (mustSplit || canSplit) {
      const orientation = mustSplit
        ? (random() < 0.5 ? 'vertical' as const : 'horizontal' as const)
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

  const horizontal = block.w >= block.h;

  if (horizontal) {
    let cursor = block.x;
    const end = block.x + block.w;
    while (cursor < end) {
      const remaining = end - cursor;
      if (remaining < min * 2 + 1) {
        if (remaining >= min) {
          rooms.push({ id: nextRoomId++, rect: { x: cursor, y: block.y, w: remaining, h: block.h }, parentHallId });
        }
        break;
      }
      const size = randInt(min, Math.min(max, remaining - min - 1));
      rooms.push({ id: nextRoomId++, rect: { x: cursor, y: block.y, w: size, h: block.h }, parentHallId });
      cursor += size + 1;
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

    if (block.w < 1 || block.h < 1) continue;

    if (isAdjacentToOuter(block, mapRect)) {
      const rooms = subdivideAlongLongest(block, item.parentHallId);
      allRooms.push(...rooms);
      item.assignTo({ kind: 'rooms', rooms, parentHallId: item.parentHallId });
    } else {
      const min = PARAMS.minRoomSize;
      const canSubdivide = block.w >= min * 2 + 1 || block.h >= min * 2 + 1;

      if (canSubdivide) {
        const rooms = subdivideAlongLongest(block, item.parentHallId);
        allRooms.push(...rooms);
        item.assignTo({ kind: 'rooms', rooms, parentHallId: item.parentHallId });
      } else if (block.w >= min && block.h >= min) {
        const room: RoomDef = { id: nextRoomId++, rect: { ...block }, parentHallId: item.parentHallId };
        allRooms.push(room);
        item.assignTo({ kind: 'rooms', rooms: [room], parentHallId: item.parentHallId });
      }
    }
  }

  return allRooms;
}

// ── Phase 2b: Merge small rooms ──

function tryMergeRects(a: Rect, b: Rect): Rect | null {
  if (a.y === b.y && a.h === b.h) {
    if (a.x + a.w + 1 === b.x) return { x: a.x, y: a.y, w: b.x + b.w - a.x, h: a.h };
    if (b.x + b.w + 1 === a.x) return { x: b.x, y: b.y, w: a.x + a.w - b.x, h: b.h };
  }
  if (a.x === b.x && a.w === b.w) {
    if (a.y + a.h + 1 === b.y) return { x: a.x, y: a.y, w: a.w, h: b.y + b.h - a.y };
    if (b.y + b.h + 1 === a.y) return { x: b.x, y: b.y, w: b.w, h: a.y + a.h - b.y };
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

      let bestJ = -1;
      let bestRect: Rect | null = null;

      for (let j = 0; j < rooms.length; j++) {
        if (i === j) continue;
        const result = tryMergeRects(r.rect, rooms[j].rect);
        if (result) {
          bestJ = j;
          bestRect = result;
          if (rooms[j].parentHallId === r.parentHallId) break;
        }
      }

      if (bestJ >= 0 && bestRect) {
        rooms[bestJ].rect = bestRect;
        rooms.splice(i, 1);
        changed = true;
        break;
      } else {
        if (r.rect.w < 2) r.rect.w = 2;
        if (r.rect.h < 2) r.rect.h = 2;
      }
    }
  }
  return rooms;
}

// ── Phase 3: Carve to grid ──

function carveToGrid(grid: Grid, halls: Hall[], rooms: RoomDef[]) {
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

// ── Phase 4: Hall cuts ──

function cutHalls(grid: Grid, halls: Hall[]) {
  for (const hall of halls) {
    if (random() >= PARAMS.cutPercentage) continue;
    const r = hall.rect;

    for (let cut = 0; cut < PARAMS.cutTimes; cut++) {
      if (hall.orientation === 'vertical') {
        if (r.h < 3) continue;
        const cutY = randInt(r.y + 1, r.y + r.h - 2);
        const doorX = randInt(r.x, r.x + r.w - 1);
        for (let x = r.x; x < r.x + r.w; x++) {
          if (x >= 0 && x < grid.w && cutY >= 0 && cutY < grid.h) {
            grid.cells[cutY][x] = (x === doorX) ? 'door' : 'wall';
          }
        }
      } else {
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

function placeHallEndDoors(grid: Grid, halls: Hall[]) {
  for (const hall of halls) {
    const r = hall.rect;
    if (hall.orientation === 'vertical') {
      tryPlaceEndDoor(grid, r.x, r.w, r.y - 1, r.y - 2, true);
      tryPlaceEndDoor(grid, r.x, r.w, r.y + r.h, r.y + r.h + 1, true);
    } else {
      tryPlaceEndDoor(grid, r.y, r.h, r.x - 1, r.x - 2, false);
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
    const pos = candidates[Math.floor(random() * candidates.length)];
    grid.cells[pos.y][pos.x] = 'door';
  }
}

// ── Phase 5: Door placement ──

function findDoorToHall(grid: Grid, room: RoomDef, hall: Hall): { x: number; y: number } | null {
  const rr = room.rect;
  const hr = hall.rect;
  const candidates: { x: number; y: number }[] = [];

  if (rr.x + rr.w <= hr.x && rr.x + rr.w + 1 >= hr.x) {
    const wallX = rr.x + rr.w;
    const minY = Math.max(rr.y, hr.y);
    const maxY = Math.min(rr.y + rr.h, hr.y + hr.h);
    for (let y = minY; y < maxY; y++) {
      if (wallX >= 0 && wallX < grid.w && y >= 0 && y < grid.h && grid.cells[y][wallX] === 'wall') {
        candidates.push({ x: wallX, y });
      }
    }
  }
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
  return candidates[Math.floor(random() * candidates.length)];
}

function findDoorBetweenRooms(grid: Grid, a: RoomDef, b: RoomDef): { x: number; y: number } | null {
  const ar = a.rect, br = b.rect;
  const candidates: { x: number; y: number }[] = [];

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
  return candidates[Math.floor(random() * candidates.length)];
}

function placeDoors(grid: Grid, rooms: RoomDef[], halls: Hall[]) {
  const hallMap = new Map(halls.map(h => [h.id, h]));

  for (const room of rooms) {
    const hall = hallMap.get(room.parentHallId);
    if (!hall) continue;
    const pos = findDoorToHall(grid, room, hall);
    if (pos) grid.cells[pos.y][pos.x] = 'door';
  }

  const byHall = new Map<number, RoomDef[]>();
  for (const room of rooms) {
    if (!byHall.has(room.parentHallId)) byHall.set(room.parentHallId, []);
    byHall.get(room.parentHallId)!.push(room);
  }

  for (const siblings of byHall.values()) {
    for (let i = 0; i < siblings.length; i++) {
      if (random() >= PARAMS.extraDoor) continue;
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

// ── Phase 6: Interfaces ──

interface EdgeRegion {
  kind: 'hall' | 'room';
  id: number;
  yMin: number;
  yMax: number;
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

function fallbackEdgeY(grid: Grid, innerX: number): number | null {
  const candidates: number[] = [];
  for (let y = 1; y < grid.h - 1; y++) {
    const c = grid.cells[y][innerX];
    if (c === 'floor' || c === 'hall') candidates.push(y);
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(random() * candidates.length)];
}

function placeInterfaces(grid: Grid, halls: Hall[], rooms: RoomDef[], mapRect: Rect) {
  const leftRegions = collectEdgeRegions(halls, rooms, mapRect, 'left');

  if (leftRegions.length > 0) {
    const region = leftRegions[Math.floor(random() * leftRegions.length)];
    const y = randInt(region.yMin, region.yMax);
    if (y >= 0 && y < grid.h) grid.cells[y][0] = 'interface';
  } else {
    const y = fallbackEdgeY(grid, mapRect.x);
    if (y !== null) grid.cells[y][0] = 'interface';
  }

  const rightRegions = collectEdgeRegions(halls, rooms, mapRect, 'right');
  const numExits = randInt(1, PARAMS.numExitInterface);
  const usedRegionIds = new Set<string>();
  const shuffled = [...rightRegions].sort(() => random() - 0.5);

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

  if (placed < numExits) {
    const innerX = mapRect.x + mapRect.w - 1;
    for (let attempts = 0; attempts < 20 && placed < numExits; attempts++) {
      const y = fallbackEdgeY(grid, innerX);
      if (y !== null && grid.cells[y][grid.w - 1] !== 'interface') {
        grid.cells[y][grid.w - 1] = 'interface';
        placed++;
      }
    }
  }
}

// ── Phase 6b: Connectivity guarantee ──

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
  let leftInterface: { x: number; y: number } | null = null;
  for (let y = 0; y < grid.h; y++) {
    if (grid.cells[y][0] === 'interface') { leftInterface = { x: 0, y }; break; }
  }
  if (!leftInterface) return;

  for (let pass = 0; pass < 50; pass++) {
    const reachable = floodFill(grid, leftInterface.x, leftInterface.y);

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

    if (allReachable) {
      for (let y = 0; y < grid.h; y++) {
        if (grid.cells[y][grid.w - 1] === 'interface' && !reachable.has(`${grid.w - 1},${y}`)) {
          allReachable = false;
          break;
        }
      }
    }

    if (allReachable) break;

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

    if (!placed) break;
  }
}

// ── Full generation ──

const PAD = 1;

export function generate(): { grid: Grid; rooms: RoomDef[]; halls: Hall[] } {
  nextHallId = 0;
  nextRoomId = 0;

  const mapRect: Rect = { x: PAD, y: PAD, w: PARAMS.gridW - 2 * PAD, h: PARAMS.gridH - 2 * PAD };

  const { halls, pendingBlocks } = buildHallTree(mapRect);
  const rooms = processBlocks(pendingBlocks, mapRect);
  mergeSmallRooms(rooms);

  const grid = createGrid();
  for (let x = 0; x < grid.w; x++) { grid.cells[0][x] = 'wall'; grid.cells[grid.h - 1][x] = 'wall'; }
  for (let y = 0; y < grid.h; y++) { grid.cells[y][0] = 'wall'; grid.cells[y][grid.w - 1] = 'wall'; }

  carveToGrid(grid, halls, rooms);
  cutHalls(grid, halls);
  placeHallEndDoors(grid, halls);
  placeDoors(grid, rooms, halls);
  placeInterfaces(grid, halls, rooms, mapRect);
  ensureConnectivity(grid, rooms);

  return { grid, rooms, halls };
}
