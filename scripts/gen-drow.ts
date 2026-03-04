// Faithful reimplementation of drow's Random Dungeon Generator (dungeon.js v1.0.4)
// Original: drow <drow@bin.sh>, CC BY-NC 3.0
//
// Uses the original's 2x coordinate system, bitmask cell flags, dense room
// placement, door placement before corridors, and errant corridor carving.
//
// Usage:
//   npx tsx scripts/gen-drow.ts              # 5 visual samples
//   npx tsx scripts/gen-drow.ts --stats      # 1000 samples, print topology metrics
//   npx tsx scripts/gen-drow.ts --sweep      # parameter sweep

// ── Cell bitmask flags (matching original) ──
const BLOCKED   = 1;
const ROOM      = 2;
const CORRIDOR  = 4;
// bit 3 unused
const PERIMETER = 16;
const ENTRANCE  = 32;
// bits 6-15: room_id << 6
const ROOM_ID_MASK = 0xFFC0;  // 65472
const ANY_DOOR  = 0x3F0000;   // bits 16-21: arch|open|lock|trap|secret|portc
const ARCH_DOOR = 65536;
const OPEN_DOOR = 131072;
const LOCK_DOOR = 262144;
const TRAP_DOOR = 524288;
const SECRET_DOOR = 1048576;
const PORTCULLIS = 2097152;

type Dir = 'north' | 'south' | 'east' | 'west';
const ALL_DIRS: Dir[] = ['east', 'north', 'south', 'west']; // sorted, matching original

const ROW_DIR: Record<Dir, number> = { north: -1, south: 1, west: 0, east: 0 };
const COL_DIR: Record<Dir, number> = { north: 0, south: 0, west: -1, east: 1 };
const OPPOSITE: Record<Dir, Dir> = { north: 'south', south: 'north', west: 'east', east: 'west' };

function random(n: number): number { return Math.floor(Math.random() * n); }

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Dungeon state ──

interface RoomInfo {
  id: number;
  north: number; south: number; west: number; east: number; // grid coords
  door: Record<Dir, DoorInfo[]>;
}

interface DoorInfo {
  row: number; col: number;
  sill_r: number; sill_c: number;
  dir: Dir;
  out_id: number; // 0 if opens to corridor/void
}

interface Dungeon {
  n_i: number; n_j: number;
  n_rows: number; n_cols: number;
  cell: number[][];
  n_rooms: number;
  room: (RoomInfo | null)[];
  straight_pct: number;
  remove_pct: number;
}

// ── Configurable parameters ──

interface GenParams {
  // Grid size
  dungeonSize: number;   // total size parameter
  cellSize: number;      // cell pixel size (determines grid subdivisions)
  aspect: number;        // width/height ratio

  // Room placement
  roomLayout: 'dense' | 'scattered';
  roomMinDim: number;    // minimum room dimension in cell-space (room_size.size)
  roomRadix: number;     // random range for room dimension (room_size.radix)

  // Corridors
  straightPct: number;   // 0=labyrinth, 50=errant, 90=straight

  // Dead-end removal
  removePct: number;     // 0=none, 50=some, 100=all
}

const DEFAULT_PARAMS: GenParams = {
  // Medium rectangle
  dungeonSize: 504,
  cellSize: 18,
  aspect: 1.3,
  roomLayout: 'dense',
  roomMinDim: 2,
  roomRadix: 5,
  straightPct: 50,   // errant
  removePct: 50,     // some
};

let PARAMS: GenParams = { ...DEFAULT_PARAMS };

// ── Grid creation ──

function createDungeon(): Dungeon {
  const n_i = Math.floor(PARAMS.dungeonSize * PARAMS.aspect / PARAMS.cellSize);
  const n_j = Math.floor(PARAMS.dungeonSize / PARAMS.cellSize);
  const n_rows = 2 * n_i;
  const n_cols = 2 * n_j;

  const cell: number[][] = [];
  for (let r = 0; r <= n_rows; r++) {
    cell[r] = [];
    for (let c = 0; c <= n_cols; c++) cell[r][c] = 0;
  }

  return {
    n_i, n_j, n_rows, n_cols, cell,
    n_rooms: 0,
    room: [],
    straight_pct: PARAMS.straightPct,
    remove_pct: PARAMS.removePct,
  };
}

