import { Direction, PlayerAction, Position } from './types';

type ActionCallback = (action: PlayerAction) => void;
type ClickCallback = (pos: Position) => void;
type AimToggleCallback = () => void;
export type ModuleNavDir = 'up' | 'down' | 'activate' | 'toggle' | 'close';
type ModuleNavCallback = (dir: ModuleNavDir) => void;

const KEY_MAP: Record<string, Direction> = {
  'ArrowUp': 'up',
  'ArrowDown': 'down',
  'ArrowLeft': 'left',
  'ArrowRight': 'right',
  'w': 'up',
  'W': 'up',
  's': 'down',
  'S': 'down',
  'a': 'left',
  'A': 'left',
  'd': 'right',
  'D': 'right',
};

export class InputHandler {
  private onAction: ActionCallback;
  private onMapClick: ClickCallback;
  private onAimToggle: AimToggleCallback;
  private onModuleNav: ModuleNavCallback;
  private bound = false;
  moduleMenuOpen = false;
  private _aimMode = false;
  onAimMove?: (dx: number, dy: number) => void;

  setAimMode(active: boolean) { this._aimMode = active; }

  constructor(onAction: ActionCallback, onMapClick: ClickCallback, onAimToggle: AimToggleCallback, onModuleNav: ModuleNavCallback) {
    this.onAction = onAction;
    this.onMapClick = onMapClick;
    this.onAimToggle = onAimToggle;
    this.onModuleNav = onModuleNav;
  }

  bind() {
    if (this.bound) return;
    this.bound = true;

    document.addEventListener('keydown', this.handleKey);
  }

  unbind() {
    document.removeEventListener('keydown', this.handleKey);
    this.bound = false;
  }

  private handleKey = (e: KeyboardEvent) => {
    // Ignore if focused on an input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    // Module menu navigation (intercepts movement keys)
    if (this.moduleMenuOpen) {
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        this.onModuleNav('up');
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        e.preventDefault();
        this.onModuleNav('down');
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        this.onModuleNav('activate');
        return;
      }
      if (e.key === 'Escape' || e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        this.onModuleNav('close');
        return;
      }
      // Block all other keys while menu is open
      e.preventDefault();
      return;
    }

    // Open module menu
    if (e.key === 'i' || e.key === 'I') {
      e.preventDefault();
      this.onModuleNav('toggle');
      return;
    }

    const dir = KEY_MAP[e.key];
    if (dir) {
      e.preventDefault();
      if (this._aimMode) {
        const dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
        const dy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
        this.onAimMove?.(dx, dy);
      } else {
        this.onAction({ kind: 'move', dir });
      }
      return;
    }

    // Wait / skip turn
    if (e.key === '.' || e.key === 'Numpad5' || e.key === ' ') {
      e.preventDefault();
      this.onAction({ kind: 'wait' });
      return;
    }

    // Transfer (Enter when on interface)
    if (e.key === 'Enter') {
      e.preventDefault();
      this.onAction({ kind: 'transfer' });
      return;
    }

    // Aim / shoot toggle
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      this.onAimToggle();
      return;
    }

    // Debug / admin panel toggle
    if (e.key === '`') {
      e.preventDefault();
      this.onAction({ kind: 'debug_toggle' });
      return;
    }

  };

  handleMapClick(pos: Position) {
    this.onMapClick(pos);
  }
}
