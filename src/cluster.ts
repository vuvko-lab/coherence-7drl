import {
  Cluster, Tile, TileType, Room, Position, InterfaceExit,
  RoomType, CorruptionStage,
  CLUSTER_WIDTH, CLUSTER_HEIGHT, COLORS,
} from './types';

// ── Constants ──

const PAD = 1; // void padding around the map
const IX = PAD;
const IY = PAD;
const IW = CLUSTER_WIDTH - 2 * PAD;
const IH = CLUSTER_HEIGHT - 2 * PAD;
const MIN_ROOM_DIM = 3; // minimum interior dimension (excluding walls)
const CORRIDOR_CHANCE = 0.20;
const CORRIDOR_WIDTH = 4; // includes walls → 2-tile interior (no 1-tile corridors)

/** Fraction of non-spanning-tree room pairs that get extra doors (creates loops).
 *  Tuned via graph-stats sweep: 0.5 hits MVC≥2 in 62% of clusters, avg degree ~3. */
let EXTRA_DOOR_CHANCE = 0.5;
export function setExtraDoorChance(v: number) { EXTRA_DOOR_CHANCE = v; }
export function getExtraDoorChance() { return EXTRA_DOOR_CHANCE; }

// ── RNG helpers ──

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Tile factories ──

function makeTile(type: TileType, glyph: string, fg: string, roomId = -1): Tile {
  const walkable = type === TileType.Floor || type === TileType.Door || type === TileType.InterfaceExit;
  const transparent = type !== TileType.Wall;
  return {
    type, glyph, fg,
    bg: COLORS.bg,
    walkable, transparent,
    roomId,
    visible: false,
    seen: false,
  };
}

function voidTile(): Tile {
  return makeTile(TileType.Void, ' ', COLORS.void);
}

function floorTile(roomId: number): Tile {
  return makeTile(TileType.Floor, '·', COLORS.floorFg, roomId);
}

function doorTile(roomId: number): Tile {
  return makeTile(TileType.Door, '+', COLORS.door, roomId);
}

function interfaceTile(): Tile {
  return makeTile(TileType.InterfaceExit, '⇋', COLORS.interfaceExit);
}

// ── Intermediate cell grid for generation ──

type Cell = 'floor' | 'wall' | 'door' | 'void';
type CellGrid = Cell[][];

function createCellGrid(): CellGrid {
  const grid: CellGrid = [];
  for (let y = 0; y < CLUSTER_HEIGHT; y++) {
    grid[y] = [];
    for (let x = 0; x < CLUSTER_WIDTH; x++) {
      grid[y][x] = 'void';
    }
  }
  return grid;
}

// ── Recursive division ──

function carveRoom(grid: CellGrid, x: number, y: number, w: number, h: number) {
  for (let ry = y; ry < y + h; ry++) {
    for (let rx = x; rx < x + w; rx++) {
      if (ry < 0 || ry >= CLUSTER_HEIGHT || rx < 0 || rx >= CLUSTER_WIDTH) continue;
      if (ry === y || ry === y + h - 1 || rx === x || rx === x + w - 1) {
        if (grid[ry][rx] !== 'floor' && grid[ry][rx] !== 'door') {
          grid[ry][rx] = 'wall';
        }
      } else {
        grid[ry][rx] = 'floor';
      }
    }
  }
}

// ── Post-process door placement ──
// Scans for wall cells that have floor on both sides (valid door positions),
// groups them by the room pair they connect, and places 1-2 doors per pair.