// ── Room placement ──

function placeRoom(d: Dungeon, opts: { i?: number; j?: number; height?: number; width?: number }): Dungeon {
  if (d.n_rooms >= 999) return d;

  const g = PARAMS.roomMinDim;
  const radix = PARAMS.roomRadix;

  let height: number, width: number;

  // Height
  if (opts.i !== undefined) {
    let c = d.n_i - g - opts.i;
    if (c < 0) c = 0;
    height = random(c < radix ? c : radix) + g;
  } else {
    height = random(radix) + g;
  }

  // Width
  if (opts.j !== undefined) {
    let c = d.n_j - g - opts.j;
    if (c < 0) c = 0;
    width = random(c < radix ? c : radix) + g;
  } else {
    width = random(radix) + g;
  }

  const i = opts.i ?? random(d.n_i - height);
  const j = opts.j ?? random(d.n_j - width);

  // Grid coordinates
  const r1 = 2 * i + 1;
  const c1 = 2 * j + 1;
  const r2 = 2 * (i + height) - 1;
  const c2 = 2 * (j + width) - 1;

  if (r1 < 1 || r2 > d.n_rows - 1 || c1 < 1 || c2 > d.n_cols - 1) return d;

  // Check for overlaps
  let blocked = false;
  const hitRooms = new Set<number>();
  for (let r = r1; r <= r2 && !blocked; r++) {
    for (let c = c1; c <= c2 && !blocked; c++) {
      if (d.cell[r][c] & BLOCKED) { blocked = true; break; }
      if (d.cell[r][c] & ROOM) {
        hitRooms.add((d.cell[r][c] & ROOM_ID_MASK) >> 6);
      }
    }
  }

  if (blocked) return d;

  // Dense mode: no complex rooms, so reject any overlap
  if (hitRooms.size > 0) return d;

  // Assign new room ID
  const roomId = ++d.n_rooms;

  // Carve room cells
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      if (d.cell[r][c] & ENTRANCE) {
        d.cell[r][c] &= ~(ROOM_ID_MASK | ENTRANCE);
      } else if (d.cell[r][c] & PERIMETER) {
        d.cell[r][c] &= ~PERIMETER;
      }
      d.cell[r][c] = d.cell[r][c] | ROOM | (roomId << 6);
    }
  }

  // Mark perimeter
  for (let r = r1 - 1; r <= r2 + 1; r++) {
    if (r < 0 || r > d.n_rows) continue;
    if (c1 - 1 >= 0 && !(d.cell[r][c1 - 1] & (ROOM | ENTRANCE))) d.cell[r][c1 - 1] |= PERIMETER;
    if (c2 + 1 <= d.n_cols && !(d.cell[r][c2 + 1] & (ROOM | ENTRANCE))) d.cell[r][c2 + 1] |= PERIMETER;
  }
  for (let c = c1 - 1; c <= c2 + 1; c++) {
    if (c < 0 || c > d.n_cols) continue;
    if (r1 - 1 >= 0 && !(d.cell[r1 - 1][c] & (ROOM | ENTRANCE))) d.cell[r1 - 1][c] |= PERIMETER;
    if (r2 + 1 <= d.n_rows && !(d.cell[r2 + 1][c] & (ROOM | ENTRANCE))) d.cell[r2 + 1][c] |= PERIMETER;
  }

  // Store room
  d.room[roomId] = {
    id: roomId,
    north: r1, south: r2, west: c1, east: c2,
    door: { north: [], south: [], east: [], west: [] },
  };

  return d;
}

function placeRoomsDense(d: Dungeon): Dungeon {
  for (let i = 0; i < d.n_i; i++) {
    const gr = 2 * i + 1;
    for (let j = 0; j < d.n_j; j++) {
      const gc = 2 * j + 1;
      if (d.cell[gr][gc] & ROOM) continue;
      // Edge skip: 50% chance to skip if on first row or first column
      if ((i === 0 || j === 0) && random(2) > 0) continue;
      d = placeRoom(d, { i, j });
    }
  }
  return d;
}

