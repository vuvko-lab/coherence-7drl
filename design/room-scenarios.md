# Room Scenario System — Compositional Template Design

This document integrates an external room-composition proposal with the existing tag system
and evaluates what is implementable given the current codebase.

---

## 1. The Core Insight: Status Composition

The proposal introduces a 5-axis composition formula:

```
Room = Spatial + Entity Behavior + Psychological + Environmental + Temporal
```

This is a good model. The existing tag system already covers the Spatial and Environmental
axes partially. The missing axes — particularly Entity Behavior and Temporal — are where
the proposal adds real value.

**Key benefit**: 5 axes × handful of values each = combinatorial variety with minimal code.
A room that is `two_wall_symmetry + observer_entity + flicker_lights + tick_delay_5` reads
as a completely different experience from `centerpiece + broadcast_noise + looping_event`
even though both use the same underlying systems.

---

## 2. Mapping to Existing Code Vocabulary

### Spatial Status → existing `geometric` tag

The existing geometric tags cover most of this:

| Proposal | Existing equivalent | Gap |
|----------|-------------------|-----|
| `near_wall_spawn` | — | New: prefer wall-adjacent placement for objects |
| `corner_cluster` | — | New: cluster objects in one corner quadrant |
| `two_wall_symmetry` | — | New: mirror object placement across room center |
| `centerpiece` | — | New: single object anchored at room center |
| `ring_layout` | — | New: objects in a ring around center |
| `pillar_field` | — | New: scatter impassable props on floor tiles |
| `tight_corridor_room` | `hall` | Already handled |
| `maze_pocket` | `dead_end` | Partially covered |

**Recommendation**: Add `spatialLayout` as an optional field on `Room` with enum values:
`near_wall`, `two_wall_symmetry`, `centerpiece`, `corner_cluster`, `ring`, `pillar_field`.
Used during interactable placement, not during tile generation — no mapgen changes needed.

### Entity Behavior Status → existing entity AI + new states

| Proposal | Existing equivalent | Gap |
|----------|-------------------|-----|
| `observer_entity` | Chronicler (catalogs) | Chronicler doesn't physically turn; add `face_player` AI state |
| `fake_enemy` | — | New: Bit-Mite that vanishes when player enters LOS |
| `corpse_prop` | — | New: static glyph entity (no AI, flavor only) |
| `interactable_echo` | `lost_echo` interactable | Already exists |
| `broadcast_noise` | Chronicler `broadcast` AI state | Partially — add log message on broadcast |
| `passive_watcher` | Chronicler | Nearly identical |
| `glitch_entity` | — | New: entity that triggers glitch.ts effect when seen |
| `replicating_prop` | — | New: static entity that spawns a copy after N ticks |
| `mimic_prop` | — | New: looks like a terminal/cache, becomes hostile on interact |

**Recommendation for 7DRL scope**: Only implement `observer_entity` (one new AI state on
Chronicler: `face_player`), `fake_enemy` (Bit-Mite variant with `despawn_on_los` flag),
and `corpse_prop` (static Entity with no AI, glyph `▫` or `‡`). The rest are post-7DRL.

### Psychological Status → glitch.ts effects + log messages

This axis has no direct equivalent in the existing system, but is almost entirely achievable
using what already exists:

| Proposal | Implementation |
|----------|---------------|
| `player_presence_trigger` | Trigger on room entry via `onPlayerEnterRoom()` |
| `line_of_sight_trigger` | Check `tile.visible` for specific positions in FOV update |
| `false_alert` | `addMessage(state, '...', 'alert')` — fake alert text |
| `movement_in_periphery` | Flicker a random entity glyph for 1 tick at edge of FOV |
| `camera_glitch` | `glitchHorizontalTear()` or `glitchStaticBurst()` from glitch.ts |
| `memory_log_spam` | Multiple rapid `addMessage()` calls with corrupted text |
| `shadow_spawn` | Entity with `invisible = true` except when adjacent to player |
| `audio_lure` | Log message only — no audio system exists |
| `delayed_threat` | See Temporal axis |

**Note on "audio"**: The game has no audio system. All `audio_lure` and `broadcast_noise`
effects should be implemented as thematic log messages (type `'system'` or `'hazard'`).
The design should specify the exact message text for each scenario.

### Environmental Status → extends existing `modifiers` tag

| Proposal | Existing equivalent | Gap |
|----------|-------------------|-----|
| `flicker_lights` | `degraded` modifier | Nearly identical — degraded already flickers tiles |
| `organic_growth` | — | New: animate floor tiles with `¤` / `░` glyphs over time |
| `corrupted_terminal` | `corrupted` flag on interactable | Already exists |
| `broken_door` | — | New: door starts open, cannot close |
| `frozen_entities` | — | New: entity with `frozen: true`, AI suspended |
| `blood_trail` | — | New: static floor glyph decoration `·` in a trail pattern |
| `void_leak` | — | New: one or two tiles at room edge become `TileType.Wall` after N ticks |
| `garbage_tiles` | — | New: scatter `▪` / `≡` floor overlays (cosmetic) |
| `temperature_drop` | — | Log message + slight blue tint on room tiles |

