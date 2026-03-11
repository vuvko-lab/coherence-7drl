/**
 * TDD tests for dialog input handling.
 *
 * Tests the pure keyboard→action mapping for overlays and click→action for map.
 * Also runs a full integration test: create game, walk to terminal, interact,
 * select choice, close via backspace.
 *
 * Usage:  npx tsx src/tests/dialog-input-test.ts
 */

import { handleOverlayKey, mapClickAction, type OverlayState } from '../dialog-input';
import { createGame, processAction, executeInteractableAction } from '../game';
import { seed as seedRng } from '../rng';
import { findPath } from '../pathfinding';
import type { GameState, Position } from '../types';

// ── Test harness ──

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
  }
}

function assertEq<T>(actual: T, expected: T, msg: string) {
  const eq = JSON.stringify(actual) === JSON.stringify(expected);
  if (eq) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${msg}  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
  }
}

// ── Overlay key handling tests ──

console.log('\n\x1b[1m── Overlay close key tests ──\x1b[0m');

const baseState: OverlayState = {
  aimMode: false,
  interactableOpen: false,
  terminalOpen: false,
  aboutOpen: false,
  settingsOpen: false,
  interactableEnabledCount: 0,
  terminalEnabledCount: 0,
};

// Backspace closes interactable
{
  const s = { ...baseState, interactableOpen: true };
  const action = handleOverlayKey('Backspace', s);
  assertEq(action?.kind, 'close_interactable', 'Backspace closes interactable overlay');
}

// Backspace closes terminal
{
  const s = { ...baseState, terminalOpen: true };
  const action = handleOverlayKey('Backspace', s);
  assertEq(action?.kind, 'close_terminal', 'Backspace closes terminal overlay');
}

// Backspace exits aim mode
{
  const s = { ...baseState, aimMode: true };
  const action = handleOverlayKey('Backspace', s);
  assertEq(action?.kind, 'exit_aim', 'Backspace exits aim mode');
}

// Backspace closes about overlay
{
  const s = { ...baseState, aboutOpen: true };
  const action = handleOverlayKey('Backspace', s);
  assertEq(action?.kind, 'close_about', 'Backspace closes about overlay');
}

// Backspace closes settings overlay
{
  const s = { ...baseState, settingsOpen: true };
  const action = handleOverlayKey('Backspace', s);
  assertEq(action?.kind, 'close_settings', 'Backspace closes settings overlay');
}

// ESC does NOT close anything (itch.io fullscreen conflict)
{
  const s = { ...baseState, interactableOpen: true };
  const action = handleOverlayKey('Escape', s);
  assertEq(action, null, 'Escape does NOT close interactable (itch.io compat)');
}
{
  const s = { ...baseState, terminalOpen: true };
  const action = handleOverlayKey('Escape', s);
  assertEq(action, null, 'Escape does NOT close terminal (itch.io compat)');
}

// Backspace with no overlay open → null
{
  const action = handleOverlayKey('Backspace', baseState);
  assertEq(action, null, 'Backspace with no overlay open returns null');
}

console.log('\n\x1b[1m── Number key choice selection tests ──\x1b[0m');

// Number keys select interactable choices
{
  const s = { ...baseState, interactableOpen: true, interactableEnabledCount: 3 };
  const action = handleOverlayKey('1', s);
  assertEq(action, { kind: 'select_interactable_choice', index: 0 }, 'Key "1" selects first interactable choice');
}
{
  const s = { ...baseState, interactableOpen: true, interactableEnabledCount: 3 };
  const action = handleOverlayKey('3', s);
  assertEq(action, { kind: 'select_interactable_choice', index: 2 }, 'Key "3" selects third interactable choice');
}

// Number key out of range → null
{
  const s = { ...baseState, interactableOpen: true, interactableEnabledCount: 2 };
  const action = handleOverlayKey('5', s);
  assertEq(action, null, 'Key "5" with only 2 choices returns null');
}

// Number keys select terminal choices
{
  const s = { ...baseState, terminalOpen: true, terminalEnabledCount: 4 };
  const action = handleOverlayKey('2', s);
  assertEq(action, { kind: 'select_terminal_choice', index: 1 }, 'Key "2" selects second terminal choice');
}

// Number keys with no overlay → null
{
  const action = handleOverlayKey('1', baseState);
  assertEq(action, null, 'Number key with no overlay open returns null');
}

// Non-number, non-backspace key → null
{
  const s = { ...baseState, interactableOpen: true, interactableEnabledCount: 3 };
  const action = handleOverlayKey('a', s);
  assertEq(action, null, 'Non-special key returns null');
}

console.log('\n\x1b[1m── Map click tests ──\x1b[0m');

// Click on self = wait
{
  const action = mapClickAction(5, 5, { playerX: 5, playerY: 5 });
  assertEq(action, { kind: 'wait' }, 'Click on player position = wait');
}