function placeRoomsScattered(d: Dungeon): Dungeon {
  const roomSize = PARAMS.roomMinDim + PARAMS.roomRadix + 1;
  const attempts = 2 * Math.floor(d.n_cols * d.n_rows / (roomSize * roomSize));
  for (let a = 0; a < attempts; a++) {
    d = placeRoom(d, {});
  }
  return d;
}

// ── Door placement ──

interface DoorCandidate {
  sill_r: number; sill_c: number;
  door_r: number; door_c: number;
  dir: Dir;
  out_id: number;
}

function checkDoorCandidate(d: Dungeon, room: RoomInfo, r: number, c: number, dir: Dir): DoorCandidate | null {
  const dr = r + ROW_DIR[dir];
  const dc = c + COL_DIR[dir];

  // Door cell must be perimeter, not blocked/door
  const doorCell = d.cell[dr]?.[dc];
  if (doorCell === undefined) return null;
  if (!(doorCell & PERIMETER) || (doorCell & (BLOCKED | ANY_DOOR))) return null;

  // Cell beyond door
  const br = dr + ROW_DIR[dir];
  const bc = dc + COL_DIR[dir];
  const beyond = d.cell[br]?.[bc];
  if (beyond === undefined || (beyond & BLOCKED)) return null;

  const out_id = (beyond & ROOM_ID_MASK) >> 6;
  if (out_id === room.id) return null; // connects back to same room

  return { sill_r: r, sill_c: c, door_r: dr, door_c: dc, dir, out_id };
}

function findDoorCandidates(d: Dungeon, room: RoomInfo): DoorCandidate[] {
  const cands: DoorCandidate[] = [];
  const { north, south, west, east } = room;

  // North wall
  if (north >= 3) {
    for (let c = west; c <= east; c += 2) {
      const dc = checkDoorCandidate(d, room, north, c, 'north');
      if (dc) cands.push(dc);
    }
  }
  // South wall
  if (south <= d.n_rows - 3) {
    for (let c = west; c <= east; c += 2) {
      const dc = checkDoorCandidate(d, room, south, c, 'south');
      if (dc) cands.push(dc);
    }
  }
  // West wall
  if (west >= 3) {
    for (let r = north; r <= south; r += 2) {
      const dc = checkDoorCandidate(d, room, r, west, 'west');
      if (dc) cands.push(dc);
    }
  }
  // East wall
  if (east <= d.n_cols - 3) {
    for (let r = north; r <= south; r += 2) {
      const dc = checkDoorCandidate(d, room, r, east, 'east');
      if (dc) cands.push(dc);
    }
  }

  return cands;
}

// Standard door table: roll 1-110
function rollDoorType(): number {
  const roll = random(110) + 1;
  if (roll <= 15) return ARCH_DOOR;
  if (roll <= 60) return OPEN_DOOR;
  if (roll <= 75) return LOCK_DOOR;
  if (roll <= 90) return TRAP_DOOR;
  if (roll <= 100) return SECRET_DOOR;
  return PORTCULLIS;
}

function placeDoor(d: Dungeon, room: RoomInfo, cand: DoorCandidate) {
  const { sill_r, sill_c, door_r, door_c, dir } = cand;

  // Mark 3 cells as entrance (sill -> door -> beyond)
  for (let m = 0; m < 3; m++) {
    const r = sill_r + ROW_DIR[dir] * m;
    const c = sill_c + COL_DIR[dir] * m;
    if (r >= 0 && r <= d.n_rows && c >= 0 && c <= d.n_cols) {
      d.cell[r][c] &= ~PERIMETER;
      d.cell[r][c] |= ENTRANCE;
    }
  }

  // Set door type
  d.cell[door_r][door_c] |= rollDoorType();

  // Record on room
  room.door[dir].push({
    row: door_r, col: door_c,
    sill_r, sill_c, dir,
    out_id: cand.out_id,
  });
}

