// Screen glitch effects for corruption, ship damage, etc.
// Mix of CSS animation effects (applied to #game) and DOM cell manipulation (#map-grid).

// ── Helpers ──

const GLITCH_CHARS = '░▒▓█▄▀▐▌┃━╋╳⌧⌫◼◻∎∿≋≈';
const GLITCH_COLORS = ['#ff0044', '#ff2200', '#cc0066', '#ff4400', '#ff0088', '#aa0033', '#ff6600'];
const CYBER_COLORS = ['#00ffaa', '#00ff66', '#44ffcc', '#22ffaa', '#00cc88'];

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getMapCells(): HTMLSpanElement[][] {
  const grid = document.getElementById('map-grid');
  if (!grid) return [];
  const rows: HTMLSpanElement[][] = [];
  let currentRow: HTMLSpanElement[] = [];
  for (const child of grid.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).classList.contains('cell')) {
      currentRow.push(child as HTMLSpanElement);
    } else if (child.nodeType === Node.TEXT_NODE && child.textContent === '\n') {
      if (currentRow.length > 0) { rows.push(currentRow); currentRow = []; }
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);
  return rows;
}

interface CellSnap { text: string; color: string; bg: string }

function snap(c: HTMLSpanElement): CellSnap {
  return { text: c.textContent ?? ' ', color: c.style.color, bg: c.style.backgroundColor };
}

function put(c: HTMLSpanElement, s: CellSnap) {
  c.textContent = s.text; c.style.color = s.color; c.style.backgroundColor = s.bg;
}

// Apply temporary CSS classes to #game and clean up after duration
function cssGlitch(classes: string[], duration: number): Promise<void> {
  return new Promise(resolve => {
    const game = document.getElementById('game');
    if (!game) { resolve(); return; }
    for (const cls of classes) game.classList.add(cls);
    setTimeout(() => {
      for (const cls of classes) game.classList.remove(cls);
      resolve();
    }, duration);
  });
}

// ── Effect 1: Shake ──
// Whole game container shakes rapidly (CSS transform)
export function glitchShake(): Promise<void> {
  return cssGlitch(['glitch-shake'], 400);
}

// ── Effect 2: Chromatic Aberration ──
// Red/blue color split overlay via CSS pseudo-element
export function glitchChromatic(): Promise<void> {
  return cssGlitch(['glitch-chromatic'], 900);
}

// ── Effect 3: Bar Sweep ──
// A horizontal bar sweeps down the screen (CSS pseudo-element)
export function glitchBarSweep(): Promise<void> {
  return cssGlitch(['glitch-bars'], 1200);
}

// ── Effect 4: Static Burst ──
// Random cells flash garbage characters, like TV static
export function glitchStaticBurst(duration = 400, intensity = 0.15): Promise<void> {
  return new Promise(resolve => {
    const rows = getMapCells();
    if (rows.length === 0) { resolve(); return; }

    const saved: { cell: HTMLSpanElement; s: CellSnap }[] = [];
    for (const row of rows) {
      for (const cell of row) {
        if (Math.random() < intensity) {
          saved.push({ cell, s: snap(cell) });
          cell.textContent = pick(GLITCH_CHARS.split(''));
          cell.style.color = pick(GLITCH_COLORS);
        }
      }
    }

    // Second wave
    setTimeout(() => {
      for (const { cell } of saved) {
        if (Math.random() < 0.5) {
          cell.textContent = pick(GLITCH_CHARS.split(''));
          cell.style.color = pick(GLITCH_COLORS);
        }
      }
    }, duration / 2);

    setTimeout(() => {
      for (const { cell, s } of saved) put(cell, s);
      resolve();
    }, duration);
  });
}

