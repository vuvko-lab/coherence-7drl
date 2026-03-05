// ── Seeded 2D Perlin noise for infrastructure collapse heatmap ──

import { random } from './rng';

// Permutation table built from seeded RNG
let perm: number[] = [];

/** Call once after RNG is seeded to build the permutation table */
export function initNoise() {
  const base = Array.from({ length: 256 }, (_, i) => i);
  // Fisher-Yates shuffle using seeded RNG
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  perm = [...base, ...base]; // Double for overflow safety
}

// Gradient vectors for 2D Perlin noise
const GRAD2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10); // Smootherstep
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function grad2d(hash: number, x: number, y: number): number {
  const g = GRAD2[hash & 7];
  return g[0] * x + g[1] * y;
}

/** Raw 2D Perlin noise, returns roughly [-1, 1] */
function perlin2d(x: number, y: number): number {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);

  const u = fade(xf);
  const v = fade(yf);

  const aa = perm[perm[xi] + yi];
  const ab = perm[perm[xi] + yi + 1];
  const ba = perm[perm[xi + 1] + yi];
  const bb = perm[perm[xi + 1] + yi + 1];

  return lerp(
    lerp(grad2d(aa, xf, yf), grad2d(ba, xf - 1, yf), u),
    lerp(grad2d(ab, xf, yf - 1), grad2d(bb, xf - 1, yf - 1), u),
    v,
  );
}

/**
 * Multi-octave Perlin noise normalized to [0, 1].
 * @param x - world x coordinate
 * @param y - world y coordinate
 * @param scale - feature size (smaller = more zoomed in)
 * @param octaves - number of noise layers
 * @param persistence - amplitude falloff per octave (0.5 = halve each octave)
 */
export function collapseNoise(
  x: number,
  y: number,
  scale = 0.08,
  octaves = 2,
  persistence = 0.5,
): number {
  let value = 0;
  let amplitude = 1;
  let frequency = scale;
  let maxAmplitude = 0;

  for (let o = 0; o < octaves; o++) {
    value += perlin2d(x * frequency, y * frequency) * amplitude;
    maxAmplitude += amplitude;
    amplitude *= persistence;
    frequency *= 2;
  }

  // Normalize from [-maxAmplitude, maxAmplitude] to [0, 1]
  return (value / maxAmplitude + 1) * 0.5;
}