function placeDoors(d: Dungeon): Dungeon {
  const roomPairDoors = new Set<string>();

  for (let rid = 1; rid <= d.n_rooms; rid++) {
    const room = d.room[rid];
    if (!room) continue;

    const cands = findDoorCandidates(d, room);
    if (!cands.length) continue;

    // Number of doors based on room area in cell-space
    const cellW = (room.east - room.west) / 2 + 1;
    const cellH = (room.south - room.north) / 2 + 1;
    const area = cellW * cellH;
    const base = Math.floor(Math.sqrt(area));
    const numDoors = base + random(base);

    const shuffled = shuffle(cands);
    let placed = 0;
    for (let i = 0; i < shuffled.length && placed < numDoors; i++) {
      const cand = shuffled[i];

      // Skip if door already placed here
      if (d.cell[cand.door_r][cand.door_c] & ANY_DOOR) continue;

      if (cand.out_id) {
        // Room-to-room: only one door per pair
        const key = [room.id, cand.out_id].sort((a, b) => a - b).join(',');
        if (roomPairDoors.has(key)) continue;
        placeDoor(d, room, cand);
        roomPairDoors.add(key);
      } else {
        placeDoor(d, room, cand);
      }
      placed++;
    }
  }

  return d;
}

// ── Corridor carving ──

function getDirections(d: Dungeon, lastDir?: Dir): Dir[] {
  const dirs = shuffle([...ALL_DIRS]);
  if (lastDir && d.straight_pct > 0 && random(100) < d.straight_pct) {
    dirs.unshift(lastDir);
  }
  return dirs;
}

function carveCorridor(d: Dungeon, i: number, j: number, lastDir?: Dir): Dungeon {
  const dirs = getDirections(d, lastDir);

  for (const dir of dirs) {
    const curR = 2 * i + 1;
    const curC = 2 * j + 1;
    const ni = i + ROW_DIR[dir];
    const nj = j + COL_DIR[dir];
    const nextR = 2 * ni + 1;
    const nextC = 2 * nj + 1;

    // Bounds check
    if (nextR < 0 || nextR > d.n_rows || nextC < 0 || nextC > d.n_cols) continue;

    // Check region: midpoint to next (for canCarve)
    const midR = Math.floor((curR + nextR) / 2);
    const midC = Math.floor((curC + nextC) / 2);
    const checkR = [midR, nextR].sort((a, b) => a - b);
    const checkC = [midC, nextC].sort((a, b) => a - b);

    let canCarve = true;
    for (let r = checkR[0]; r <= checkR[1] && canCarve; r++) {
      for (let c = checkC[0]; c <= checkC[1] && canCarve; c++) {
        if (d.cell[r][c] & (BLOCKED | CORRIDOR | PERIMETER)) { // & 21
          canCarve = false;
        }
      }
    }

    if (canCarve) {
      // Carve: current to next
      const carveR = [curR, nextR].sort((a, b) => a - b);
      const carveC = [curC, nextC].sort((a, b) => a - b);
      for (let r = carveR[0]; r <= carveR[1]; r++) {
        for (let c = carveC[0]; c <= carveC[1]; c++) {
          d.cell[r][c] &= ~ENTRANCE;
          d.cell[r][c] |= CORRIDOR;
        }
      }
      // Recurse
      d = carveCorridor(d, ni, nj, dir);
    }
  }

  return d;
}

function carveCorridors(d: Dungeon): Dungeon {
  // Start from i=1,j=1 (skip border row/col)
  for (let i = 1; i < d.n_i; i++) {
    const r = 2 * i + 1;
    for (let j = 1; j < d.n_j; j++) {
      if (!(d.cell[r][2 * j + 1] & CORRIDOR)) {
        d = carveCorridor(d, i, j);
      }
    }
  }
  return d;
}

// ── Dead-end removal ──

// A dead end faces direction `dir` if the 5 neighbors forming a U opposite to dir are all non-open
interface DeadEndPattern {
  walled: [number, number][];
  close: [number, number][];
  recurse: [number, number];
}

