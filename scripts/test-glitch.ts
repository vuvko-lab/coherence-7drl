// Unit test for glitch effects — runs in Node.js via tsx.
// Tests that canvas effects call drawOver with valid coordinates and colors.
// CSS effects (shake, chromatic, etc.) are skipped in Node.js (no DOM).

// Minimal DOM stub so cssGlitch's document.getElementById resolves to null
(globalThis as any).document = { getElementById: () => null };
// setTimeout / clearTimeout are available natively in Node.js

import { initGlitch, glitchStaticBurst, glitchHorizontalTear, glitchDataBleed } from '../src/glitch';

// ── Mock renderer ──

interface DrawCall { x: number; y: number; ch: string; fg: string }

const W = 50, H = 30;
let calls: DrawCall[] = [];

const mockRenderer = {
  displayWidth: W,
  displayHeight: H,
  drawOver(x: number, y: number, ch: string, fg: string) {
    calls.push({ x, y, ch, fg });
  },
};

function reset() { calls = []; }

// ── Assertion helpers ──

let passed = 0, failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

function assertGt(n: number, min: number, msg: string) {
  assert(n > min, `${msg} (got ${n}, expected > ${min})`);
}

function assertInRange(n: number, lo: number, hi: number, msg: string) {
  assert(n >= lo && n <= hi, `${msg} (got ${n}, expected ${lo}–${hi})`);
}

// ── Tests ──

async function runTests() {
  initGlitch(mockRenderer);

  // ── staticBurst ──
  console.log('\nglitchStaticBurst:');

  reset();
  await glitchStaticBurst(50, 0.5);
  assertGt(calls.length, 0, 'produces drawOver calls');
  assertInRange(calls.length, W * H * 0.3, W * H * 2, 'call count plausible for 50% intensity');
  assert(calls.every(c => c.x >= 0 && c.x < W), 'x coords in bounds');
  assert(calls.every(c => c.y >= 0 && c.y < H), 'y coords in bounds');
  assert(calls.every(c => c.ch.length === 1), 'single character per call');
  assert(calls.every(c => /^#[0-9a-f]{6}$/i.test(c.fg)), 'fg is a hex color');

  // zero intensity → no calls
  reset();
  await glitchStaticBurst(50, 0);
  assert(calls.length === 0, 'zero intensity → no drawOver calls');

  // full intensity → every cell hit at least once
  reset();
  await glitchStaticBurst(50, 1.0);
  assertGt(calls.length, W * H - 1, 'full intensity → covers all cells');

  // ── horizontalTear ──
  console.log('\nglitchHorizontalTear:');

  reset();
  await glitchHorizontalTear(50);
  assertGt(calls.length, 0, 'produces drawOver calls');
  assert(calls.every(c => c.x >= 0 && c.x < W), 'x coords in bounds');
  assert(calls.every(c => c.y >= 0 && c.y < H), 'y coords in bounds');
  assert(calls.every(c => c.ch.length === 1), 'single character per call');

  // ── dataBleed ──
  console.log('\nglitchDataBleed:');

  reset();
  await glitchDataBleed(50);
  assertGt(calls.length, 0, 'produces drawOver calls');
  assert(calls.every(c => c.x >= 0 && c.x < W), 'x coords in bounds');
  assert(calls.every(c => c.y >= 0 && c.y < H), 'y coords in bounds');
  const cyberColors = new Set(['#00ffaa', '#00ff66', '#44ffcc', '#22ffaa', '#00cc88']);
  assert(calls.every(c => cyberColors.has(c.fg)), 'fg uses cyber color palette');

  // ── drawOver on Renderer uses bgCache ──
  console.log('\nRenderer.drawOver (bg cache):');
  {
    const drawCalls: { x: number; y: number; ch: string; fg: string; bg: string }[] = [];
    const mockDisplay = {
      _data: {} as Record<string, unknown>,
      draw(x: number, y: number, ch: string, fg: string, bg: string) {
        drawCalls.push({ x, y, ch, fg, bg });
        this._data[`${x},${y}`] = [x, y, ch, fg, bg];
      },
      drawOver(x: number, y: number, ch: string, fg: string, bg: string | null) {
        // Simulates the broken rot-js drawOver (no canvas flush)
        const key = `${x},${y}`;
        if (this._data[key]) {
          (this._data[key] as any[])[2] = ch;
        }
        // NOTE: intentionally does NOT call draw() — this is the rot-js bug
      },
    };

    // Patch a renderer instance manually to test the bgCache path
    const { Renderer } = await import('../src/renderer');
    const r = new Renderer('nonexistent') as any;
    r.display = mockDisplay;
    r.width = 5; r.height = 5;
    r.bgCache = Array.from({ length: 5 }, () => Array(5).fill('#112233'));

    r.drawOver(2, 2, 'X', '#ff0000');
    assertGt(drawCalls.length, 0, 'Renderer.drawOver calls display.draw (not drawOver)');
    assert(drawCalls[0].ch === 'X', 'correct character passed');
    assert(drawCalls[0].fg === '#ff0000', 'correct fg passed');
    assert(drawCalls[0].bg === '#112233', 'background taken from bgCache');
  }

  // ── Summary ──
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
