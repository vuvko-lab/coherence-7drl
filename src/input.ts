import { Direction, PlayerAction, Position } from './types';

type ActionCallback = (action: PlayerAction) => void;
type ClickCallback = (pos: Position) => void;

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
  private bound = false;

  constructor(onAction: ActionCallback, onMapClick: ClickCallback) {
    this.onAction = onAction;
    this.onMapClick = onMapClick;
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

    const dir = KEY_MAP[e.key];
    if (dir) {
      e.preventDefault();
      this.onAction({ kind: 'move', dir });
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

    // Debug toggle
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