const DEAD_END_PATTERNS: Record<Dir, DeadEndPattern> = {
  north: {
    walled: [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1]],
    close: [[0, 0]],
    recurse: [-1, 0],
  },
  south: {
    walled: [[0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]],
    close: [[0, 0]],
    recurse: [1, 0],
  },
  west: {
    walled: [[-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0]],
    close: [[0, 0]],
    recurse: [0, -1],
  },
  east: {
    walled: [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0]],
    close: [[0, 0]],
    recurse: [0, 1],
  },
};

function matchesPattern(d: Dungeon, r: number, c: number, pat: DeadEndPattern): boolean {
  for (const [dr, dc] of pat.walled) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr > d.n_rows || nc < 0 || nc > d.n_cols) continue;
    if (d.cell[nr][nc] & (ROOM | CORRIDOR)) return false; // neighbor is open
  }
  return true;
}

function closeDeadEnd(d: Dungeon, r: number, c: number): Dungeon {
  if (!(d.cell[r][c] & (ROOM | CORRIDOR))) return d;

  for (const dir of ALL_DIRS) {
    const pat = DEAD_END_PATTERNS[dir];
    if (matchesPattern(d, r, c, pat)) {
      // Close
      for (const [dr, dc] of pat.close) {
        d.cell[r + dr][c + dc] = 0;
      }
      // Recurse
      const [dr, dc] = pat.recurse;
      d = closeDeadEnd(d, r + dr, c + dc);
    }
  }
  return d;
}

function removeDeadEnds(d: Dungeon): Dungeon {
  const always = d.remove_pct >= 100;
  for (let i = 0; i < d.n_i; i++) {
    const r = 2 * i + 1;
    for (let j = 0; j < d.n_j; j++) {
      const c = 2 * j + 1;
      if (d.cell[r][c] & (ROOM | CORRIDOR)) {
        if (always || random(100) < d.remove_pct) {
          d = closeDeadEnd(d, r, c);
        }
      }
    }
  }
  return d;
}

// ── Full generation ──

function generate(): Dungeon {
  let d = createDungeon();

  // 1. Place rooms
  if (PARAMS.roomLayout === 'dense') {
    d = placeRoomsDense(d);
  } else {
    d = placeRoomsScattered(d);
  }

  // 2. Place doors (BEFORE corridors!)
  d = placeDoors(d);

  // 3. Carve corridors in remaining space
  d = carveCorridors(d);

  // 4. Remove dead ends
  if (d.remove_pct > 0) {
    d = removeDeadEnds(d);
  }

  return d;
}

// ── Rendering ──

function renderDungeon(d: Dungeon): string {
  const lines: string[] = [];
  for (let r = 0; r <= d.n_rows; r++) {
    let line = '';
    for (let c = 0; c <= d.n_cols; c++) {
      const cell = d.cell[r][c];
      if (cell & ROOM) {
        if (cell & ANY_DOOR) line += '+';
        else line += '·';
      } else if (cell & CORRIDOR) {
        line += '·';
      } else if (cell & ANY_DOOR) {
        line += '+';
      } else if (cell & ENTRANCE) {
        line += '·';
      } else if (cell & PERIMETER) {
        line += '#';
      } else if (cell & BLOCKED) {
        line += 'X';
      } else {
        line += ' ';
      }
    }
    lines.push(line);
  }
  return lines.join('\n');
}

// ── Room adjacency graph ──