// ── Effect 5: Horizontal Tear ──
// Bands of rows shift left/right, gaps filled with glitch chars
export function glitchHorizontalTear(duration = 500): Promise<void> {
  return new Promise(resolve => {
    const rows = getMapCells();
    if (rows.length === 0) { resolve(); return; }

    const tears: { rowIdx: number; saved: CellSnap[] }[] = [];

    for (let t = 0; t < randInt(2, 5); t++) {
      const startRow = randInt(0, rows.length - 1);
      const band = randInt(1, 3);
      const offset = randInt(1, 6) * (Math.random() < 0.5 ? -1 : 1);

      for (let dy = 0; dy < band; dy++) {
        const ri = startRow + dy;
        if (ri >= rows.length) continue;
        const row = rows[ri];
        const saved = row.map(c => snap(c));
        tears.push({ rowIdx: ri, saved });

        const w = row.length;
        for (let x = 0; x < w; x++) {
          const srcX = x - offset;
          if (srcX >= 0 && srcX < w) {
            row[x].textContent = saved[srcX].text;
            row[x].style.color = saved[srcX].color;
          } else {
            row[x].textContent = pick(GLITCH_CHARS.split(''));
            row[x].style.color = pick(GLITCH_COLORS);
          }
        }
      }
    }

    setTimeout(() => {
      for (const tr of tears) {
        const row = rows[tr.rowIdx];
        for (let x = 0; x < row.length; x++) put(row[x], tr.saved[x]);
      }
      resolve();
    }, duration);
  });
}

// ── Effect 6: Data Bleed ──
// Rectangular blocks of cells get copied/displaced across the screen
export function glitchDataBleed(duration = 500): Promise<void> {
  return new Promise(resolve => {
    const rows = getMapCells();
    if (rows.length === 0) { resolve(); return; }
    const h = rows.length, w = rows[0]?.length ?? 0;
    if (w === 0) { resolve(); return; }

    const saved: CellSnap[][] = rows.map(row => row.map(c => snap(c)));

    for (let b = 0; b < randInt(3, 6); b++) {
      const bw = randInt(4, 12), bh = randInt(2, 5);
      const sx = randInt(0, Math.max(0, w - bw - 1)), sy = randInt(0, Math.max(0, h - bh - 1));
      const dx = randInt(0, Math.max(0, w - bw - 1)), dy = randInt(0, Math.max(0, h - bh - 1));
      for (let iy = 0; iy < bh; iy++) {
        for (let ix = 0; ix < bw; ix++) {
          const fy = sy + iy, fx = sx + ix, ty = dy + iy, tx = dx + ix;
          if (fy < h && fx < w && ty < h && tx < w) {
            rows[ty][tx].textContent = saved[fy][fx].text;
            rows[ty][tx].style.color = pick(CYBER_COLORS);
          }
        }
      }
    }

    setTimeout(() => {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) put(rows[y][x], saved[y][x]);
      resolve();
    }, duration);
  });
}

// ── Effect 7: Text Flicker ──
// Skew + opacity flicker on the whole game (from ai_zero_rpg glitch-text-flicker)
export function glitchTextFlicker(): Promise<void> {
  return cssGlitch(['glitch-text-flicker'], 750);
}

// ── Effect 8: Hue Distort ──
// Hue-rotate + skew distortion sweep (from ai_zero_rpg entry-glitch)
export function glitchHueDistort(): Promise<void> {
  return cssGlitch(['glitch-hue-distort'], 500);
}

// ── Effect 9: Full Glitch ──
// Combines shake + chromatic + static for maximum impact
export function glitchFull(): Promise<void> {
  return Promise.all([
    cssGlitch(['glitch-shake', 'glitch-chromatic', 'glitch-bars'], 1200),
    glitchStaticBurst(600, 0.2),
  ]).then(() => {});
}

// Registry for admin panel
export const GLITCH_EFFECTS: { name: string; fn: () => Promise<void> }[] = [
  { name: 'Shake', fn: glitchShake },
  { name: 'Chromatic', fn: glitchChromatic },
  { name: 'Bar Sweep', fn: glitchBarSweep },
  { name: 'Text Flicker', fn: glitchTextFlicker },
  { name: 'Hue Distort', fn: glitchHueDistort },
  { name: 'Static Burst', fn: glitchStaticBurst },
  { name: 'Horiz. Tear', fn: glitchHorizontalTear },
  { name: 'Data Bleed', fn: glitchDataBleed },
  { name: 'FULL GLITCH', fn: glitchFull },
];
