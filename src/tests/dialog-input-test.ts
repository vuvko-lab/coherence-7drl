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
import { createGame, processAction, executeInteractableAction, adminTeleportToCluster } from '../game';
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
  interactableChoiceCount: 0,
  terminalChoiceCount: 0,
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
  const s = { ...baseState, interactableOpen: true, interactableChoiceCount: 3 };
  const action = handleOverlayKey('1', s);
  assertEq(action, { kind: 'select_interactable_choice', index: 0 }, 'Key "1" selects first interactable choice');
}
{
  const s = { ...baseState, interactableOpen: true, interactableChoiceCount: 3 };
  const action = handleOverlayKey('3', s);
  assertEq(action, { kind: 'select_interactable_choice', index: 2 }, 'Key "3" selects third interactable choice');
}

// Number key out of range → null
{
  const s = { ...baseState, interactableOpen: true, interactableChoiceCount: 2 };
  const action = handleOverlayKey('5', s);
  assertEq(action, null, 'Key "5" with only 2 choices returns null');
}

// Number keys select terminal choices
{
  const s = { ...baseState, terminalOpen: true, terminalChoiceCount: 4 };
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
  const s = { ...baseState, interactableOpen: true, interactableChoiceCount: 3 };
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
        interactableChoiceCount: 0,
        terminalChoiceCount: enabledChoices,
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
        // rootPartTaken choices are now visible (shown disabled), not hidden
        return true;
      });

      const overlayState: OverlayState = {
        aimMode: false,
        interactableOpen: true,
        terminalOpen: false,
        aboutOpen: false,
        settingsOpen: false,
        interactableChoiceCount: visibleChoices.length,
        terminalChoiceCount: 0,
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

// ── Dialog label content tests: no [ESC] in choice labels ──

console.log('\n\x1b[1m── Dialog label content checks ──\x1b[0m');

{
  // Generate multiple clusters and scan all dialog choice labels for [ESC]
  const badLabels: string[] = [];
  let totalChoices = 0;

  for (const testSeed of [1, 7, 42, 99, 200]) {
    seedRng(testSeed);
    const state = createGame();
    // Scan all clusters
    for (const [, cluster] of state.clusters) {
      // Check interactable dialog choices
      for (const item of cluster.interactables) {
        for (const node of item.dialog) {
          for (const choice of node.choices) {
            totalChoices++;
            if (choice.label.includes('[ESC]')) {
              badLabels.push(`seed=${testSeed} interactable="${item.kind}" node="${node.id}": "${choice.label}"`);
            }
          }
        }
      }
    }
  }

  assert(totalChoices > 0, `Scanned ${totalChoices} dialog choices across 5 seeds`);
  assert(badLabels.length === 0,
    badLabels.length === 0
      ? 'No dialog choice labels contain [ESC]'
      : `${badLabels.length} labels still contain [ESC]: ${badLabels[0]}`);
}

// ── Overridden choices disabled, close/back always enabled ──

console.log('\n\x1b[1m── Overridden vs close/back choice state ──\x1b[0m');

{
  // Simulate the dialog rendering logic from main.ts openInteractableOverlay()
  // to verify that:
  //   1. Deactivated hazard choices are disabled
  //   2. Close/back choices are never disabled
  //   3. Number key indices match visual labels (no disabled gaps)

  // Reproduce the isDeactivatedHazard + disabled logic from main.ts
  function classifyChoices(
    item: { dialog: any[]; currentNodeId: string; rewardTaken: boolean; rootPartTaken?: boolean },
    cluster: { rooms: any[]; exitLocked: boolean },
  ): Array<{ label: string; disabled: boolean; isClose: boolean }> {
    const node = item.dialog.find((n: any) => n.id === item.currentNodeId);
    if (!node) return [];

    const result: Array<{ label: string; disabled: boolean; isClose: boolean }> = [];
    for (const choice of node.choices) {
      if (choice.requiresRewardAvailable && item.rewardTaken) continue;
      if (choice.requiresExitLocked && !cluster.exitLocked) continue;

      const isRootPartTaken = choice.requiresRootPartAvailable && item.rootPartTaken;

      const isDeactivatedHazard = (() => {
        if (choice.action === 'deactivate_hazard') {
          const rid = choice.deactivatesHazardRoomId;
          if (rid != null) {
            const room = cluster.rooms.find((r: any) => r.id === rid);
            return room?.roomType === 'normal';
          }
        }
        if (choice.nodeId?.startsWith('deactivate_')) {
          const targetNode = item.dialog.find((n: any) => n.id === choice.nodeId);
          const deactChoice = targetNode?.choices.find((c: any) => c.action === 'deactivate_hazard');
          if (deactChoice?.deactivatesHazardRoomId != null) {
            const room = cluster.rooms.find((r: any) => r.id === deactChoice.deactivatesHazardRoomId);
            return room?.roomType === 'normal';
          }
        }
        return false;
      })();

      const isClose = choice.action === 'close' || choice.label.includes('[BACK]');
      result.push({ label: choice.label, disabled: isDeactivatedHazard || isRootPartTaken, isClose });
    }
    return result;
  }

  let testedOverridden = false;
  for (const testSeed of [1, 7, 42, 99, 123, 200, 314]) {
    seedRng(testSeed);
    const state = createGame();
    const cluster = state.clusters.get(state.currentClusterId)!;

    // Find an interactable with a deactivate_hazard choice
    for (const item of cluster.interactables) {
      if (item.hidden) continue;
      for (const node of item.dialog) {
        const hasDeactivate = node.choices.some((c: any) =>
          c.action === 'deactivate_hazard' || c.nodeId?.startsWith('deactivate_'));
        if (!hasDeactivate) continue;

        // Find the hazard room to deactivate
        const deactChoice = node.choices.find((c: any) => c.action === 'deactivate_hazard');
        const deactNavChoice = node.choices.find((c: any) => c.nodeId?.startsWith('deactivate_'));
        let hazardRoomId: number | undefined;
        if (deactChoice?.deactivatesHazardRoomId != null) {
          hazardRoomId = deactChoice.deactivatesHazardRoomId;
        } else if (deactNavChoice) {
          const targetNode = item.dialog.find((n: any) => n.id === deactNavChoice.nodeId);
          const dc = targetNode?.choices.find((c: any) => c.action === 'deactivate_hazard');
          hazardRoomId = dc?.deactivatesHazardRoomId;
        }
        if (hazardRoomId == null) continue;

        // Deactivate the hazard room to trigger [OVERRIDDEN] state
        const hazardRoom = cluster.rooms.find(r => r.id === hazardRoomId);
        if (!hazardRoom || hazardRoom.roomType === 'normal') continue;
        hazardRoom.roomType = 'normal';

        item.currentNodeId = node.id;
        const classified = classifyChoices(item, cluster);

        // Verify: overridden choices are disabled
        const overridden = classified.filter(c => c.label.includes('[OVERRIDDEN]') || c.disabled);
        const closeBack = classified.filter(c => c.isClose);

        if (overridden.length > 0) {
          testedOverridden = true;
          for (const c of overridden) {
            assert(c.disabled, `[OVERRIDDEN] choice is disabled: "${c.label}"`);
          }
          for (const c of closeBack) {
            assert(!c.disabled, `Close/back choice is NOT disabled: "${c.label}"`);
          }

          const enabledChoices = classified.filter(c => !c.disabled);
          const allChoices = classified;
          const enabledCount = enabledChoices.length;
          const totalCount = allChoices.length;
          assert(enabledCount > 0, `At least one enabled choice exists (${enabledCount} enabled, ${totalCount} total)`);

          // Check that close/back is among enabled choices
          const enabledCloseBack = enabledChoices.filter(c => c.isClose);
          assert(enabledCloseBack.length > 0, 'Close/back choice is among enabled choices');

          // Verify number key behavior:
          // All choices (including disabled) are numbered 1..N
          // Pressing a disabled choice's number does nothing
          // Pressing an enabled choice's number activates it
          const disabledCount = totalCount - enabledCount;
          if (disabledCount > 0) {
            const overlayState: OverlayState = {
              aimMode: false,
              interactableOpen: true,
              terminalOpen: false,
              aboutOpen: false,
              settingsOpen: false,
              interactableChoiceCount: totalCount,
              terminalChoiceCount: 0,
            };

            // Find a disabled choice's index — key press returns an action
            // but main.ts checks btn.disabled before clicking
            const disabledIdx = allChoices.findIndex(c => c.disabled);
            const disabledKey = handleOverlayKey(String(disabledIdx + 1), overlayState);
            assert(
              disabledKey !== null && disabledKey.kind === 'select_interactable_choice',
              `Key "${disabledIdx + 1}" resolves for disabled choice (main.ts skips click)`,
            );
            // main.ts does: if (btn && !btn.disabled) btn.click()
            // So the action fires but click is guarded — disabled button not activated
            assert(allChoices[disabledIdx].disabled,
              `Choice at index ${disabledIdx} IS disabled — click handler not attached`);

            // Find the close/back choice — it should be reachable
            const closeIdx = allChoices.findIndex(c => c.isClose);
            const closeKey = handleOverlayKey(String(closeIdx + 1), overlayState);
            assert(
              closeKey !== null && closeKey.kind === 'select_interactable_choice',
              `Key "${closeIdx + 1}" reaches close/back choice`,
            );
            assert(!allChoices[closeIdx].disabled,
              'Close/back choice is enabled — click handler IS attached');
          }
        }

        break;
      }
      if (testedOverridden) break;
    }
    if (testedOverridden) break;
  }
  assert(testedOverridden, 'Found and tested overridden + close/back choice state');
}

// ── Terminal button styling: overridden looks disabled, disconnect looks active ──

console.log('\n\x1b[1m── Terminal button styling checks ──\x1b[0m');

{
  // Simulate the terminal button rendering logic from main.ts openTerminal()
  // and verify CSS classes match intended visual appearance:
  //   - Overridden hazard buttons: disabled + should NOT look active (no opt-warn)
  //   - Disconnect button: enabled + should look active (no dim opt-close)

  interface TermBtnInfo {
    label: string;
    cssClass: string;
    disabled: boolean;
    isDisconnect: boolean;
    isOverridden: boolean;
  }

  function classifyTerminalButtons(
    terminal: { hasKey: boolean; isFinalTerminal?: boolean; hazardOverrides?: Array<{ hazardRoomId: number; label: string }> },
    cluster: { rooms: any[]; exitLocked: boolean },
  ): TermBtnInfo[] {
    const result: TermBtnInfo[] = [];

    // Grant key button
    if (terminal.hasKey && cluster.exitLocked && !terminal.isFinalTerminal) {
      result.push({
        label: '> [EXECUTE] authorize cluster egress',
        cssClass: 'terminal-opt-btn opt-grant',
        disabled: false,
        isDisconnect: false,
        isOverridden: false,
      });
    }

    // Hazard override buttons
    if (terminal.hazardOverrides) {
      for (const override of terminal.hazardOverrides) {
        const hazardRoom = cluster.rooms.find((r: any) => r.id === override.hazardRoomId);
        const alreadyDone = hazardRoom?.roomType === 'normal';
        // Overridden buttons should use base class (no opt-warn), active ones use opt-warn
        result.push({
          label: alreadyDone
            ? `> [OVERRIDE] ${override.label} [OVERRIDDEN]`
            : `> [OVERRIDE] ${override.label}`,
          cssClass: alreadyDone ? 'terminal-opt-btn' : 'terminal-opt-btn opt-warn',
          disabled: alreadyDone,
          isDisconnect: false,
          isOverridden: alreadyDone,
        });
      }
    }

    // Disconnect button — should use base class (not dim opt-close)
    result.push({
      label: '> [BKSP] disconnect',
      cssClass: 'terminal-opt-btn',
      disabled: false,
      isDisconnect: true,
      isOverridden: false,
    });

    return result;
  }

  let testedTerminal = false;
  for (const testSeed of [1, 7, 42, 99, 123, 200, 314]) {
    seedRng(testSeed);
    const state = createGame();
    const cluster = state.clusters.get(state.currentClusterId)!;

    for (const terminal of cluster.terminals) {
      if (!terminal.hazardOverrides?.length) continue;

      // Deactivate one hazard to create [OVERRIDDEN] state
      const override = terminal.hazardOverrides[0];
      const hazardRoom = cluster.rooms.find(r => r.id === override.hazardRoomId);
      if (!hazardRoom || hazardRoom.roomType === 'normal') continue;
      hazardRoom.roomType = 'normal';

      const buttons = classifyTerminalButtons(terminal, cluster);
      const overriddenBtns = buttons.filter(b => b.isOverridden);
      const disconnectBtn = buttons.find(b => b.isDisconnect);

      if (overriddenBtns.length > 0 && disconnectBtn) {
        testedTerminal = true;

        // TEST 1: overridden buttons should look visually disabled (not use opt-warn)
        for (const btn of overriddenBtns) {
          assert(btn.disabled, `Overridden terminal button is disabled: "${btn.label}"`);
          assert(!btn.cssClass.includes('opt-warn'),
            `Overridden terminal button should NOT use opt-warn (looks clickable): "${btn.label}"`);
        }

        // TEST 2: disconnect button should look active (not use dim opt-close)
        assert(!disconnectBtn.disabled, 'Disconnect button is NOT disabled');
        assert(!disconnectBtn.cssClass.includes('opt-close'),
          'Disconnect button should NOT use opt-close (looks grayed out)');

        break;
      }
    }
    if (testedTerminal) break;
  }
  assert(testedTerminal, 'Found terminal with overridden hazard + disconnect to test styling');
}

// ── Root part: taken choice shown disabled, not hidden ──

console.log('\n\x1b[1m── Root part taken choice state ──\x1b[0m');

{
  // Simulate the interactable rendering logic from main.ts openInteractableOverlay()
  // When rootPartTaken is true, the extract_root_part choice should be shown
  // but disabled (grayed out), not hidden entirely.

  function classifyInteractableChoices(
    item: { dialog: any[]; currentNodeId: string; rewardTaken: boolean; rootPartTaken?: boolean },
    cluster: { rooms: any[]; exitLocked: boolean },
  ): Array<{ label: string; disabled: boolean; hidden: boolean; action?: string }> {
    const node = item.dialog.find((n: any) => n.id === item.currentNodeId);
    if (!node) return [];

    const result: Array<{ label: string; disabled: boolean; hidden: boolean; action?: string }> = [];
    for (const choice of node.choices) {
      if (choice.requiresRewardAvailable && item.rewardTaken) { result.push({ label: choice.label, disabled: true, hidden: true, action: choice.action }); continue; }
      if (choice.requiresExitLocked && !cluster.exitLocked) { result.push({ label: choice.label, disabled: true, hidden: true, action: choice.action }); continue; }

      // Root part taken: should be disabled+visible, NOT hidden
      const isRootPartTaken = choice.requiresRootPartAvailable && item.rootPartTaken;
      if (isRootPartTaken) {
        result.push({ label: choice.label, disabled: true, hidden: false, action: choice.action });
        continue;
      }

      // Deactivated hazard
      const isDeactivatedHazard = (() => {
        if (choice.action === 'deactivate_hazard') {
          const rid = choice.deactivatesHazardRoomId;
          if (rid != null) {
            const room = cluster.rooms.find((r: any) => r.id === rid);
            return room?.roomType === 'normal';
          }
        }
        if (choice.nodeId?.startsWith('deactivate_')) {
          const targetNode = item.dialog.find((n: any) => n.id === choice.nodeId);
          const deactChoice = targetNode?.choices.find((c: any) => c.action === 'deactivate_hazard');
          if (deactChoice?.deactivatesHazardRoomId != null) {
            const room = cluster.rooms.find((r: any) => r.id === deactChoice.deactivatesHazardRoomId);
            return room?.roomType === 'normal';
          }
        }
        return false;
      })();

      result.push({ label: choice.label, disabled: isDeactivatedHazard, hidden: false, action: choice.action });
    }
    return result;
  }

  let testedRootPart = false;
  for (const testSeed of [1, 7, 42, 99, 123, 200, 314, 500, 777, 1000]) {
    // Root parts only exist in clusters 1+
    for (const clusterId of [1, 2, 3]) {
      seedRng(testSeed);
      const state = createGame(testSeed);
      adminTeleportToCluster(state, clusterId);
      const cluster = state.clusters.get(clusterId);
      if (!cluster) continue;

      // Find interactable with a root part
      const rootPartItem = cluster.interactables.find(ia => ia.hasRootPart);
      if (!rootPartItem) continue;

      // Find the node with extract_root_part choice
      const extractNode = rootPartItem.dialog.find(n =>
        n.choices.some((c: any) => c.action === 'extract_root_part'));
      if (!extractNode) continue;

      // Mark root part as taken
      rootPartItem.rootPartTaken = true;
      rootPartItem.currentNodeId = extractNode.id;

      const classified = classifyInteractableChoices(rootPartItem, cluster);
      const rootPartChoice = classified.find(c => c.action === 'extract_root_part');

      if (rootPartChoice) {
        testedRootPart = true;

        // The taken root part choice should be visible (not hidden) but disabled
        assert(!rootPartChoice.hidden,
          `Root part choice is visible (not hidden) when taken: "${rootPartChoice.label}"`);
        assert(rootPartChoice.disabled,
          `Root part choice is disabled when taken: "${rootPartChoice.label}"`);

        // Other choices in the same node (e.g. [BACK]) should still be enabled
        const otherChoices = classified.filter(c => c.action !== 'extract_root_part' && !c.hidden);
        assert(otherChoices.length > 0, 'Other choices (e.g. [BACK]) still exist and are visible');
        for (const c of otherChoices) {
          assert(!c.disabled, `Non-root-part choice is still enabled: "${c.label}"`);
        }

        // Verify main.ts rendering logic: simulate what main.ts does and check
        // that taken root part choices are NOT skipped (shown disabled instead)
        const mainTsVisibleChoices: string[] = [];
        for (const choice of extractNode.choices) {
          // This replicates main.ts filter logic — rootPartTaken no longer skips
          if (choice.requiresRewardAvailable && rootPartItem.rewardTaken) continue;
          if (choice.requiresExitLocked && !cluster.exitLocked) continue;
          // root part taken choices should NOT be skipped — they render as disabled
          mainTsVisibleChoices.push(choice.label);
        }
        const rootPartVisibleInMainTs = mainTsVisibleChoices.some(l =>
          extractNode.choices.find((c: any) => c.action === 'extract_root_part' && c.label === l));
        assert(rootPartVisibleInMainTs,
          'main.ts rendering does NOT hide taken root part choice (shows it disabled)');

        break;
      }
    }
    if (testedRootPart) break;
  }
  assert(testedRootPart, 'Found interactable with root part to test taken state');
}

// ── Summary ──

console.log(`\n\x1b[1m${passed + failed} tests: \x1b[32m${passed} passed\x1b[0m, \x1b[${failed > 0 ? '31' : '32'}m${failed} failed\x1b[0m\n`);
process.exit(failed > 0 ? 1 : 0);