function buildAdjacency(d: Dungeon): Map<number, Set<number>> {
  const adj = new Map<number, Set<number>>();
  for (let rid = 1; rid <= d.n_rooms; rid++) adj.set(rid, new Set());

  // Method 1: Direct room-to-room doors (from door records)
  for (let rid = 1; rid <= d.n_rooms; rid++) {
    const room = d.room[rid];
    if (!room) continue;
    for (const dir of ALL_DIRS) {
      for (const door of room.door[dir]) {
        if (door.out_id > 0) {
          adj.get(rid)!.add(door.out_id);
          adj.get(door.out_id)!.add(rid);
        }
      }
    }
  }

  // Method 2: Corridor connectivity (flood-fill from each room's doors into corridors)
  for (let rid = 1; rid <= d.n_rooms; rid++) {
    const room = d.room[rid];
    if (!room) continue;

    // Find all door/entrance cells adjacent to this room that lead to corridors
    const starts: [number, number][] = [];
    for (const dir of ALL_DIRS) {
      for (const door of room.door[dir]) {
        if (door.out_id === 0) { // opens to corridor, not another room
          // The cell beyond the door
          const br = door.row + ROW_DIR[door.dir];
          const bc = door.col + COL_DIR[door.dir];
          if (br >= 0 && br <= d.n_rows && bc >= 0 && bc <= d.n_cols) {
            starts.push([br, bc]);
          }
        }
      }
    }

    // BFS through corridors and entrance cells to find connected rooms
    const visited = new Set<string>();
    const queue: [number, number][] = [];
    for (const [sr, sc] of starts) {
      const key = `${sr},${sc}`;
      if (!visited.has(key)) {
        visited.add(key);
        queue.push([sr, sc]);
      }
    }

    while (queue.length > 0) {
      const [cr, cc] = queue.shift()!;

      // Check if this cell belongs to another room
      if (d.cell[cr][cc] & ROOM) {
        const otherRid = (d.cell[cr][cc] & ROOM_ID_MASK) >> 6;
        if (otherRid !== rid && otherRid > 0) {
          adj.get(rid)!.add(otherRid);
          adj.get(otherRid)!.add(rid);
          continue; // don't flood through other rooms
        }
      }

      // Expand to neighbors
      for (const [dr, dc] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nr = cr + dr, nc = cc + dc;
        if (nr < 0 || nr > d.n_rows || nc < 0 || nc > d.n_cols) continue;
        const key = `${nr},${nc}`;
        if (visited.has(key)) continue;
        const cell = d.cell[nr][nc];
        if (cell & (CORRIDOR | ENTRANCE)) {
          visited.add(key);
          queue.push([nr, nc]);
        }
        // Also enter other rooms through their entrance cells
        if (cell & ROOM) {
          const otherRid = (cell & ROOM_ID_MASK) >> 6;
          if (otherRid !== rid && otherRid > 0) {
            visited.add(key);
            queue.push([nr, nc]); // will be caught as "other room" above
          }
        }
      }
    }
  }

  return adj;
}

// ── Topology metrics ──

const PATH_CAP = 500;
const PATH_TIMEOUT_MS = 50; // abort path counting after 50ms per cluster

function countPaths(adj: Map<number, Set<number>>, start: number, end: number): number {
  const visited = new Set<number>();
  let count = 0;
  const deadline = Date.now() + PATH_TIMEOUT_MS;
  let aborted = false;
  function dfs(cur: number) {
    if (count >= PATH_CAP || aborted) return;
    if (Date.now() > deadline) { aborted = true; count = PATH_CAP; return; }
    if (cur === end) { count++; return; }
    visited.add(cur);
    for (const n of adj.get(cur) ?? []) {
      if (count >= PATH_CAP || aborted) return;
      if (!visited.has(n)) dfs(n);
    }
    visited.delete(cur);
  }
  dfs(start);
  return count;
}

function bfsReachable(adj: Map<number, Set<number>>, start: number, exclude: number): Set<number> {
  const visited = new Set<number>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const n of adj.get(node) ?? []) {
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
}

