# Overhaul Status

## Phase 1: Foundation — Determinism + Intent Types ✓

### Completed: Determinism Fixes

**Date.now() violation (game.ts:1037)** — Fixed. The hacked-terminal Bit-Mite spawning was overwriting `enemy.id` with `Date.now() % 100000 + random()`. Removed the override; entities now keep their deterministic `_nextEntityId++` assigned by `makeBitMite()`.

**performance.now() in game logic** — Fixed in 7 locations across 3 files. All `spawnTime` and `echoFadeAtTime` values are now set to placeholder values in game logic, and stamped by the presentation layer:

| File | Line | Before | After | Stamping |
| --- | --- | --- | --- | --- |
| game.ts:628 | smoke effect (player melee kill) | `performance.now()` | `0` | Smoke loop stamps `spawnTime === 0` |
| game.ts:928 | smoke effect (entity death cleanup) | `performance.now()` | `0` | Smoke loop stamps `spawnTime === 0` |
| game.ts:1200 | echo fade delay (lost echo extraction) | `performance.now() + randInt(2000, 5000)` | `-randInt(2000, 5000)` | Smoke loop converts: `now + abs(value)` |
| ai.ts:632 | smoke effect (AI entity removal) | `performance.now()` | `0` | Smoke loop stamps `spawnTime === 0` |
| hazards.ts:903 | echo fade (mite_burst scenario) | `performance.now() + 300` | `-300` | Smoke loop converts |
| hazards.ts:924 | echo fade (gk_dies scenario) | `performance.now()` | `-1` | Smoke loop converts |
| hazards.ts:932 | smoke effect (Gate-Keeper death) | `performance.now()` | `0` | Smoke loop stamps |
| hazards.ts:1055 | smoke effect (entity_despawn micro-event) | `performance.now()` | `0` | Smoke loop stamps |

**Presentation layer stamping** — Added to `runSmokeLoop()` in main.ts:
1. At loop start: iterate `state.smokeEffects`, stamp any with `spawnTime === 0`
2. At loop start: iterate `cluster.interactables`, convert any `echoFadeAtTime < 0` to `now + abs(value)`

### Completed: Intent Types

**src/intents.ts** — 28-kind Intent union type covering all game actions:
- Movement: move, open_door, push_entity
- Combat: melee_attack, ranged_attack, aoe_attack, pull
- Interaction: transfer, activate_terminal
- Entity lifecycle: spawn_entity, remove_entity
- AI state: change_ai_state, set_invisible, set_target, set_cooldown, catalog
- Presentation: message, sound, glitch, smoke, reveal, shoot_animation
- Hazard/room: damage_tile, spread_hazard, seal_door, unseal_door, damage_player, alert_delta, mark_entity
- No-op: wait

### Completed: Intent Resolver

**src/intent-resolver.ts** — `resolveIntents(state, intents)` is the single mutation point for all game state changes. Handles 26 of 28 intent kinds (spawn_entity, spread_hazard, transfer, activate_terminal stubbed for later phases). Includes deferred entity cleanup (_pendingRemoval filter) after each batch.

---

## Phase 2: Data Layer — In Progress

### Completed: Balance Constants

**src/balance.ts** — All gameplay-affecting numbers centralized in one file:
- Player stats (speed, coherence, melee damage)
- Module costs (corrupt.m: range/damage/cooldown/free shots/drain; cloak.m: duration/cooldown/free uses/drain)
- Entity stats table (speed, coherence, attackValue, attackDistance, sightRadius for all 8 entity types)
- Entity AI behavior thresholds (leech stalk/charge, sentry patrol, beam cooldown, repair chance)
- All 7 hazard type constants (corruption, trigger trap, memory leak, firewall, unstable, echo chamber, gravity well)
- Collapse/spawning rates, scenario periods, micro-event chance, alert system, echo visibility
- Progression constants (final cluster, log caps)

**game.ts** — Replaced 10 local const declarations and 2 inline magic numbers with imports from balance.ts.

### Completed: Hazard & Scenario Definitions

**src/hazard-defs.ts** — Data-driven registry of all 8 hazard types with metadata: overlay type, cluster range, generation weight, behavioral flags (sealsDoors, dealsDamage, modifiesTerrain, etc.). Helper functions: `getHazardDef()`, `getHazardDefsForCluster()`.

**src/scenario-defs.ts** — Data-driven registry of all 7 room scenarios with metadata: category (ambient/encounter/ritual/alarm), trigger conditions, prop tags, broadcast behavior. Helper functions: `getScenarioDef()`, `getScenarioDefsForCluster()`.

### Completed: Unified Event System

**src/events.ts** — Trigger→condition→effect architecture:

- 10 trigger types (player_enter_room, tick, entity_killed, etc.)
- EventCondition: pure predicate, reads GameState without mutation
- EventEffect: pure function returning Intent[]
- Common conditions: playerInRoom, firstVisit, alertSuspicious, alertEnemy, notTriggered, hazardActive
- `dispatchEvents()`: matches events to triggers, evaluates conditions, collects intents

---

## Phase 4: Entity AI Definitions ✓

### Completed: Behavior Primitives

