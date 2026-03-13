/**
 * God mode tests — verify noclip (walk through walls) works.
 *
 * The old code emitted a move intent but resolveMove always checked
 * tile.walkable, blocking god mode movement through walls.
 * The fix: MoveIntent.force skips walkability checks.
 *
 * Usage:  npx tsx src/tests/godmode-test.ts
 */

import { createGame, processAction } from '../game';
import { seed as seedRng } from '../rng';
import { TileType } from '../types';
import type { PlayerAction } from '../types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
    passed++;
  } else {
    console.log(`  \x1b[31m✗\x1b[0m ${label}`);
    failed++;
  }
}

console.log('\x1b[1m── God mode: noclip through walls ──\x1b[0m');

seedRng(42);
const state = createGame();
const cluster = state.clusters.get(state.currentClusterId)!;

// Find a wall tile adjacent to the player
const px = state.player.position.x;
const py = state.player.position.y;

// Search for an adjacent wall in each direction
const dirs: { dir: 'up' | 'down' | 'left' | 'right'; dx: number; dy: number }[] = [
  { dir: 'right', dx: 1, dy: 0 },
  { dir: 'left', dx: -1, dy: 0 },
  { dir: 'down', dx: 0, dy: 1 },
  { dir: 'up', dx: 0, dy: -1 },
];

let wallDir: typeof dirs[0] | null = null;
for (const d of dirs) {
  const tile = cluster.tiles[py + d.dy]?.[px + d.dx];
  if (tile?.type === TileType.Wall) {
    wallDir = d;
    break;
  }
}

// If no wall adjacent to start, walk until we find one
if (!wallDir) {
  // Move right until we hit a wall
  for (let i = 0; i < 20; i++) {
    const nx = state.player.position.x + 1;
    const tile = cluster.tiles[state.player.position.y]?.[nx];
    if (tile?.type === TileType.Wall) {
      wallDir = { dir: 'right', dx: 1, dy: 0 };
      break;
    }
    if (tile?.walkable) {
      processAction(state, { kind: 'move', dir: 'right' });
    } else {
      break;
    }
  }
}

assert(wallDir !== null, `Found wall adjacent to player at (${state.player.position.x},${state.player.position.y})`);

if (wallDir) {
  const wallX = state.player.position.x + wallDir.dx;
  const wallY = state.player.position.y + wallDir.dy;
  const wallTile = cluster.tiles[wallY][wallX];

  assert(wallTile.type === TileType.Wall, `Tile at (${wallX},${wallY}) is a wall`);
  assert(!wallTile.walkable, 'Wall tile is not walkable');

  // Try moving into wall WITHOUT god mode — should not move
  const beforeX = state.player.position.x;
  const beforeY = state.player.position.y;
  processAction(state, { kind: 'move', dir: wallDir.dir });
  assert(
    state.player.position.x === beforeX && state.player.position.y === beforeY,
    'Normal mode: player does NOT move through wall'
  );

  // Enable god mode
  state.godMode = true;

  // Try moving into wall WITH god mode — should move through
  processAction(state, { kind: 'move', dir: wallDir.dir });
  assert(
    state.player.position.x === wallX && state.player.position.y === wallY,
    'God mode: player moves through wall (noclip)'
  );

  // Move again to verify continued noclip
  const nextX = wallX + wallDir.dx;
  const nextY = wallY + wallDir.dy;
  if (nextX >= 0 && nextX < cluster.width && nextY >= 0 && nextY < cluster.height) {
    processAction(state, { kind: 'move', dir: wallDir.dir });
    assert(
      state.player.position.x === nextX && state.player.position.y === nextY,
      'God mode: player continues moving through consecutive tiles'
    );
  }

  // Disable god mode, verify wall blocks again
  state.godMode = false;
  const posBeforeDisable = { ...state.player.position };
  // Move player back to a floor tile first
  state.player.position = { x: beforeX, y: beforeY };
  processAction(state, { kind: 'move', dir: wallDir.dir });
  assert(
    state.player.position.x === beforeX && state.player.position.y === beforeY,
    'After disabling god mode: wall blocks again'
  );
}

// ── Summary ──

console.log(`\n\x1b[1m${passed + failed} tests: \x1b[32m${passed} passed\x1b[0m, \x1b[${failed > 0 ? '31' : '32'}m${failed} failed\x1b[0m`);
process.exit(failed > 0 ? 1 : 0);