function computeMetrics(d: Dungeon, adj: Map<number, Set<number>>): Metrics {
  const ids: number[] = [];
  for (let rid = 1; rid <= d.n_rooms; rid++) if (d.room[rid]) ids.push(rid);
  const roomCount = ids.length;

  let edgeCount = 0;
  for (const neighbors of adj.values()) edgeCount += neighbors.size;
  edgeCount /= 2;

  const cycleCount = edgeCount - (roomCount - 1);
  const degrees = ids.map(id => (adj.get(id)?.size ?? 0));
  const avgDegree = roomCount > 0 ? degrees.reduce((a, b) => a + b, 0) / roomCount : 0;
  const maxDegree = Math.max(0, ...degrees);
  const deadEnds = degrees.filter(d => d <= 1).length;

  // Entry = room closest to top-left, exit = closest to bottom-right
  const rooms = ids.map(id => d.room[id]!);
  const sorted = [...rooms].sort((a, b) => (a.west + a.north) - (b.west + b.north));
  const entry = sorted[0]?.id ?? 1;
  const exit = sorted[sorted.length - 1]?.id ?? entry;

  // Connectivity
  const reachable = bfsReachable(adj, entry, -1);
  const disconnected = !reachable.has(exit);
  const simplePaths = disconnected ? 0 : countPaths(adj, entry, exit);

  // Articulation points (entry↔exit relevant)
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
    const d = generate();
    const adj = buildAdjacency(d);
    const m = computeMetrics(d, adj);
    all.push(m);
    if (m.disconnected) disconnectedCount++;
  }

  const keys: (keyof Metrics)[] = [
    'roomCount', 'edgeCount', 'cycleCount', 'simplePaths',
    'articulationPoints', 'avgDegree', 'maxDegree', 'deadEnds',
  ];

  console.log(`\n═══ ${label} (${samples} samples) ═══`);
  console.log(`Grid: ${PARAMS.dungeonSize} ${PARAMS.roomLayout} rooms=${PARAMS.roomMinDim}+rand(${PARAMS.roomRadix}) corridors=${PARAMS.straightPct}%str deadends=${PARAMS.removePct}%`);
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
  const N = 200;

  // Sweep 1: Room layout
  console.log('\n\n========== SWEEP: Room Layout ==========');
  for (const layout of ['dense', 'scattered'] as const) {
    PARAMS = { ...DEFAULT_PARAMS, roomLayout: layout };
    runStats(N, `layout=${layout}`);
  }

  // Sweep 2: Corridor style
  console.log('\n\n========== SWEEP: Corridor Style ==========');
  for (const [name, pct] of [['labyrinth', 0], ['errant', 50], ['straight', 90]] as const) {
    PARAMS = { ...DEFAULT_PARAMS, straightPct: pct };
    runStats(N, `corridor=${name}(${pct}%)`);
  }

  // Sweep 3: Dead-end removal
  console.log('\n\n========== SWEEP: Dead-End Removal ==========');
  for (const [name, pct] of [['none', 0], ['some', 50], ['all', 100]] as const) {
    PARAMS = { ...DEFAULT_PARAMS, removePct: pct };
    runStats(N, `deadends=${name}(${pct}%)`);
  }

  // Sweep 4: Dungeon size
  console.log('\n\n========== SWEEP: Dungeon Size ==========');
  for (const [name, size] of [['small', 400], ['medium', 504], ['large', 635]] as const) {
    PARAMS = { ...DEFAULT_PARAMS, dungeonSize: size };
    runStats(N, `size=${name}(${size})`);
  }

  // Sweep 5: Room size
  console.log('\n\n========== SWEEP: Room Size ==========');
  for (const [name, minD, rad] of [['small', 2, 2], ['medium', 2, 5], ['large', 5, 2], ['huge', 5, 5]] as const) {
    PARAMS = { ...DEFAULT_PARAMS, roomMinDim: minD, roomRadix: rad };
    runStats(N, `roomSize=${name}(${minD}+${rad})`);
  }

} else if (args.includes('--stats')) {
  PARAMS = { ...DEFAULT_PARAMS };
  runStats(1000, 'Drow Default (medium rect, dense, errant, some deadends)');
} else {
  PARAMS = { ...DEFAULT_PARAMS };
  for (let i = 0; i < 5; i++) {
    const d = generate();
    const adj = buildAdjacency(d);
    console.log(`=== Sample ${i + 1} (${d.n_rooms} rooms, grid ${d.n_rows + 1}×${d.n_cols + 1}) ===`);
    console.log(renderDungeon(d));

    // Print adjacency
    const adjStr: string[] = [];
    for (let rid = 1; rid <= d.n_rooms; rid++) {
      const ns = adj.get(rid);
      if (ns) adjStr.push(`${rid}→[${[...ns].sort((a,b)=>a-b).join(',')}]`);
    }
    console.log(`Adjacency: ${adjStr.join('  ')}`);
    console.log();
  }
}
