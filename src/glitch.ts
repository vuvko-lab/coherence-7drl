// Screen glitch effects for corruption, ship damage, etc.
// CSS effects (shake, chromatic, bars, flicker, hue) animate the #game element.
// Canvas effects (static, tear, bleed) use ROT.Display.drawOver via the renderer.
// Restoration after canvas effects is handled by renderAll() in main.ts.

const GLITCH_CHARS = '░▒▓█▄▀▐▌┃━╋╳⌧⌫◼◻∎∿≋≈';
const GLITCH_COLORS = ['#ff0044', '#ff2200', '#cc0066', '#ff4400', '#ff0088', '#aa0033', '#ff6600'];
const CYBER_COLORS = ['#00ffaa', '#00ff66', '#44ffcc', '#22ffaa', '#00cc88'];

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Canvas glitch interface ──

export interface GlitchRenderer {
  displayWidth: number;
  displayHeight: number;
  drawOver(x: number, y: number, ch: string, fg: string): void;
}

let _renderer: GlitchRenderer | null = null;

export function initGlitch(r: GlitchRenderer) {
  _renderer = r;
}

// ── Helpers ──

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
export function glitchShake(): Promise<void> {
  return cssGlitch(['glitch-shake'], 400);
}

// ── Effect 2: Chromatic Aberration ──
export function glitchChromatic(): Promise<void> {
  return cssGlitch(['glitch-chromatic'], 900);
}

// ── Effect 3: Bar Sweep ──
export function glitchBarSweep(): Promise<void> {
  return cssGlitch(['glitch-bars'], 1200);
}

// ── Effect 4: Static Burst ──
// Random cells flash garbage characters via drawOver; renderAll() restores.
export function glitchStaticBurst(duration = 400, intensity = 0.15): Promise<void> {
  return new Promise(resolve => {
    const r = _renderer;
    if (!r) { resolve(); return; }
    const w = r.displayWidth, h = r.displayHeight;
    const glyphs = GLITCH_CHARS.split('');
    const affected: { x: number; y: number }[] = [];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (Math.random() < intensity) {
          r.drawOver(x, y, pick(glyphs), pick(GLITCH_COLORS));
          affected.push({ x, y });
        }
      }
    }

    // Second wave
    setTimeout(() => {
      for (const { x, y } of affected) {
        if (Math.random() < 0.5) r.drawOver(x, y, pick(glyphs), pick(GLITCH_COLORS));
      }
    }, duration / 2);

    setTimeout(() => resolve(), duration);
  });
}

// ── Effect 5: Horizontal Tear ──
// Bands of rows get glitch chars at the tear edges; renderAll() restores.
export function glitchHorizontalTear(duration = 500): Promise<void> {
  return new Promise(resolve => {
    const r = _renderer;
    if (!r) { resolve(); return; }
    const w = r.displayWidth, h = r.displayHeight;
    const glyphs = GLITCH_CHARS.split('');

    for (let t = 0; t < randInt(2, 5); t++) {
      const startRow = randInt(0, h - 1);
      const band = randInt(1, 3);
      const offset = randInt(1, 6);

      for (let dy = 0; dy < band; dy++) {
        const ry = startRow + dy;
        if (ry >= h) continue;
        // Tear edges
        for (let x = 0; x < offset; x++) r.drawOver(x, ry, pick(glyphs), pick(GLITCH_COLORS));
        for (let x = w - offset; x < w; x++) r.drawOver(x, ry, pick(glyphs), pick(GLITCH_COLORS));
        // Sparse scatter in the middle
        for (let x = offset; x < w - offset; x++) {
          if (Math.random() < 0.25) r.drawOver(x, ry, pick(glyphs), pick(GLITCH_COLORS));
        }
      }
    }

    setTimeout(() => resolve(), duration);
  });
}

// ── Effect 6: Data Bleed ──
// Rectangular blocks of glitch chars in cyber colors; renderAll() restores.
export function glitchDataBleed(duration = 500): Promise<void> {
  return new Promise(resolve => {
    const r = _renderer;
    if (!r) { resolve(); return; }
    const w = r.displayWidth, h = r.displayHeight;
    const glyphs = GLITCH_CHARS.split('');

    for (let b = 0; b < randInt(3, 6); b++) {
      const bw = randInt(4, 12), bh = randInt(2, 5);
      const dx = randInt(0, Math.max(0, w - bw - 1));
      const dy = randInt(0, Math.max(0, h - bh - 1));
      const color = pick(CYBER_COLORS);
      for (let iy = 0; iy < bh; iy++) {
        for (let ix = 0; ix < bw; ix++) {
          r.drawOver(dx + ix, dy + iy, pick(glyphs), color);
        }
      }
    }

    setTimeout(() => resolve(), duration);
  });
}

// ── Effect 7: Text Flicker ──
export function glitchTextFlicker(): Promise<void> {
  return cssGlitch(['glitch-text-flicker'], 750);
}

// ── Effect 8: Hue Distort ──
export function glitchHueDistort(): Promise<void> {
  return cssGlitch(['glitch-hue-distort'], 500);
}

// ── Effect 9: Full Glitch ──
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
