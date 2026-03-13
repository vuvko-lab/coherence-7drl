/**
 * Test suite runner — executes all test scripts and reports results.
 *
 * Usage:
 *   npx tsx src/tests/run-all.ts           # run all tests
 *   npm test                               # same (via package.json script)
 */

import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  output: string;
}

const results: TestResult[] = [];

// Explicit test suites with their default args
const explicitSuites = new Set(['sim-test.ts', 'ai-player.ts', 'gen-html.ts', 'run-all.ts']);

// Discover test files: anything ending in -test.ts (excluding explicit suites)
const testFiles = readdirSync(__dirname)
  .filter(f => f.endsWith('-test.ts') && !explicitSuites.has(f))
  .sort();

const suites: Array<{ file: string; args: string }> = [
  ...testFiles.map(f => ({ file: f, args: '' })),
  { file: 'sim-test.ts', args: '--seeds 10 --ticks 100' },
  { file: 'ai-player.ts', args: '--seeds 5' },
];

console.log(`\x1b[1m\n═══ Coherence Test Suite ═══\x1b[0m\n`);

for (const { file, args } of suites) {
  const filePath = join(__dirname, file);
  const label = file.replace('.ts', '');
  process.stdout.write(`  Running \x1b[36m${label}\x1b[0m${args ? ` (${args})` : ''}...`);

  const start = Date.now();
  try {
    const output = execSync(`npx tsx "${filePath}" ${args}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000,
      cwd: join(__dirname, '../..'),
    });
    const duration = Date.now() - start;
    results.push({ name: label, passed: true, duration, output });
    console.log(` \x1b[32mPASS\x1b[0m (${(duration / 1000).toFixed(1)}s)`);
  } catch (err: any) {
    const duration = Date.now() - start;
    const output = (err.stdout ?? '') + '\n' + (err.stderr ?? '');
    results.push({ name: label, passed: false, duration, output });
    console.log(` \x1b[31mFAIL\x1b[0m (${(duration / 1000).toFixed(1)}s)`);
  }
}

// Summary
console.log(`\n\x1b[1m═══ Results ═══\x1b[0m\n`);

const passed = results.filter(r => r.passed);
const failed = results.filter(r => !r.passed);

for (const r of results) {
  const icon = r.passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${icon} ${r.name} (${(r.duration / 1000).toFixed(1)}s)`);
}

if (failed.length > 0) {
  console.log(`\n\x1b[1m── Failed test output ──\x1b[0m\n`);
  for (const r of failed) {
    console.log(`\x1b[31m── ${r.name} ──\x1b[0m`);
    // Show last 30 lines of output
    const lines = r.output.trim().split('\n');
    const tail = lines.slice(-30);
    console.log(tail.join('\n'));
    console.log('');
  }
}

const total = results.length;
console.log(`\n\x1b[1m${total} suites: \x1b[32m${passed.length} passed\x1b[0m, \x1b[${failed.length > 0 ? '31' : '32'}m${failed.length} failed\x1b[0m\n`);

process.exit(failed.length > 0 ? 1 : 0);
