// Algorithm 6: Modified Recursive Division for ship interiors
// Generates text representation for review

const W = 50;
const H = 30;
const PAD = 1; // void padding around the map
// Inner map bounds: (PAD, PAD) to (W-PAD-1, H-PAD-1)
const IX = PAD;
const IY = PAD;
const IW = W - 2 * PAD;
const IH = H - 2 * PAD;
const MIN_ROOM_DIM = 4; // minimum room dimension (interior, excluding walls)
const CORRIDOR_CHANCE = 0.20;
const CORRIDOR_WIDTH = 3;

type Cell = 'floor' | 'wall' | 'door' | 'void';
type Grid = Cell[][];

interface Room {
  id: number;
  x: number; y: number;
  w: number; h: number;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createGrid(): Grid {
  const grid: Grid = [];
  for (let y = 0; y < H; y++) {
    grid[y] = [];
    for (let x = 0; x < W; x++) {
      grid[y][x] = 'void';
    }
  }
  return grid;
}

// Fill a rect with floor, place walls on boundary
function carveRoom(grid: Grid, x: number, y: number, w: number, h: number) {
  for (let ry = y; ry < y + h; ry++) {
    for (let rx = x; rx < x + w; rx++) {
      if (ry < 0 || ry >= H || rx < 0 || rx >= W) continue;
      if (ry === y || ry === y + h - 1 || rx === x || rx === x + w - 1) {
        // Only place wall if not already floor (shared walls become walls, not overwriting doors)
        if (grid[ry][rx] !== 'floor' && grid[ry][rx] !== 'door') {
          grid[ry][rx] = 'wall';
        }
      } else {
        grid[ry][rx] = 'floor';
      }
    }
  }
}

const rooms: Room[] = [];
let nextRoomId = 0;

function divide(grid: Grid, x: number, y: number, w: number, h: number, depth: number) {
  // Interior dimensions (excluding walls)
  const innerW = w - 2;
  const innerH = h - 2;
  const area = innerW * innerH;

  // Stop conditions
  if (innerW < MIN_ROOM_DIM || innerH < MIN_ROOM_DIM) {
    carveRoom(grid, x, y, w, h);
    rooms.push({ id: nextRoomId++, x, y, w, h });
    return;
  }

  if (area < 15) {
    carveRoom(grid, x, y, w, h);
    rooms.push({ id: nextRoomId++, x, y, w, h });
    return;
  }

  // Medium rooms: chance to stop
  if (area < 40 && Math.random() > 0.6) {
    carveRoom(grid, x, y, w, h);
    rooms.push({ id: nextRoomId++, x, y, w, h });
    return;
  }

  // Choose split direction: prefer longer axis
  const ratio = w / h;
  let splitH: boolean;
  if (ratio > 1.5) splitH = false;      // wider → split vertically
  else if (ratio < 0.67) splitH = true;  // taller → split horizontally
  else splitH = Math.random() < 0.5;

  if (splitH) {
    // Horizontal split: wall runs left-right at some y
    const minSplit = y + MIN_ROOM_DIM + 1; // room needs at least MIN_ROOM_DIM interior + 1 wall
    const maxSplit = y + h - MIN_ROOM_DIM - 2;
    if (minSplit > maxSplit) {
      carveRoom(grid, x, y, w, h);
      rooms.push({ id: nextRoomId++, x, y, w, h });
      return;
    }

    const splitAt = randInt(minSplit, maxSplit);

    // Corridor injection
    if (Math.random() < CORRIDOR_CHANCE && h > CORRIDOR_WIDTH + MIN_ROOM_DIM + 3) {
      const corrH = CORRIDOR_WIDTH;
      const corrY = splitAt;
      // Top part
      divide(grid, x, y, w, corrY - y + 1, depth + 1);
      // Corridor
      carveRoom(grid, x, corrY, w, corrH);
      rooms.push({ id: nextRoomId++, x, y: corrY, w, h: corrH });
      // Place doors on corridor walls
      placeDoorOnHWall(grid, x, corrY, w);
      placeDoorOnHWall(grid, x, corrY + corrH - 1, w);
      // Bottom part
      divide(grid, x, corrY + corrH - 1, w, y + h - (corrY + corrH - 1), depth + 1);
      return;
    }

    // Split into top and bottom
    const topH = splitAt - y + 1;
    const botH = h - topH + 1;

    // Place the dividing wall
    for (let rx = x; rx < x + w; rx++) {
      if (grid[splitAt][rx] !== 'door') {
        grid[splitAt][rx] = 'wall';
      }
    }

    // Place door(s) in the wall
    placeDoorOnHWall(grid, x, splitAt, w);

    divide(grid, x, y, w, topH, depth + 1);
    divide(grid, x, splitAt, w, botH, depth + 1);
  } else {
    // Vertical split: wall runs top-bottom at some x
    const minSplit = x + MIN_ROOM_DIM + 1;
    const maxSplit = x + w - MIN_ROOM_DIM - 2;
    if (minSplit > maxSplit) {
      carveRoom(grid, x, y, w, h);
      rooms.push({ id: nextRoomId++, x, y, w, h });
      return;
    }

    const splitAt = randInt(minSplit, maxSplit);

    // Corridor injection
    if (Math.random() < CORRIDOR_CHANCE && w > CORRIDOR_WIDTH + MIN_ROOM_DIM + 3) {
      const corrW = CORRIDOR_WIDTH;
      const corrX = splitAt;
      // Left part
      divide(grid, x, y, corrX - x + 1, h, depth + 1);
      // Corridor
      carveRoom(grid, corrX, y, corrW, h);
      rooms.push({ id: nextRoomId++, x: corrX, y, w: corrW, h });
      placeDoorOnVWall(grid, corrX, y, h);
      placeDoorOnVWall(grid, corrX + corrW - 1, y, h);
      // Right part
      divide(grid, corrX + corrW - 1, y, x + w - (corrX + corrW - 1), h, depth + 1);
      return;
    }

    // Split into left and right
    const leftW = splitAt - x + 1;
    const rightW = w - leftW + 1;

    for (let ry = y; ry < y + h; ry++) {
      if (grid[ry][splitAt] !== 'door') {
        grid[ry][splitAt] = 'wall';
      }
    }

    placeDoorOnVWall(grid, splitAt, y, h);

    divide(grid, x, y, leftW, h, depth + 1);
    divide(grid, splitAt, y, rightW, h, depth + 1);
  }
}

function placeDoorOnHWall(grid: Grid, x: number, wallY: number, w: number) {
  // Place 1-2 doors on a horizontal wall segment
  const minDoor = x + 2;
  const maxDoor = x + w - 3;
  if (minDoor > maxDoor) return;

  const pos1 = randInt(minDoor, maxDoor);
  grid[wallY][pos1] = 'door';

  // Second door for long walls
  if (w > 10 && Math.random() < 0.4) {
    const pos2 = randInt(minDoor, maxDoor);
    if (Math.abs(pos2 - pos1) > 3) {
      grid[wallY][pos2] = 'door';
    }
  }
}

function placeDoorOnVWall(grid: Grid, wallX: number, y: number, h: number) {
  const minDoor = y + 2;
  const maxDoor = y + h - 3;
  if (minDoor > maxDoor) return;

  const pos1 = randInt(minDoor, maxDoor);
  grid[pos1][wallX] = 'door';

  if (h > 10 && Math.random() < 0.4) {
    const pos2 = randInt(minDoor, maxDoor);
    if (Math.abs(pos2 - pos1) > 3) {
      grid[pos2][wallX] = 'door';
    }
  }
}

// ── Wall glyph selection ──

function wallGlyph(grid: Grid, x: number, y: number, outer: boolean): string {
  const isWall = (ty: number, tx: number) => {
    if (ty < 0 || ty >= H || tx < 0 || tx >= W) return true;
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

  // Inner walls — but use mixed glyphs where inner meets outer
  const isOuter = (ty: number, tx: number) =>
    ty === IY || ty === IY + IH - 1 || tx === IX || tx === IX + IW - 1;

  const nOuter = isOuter(y - 1, x) && isWall(y - 1, x);
  const sOuter = isOuter(y + 1, x) && isWall(y + 1, x);
  const eOuter = isOuter(y, x + 1) && isWall(y, x + 1);
  const wOuter = isOuter(y, x - 1) && isWall(y, x - 1);

  // If touching outer wall, use junction glyphs
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

function renderGrid(grid: Grid): string {
  const lines: string[] = [];
  for (let y = 0; y < H; y++) {
    let line = '';
    for (let x = 0; x < W; x++) {
      const cell = grid[y][x];
      if (cell === 'floor') {
        line += '·';
      } else if (cell === 'door') {
        line += '+';
      } else if (cell === 'wall') {
        const outer = y === IY || y === IY + IH - 1 || x === IX || x === IX + IW - 1;
        line += wallGlyph(grid, x, y, outer);
      } else {
        line += ' ';
      }
    }
    lines.push(line);
  }
  return lines.join('\n');
}

// ── Generate multiple samples ──

function generate(): string {
  const grid = createGrid();
  rooms.length = 0;
  nextRoomId = 0;

  // Outer boundary (inset by PAD)
  for (let x = IX; x < IX + IW; x++) { grid[IY][x] = 'wall'; grid[IY + IH - 1][x] = 'wall'; }
  for (let y = IY; y < IY + IH; y++) { grid[y][IX] = 'wall'; grid[y][IX + IW - 1] = 'wall'; }

  // Recursive division on interior
  divide(grid, IX, IY, IW, IH, 0);

  return renderGrid(grid);
}

let output = '';
for (let i = 0; i < 5; i++) {
  output += `=== Recursive Division Sample ${i + 1} ===\n`;
  output += generate();
  output += `\n(${rooms.length} rooms)\n\n`;
}

process.stdout.write(output);
