// Algorithm 4: Tunneling with Room Excavation (Cogmind-style)
// Generates text representation for review

const W = 48;
const H = 28;

type Cell = 'floor' | 'wall' | 'void';
type Grid = Cell[][];

type Dir = 'n' | 's' | 'e' | 'w';

const DIR_DELTA: Record<Dir, [number, number]> = {
  n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0],
};
const ALL_DIRS: Dir[] = ['n', 's', 'e', 'w'];

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
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

function inBounds(x: number, y: number): boolean {
  return x >= 1 && x < W - 1 && y >= 1 && y < H - 1;
}

// Check if a rectangle is entirely void (safe to carve)
function canCarveRect(grid: Grid, x: number, y: number, w: number, h: number, padding: number): boolean {
  for (let ry = y - padding; ry < y + h + padding; ry++) {
    for (let rx = x - padding; rx < x + w + padding; rx++) {
      if (!inBounds(rx, ry)) return false;
      if (grid[ry][rx] === 'floor') return false;
    }
  }
  return true;
}

function carveRect(grid: Grid, x: number, y: number, w: number, h: number) {
  for (let ry = y; ry < y + h; ry++) {
    for (let rx = x; rx < x + w; rx++) {
      if (inBounds(rx, ry)) {
        grid[ry][rx] = 'floor';
      }
    }
  }
}

interface Tunneler {
  x: number;
  y: number;
  dir: Dir;
  width: number;
  life: number;
  turnChance: number;
  roomChance: number;
}

function turnDir(dir: Dir): Dir {
  if (dir === 'n' || dir === 's') return pick(['e', 'w']);
  return pick(['n', 's']);
}

function makeTunneler(x: number, y: number, dir: Dir): Tunneler {
  return {
    x, y, dir,
    width: pick([1, 1, 2]),
    life: randInt(15, 40),
    turnChance: 0.2 + Math.random() * 0.2,
    roomChance: 0.15 + Math.random() * 0.15,
  };
}

function stepTunneler(grid: Grid, t: Tunneler, tunnelers: Tunneler[]): boolean {
  if (t.life <= 0) return false;

  const [dx, dy] = DIR_DELTA[t.dir];

  // Carve corridor (width)
  for (let i = 0; i < t.width; i++) {
    let cx: number, cy: number;
    if (dx !== 0) {
      // Moving horizontally, width is vertical
      cx = t.x;
      cy = t.y + i;
    } else {
      cx = t.x + i;
      cy = t.y;
    }
    if (inBounds(cx, cy)) {
      grid[cy][cx] = 'floor';
    }
  }

  // Move forward
  t.x += dx;
  t.y += dy;
  t.life--;

  // Out of bounds? Stop
  if (!inBounds(t.x, t.y)) {
    t.life = 0;
    return false;
  }

  // Random turn
  if (Math.random() < t.turnChance) {
    t.dir = turnDir(t.dir);
  }

  // Random room excavation
  if (Math.random() < t.roomChance) {
    excavateRoom(grid, t.x, t.y, t.dir);
  }

  // Spawn child tunneler (rare)
  if (Math.random() < 0.05 && tunnelers.length < 8) {
    const childDir = turnDir(t.dir);
    tunnelers.push(makeTunneler(t.x, t.y, childDir));
  }

  return true;
}

function excavateRoom(grid: Grid, cx: number, cy: number, tunnelDir: Dir) {
  const rw = randInt(3, 8);
  const rh = randInt(3, 6);

  // Position room to the side of the tunnel
  let rx: number, ry: number;
  const [dx, dy] = DIR_DELTA[tunnelDir];

  if (dx !== 0) {
    // Tunnel goes horizontal → room above or below
    rx = cx - Math.floor(rw / 2);
    ry = pick([cy - rh - 1, cy + 2]);
  } else {
    // Tunnel goes vertical → room left or right
    rx = pick([cx - rw - 1, cx + 2]);
    ry = cy - Math.floor(rh / 2);
  }

  if (canCarveRect(grid, rx, ry, rw, rh, 1)) {
    carveRect(grid, rx, ry, rw, rh);
    // Connect room to tunnel with a short passage
    const connX = Math.min(Math.max(cx, rx), rx + rw - 1);
    const connY = Math.min(Math.max(cy, ry), ry + rh - 1);
    // Carve connection
    const minX = Math.min(cx, connX);
    const maxX = Math.max(cx, connX);
    const minY = Math.min(cy, connY);
    const maxY = Math.max(cy, connY);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (inBounds(x, y)) grid[y][x] = 'floor';
      }
    }
  }
}