// Click adjacent = move
{
  const action = mapClickAction(6, 5, { playerX: 5, playerY: 5 });
  assertEq(action, { kind: 'move', dir: 'right' }, 'Click right-adjacent = move right');
}
{
  const action = mapClickAction(4, 5, { playerX: 5, playerY: 5 });
  assertEq(action, { kind: 'move', dir: 'left' }, 'Click left-adjacent = move left');
}
{
  const action = mapClickAction(5, 4, { playerX: 5, playerY: 5 });
  assertEq(action, { kind: 'move', dir: 'up' }, 'Click up-adjacent = move up');
}
{
  const action = mapClickAction(5, 6, { playerX: 5, playerY: 5 });
  assertEq(action, { kind: 'move', dir: 'down' }, 'Click down-adjacent = move down');
}

// Click far = pathfind
{
  const action = mapClickAction(10, 10, { playerX: 5, playerY: 5 });
  assertEq(action, { kind: 'pathfind', x: 10, y: 10 }, 'Click far = pathfind');
}

// Click diagonal-adjacent = pathfind (not direct move)
{
  const action = mapClickAction(6, 6, { playerX: 5, playerY: 5 });
  assertEq(action, { kind: 'pathfind', x: 6, y: 6 }, 'Click diagonal = pathfind (not adjacent)');
}

// ── Helper: walk player to a target position via pathfinding ──

function walkPlayerTo(state: GameState, cluster: any, target: Position): boolean {
  const DIRS = [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }];

  for (let attempt = 0; attempt < 200; attempt++) {
    if (state.openTerminal || state.openInteractable) return true;
    if ((state.player.coherence ?? 0) <= 0) return false;

    const dist = Math.abs(state.player.position.x - target.x) + Math.abs(state.player.position.y - target.y);

    // Adjacent to target — bump into it
    if (dist === 1) {
      const dx = target.x - state.player.position.x;
      const dy = target.y - state.player.position.y;
      const dir = dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'down' : 'up';
      processAction(state, { kind: 'move', dir: dir as any });
      return state.openTerminal != null || state.openInteractable != null;
    }

    // Find an adjacent walkable tile to the target and path to it
    let adjacentTarget: Position | null = null;
    let bestPathLen = Infinity;
    for (const d of DIRS) {
      const ax = target.x + d.x, ay = target.y + d.y;
      const tile = cluster.tiles[ay]?.[ax];
      if (!tile?.walkable) continue;
      const p = findPath(cluster, state.player.position, { x: ax, y: ay });
      if (p && p.length < bestPathLen) {
        bestPathLen = p.length;
        adjacentTarget = { x: ax, y: ay };
      }
    }
    if (!adjacentTarget) return false;

    const path = findPath(cluster, state.player.position, adjacentTarget);
    if (!path || path.length === 0) return false;

    // Take the first step
    const step = path[0];
    const dx = step.x - state.player.position.x;
    const dy = step.y - state.player.position.y;
    if (Math.abs(dx) + Math.abs(dy) !== 1) return false; // shouldn't happen
    const dir = dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'down' : 'up';
    processAction(state, { kind: 'move', dir: dir as any });
  }
  return false;
}

// ── Integration test: walk to terminal, interact, close ──

console.log('\n\x1b[1m── Integration: terminal interaction flow ──\x1b[0m');

{
  // Try multiple seeds to find one where we can reach a terminal
  let tested = false;
  for (const testSeed of [42, 7, 13, 99, 123, 200, 314]) {
    seedRng(testSeed);
    const state = createGame();
    const cluster = state.clusters.get(state.currentClusterId)!;

    // Find the closest reachable terminal
    const terminals = [...cluster.terminals].sort((a, b) => {
      const da = Math.abs(a.position.x - state.player.position.x) + Math.abs(a.position.y - state.player.position.y);
      const db = Math.abs(b.position.x - state.player.position.x) + Math.abs(b.position.y - state.player.position.y);
      return da - db;
    });

    for (const terminal of terminals) {
      const reached = walkPlayerTo(state, cluster, terminal.position);
      if (!reached || !state.openTerminal) continue;

      tested = true;
      assert(true, `Reached terminal "${terminal.label}" (seed=${testSeed})`);
      assertEq(state.openTerminal.terminalId, terminal.id, 'Opened correct terminal');

      // Count enabled terminal options (matches what main.ts renders)
      let enabledChoices = 0;
      if (terminal.hasKey && cluster.exitLocked && !terminal.isFinalTerminal) enabledChoices++;
      if (terminal.hazardOverrides) enabledChoices += terminal.hazardOverrides.length;
      enabledChoices++; // close button always present

      const overlayState: OverlayState = {
        aimMode: false,
        interactableOpen: false,
        terminalOpen: true,
        aboutOpen: false,
        settingsOpen: false,
        interactableEnabledCount: 0,
        terminalEnabledCount: enabledChoices,
      };

      // Key "1" selects first choice
      const selectAction = handleOverlayKey('1', overlayState);
      assertEq(selectAction?.kind, 'select_terminal_choice', 'Key "1" selects a terminal choice');
      assert(
        selectAction !== null && 'index' in selectAction && selectAction.index === 0,
        'Key "1" selects index 0',
      );

      // Backspace closes
      const closeAction = handleOverlayKey('Backspace', overlayState);
      assertEq(closeAction?.kind, 'close_terminal', 'Backspace closes terminal');

      // Simulate close
      state.openTerminal = undefined;
      assertEq(state.openTerminal, undefined, 'Terminal closed after Backspace action');

      // ESC does NOT close
      const escAction = handleOverlayKey('Escape', overlayState);
      assertEq(escAction, null, 'Escape does NOT close terminal (itch.io compat)');

      break;
    }
    if (tested) break;
  }
  assert(tested, 'Found and tested at least one terminal across seeds');
}

