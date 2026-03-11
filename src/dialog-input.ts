/**
 * Pure dialog/overlay input handling — no DOM dependencies.
 *
 * Extracted so that keyboard→action mapping can be tested headlessly.
 */

export interface OverlayState {
  aimMode: boolean;
  interactableOpen: boolean;
  terminalOpen: boolean;
  aboutOpen: boolean;
  settingsOpen: boolean;
  /** Number of enabled (clickable) choices in the interactable overlay */
  interactableEnabledCount: number;
  /** Number of enabled (clickable) choices in the terminal overlay */
  terminalEnabledCount: number;
}

export type OverlayAction =
  | { kind: 'exit_aim' }
  | { kind: 'close_interactable' }
  | { kind: 'close_terminal' }
  | { kind: 'close_about' }
  | { kind: 'close_settings' }
  | { kind: 'select_interactable_choice'; index: number }
  | { kind: 'select_terminal_choice'; index: number };

/**
 * Given a key press and current overlay state, return the action to take (or null).
 */
export function handleOverlayKey(key: string, state: OverlayState): OverlayAction | null {
  // Backspace closes overlays (ESC avoided — exits fullscreen on itch.io)
  if (key === 'Backspace') {
    if (state.aimMode) return { kind: 'exit_aim' };
    if (state.interactableOpen) return { kind: 'close_interactable' };
    if (state.terminalOpen) return { kind: 'close_terminal' };
    if (state.aboutOpen) return { kind: 'close_about' };
    if (state.settingsOpen) return { kind: 'close_settings' };
  }

  // Number keys select dialog choices
  if (key >= '1' && key <= '9') {
    const index = parseInt(key, 10) - 1;
    if (state.interactableOpen && index < state.interactableEnabledCount) {
      return { kind: 'select_interactable_choice', index };
    }
    if (state.terminalOpen && index < state.terminalEnabledCount) {
      return { kind: 'select_terminal_choice', index };
    }
  }

  return null;
}

export interface MapClickContext {
  playerX: number;
  playerY: number;
}

export type MapClickAction =
  | { kind: 'wait' }
  | { kind: 'move'; dir: 'up' | 'down' | 'left' | 'right' }
  | { kind: 'pathfind'; x: number; y: number }
  | null;

/**
 * Given a click position and player position, return the base movement action.
 * Does NOT handle aim-mode or entity-click shooting (those are checked before this).
 */
export function mapClickAction(clickX: number, clickY: number, ctx: MapClickContext): MapClickAction {
  // Click on self = wait
  if (clickX === ctx.playerX && clickY === ctx.playerY) {
    return { kind: 'wait' };
  }

  // Adjacent = single step
  const dx = Math.abs(clickX - ctx.playerX);
  const dy = Math.abs(clickY - ctx.playerY);
  if (dx + dy === 1) {
    const dir = clickX > ctx.playerX ? 'right'
      : clickX < ctx.playerX ? 'left'
      : clickY > ctx.playerY ? 'down'
      : 'up';
    return { kind: 'move', dir };
  }

  // Far click = pathfind
  return { kind: 'pathfind', x: clickX, y: clickY };
}