**src/behaviors.ts** — 14 composable, intent-returning behavior functions:

- Movement: `behaviorWander`, `behaviorWallWalk`, `behaviorChase`, `behaviorPatrol`
- Combat: `behaviorMeleeAttack`, `behaviorRangedAttack`
- AI state: `behaviorChangeState`, `behaviorSetTarget`, `behaviorSetCooldown`, `behaviorSetInvisible`
- Lifecycle: `behaviorRemoveEntity`, `behaviorMarkEntity`, `behaviorOpenDoor`
- Helpers: `findNearestHostile`, `getRelation`

### Completed: Entity Definitions

**src/entity-defs.ts** — Data-driven registry of all 7 entity types:

- Full stat blocks sourced from balance.ts (speed, coherence, attack, sight, etc.)
- AI metadata: startState, valid states, faction, wall penetration
- Display: name, glyph, fg color
- Helpers: `getEntityDef()`, `factionColor()`

---

## Phase 3: Intent Pipeline ✓

### Completed: Player Actions Return Intents

**`collectMoveIntents()`** — Player movement returns `{ acted, intents: Intent[] }`:
- God mode noclip: `move` + `sound` + interface exit `message` intents
- Door bump: `open_door` + `sound` intents
- Melee attack (hostile bump): `melee_attack` + `sound` + `message` intents
- Friendly push + swap: `push_entity` + `move` intents (resolved sequentially)
- Normal movement: `move` intent + interface exit messages
- Terminal/interactable bumps: UI-only state, no intents (return `acted: false`)

**`collectShootIntents()`** — corrupt.m ranged attack returns `{ acted, intents: Intent[] }`:
- Module bookkeeping (cooldowns, shot counts, coherence drain) applied directly
- Combat: `ranged_attack` + `shoot_animation` + `sound` + `message` intents
- Free-shot warning via `message` intent

### Completed: Pipeline-Structured processAction

**`processAction()`** restructured into 5 phases:
1. **Player intent** — collect + resolve player intents via `resolveIntents()`
2. **Environment** — FOV, room entry, door auto-close
3. **Hazards & room effects** — hazard ticks, tile damage, narrative triggers, modules
4. **Entity AI** — speed-based energy accumulation, `updateEntityAI()` dispatch
5. **Cleanup** — dead entity detection (coherence ≤ 0), smoke/sound/killedEntities tracking, `_pendingRemoval` flush, player death check

### Completed: Uniform Death Tracking

Dead entity cleanup enhanced to handle all death sources uniformly:
- Entities killed by AI: handled by `remove_entity` intents in Phase 4
- Entities killed by player (melee/ranged): `melee_attack`/`ranged_attack` intents reduce coherence, Phase 5 cleanup detects coherence ≤ 0 and adds smoke, sound, killedEntities, narrative triggers
- `checkNarrativeTriggers('entity_killed')` now fires for all kill sources, not just player melee

### Removed Code

- `openDoor()` helper (replaced by `open_door` intent)
- `tryMove()` function (replaced by `collectMoveIntents()`)
- `tryShoot()` function (replaced by `collectShootIntents()`)
- Inline entity death handling from player melee (moved to uniform cleanup)

---

## Overall Progress

| Phase | Status | Description |
| --- | --- | --- |
| 1. Foundation | **Complete** | Determinism fixes, intent types, intent resolver |
| 2. Data Layer | **Complete** | balance.ts, hazard-defs.ts, scenario-defs.ts, events.ts |
| 3. Intent Pipeline | **Complete** | processAction pipeline, player actions return Intent[] |
| 4. Entity AI | **Complete** | behaviors.ts, entity-defs.ts, all 7 AI types converted |
| 5. Room Events | Not started | Migrate narrative/hazard/scenario/micro to unified system |
| 6. Integration Tests | Not started | Room/key/reach/entity/event tests |
| 7. AI Player | Not started | Deterministic full-game bot |
| 8. Async + UI | Not started | Cluster pre-gen, main.ts decomposition |

### New Files

| File | Purpose |
| --- | --- |
| `src/intents.ts` | Intent type union (28 kinds) |
| `src/intent-resolver.ts` | Single mutation point: `resolveIntents()` |
| `src/balance.ts` | Centralized balance constants (~140 constants) |
| `src/hazard-defs.ts` | Data-driven hazard type registry (8 types) |
| `src/scenario-defs.ts` | Data-driven scenario registry (7 types) |
| `src/events.ts` | Unified trigger→condition→effect event system |
| `src/behaviors.ts` | Composable intent-returning AI behavior primitives |
| `src/entity-defs.ts` | Data-driven entity type registry (7 types) |

### Modified Files

| File | Changes |
| --- | --- |
| `src/game.ts` | Determinism fixes; balance.ts imports; intent pipeline (collectMoveIntents, collectShootIntents, 5-phase processAction, uniform death cleanup) |
| `src/ai.ts` | Replaced 1 `performance.now()` with `0` |
| `src/hazards.ts` | Replaced 4 `performance.now()` calls with `0` or negative delays |
| `src/main.ts` | Added smoke/echo timestamp stamping in `runSmokeLoop()` |
| `design/overhaul.md` | Full architecture design document |