function placeDoors(grid: CellGrid, rooms: Room[]): Map<number, number[]> {
  const adjacency = new Map<number, number[]>();
  for (const room of rooms) adjacency.set(room.id, []);
  // Build room ID lookup from room rects
  const roomIdAt: number[][] = [];
  for (let y = 0; y < CLUSTER_HEIGHT; y++) {
    roomIdAt[y] = new Array(CLUSTER_WIDTH).fill(-1);
  }
  for (const room of rooms) {
    for (let ry = room.y + 1; ry < room.y + room.h - 1; ry++) {
      for (let rx = room.x + 1; rx < room.x + room.w - 1; rx++) {
        if (ry >= 0 && ry < CLUSTER_HEIGHT && rx >= 0 && rx < CLUSTER_WIDTH) {
          roomIdAt[ry][rx] = room.id;
        }
      }
    }
  }

  // Find all valid door candidates, grouped by the room pair they connect
  const pairCandidates = new Map<string, { x: number; y: number }[]>();

  for (let y = IY + 1; y < IY + IH - 1; y++) {
    for (let x = IX + 1; x < IX + IW - 1; x++) {
      if (grid[y][x] !== 'wall') continue;

      // Horizontal door: floor left & right, wall up & down
      if (grid[y][x - 1] === 'floor' && grid[y][x + 1] === 'floor' &&
          (grid[y - 1][x] === 'wall') && (grid[y + 1][x] === 'wall')) {
        const idL = roomIdAt[y][x - 1];
        const idR = roomIdAt[y][x + 1];
        if (idL >= 0 && idR >= 0 && idL !== idR) {
          const key = `${Math.min(idL, idR)}-${Math.max(idL, idR)}`;
          if (!pairCandidates.has(key)) pairCandidates.set(key, []);
          pairCandidates.get(key)!.push({ x, y });
        }
      }

      // Vertical door: floor up & down, wall left & right
      if (grid[y - 1][x] === 'floor' && grid[y + 1][x] === 'floor' &&
          (grid[y][x - 1] === 'wall') && (grid[y][x + 1] === 'wall')) {
        const idU = roomIdAt[y - 1][x];
        const idD = roomIdAt[y + 1][x];
        if (idU >= 0 && idD >= 0 && idU !== idD) {
          const key = `${Math.min(idU, idD)}-${Math.max(idU, idD)}`;
          if (!pairCandidates.has(key)) pairCandidates.set(key, []);
          pairCandidates.get(key)!.push({ x, y });
        }
      }
    }
  }

  // ── Spanning-tree door selection (maze-like connectivity) ──
  // Union-find
  const parent = new Map<number, number>();
  function find(x: number): number {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  }
  function union(a: number, b: number): boolean {
    const ra = find(a), rb = find(b);
    if (ra === rb) return false;
    parent.set(ra, rb);
    return true;
  }

  // Initialize all room ids in union-find
  for (const room of rooms) find(room.id);

  // Collect and shuffle all pair keys
  const allPairs = [...pairCandidates.keys()];
  for (let i = allPairs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allPairs[i], allPairs[j]] = [allPairs[j], allPairs[i]];
  }

  // Build spanning tree — guarantees all rooms are reachable
  const selectedPairs = new Set<string>();
  for (const key of allPairs) {
    const [idA, idB] = key.split('-').map(Number);
    if (union(idA, idB)) {
      selectedPairs.add(key);
    }
  }

  // Add extra connections from remaining pairs (loops / alternate paths)
  for (const key of allPairs) {
    if (selectedPairs.has(key)) continue;
    if (Math.random() < EXTRA_DOOR_CHANCE) {
      selectedPairs.add(key);
    }
  }

  // Only place doors for selected pairs
  for (const key of selectedPairs) {
    const candidates = pairCandidates.get(key)!;
    if (!candidates || candidates.length === 0) continue;

    const [idA, idB] = key.split('-').map(Number);

    // Place first door
    const idx1 = randInt(0, candidates.length - 1);
    const d1 = candidates[idx1];
    grid[d1.y][d1.x] = 'door';

    // Place second door for long shared walls
    if (candidates.length >= 6 && Math.random() < 0.4) {
      const idx2 = randInt(0, candidates.length - 1);
      const d2 = candidates[idx2];
      if (Math.abs(d2.x - d1.x) + Math.abs(d2.y - d1.y) > 3) {
        grid[d2.y][d2.x] = 'door';
      }
    }

    // Record adjacency
    if (!adjacency.get(idA)!.includes(idB)) adjacency.get(idA)!.push(idB);
    if (!adjacency.get(idB)!.includes(idA)) adjacency.get(idB)!.push(idA);
  }

  return adjacency;
}

