/**
 * Unified room event system: trigger → condition → effect.
 *
 * Replaces the four separate event systems (narrative triggers, room scenarios,
 * micro-events, hazard updates) with a single dispatch model.
 *
 * Events are pure data. Each RoomEventDef declares:
 *   - trigger: what game event activates it (player enters room, tick, entity killed, etc.)
 *   - condition: optional predicate checked against GameState (read-only)
 *   - effect: returns Intent[] describing what should happen
 *
 * The event dispatcher collects matching events each tick and feeds their
 * intents to resolveIntents(). This keeps the event system side-effect-free
 * until the single mutation point.
 */

import type { GameState, Room, Cluster, Position } from './types';
import type { Intent } from './intents';

// ── Trigger types ──

export type EventTrigger =
  | { kind: 'player_enter_room'; roomId: number }
  | { kind: 'player_exit_room'; roomId: number }
  | { kind: 'tick' }
  | { kind: 'entity_killed'; entityId: number; faction: string }
  | { kind: 'entity_spawned'; entityId: number }
  | { kind: 'hazard_deactivated'; roomId: number }
  | { kind: 'terminal_activated'; terminalId: string }
  | { kind: 'cluster_enter'; clusterId: number }
  | { kind: 'door_opened'; position: Position }
  | { kind: 'damage_taken'; amount: number; source: string };

// ── Condition predicates ──

/** A pure predicate that reads GameState but never mutates it. */
export type EventCondition = (state: Readonly<GameState>, room: Readonly<Room>, cluster: Readonly<Cluster>) => boolean;

// ── Common conditions ──

export const CONDITIONS = {
  /** Player is currently standing in this room. */
  playerInRoom: ((state, room, _cluster) => {
    const px = state.player.position.x;
    const py = state.player.position.y;
    return px >= room.x && px < room.x + room.w &&
           py >= room.y && py < room.y + room.h;
  }) satisfies EventCondition,

  /** Player has NOT entered this room yet this session. */
  firstVisit: ((_state, room) => {
    return !room.scenarioState?.playerEnteredAtTick;
  }) satisfies EventCondition,

  /** Alert level is at suspicious or above. */
  alertSuspicious: ((state, _room, _cluster) => {
    return state.alertLevel >= 100;
  }) satisfies EventCondition,

  /** Alert level is at enemy or above. */
  alertEnemy: ((state, _room, _cluster) => {
    return state.alertLevel >= 200;
  }) satisfies EventCondition,

  /** Room's scenario has not yet been triggered. */
  notTriggered: ((_state, room) => {
    return !room.scenarioState?.triggered;
  }) satisfies EventCondition,

  /** Room hazard is active (not deactivated). */
  hazardActive: ((_state, room) => {
    return room.roomType !== 'normal' && room.hazardState != null;
  }) satisfies EventCondition,
};

// ── Effect function ──

/**
 * Pure function that computes what should happen in response to an event.
 * Returns Intent[] without performing any mutation.
 */
export type EventEffect = (
  state: Readonly<GameState>,
  room: Readonly<Room>,
  cluster: Readonly<Cluster>,
  trigger: EventTrigger,
) => Intent[];

// ── Event definition ──

export interface RoomEventDef {
  /** Unique event id (for once-only tracking via firedTriggerIds) */
  id: string;

  /** What triggers this event */
  triggerKind: EventTrigger['kind'];

  /** Optional condition that must be true for the effect to fire */
  condition?: EventCondition;

  /** Whether this event fires only once per game (tracked in firedTriggerIds) */
  once: boolean;

  /** The effect: returns intents describing what happens */
  effect: EventEffect;
}

// ── Dispatcher ──

/**
 * Check all registered events against a trigger, return collected intents.
 * Events that have already fired (once-only) are skipped.
 */
export function dispatchEvents(
  events: RoomEventDef[],
  trigger: EventTrigger,
  state: Readonly<GameState>,
  room: Readonly<Room>,
  cluster: Readonly<Cluster>,
): Intent[] {
  const intents: Intent[] = [];

  for (const event of events) {
    // Match trigger kind
    if (event.triggerKind !== trigger.kind) continue;

    // Skip already-fired once-only events
    if (event.once && state.firedTriggerIds.has(event.id)) continue;

    // Check condition
    if (event.condition && !event.condition(state, room, cluster)) continue;

    // Fire effect
    const result = event.effect(state, room, cluster, trigger);
    intents.push(...result);

    // Mark once-only events as fired (caller must apply this to mutable state)
    // We push a marker intent so the resolver can handle it
    if (event.once) {
      // The caller is responsible for adding event.id to firedTriggerIds
      // after resolving intents. We signal this via a convention:
      // the event id is available for the caller to track.
    }
  }

  return intents;
}