**Recommendation**: `flicker_lights`, `corrupted_terminal`, and `frozen_entities` are worth
implementing. The rest are cosmetic-only and low-impact for 7DRL.

### Temporal Status → new `timingRule` on room / hazardState

This axis has no equivalent and is the most valuable addition. Current hazards all act on
fixed tick intervals. Temporal status adds:

| Proposal | Mechanism | Difficulty |
|----------|-----------|-----------|
| `tick_delay_N` | `activateAtTick = spawnTick + N` on hazardState | Low |
| `tick_delay_random` | `activateAtTick = spawnTick + randInt(3, 15)` | Low |
| `looping_event` | Already how hazards work (per-tick update) | Done |
| `one_time_event` | `triggered: boolean` flag on hazardState | Low |
| `after_exit_trigger` | Hook in `onPlayerLeaveRoom()` (doesn't exist yet) | Medium |
| `after_interaction_trigger` | Hook at end of `executeInteractableAction()` | Low |

**Recommendation**: Add `activateAtTick?: number` and `oneTimeOnly?: boolean` to
`RoomHazardState`. This unlocks delayed and one-shot behaviors for all existing hazards
without per-hazard changes.

---

## 3. Filtered Room Templates: What to Build

Ranked by feasibility given the current codebase. "Cost" = estimated new code required.

### Tier 1 — Implementable now (existing systems only)

| # | Name | Key statuses | What uses |
|---|------|-------------|-----------|
| 1 | **Whispering Wall** | `near_wall_spawn + interactable_echo + broadcast_noise` | existing `lost_echo`, `addMessage` |
| 2 | **Echo Choir** | `cluster_spawn + broadcast_noise + glitch_entity` | existing `lost_echo` cluster, glitch.ts |
| 6 | **Fake Control Room** | `centerpiece + corrupted_terminal + broadcast_noise` | existing `info_terminal` (corrupted) |
| 11 | **Radio Distress Room** | `centerpiece + broadcast_noise + looping_event` | existing `lost_echo` + periodic message |
| 15 | **Whisper Corridor** | `tight_corridor_room + broadcast_noise` | hall rooms + `addMessage` |
| 21 | **Echo Trap** | `interactable_echo + after_interaction_trigger` | existing echo + hazard spawn on extract |
| 24 | **Silent Alarm** | `false_alert + flicker_lights + looping_event` | `addMessage` + `degraded` modifier |
| 20 | **Lost Expedition** | `cluster_spawn + corpse_prop + memory_log_spam` | static entities + message spam |

### Tier 2 — Small additions required

| # | Name | Key statuses | What needs adding |
|---|------|-------------|-----------------|
| 2 | **Empty Barracks** | `two_wall_symmetry + corpse_prop + player_presence_trigger` | `corpse_prop` entity, `onPlayerEnterRoom` hook |
| 4 | **Observer Room** | `centerpiece + observer_entity + line_of_sight_trigger` | `face_player` AI state on Chronicler |
| 5 | **False Ambush** | `fake_enemy + false_alert + tick_delay_random` | `despawn_on_los` flag on Bit-Mite, `activateAtTick` |
| 10 | **Frozen Time Room** | `frozen_entities + delayed_activation + tick_delay_10` | `frozen` AI flag, `activateAtTick` |
| 17 | **Watching Helmets** | `two_wall_symmetry + observer_entity` | `face_player` AI state + `two_wall_symmetry` layout |
| 18 | **Sudden Darkness** | `flicker_lights + tick_delay_random + delayed_threat` | `activateAtTick`, FOV radius reduction |
| 22 | **Empty Cryo Pods** | `two_wall_symmetry + delayed_activation + tick_delay_5` | `activateAtTick`, static prop → hostile transition |

### Tier 3 — Out of scope for 7DRL

| # | Name | Why out of scope |
|---|------|----------------|
| 7 | **Locked Surgery** | Requires audio system for "surgical tools" |
| 8 | **Mirror Hall** | Requires entity position mirroring system |
| 9 | **Organic Growth** | Requires tile-spreading system (significant) |
| 12 | **Crawling Shadows** | Requires shadow rendering layer |
| 14 | **Duplicate Room** | Requires map duplication during generation |
| 19 | **Distorted Gravity** | Covered by existing `gravity_well` hazard |
| 23 | **Wall Faces** | Requires wall tile animation (complex) |
| 25 | **Breathing Room** | Requires pulsating tile system |

---

## 4. Recommended New Fields

Minimal additions to support the status system without breaking existing architecture.

### On `Room`:
```typescript
spatialLayout?: 'near_wall' | 'two_wall_symmetry' | 'centerpiece' | 'corner_cluster' | 'ring' | 'pillar_field';
scenario?: RoomScenario;  // one of the named templates
```

### On `RoomHazardState`:
```typescript
activateAtTick?: number;   // hazard dormant until this tick
oneTimeOnly?: boolean;     // event fires once, then clears
triggered?: boolean;       // one_time_event: has this fired yet?
```

### New entity flags (on `EntityAI`):
```typescript
despawnOnLOS?: boolean;    // fake_enemy: vanish when player sees them
frozen?: boolean;          // frozen_entities: skip AI turns until unfrozen
frozenUntilTick?: number;  // thaw at this tick
facePlayer?: boolean;      // observer_entity: always face toward player
```

### New entity kind:
```typescript
'corpse_prop' | 'prop'  // static, no AI, glyph-only entities for decoration
```

---

## 5. The 10 Micro-Events — Implementation Notes

These can be attached to any room scenario as additional dressing. Cheap because they use
existing systems almost entirely.

| Micro-event | Implementation | Cost |
|-------------|---------------|------|
| random door slam | `openDoor()` / `closeDoor()` on random adjacent door at tick N | Trivial |
| log spam | `addMessage(state, corruptLine(text), 'system')` × 3-5 | Trivial |
| light flicker burst | `glitchFlicker()` from glitch.ts | Already exists |
| entity despawns | Set `entity.coherence = 0` at `activateAtTick` | Trivial |
| false radar ping | `addMessage(state, 'alert.m: THREAT DETECTED...', 'alert')` then nothing | Trivial |
| player HUD glitch | `glitchShake()` + `glitchChromatic()` | Already exists |
| map distortion | `glitchHorizontalTear()` | Already exists |
| distant scream | `addMessage(state, '...', 'hazard')` from off-screen | Trivial |
| entity teleports | Move entity position to random walkable tile | Easy |
| nearby footsteps | Log message: `"Something moves nearby..."` + door sound | Trivial |

All 10 are implementable in under an hour total. They should fire at most once per room
entry and be gated behind the `activateAtTick` temporal system.

---

## 6. Proposed `RoomScenario` Type

A named scenario bundles the 5 statuses into a reusable template. The engine picks a
scenario for eligible rooms during `generateCluster()` and applies it in a post-pass
(similar to how `initRoomHazards()` works now).

```typescript
export type RoomScenario =
  | 'whispering_wall'
  | 'echo_choir'
  | 'fake_control_room'
  | 'observer_room'
  | 'false_ambush'
  | 'radio_distress'
  | 'whisper_corridor'
  | 'empty_barracks'
  | 'watching_helmets'
  | 'frozen_time'
  | 'sudden_darkness'
  | 'echo_trap'
  | 'silent_alarm'
  | 'lost_expedition'
  | 'empty_cryo_pods';
```

Scenarios are assigned only to `normal` rooms (no hazard tag already assigned), weighted
by cluster depth and room geometry. A single `initRoomScenario(room, tiles, cluster)`
function handles all of them — no new per-scenario update loops needed since they compose
from existing mechanisms.

---

## 7. What the Proposal Gets Right

- **Temporal axis is the most underexplored dimension** in the existing design. `tick_delay`
  transforms a trivial room into a horror beat. `after_interaction_trigger` turns echo
  extraction into a Chekhov's gun.

- **Corpse props and observer entities** create rooms that feel inhabited without requiring
  combat. The game currently has either "empty room" or "enemy room" — static non-combat
  entities fill the gap.

- **False ambush and fake enemy** are cheap to implement but change the player's mental
  model of every room they enter. One false ambush early in the game makes the player
  paranoid in every subsequent room.

- **The variation formula** (echo_count, spawn_radius, message_set) is the right way to
  get 100+ rooms from 25 templates without 100 code paths. This maps directly to the
  existing random parameter system in `placeInteractables()`.

## 8. What Needs Adjustment

- **No audio system** — every "audio" status becomes a log message. Rename `audio_lure`
  to `log_lure` in implementation. The effect is the same: player reads something that
  pulls attention toward a specific location.

- **Mirror layout** requires knowing all object positions before mirroring them, which
  means it must run as a full post-pass after all other placement. Defer to post-7DRL.

- **Psychological effects work best when rare** — if every room has a `camera_glitch`,
  the effect is noise. Recommend max 1 psychological scenario per cluster, with a cluster
  depth gate (none in cluster 0, possible from cluster 2+).

- **Scope gate**: For the 7DRL deadline, implement only Tier 1 rooms + the temporal axis
  (`activateAtTick`, `oneTimeOnly`). Tier 2 rooms can follow as polish. The 5-axis formula
  is the architecture; the templates are content that can be added incrementally.
