// Algorithm 3: Squarified Treemap Subdivision
// Generates text representation for review

const W = 48;
const H = 28;
const MIN_ROOM_OUTER = 5; // minimum room dimension including walls

type Cell = 'floor' | 'wall' | 'door' | 'void';
type Grid = Cell[][];

interface RoomSpec {
  type: string;
  area: number;
}

interface Rect {
  x: number; y: number;
  w: number; h: number;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Generate a room manifest — 8-18 rooms of varying sizes
function generateManifest(): RoomSpec[] {
  const totalArea = (W - 2) * (H - 2);
  const rooms: RoomSpec[] = [];

  const types: { type: string; minArea: number; maxArea: number; weight: number }[] = [
    { type: 'bridge', minArea: 60, maxArea: 120, weight: 1 },
    { type: 'server', minArea: 40, maxArea: 80, weight: 2 },
    { type: 'corridor', minArea: 25, maxArea: 50, weight: 2 },
    { type: 'terminal', minArea: 20, maxArea: 40, weight: 3 },
    { type: 'storage', minArea: 15, maxArea: 30, weight: 2 },
    { type: 'closet', minArea: 12, maxArea: 20, weight: 2 },
  ];

  const pool: typeof types[number][] = [];
  for (const t of types) {
    for (let i = 0; i < t.weight; i++) pool.push(t);
  }

  let remaining = totalArea;
  const targetRooms = randInt(8, 16);

  for (let i = 0; i < targetRooms && remaining > 20; i++) {
    const spec = pool[Math.floor(Math.random() * pool.length)];
    const maxForThis = Math.min(spec.maxArea, remaining - (targetRooms - i - 1) * 15);
    const area = Math.max(spec.minArea, randInt(spec.minArea, Math.max(spec.minArea, maxForThis)));
    rooms.push({ type: spec.type, area: Math.min(area, remaining) });
    remaining -= rooms[rooms.length - 1].area;
  }

  // Distribute leftover among rooms
  if (remaining > 0 && rooms.length > 0) {
    const extra = Math.ceil(remaining / rooms.length);
    for (let i = 0; i < rooms.length && remaining > 0; i++) {
      const add = Math.min(extra, remaining);
      rooms[i].area += add;
      remaining -= add;
    }
  }

  rooms.sort((a, b) => b.area - a.area);
  return rooms;
}

// Squarified treemap — Bruls, Huizing, van Wijk (2000)

function worstAspectRatio(areas: number[], sideLength: number): number {
  if (sideLength <= 0) return Infinity;
  const totalArea = areas.reduce((s, a) => s + a, 0);
  if (totalArea <= 0) return Infinity;
  let worst = 0;
  for (const a of areas) {
    const rowThickness = totalArea / sideLength;
    if (rowThickness <= 0) return Infinity;
    const cellLength = a / rowThickness;
    const ratio = Math.max(cellLength / rowThickness, rowThickness / cellLength);
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

function layoutRow(
  areas: number[],
  rect: Rect,
  horizontal: boolean
): { rects: Rect[]; remaining: Rect } {
  const totalArea = areas.reduce((s, a) => s + a, 0);

  if (horizontal) {
    const rowWidth = rect.h > 0 ? totalArea / rect.h : rect.w;
    const rects: Rect[] = [];
    let cy = rect.y;
    for (const a of areas) {
      const cellH = rowWidth > 0 ? a / rowWidth : rect.h;
      rects.push({ x: rect.x, y: cy, w: rowWidth, h: cellH });
      cy += cellH;
    }
    return {
      rects,
      remaining: { x: rect.x + rowWidth, y: rect.y, w: rect.w - rowWidth, h: rect.h },
    };
  } else {
    const rowHeight = rect.w > 0 ? totalArea / rect.w : rect.h;
    const rects: Rect[] = [];
    let cx = rect.x;
    for (const a of areas) {
      const cellW = rowHeight > 0 ? a / rowHeight : rect.w;
      rects.push({ x: cx, y: rect.y, w: cellW, h: rowHeight });
      cx += cellW;
    }
    return {
      rects,
      remaining: { x: rect.x, y: rect.y + rowHeight, w: rect.w, h: rect.h - rowHeight },
    };
  }
}

function squarify(areas: number[], rect: Rect): Rect[] {
  if (areas.length === 0) return [];
  if (areas.length === 1) return [{ ...rect }];
  if (rect.w <= 0 || rect.h <= 0) return areas.map(() => ({ ...rect }));

  const horizontal = rect.w >= rect.h;
  const sideLength = horizontal ? rect.h : rect.w;

  let row = [areas[0]];
  let restStart = 1;
  let currentWorst = worstAspectRatio(row, sideLength);

  for (let i = 1; i < areas.length; i++) {
    const candidate = [...row, areas[i]];
    const candidateWorst = worstAspectRatio(candidate, sideLength);
    if (candidateWorst <= currentWorst) {
      row = candidate;
      restStart = i + 1;
      currentWorst = candidateWorst;
    } else {
      break;
    }
  }

  const { rects, remaining } = layoutRow(row, rect, horizontal);
  return [...rects, ...squarify(areas.slice(restStart), remaining)];
}

// Snap floating-point rects to integer grid with shared walls
// Key insight: adjacent rooms share a wall, so we snap edges to integer positions
// and each room includes its own walls (like carveRoom in recursive division)
function snapToGrid(floatRects: Rect[], bounds: Rect): Rect[] {
  // Convert to edge-based representation, snap edges to integers
  const result: Rect[] = [];

  for (const r of floatRects) {
    const x1 = Math.round(r.x);
    const y1 = Math.round(r.y);
    const x2 = Math.round(r.x + r.w);
    const y2 = Math.round(r.y + r.h);

    // Clamp to bounds
    const cx1 = Math.max(bounds.x, x1);
    const cy1 = Math.max(bounds.y, y1);
    const cx2 = Math.min(bounds.x + bounds.w, x2);
    const cy2 = Math.min(bounds.y + bounds.h, y2);

    const w = cx2 - cx1;
    const h = cy2 - cy1;

    if (w >= MIN_ROOM_OUTER && h >= MIN_ROOM_OUTER) {
      result.push({ x: cx1, y: cy1, w, h });
    } else if (w >= 3 && h >= 3) {
      // Still usable, just small
      result.push({ x: cx1, y: cy1, w, h });
    }
    // Skip degenerate rooms
  }

  return result;
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

function carveRoom(grid: Grid, r: Rect) {
  for (let ry = r.y; ry < r.y + r.h; ry++) {
    for (let rx = r.x; rx < r.x + r.w; rx++) {
      if (ry < 0 || ry >= H || rx < 0 || rx >= W) continue;
      if (ry === r.y || ry === r.y + r.h - 1 || rx === r.x || rx === r.x + r.w - 1) {
        if (grid[ry][rx] !== 'floor' && grid[ry][rx] !== 'door') {
          grid[ry][rx] = 'wall';
        }
      } else {
        grid[ry][rx] = 'floor';
      }
    }
  }
}

function placeDoors(grid: Grid, roomRects: Rect[]) {
  for (let i = 0; i < roomRects.length; i++) {
    for (let j = i + 1; j < roomRects.length; j++) {
      const a = roomRects[i];
      const b = roomRects[j];

      // Shared vertical wall
      if (a.x + a.w - 1 === b.x || b.x + b.w - 1 === a.x) {
        const wallX = a.x + a.w - 1 === b.x ? b.x : a.x;
        const overlapY1 = Math.max(a.y + 1, b.y + 1);
        const overlapY2 = Math.min(a.y + a.h - 2, b.y + b.h - 2);
        if (overlapY2 >= overlapY1) {
          const doorY = randInt(overlapY1, overlapY2);
          if (doorY >= 0 && doorY < H && wallX >= 0 && wallX < W) {
            grid[doorY][wallX] = 'door';
          }
          if (overlapY2 - overlapY1 >= 6 && Math.random() < 0.4) {
            const doorY2 = randInt(overlapY1, overlapY2);
            if (Math.abs(doorY2 - doorY) > 3 && doorY2 >= 0 && doorY2 < H) {
              grid[doorY2][wallX] = 'door';
            }
          }
        }
      }

      // Shared horizontal wall
      if (a.y + a.h - 1 === b.y || b.y + b.h - 1 === a.y) {
        const wallY = a.y + a.h - 1 === b.y ? b.y : a.y;
        const overlapX1 = Math.max(a.x + 1, b.x + 1);
        const overlapX2 = Math.min(a.x + a.w - 2, b.x + b.w - 2);
        if (overlapX2 >= overlapX1) {
          const doorX = randInt(overlapX1, overlapX2);
          if (doorX >= 0 && doorX < W && wallY >= 0 && wallY < H) {
            grid[wallY][doorX] = 'door';
          }
          if (overlapX2 - overlapX1 >= 6 && Math.random() < 0.4) {
            const doorX2 = randInt(overlapX1, overlapX2);
            if (Math.abs(doorX2 - doorX) > 3 && doorX2 >= 0 && doorX2 < W) {
              grid[wallY][doorX2] = 'door';
            }
          }
        }
      }
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

  const isOuter = (ty: number, tx: number) =>
    ty === 0 || ty === H - 1 || tx === 0 || tx === W - 1;

  const nOuter = isOuter(y - 1, x) && isWall(y - 1, x);
  const sOuter = isOuter(y + 1, x) && isWall(y + 1, x);
  const eOuter = isOuter(y, x + 1) && isWall(y, x + 1);
  const wOuter = isOuter(y, x - 1) && isWall(y, x - 1);

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
      if (cell === 'floor') line += '·';
      else if (cell === 'door') line += '+';
      else if (cell === 'wall') {
        const outer = y === 0 || y === H - 1 || x === 0 || x === W - 1;
        line += wallGlyph(grid, x, y, outer);
      }
      else line += ' ';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

// ── Generate ──

function generate(): { text: string; roomCount: number } {
  const grid = createGrid();
  const manifest = generateManifest();

  // Outer boundary
  for (let x = 0; x < W; x++) { grid[0][x] = 'wall'; grid[H - 1][x] = 'wall'; }
  for (let y = 0; y < H; y++) { grid[y][0] = 'wall'; grid[y][W - 1] = 'wall'; }

  // Interior bounds
  const interior: Rect = { x: 1, y: 1, w: W - 2, h: H - 2 };

  // Scale areas to fit interior
  const totalManifestArea = manifest.reduce((s, r) => s + r.area, 0);
  const totalInteriorArea = interior.w * interior.h;
  const scaledAreas = manifest.map(r => (r.area / totalManifestArea) * totalInteriorArea);

  // Run squarified treemap
  const floatRects = squarify(scaledAreas, interior);

  // Snap to integer grid
  const roomRects = snapToGrid(floatRects, interior);

  // Carve rooms
  for (const r of roomRects) {
    carveRoom(grid, r);
  }

  // Place doors
  placeDoors(grid, roomRects);

  return { text: renderGrid(grid), roomCount: roomRects.length };
}

let output = '';
for (let i = 0; i < 5; i++) {
  const { text, roomCount } = generate();
  output += `=== Treemap Sample ${i + 1} ===\n`;
  output += text;
  output += `\n(${roomCount} rooms)\n\n`;
}

process.stdout.write(output);
