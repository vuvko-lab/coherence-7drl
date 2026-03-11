/**
 * Intent types — all possible actions that entities, player, and game systems can express.
 * Intents are pure data describing "what should happen" without performing any state mutation.
 * The intent resolver (intent-resolver.ts) is the single point where intents become state changes.
 */

import type { Position, EntityKind, Entity } from './types';

// ── Movement ──

export interface MoveIntent {
  kind: 'move';
  entityId: number;
  to: Position;
}

export interface OpenDoorIntent {
  kind: 'open_door';
  entityId: number;
  at: Position;
}

export interface PushEntityIntent {
  kind: 'push_entity';
  pusherId: number;
  targetId: number;
  awayFrom: Position; // push target away from this position
}

// ── Combat ──

export interface MeleeAttackIntent {
  kind: 'melee_attack';
  attackerId: number;
  targetId: number;
  damage: number;
}

export interface RangedAttackIntent {
  kind: 'ranged_attack';
  attackerId: number;
  targetId: number;
  damage: number;
  style: 'single' | 'beam' | 'rapid';
}

export interface AoeAttackIntent {
  kind: 'aoe_attack';
  attackerId: number;
  targetIds: number[];
  damage: number;
  style: 'single' | 'beam' | 'rapid';
}

export interface PullIntent {
  kind: 'pull';
  pullerId: number;
  targetId: number;
  toward: Position;
}

// ── Interaction ──

export interface TransferIntent {
  kind: 'transfer';
  entityId: number;
  direction: 'forward' | 'back';
}

export interface ActivateTerminalIntent {
  kind: 'activate_terminal';
  entityId: number;
  terminalId: number;
}

// ── Entity lifecycle ──

export interface SpawnEntityIntent {
  kind: 'spawn_entity';
  entityKind: EntityKind;
  position: Position;
  clusterId: number;
  overrides?: Partial<Entity>;
}

export interface RemoveEntityIntent {
  kind: 'remove_entity';
  entityId: number;
  cause: 'killed' | 'despawn' | 'dissolve';
}

// ── AI state management ──

export interface ChangeAIStateIntent {
  kind: 'change_ai_state';
  entityId: number;
  newState: string;
}

export interface SetInvisibleIntent {
  kind: 'set_invisible';
  entityId: number;
  invisible: boolean;
}

export interface SetTargetIntent {
  kind: 'set_target';
  entityId: number;
  targetId: number | undefined;
  lastTargetPos?: Position;
}

export interface SetCooldownIntent {
  kind: 'set_cooldown';
  entityId: number;
  ticks: number;
}

export interface CatalogIntent {
  kind: 'catalog';
  catalogerId: number;
  targetId: number;
  positions: string[]; // revealed tile positions
}

// ── Presentation effects (queued for render layer) ──

export interface MessageIntent {
  kind: 'message';
  text: string;
  style?: 'normal' | 'system' | 'hazard' | 'alert' | 'combat' | 'important';
}

export interface SoundIntent {
  kind: 'sound';
  id: string;
}

export interface GlitchIntent {
  kind: 'glitch';
  effect: string;
}

export interface SmokeIntent {
  kind: 'smoke';
  position: Position;
  color: string;
}

export interface RevealIntent {
  kind: 'reveal';
  positions: string[];
  durationTicks: number;
}

export interface ShootAnimationIntent {
  kind: 'shoot_animation';
  from: Position;
  to: Position;
  style: 'single' | 'beam' | 'rapid';
}

// ── Hazard / room effects ──

export interface DamageTileIntent {
  kind: 'damage_tile';
  position: Position;
  hazardType: string;
  stage?: number;
}

export interface SpreadHazardIntent {
  kind: 'spread_hazard';
  roomId: number;
  hazardType: string;
}

export interface BreachTileIntent {
  kind: 'breach_tile';
  position: Position;
}

export interface SetTilePropsIntent {
  kind: 'set_tile_props';
  position: Position;
  props: Partial<{ glyph: string; fg: string; integrity: number; walkable: boolean; transparent: boolean }>;
}

export interface ClearOverlaysIntent {
  kind: 'clear_overlays';
  region: { x1: number; y1: number; x2: number; y2: number };
  overlayType: string;
}

export interface SetHazardFieldIntent {
  kind: 'set_hazard_field';
  roomId: number;
  field: string;
  value: any;
}

export interface CollapseGlitchIntent {
  kind: 'collapse_glitch';
  position: Position;
  glyph: string;
  fg: string;
  expireTick: number;
}

export interface MovePlayerIntent {
  kind: 'move_player';
  to: Position;
}

export interface CloseDoorIntent {
  kind: 'close_door';
  position: Position;
}

export interface ClearTileOverlayIntent {
  kind: 'clear_tile_overlay';
  position: Position;
  overlayType?: string; // if specified, only clear if matching
}

export interface MarkTileHazardIntent {
  kind: 'mark_tile_hazard';
  position: Position;
  hazardType: string;
}

export interface SealDoorIntent {
  kind: 'seal_door';
  position: Position;
}

export interface UnsealDoorIntent {
  kind: 'unseal_door';
  position: Position;
}

export interface DamagePlayerIntent {
  kind: 'damage_player';
  amount: number;
  source: string; // for logging
}

export interface AlertDeltaIntent {
  kind: 'alert_delta';
  amount: number;
}

export interface MarkEntityIntent {
  kind: 'mark_entity';
  entityId: number;
}

// ── AI internal state (generic field setter for bookkeeping counters) ──

export interface SetAIFieldIntent {
  kind: 'set_ai_field';
  entityId: number;
  field: string;
  value: any;
}

// ── Interactable repair ──

export interface RepairInteractableIntent {
  kind: 'repair_interactable';
  position: Position;
}

// ── No-op (signals a valid action happened but nothing to resolve) ──

export interface WaitIntent {
  kind: 'wait';
}

// ── Union ──

export type Intent =
  // Movement
  | MoveIntent
  | OpenDoorIntent
  | PushEntityIntent
  // Combat
  | MeleeAttackIntent
  | RangedAttackIntent
  | AoeAttackIntent
  | PullIntent
  // Interaction
  | TransferIntent
  | ActivateTerminalIntent
  // Entity lifecycle
  | SpawnEntityIntent
  | RemoveEntityIntent
  // AI state
  | ChangeAIStateIntent
  | SetInvisibleIntent
  | SetTargetIntent
  | SetCooldownIntent
  | CatalogIntent
  | SetAIFieldIntent
  // Interactable
  | RepairInteractableIntent
  // Presentation
  | MessageIntent
  | SoundIntent
  | GlitchIntent
  | SmokeIntent
  | RevealIntent
  | ShootAnimationIntent
  // Hazard / room
  | DamageTileIntent
  | SpreadHazardIntent
  | BreachTileIntent
  | SetTilePropsIntent
  | ClearOverlaysIntent
  | ClearTileOverlayIntent
  | SetHazardFieldIntent
  | CollapseGlitchIntent
  | MovePlayerIntent
  | CloseDoorIntent
  | MarkTileHazardIntent
  | SealDoorIntent
  | UnsealDoorIntent
  | DamagePlayerIntent
  | AlertDeltaIntent
  | MarkEntityIntent
  // No-op
  | WaitIntent
  ;