function divide(
  grid: CellGrid, rooms: Room[],
  x: number, y: number, w: number, h: number,
  depth: number, nextId: { value: number },
) {
  const innerW = w - 2;
  const innerH = h - 2;
  const area = innerW * innerH;

  // Stop conditions
  if (innerW < MIN_ROOM_DIM || innerH < MIN_ROOM_DIM || area < 15) {
    carveRoom(grid, x, y, w, h);
    rooms.push({ id: nextId.value++, x, y, w, h, roomType: 'normal', containedHazards: new Set() });
    return;
  }

  // Medium rooms: chance to stop
  if (area < 40 && Math.random() > 0.6) {
    carveRoom(grid, x, y, w, h);
    rooms.push({ id: nextId.value++, x, y, w, h, roomType: 'normal', containedHazards: new Set() });
    return;
  }

  // Choose split direction: prefer longer axis
  const ratio = w / h;
  let splitH: boolean;
  if (ratio > 1.5) splitH = false;
  else if (ratio < 0.67) splitH = true;
  else splitH = Math.random() < 0.5;

  if (splitH) {
    const minSplit = y + MIN_ROOM_DIM + 1;
    const maxSplit = y + h - MIN_ROOM_DIM - 2;
    if (minSplit > maxSplit) {
      carveRoom(grid, x, y, w, h);
      rooms.push({ id: nextId.value++, x, y, w, h, roomType: 'normal', containedHazards: new Set() });
      return;
    }

    const splitAt = randInt(minSplit, maxSplit);

    // Corridor injection
    if (Math.random() < CORRIDOR_CHANCE && h > CORRIDOR_WIDTH + MIN_ROOM_DIM + 3) {
      const corrH = CORRIDOR_WIDTH;
      const corrY = splitAt;
      divide(grid, rooms, x, y, w, corrY - y + 1, depth + 1, nextId);
      carveRoom(grid, x, corrY, w, corrH);
      rooms.push({ id: nextId.value++, x, y: corrY, w, h: corrH, roomType: 'normal', containedHazards: new Set() });
      divide(grid, rooms, x, corrY + corrH - 1, w, y + h - (corrY + corrH - 1), depth + 1, nextId);
      return;
    }

    const topH = splitAt - y + 1;
    const botH = h - topH + 1;

    for (let rx = x; rx < x + w; rx++) {
      grid[splitAt][rx] = 'wall';
    }

    divide(grid, rooms, x, y, w, topH, depth + 1, nextId);
    divide(grid, rooms, x, splitAt, w, botH, depth + 1, nextId);
  } else {
    const minSplit = x + MIN_ROOM_DIM + 1;
    const maxSplit = x + w - MIN_ROOM_DIM - 2;
    if (minSplit > maxSplit) {
      carveRoom(grid, x, y, w, h);
      rooms.push({ id: nextId.value++, x, y, w, h, roomType: 'normal', containedHazards: new Set() });
      return;
    }

    const splitAt = randInt(minSplit, maxSplit);

    // Corridor injection
    if (Math.random() < CORRIDOR_CHANCE && w > CORRIDOR_WIDTH + MIN_ROOM_DIM + 3) {
      const corrW = CORRIDOR_WIDTH;
      const corrX = splitAt;
      divide(grid, rooms, x, y, corrX - x + 1, h, depth + 1, nextId);
      carveRoom(grid, corrX, y, corrW, h);
      rooms.push({ id: nextId.value++, x: corrX, y, w: corrW, h, roomType: 'normal', containedHazards: new Set() });
      divide(grid, rooms, corrX + corrW - 1, y, x + w - (corrX + corrW - 1), h, depth + 1, nextId);
      return;
    }

    const leftW = splitAt - x + 1;
    const rightW = w - leftW + 1;

    for (let ry = y; ry < y + h; ry++) {
      grid[ry][splitAt] = 'wall';
    }

    divide(grid, rooms, x, y, leftW, h, depth + 1, nextId);
    divide(grid, rooms, splitAt, y, rightW, h, depth + 1, nextId);
  }
}

// ── Wall glyph selection ──

function isOuterPos(y: number, x: number): boolean {
  return y === IY || y === IY + IH - 1 || x === IX || x === IX + IW - 1;
}