// ── Integration test: walk to interactable, interact, navigate dialog ──

console.log('\n\x1b[1m── Integration: interactable dialog flow ──\x1b[0m');

{
  let tested = false;
  for (const testSeed of [7, 42, 13, 99, 123, 200, 314]) {
    seedRng(testSeed);
    const state = createGame();
    const cluster = state.clusters.get(state.currentClusterId)!;

    // Find interactables with dialog choices, sorted by distance
    const items = cluster.interactables
      .filter(i => !i.hidden && i.dialog.find(n => n.id === 'root')?.choices.length)
      .sort((a, b) => {
        const da = Math.abs(a.position.x - state.player.position.x) + Math.abs(a.position.y - state.player.position.y);
        const db = Math.abs(b.position.x - state.player.position.x) + Math.abs(b.position.y - state.player.position.y);
        return da - db;
      });

    for (const item of items) {
      const reached = walkPlayerTo(state, cluster, item.position);
      if (!reached || !state.openInteractable) continue;

      tested = true;
      assert(true, `Reached interactable "${item.kind}" (seed=${testSeed})`);

      // Count enabled choices
      const rootNode = item.dialog.find(n => n.id === item.currentNodeId)!;
      const visibleChoices = rootNode.choices.filter(c => {
        if (c.requiresRewardAvailable && item.rewardTaken) return false;
        if (c.requiresExitLocked && !cluster.exitLocked) return false;
        if (c.requiresRootPartAvailable && item.rootPartTaken) return false;
        return true;
      });

      const overlayState: OverlayState = {
        aimMode: false,
        interactableOpen: true,
        terminalOpen: false,
        aboutOpen: false,
        settingsOpen: false,
        interactableEnabledCount: visibleChoices.length,
        terminalEnabledCount: 0,
      };

      assert(visibleChoices.length > 0, `Interactable has ${visibleChoices.length} enabled choices`);

      // Key "1" selects choice
      const selectAction = handleOverlayKey('1', overlayState);
      assertEq(selectAction?.kind, 'select_interactable_choice', 'Key "1" selects interactable choice');

      // Navigate dialog if choice has a nodeId
      if (visibleChoices[0]?.nodeId) {
        item.currentNodeId = visibleChoices[0].nodeId;
        const nextNode = item.dialog.find(n => n.id === item.currentNodeId);
        assert(nextNode !== undefined, `Dialog navigation: reached node "${item.currentNodeId}"`);
      } else if (visibleChoices[0]?.action) {
        const shouldClose = executeInteractableAction(
          state, item.id, state.openInteractable!.clusterId,
          visibleChoices[0].action, visibleChoices[0],
        );
        assert(typeof shouldClose === 'boolean', `executeInteractableAction returned boolean (${shouldClose})`);
      }

      // Backspace closes
      const closeAction = handleOverlayKey('Backspace', overlayState);
      assertEq(closeAction?.kind, 'close_interactable', 'Backspace closes interactable');

      state.openInteractable = undefined;
      assertEq(state.openInteractable, undefined, 'Interactable closed after Backspace');

      // ESC does NOT close
      const escAction = handleOverlayKey('Escape', overlayState);
      assertEq(escAction, null, 'Escape does NOT close interactable');

      break;
    }
    if (tested) break;
  }
  assert(tested, 'Found and tested at least one interactable across seeds');
}

// ── Summary ──

console.log(`\n\x1b[1m${passed + failed} tests: \x1b[32m${passed} passed\x1b[0m, \x1b[${failed > 0 ? '31' : '32'}m${failed} failed\x1b[0m\n`);
process.exit(failed > 0 ? 1 : 0);
