// Test script for gen-halls map generator
// Usage: npx tsx scripts/test-halls.ts [iterations]

import { generate, floodFill } from './gen-halls';
import type { Grid, RoomDef } from './gen-halls';

const ITERATIONS = parseInt(process.argv[2] || '100', 10);
let failures = 0;

for (let i = 0; i < ITERATIONS; i++) {
  const { grid, rooms, halls } = generate();
  const errors: string[] = [];

  // Test 1: No small rooms (both dimensions must be >= 2)
  for (const room of rooms) {
    if (room.rect.w < 2 || room.rect.h < 2) {
      errors.push(`Room ${room.id} too small: ${room.rect.w}x${room.rect.h} at (${room.rect.x},${room.rect.y})`);
    }
  }

  // Test 2: Left interface exists
  let leftInterface: { x: number; y: number } | null = null;
  for (let y = 0; y < grid.h; y++) {
    if (grid.cells[y][0] === 'interface') {
      leftInterface = { x: 0, y };
      break;
    }
  }
  if (!leftInterface) {
    errors.push('No left interface found');
  }

  // Test 3: Every room is reachable from the left interface
  if (leftInterface) {
    const reachable = floodFill(grid, leftInterface.x, leftInterface.y);

    for (const room of rooms) {
      const r = room.rect;
      let roomReachable = false;
      for (let ry = r.y; ry < r.y + r.h && !roomReachable; ry++) {
        for (let rx = r.x; rx < r.x + r.w && !roomReachable; rx++) {
          if (reachable.has(`${rx},${ry}`)) {
            roomReachable = true;
          }
        }
      }
      if (!roomReachable) {
        errors.push(`Room ${room.id} (${r.w}x${r.h} at ${r.x},${r.y}, hall=${room.parentHallId}) unreachable from left interface`);
      }
    }
  }

  if (errors.length > 0) {
    failures++;
    console.error(`\n--- FAIL iteration ${i + 1} (${rooms.length} rooms, ${halls.length} halls) ---`);
    for (const err of errors) console.error(`  ${err}`);
  }
}

if (failures === 0) {
  console.log(`PASS: ${ITERATIONS} iterations, all checks passed`);
} else {
  console.error(`\nFAILED: ${failures}/${ITERATIONS} iterations had errors`);
  process.exit(1);
}