function wallGlyph(grid: CellGrid, x: number, y: number, outer: boolean): string {
  const isWall = (ty: number, tx: number) => {
    if (ty < 0 || ty >= CLUSTER_HEIGHT || tx < 0 || tx >= CLUSTER_WIDTH) return true;
    return grid[ty][tx] === 'wall' || grid[ty][tx] === 'door';
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

  // Mixed junction glyphs where inner meets outer
  const nOuter = isOuterPos(y - 1, x) && isWall(y - 1, x);
  const sOuter = isOuterPos(y + 1, x) && isWall(y + 1, x);
  const eOuter = isOuterPos(y, x + 1) && isWall(y, x + 1);
  const wOuter = isOuterPos(y, x - 1) && isWall(y, x - 1);

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

// ── Convert cell grid to tile grid ──

function cellGridToTiles(grid: CellGrid, rooms: Room[]): Tile[][] {
  const tiles: Tile[][] = [];

  // Build room lookup: for each floor cell, find which room it belongs to
  const roomMap: number[][] = [];
  for (let y = 0; y < CLUSTER_HEIGHT; y++) {
    roomMap[y] = new Array(CLUSTER_WIDTH).fill(-1);
  }
  for (const room of rooms) {
    for (let ry = room.y + 1; ry < room.y + room.h - 1; ry++) {
      for (let rx = room.x + 1; rx < room.x + room.w - 1; rx++) {
        if (ry >= 0 && ry < CLUSTER_HEIGHT && rx >= 0 && rx < CLUSTER_WIDTH) {
          roomMap[ry][rx] = room.id;
        }
      }
    }
  }

  for (let y = 0; y < CLUSTER_HEIGHT; y++) {
    tiles[y] = [];
    for (let x = 0; x < CLUSTER_WIDTH; x++) {
      const cell = grid[y][x];
      switch (cell) {
        case 'floor':
          tiles[y][x] = floorTile(roomMap[y][x]);
          break;
        case 'door':
          tiles[y][x] = doorTile(roomMap[y][x]);
          break;
        case 'wall': {
          const outer = isOuterPos(y, x);
          const glyph = wallGlyph(grid, x, y, outer);
          tiles[y][x] = makeTile(TileType.Wall, glyph, outer ? COLORS.wallOuter : COLORS.wall);
          break;
        }
        default:
          tiles[y][x] = voidTile();
          break;
      }
    }
  }

  return tiles;
}

// ── Interface exits ──

function placeInterfaceExits(tiles: Tile[][], rooms: Room[]): InterfaceExit[] {
  const exits: InterfaceExit[] = [];

  // Place exit on the right edge
  const rightEdgeRooms = rooms.filter(r => r.x + r.w >= IX + IW - 2);
  const exitRoom = rightEdgeRooms.length > 0 ? pick(rightEdgeRooms) : pick(rooms);
  const ey = Math.floor(exitRoom.y + exitRoom.h / 2);
  const ex = IX + IW - 1;

  tiles[ey][ex] = interfaceTile();
  // Dotted approach line
  if (ex - 1 >= 0 && tiles[ey][ex - 1].type === TileType.Wall) {
    tiles[ey][ex - 1] = makeTile(TileType.Floor, '┅', COLORS.interfaceExit);
    tiles[ey][ex - 1].walkable = true;
  }

  exits.push({
    position: { x: ex, y: ey },
    targetClusterId: -1,
    targetPosition: null,
  });

  return exits;
}

// ── Entry point ──

export function placeEntryPoint(tiles: Tile[][], rooms: Room[]): Position {
  const leftEdgeRooms = rooms.filter(r => r.x <= IX + 2);
  const entryRoom = leftEdgeRooms.length > 0 ? pick(leftEdgeRooms) : rooms[0];
  const ey = Math.floor(entryRoom.y + entryRoom.h / 2);

  // Carve approach from left outer wall to the room
  for (let x = IX; x <= entryRoom.x; x++) {
    if (tiles[ey][x].type === TileType.Wall || tiles[ey][x].type === TileType.Void) {
      tiles[ey][x] = makeTile(TileType.Floor, '┅', COLORS.interfaceExit);
      tiles[ey][x].walkable = true;
    }
  }

  return { x: entryRoom.x + 1, y: ey };
}

// ── Room type assignment ──

const HAZARD_WEIGHTS: { type: RoomType; weight: number }[] = [
  { type: 'corrupted', weight: 3 },
  { type: 'trigger_trap', weight: 2 },
  { type: 'memory_leak', weight: 2 },
  { type: 'firewall', weight: 1 },
  { type: 'unstable', weight: 3 },
  { type: 'quarantine', weight: 2 },
  { type: 'echo_chamber', weight: 1 },
  { type: 'gravity_well', weight: 2 },
];

function weightedPick(pool: { type: RoomType; weight: number }[]): RoomType {
  const total = pool.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * total;
  for (const entry of pool) {
    r -= entry.weight;
    if (r <= 0) return entry.type;
  }
  return pool[pool.length - 1].type;
}

function assignRoomTypes(
  rooms: Room[],
  _clusterId: number,
  _roomAdjacency: Map<number, number[]>,
) {
  // Find entry/exit rooms (leftmost/rightmost) — never make special
  const sortedByX = [...rooms].sort((a, b) => a.x - b.x);
  const entryRoom = sortedByX[0];
  const exitRoom = sortedByX[sortedByX.length - 1];
  const excludeIds = new Set([entryRoom.id, exitRoom.id]);

  // Filter candidates: min 3x3 interior (w>=5, h>=5 since walls take 2)
  const candidates = rooms.filter(r =>
    !excludeIds.has(r.id) &&
    (r.w - 2) >= 3 && (r.h - 2) >= 3
  );

  if (candidates.length === 0) return;

  // 1-3 special rooms per cluster
  const numSpecial = Math.min(candidates.length, randInt(1, 3));
  const usedTypes = new Set<RoomType>();
  const shuffled = candidates.sort(() => Math.random() - 0.5);

  for (let i = 0; i < numSpecial && i < shuffled.length; i++) {
    const available = HAZARD_WEIGHTS.filter(e => !usedTypes.has(e.type));
    if (available.length === 0) break;

    const type = weightedPick(available);
    usedTypes.add(type);
    shuffled[i].roomType = type;
  }
}

function initRoomHazards(tiles: Tile[][], rooms: Room[]) {
  for (const room of rooms) {
    if (room.roomType === 'normal') continue;

    const innerX1 = room.x + 1;
    const innerY1 = room.y + 1;
    const innerX2 = room.x + room.w - 2;
    const innerY2 = room.y + room.h - 2;

    switch (room.roomType) {
      case 'corrupted': {
        // Place 1-3 corruption seeds on random floor tiles
        const seedCount = randInt(1, 3);
        const corruptionTiles = new Map<string, CorruptionStage>();
        for (let s = 0; s < seedCount; s++) {
          const sx = randInt(innerX1, innerX2);
          const sy = randInt(innerY1, innerY2);
          const key = `${sx},${sy}`;
          corruptionTiles.set(key, 'degrading');
          tiles[sy][sx].hazardOverlay = { type: 'corruption', stage: 0 };
        }
        room.hazardState = { corruptionTiles, lastSpreadTick: 0 };
        break;
      }

      case 'trigger_trap': {
        const fuseLength = randInt(15, 25);
        room.hazardState = {
          fuseLength,
          ticksRemaining: fuseLength,
          activated: false,
          detonated: false,
        };
        // Dormant — no visual change until activated
        break;
      }

      case 'memory_leak': {
        // Place leak source on a random wall position
        room.hazardState = { floodLevel: 0 };
        // Mark a wall tile as the leak source (visual only)
        const wallSide = randInt(0, 3);
        let lx: number, ly: number;
        switch (wallSide) {
          case 0: lx = randInt(innerX1, innerX2); ly = room.y; break;       // top
          case 1: lx = randInt(innerX1, innerX2); ly = room.y + room.h - 1; break; // bottom
          case 2: lx = room.x; ly = randInt(innerY1, innerY2); break;       // left
          default: lx = room.x + room.w - 1; ly = randInt(innerY1, innerY2); break; // right
        }
        if (tiles[ly]?.[lx]) {
          tiles[ly][lx].glyph = '◎';
          tiles[ly][lx].fg = '#4488cc';
        }
        break;
      }

      case 'firewall': {
        // 1-2 scanner beams
        const beamCount = randInt(1, 2);
        const beams = [];
        for (let b = 0; b < beamCount; b++) {
          const axis = Math.random() < 0.5 ? 'horizontal' as const : 'vertical' as const;
          if (axis === 'horizontal') {
            const pos = randInt(innerY1, innerY2);
            beams.push({ axis, position: pos, direction: 1 as const, min: innerX1, max: innerX2 });
          } else {
            const pos = randInt(innerX1, innerX2);
            beams.push({ axis, position: pos, direction: 1 as const, min: innerY1, max: innerY2 });
          }
        }
        room.hazardState = { beams, alarmTriggered: false };
        // Place checkpoint terminal on a wall
        const tx = room.x + room.w - 1;
        const ty = Math.floor(room.y + room.h / 2);
        if (tiles[ty]?.[tx]) {
          tiles[ty][tx].glyph = '▣';
          tiles[ty][tx].fg = '#ffcc00';
        }
        break;
      }

      case 'unstable': {
        // Place process core at center of room
        const cx = Math.floor(room.x + room.w / 2);
        const cy = Math.floor(room.y + room.h / 2);
        room.hazardState = { corePos: { x: cx, y: cy }, coreDestroyed: false, sparkedTiles: [] };
        tiles[cy][cx].glyph = '◆';
        tiles[cy][cx].fg = '#ffaa00';
        break;
      }

      case 'quarantine': {
        // Lock all doors to this room
        room.hazardState = { locked: true };
        for (let y = room.y; y < room.y + room.h; y++) {
          for (let x = room.x; x < room.x + room.w; x++) {
            if (x < 0 || x >= CLUSTER_WIDTH || y < 0 || y >= CLUSTER_HEIGHT) continue;
            if (tiles[y][x].type === TileType.Door) {
              tiles[y][x].glyph = '▪';
              tiles[y][x].fg = '#ff2222';
              tiles[y][x].walkable = false;
              // Keep transparent so player can see inside
            }
          }
        }
        break;
      }

      case 'echo_chamber': {
        // Tint floor bg
        for (let y = innerY1; y <= innerY2; y++) {
          for (let x = innerX1; x <= innerX2; x++) {
            if (tiles[y]?.[x]?.type === TileType.Floor) {
              tiles[y][x].bg = '#0a0a14';
            }
          }
        }
        room.hazardState = {};
        break;
      }

      case 'gravity_well': {
        // Place singularity at room center
        const cx = Math.floor(room.x + room.w / 2);
        const cy = Math.floor(room.y + room.h / 2);
        room.hazardState = {
          singularityPos: { x: cx, y: cy },
          pullInterval: 3,
          lastPullTick: 0,
        };
        // Singularity glyph
        tiles[cy][cx].glyph = '●';
        tiles[cy][cx].fg = '#aa44ff';
        tiles[cy][cx].hazardOverlay = { type: 'gravity', stage: 2 };
        // Directional arrows on interior tiles
        for (let y = innerY1; y <= innerY2; y++) {
          for (let x = innerX1; x <= innerX2; x++) {
            if (x === cx && y === cy) continue;
            if (tiles[y][x].type !== TileType.Floor) continue;
            const dx = cx - x;
            const dy = cy - y;
            const dist = Math.abs(dx) + Math.abs(dy);
            const stage = dist <= 2 ? 1 : 0;
            tiles[y][x].hazardOverlay = { type: 'gravity', stage };
          }
        }
        break;
      }

    }
  }
}

// ── Main generation ──

export function generateCluster(id: number): Cluster {
  const grid = createCellGrid();
  const rooms: Room[] = [];
  const nextId = { value: 0 };

  // Outer boundary (inset by PAD)
  for (let x = IX; x < IX + IW; x++) {
    grid[IY][x] = 'wall';
    grid[IY + IH - 1][x] = 'wall';
  }
  for (let y = IY; y < IY + IH; y++) {
    grid[y][IX] = 'wall';
    grid[y][IX + IW - 1] = 'wall';
  }

  // Recursive division
  divide(grid, rooms, IX, IY, IW, IH, 0, nextId);

  // Post-process: place doors on valid wall positions between rooms
  const roomAdjacency = placeDoors(grid, rooms);

  // Assign special room types
  assignRoomTypes(rooms, id, roomAdjacency);

  // Convert to tile grid
  const tiles = cellGridToTiles(grid, rooms);

  // Initialize hazard visuals on tiles
  initRoomHazards(tiles, rooms);

  // Place interface exits
  const interfaces = placeInterfaceExits(tiles, rooms);

  return { id, width: CLUSTER_WIDTH, height: CLUSTER_HEIGHT, tiles, rooms, interfaces, roomAdjacency };
}
