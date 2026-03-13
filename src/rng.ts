// Seeded PRNG using mulberry32
// Replaces Math.random() across the codebase for reproducible generation

let _state = 0;
let _seed = 0;

/** Seed the global RNG. Call before any generation. */
export function seed(s: number) {
  _seed = s;
  _state = s;
}

/** Get the current seed (for display/reproduction). */
export function getSeed(): number {
  return _seed;
}

/** Generate a random float in [0, 1) — drop-in replacement for Math.random() */
export function random(): number {
  _state |= 0;
  _state = (_state + 0x6D2B79F5) | 0;
  let t = Math.imul(_state ^ (_state >>> 15), 1 | _state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Random integer in [min, max] inclusive */
export function randInt(min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

/** Pick a random element from an array */
export function pick<T>(arr: T[]): T {
  return arr[Math.floor(random() * arr.length)];
}

/** Shuffle an array in-place (Fisher-Yates) */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Save the current RNG state (for determinism checks). */
export function saveRngState(): number {
  return _state;
}

/** Restore a previously saved RNG state. */
export function restoreRngState(s: number) {
  _state = s;
}

/** Generate a seed from current time + small random component */
export function generateSeed(): number {
  return (Date.now() ^ (Math.random() * 0x7FFFFFFF)) >>> 0;
}