// ── Surround floor with walls ──

function buildWalls(grid: Grid) {
  // Outer boundary
  for (let x = 0; x < W; x++) { grid[0][x] = 'wall'; grid[H - 1][x] = 'wall'; }
  for (let y = 0; y < H; y++) { grid[y][0] = 'wall'; grid[y][W - 1] = 'wall'; }

  // Inner walls: void adjacent to floor becomes wall
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (grid[y][x] !== 'void') continue;
      // Check 8 neighbors
      let adjFloor = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dy === 0 && dx === 0) continue;
          const ny = y + dy, nx = x + dx;
          if (ny >= 0 && ny < H && nx >= 0 && nx < W && grid[ny][nx] === 'floor') {
            adjFloor = true;
          }
        }
      }
      if (adjFloor) grid[y][x] = 'wall';
    }
  }
}

// ── Detect doors: wall tiles between two floor regions ──

type DoorGrid = ('floor' | 'wall' | 'door' | 'void')[][];

function placeDoors(grid: Grid): DoorGrid {
  const dg: DoorGrid = grid.map(row => [...row]) as DoorGrid;

  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (dg[y][x] !== 'wall') continue;

      // Horizontal door: floor left & right, wall up & down
      if (dg[y][x - 1] === 'floor' && dg[y][x + 1] === 'floor' &&
          dg[y - 1][x] === 'wall' && dg[y + 1][x] === 'wall') {
        dg[y][x] = 'door';
        continue;
      }

      // Vertical door: floor up & down, wall left & right
      if (dg[y - 1][x] === 'floor' && dg[y + 1][x] === 'floor' &&
          dg[y][x - 1] === 'wall' && dg[y][x + 1] === 'wall') {
        dg[y][x] = 'door';
      }
    }
  }
  return dg;
}

// ── Wall glyph ──

function wallGlyph(dg: DoorGrid, x: number, y: number, outer: boolean): string {
  const isW = (ty: number, tx: number) => {
    if (ty < 0 || ty >= H || tx < 0 || tx >= W) return true;
    return dg[ty][tx] === 'wall' || dg[ty][tx] === 'door';
  };
  const n = isW(y - 1, x), s = isW(y + 1, x), e = isW(y, x + 1), w = isW(y, x - 1);

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

function renderGrid(dg: DoorGrid): string {
  const lines: string[] = [];
  for (let y = 0; y < H; y++) {
    let line = '';
    for (let x = 0; x < W; x++) {
      const cell = dg[y][x];
      if (cell === 'floor') line += '·';
      else if (cell === 'door') line += '+';
      else if (cell === 'wall') {
        const outer = y === 0 || y === H - 1 || x === 0 || x === W - 1;
        line += wallGlyph(dg, x, y, outer);
      }
      else line += ' ';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

// ── Generate ──

function generate(): string {
  const grid = createGrid();

  // Seed 2-3 tunnelers from different positions
  const tunnelers: Tunneler[] = [];
  tunnelers.push(makeTunneler(Math.floor(W / 4), Math.floor(H / 2), 'e'));
  tunnelers.push(makeTunneler(Math.floor(3 * W / 4), Math.floor(H / 2), 'w'));
  if (Math.random() < 0.5) {
    tunnelers.push(makeTunneler(Math.floor(W / 2), Math.floor(H / 4), 's'));
  }

  // Run tunnelers
  let maxSteps = 500;
  while (maxSteps-- > 0) {
    let anyAlive = false;
    for (const t of tunnelers) {
      if (t.life > 0) {
        stepTunneler(grid, t, tunnelers);
        anyAlive = true;
      }
    }
    if (!anyAlive) break;
  }

  buildWalls(grid);
  const dg = placeDoors(grid);
  return renderGrid(dg);
}

let output = '';
for (let i = 0; i < 5; i++) {
  output += `=== Tunneling Sample ${i + 1} ===\n`;
  output += generate();
  output += '\n\n';
}

process.stdout.write(output);
