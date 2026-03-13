# Codebase Overhaul: Lean Architecture + Integration Tests

## Goals

1. **Data-flow-driven engine** — the whole game is a pipeline: data definitions → intent generation → resolution → state update → render
2. **Strict determinism** — same seed = identical game from start to victory, always
3. **Intent-based actions** — entities (and player) emit intents, the game loop resolves them; no direct state mutation
4. **Data-driven everything** — entities, hazards, rooms, events, and balance all defined as data, not code
5. **Event-driven core loop** — generalized trigger→condition→effect architecture replaces scattered mutation
6. **Async where possible** — cluster generation, pathfinding, and presentation run async without blocking the core tick
7. **Lean, readable code** — break god-functions, centralize constants, eliminate dead patterns
8. **Integration test suite** — entity behavior, room placement, key access, reachability, full-game AI playthrough
9. **AI player** — completes the entire game (6 clusters), immune to entity damage but not hazards, used for determinism and reachability validation

---

## Part 1: Determinism Enforcement

### 1.1 Known Violations

| Location | Issue | Fix |
|----------|-------|-----|
| `game.ts:1037` | `Date.now()` in hacked-terminal enemy ID | Use `_nextEntityId++` like all other factories |
| `ai.ts:632`, `game.ts:628,928`, `hazards.ts:903,924,932,1055` | `performance.now()` for `spawnTime` / `echoFadeAtTime` | **Already safe** — visual-only, not in game logic |

### 1.2 Determinism Boundary

Split the codebase into two layers:

```
DETERMINISTIC CORE (seed-controlled)          PRESENTATION (non-deterministic OK)
─────────────────────────────────────         ──────────────────────────────────
rng.ts          — seeded PRNG                 renderer.ts    — DOM rendering
game.ts         — state, actions, turns       audio.ts       — Web Audio
cluster.ts      — cluster generation          glitch.ts      — CSS/canvas effects
gen-halls.ts    — BSP layout                  main.ts        — UI orchestration
hazards.ts      — hazard simulation           boot/loading   — animations
ai.ts           — entity AI                   admin panel    — debug UI
pathfinding.ts  — BFS                         settings/theme — user prefs
fov.ts          — shadowcasting
noise.ts        — Perlin noise
events.ts       — room event system (NEW)
narrative/*     — trigger definitions
```

**Rule:** No file in the deterministic core may import from or call into the presentation layer. No `Date.now()`, `Math.random()`, `performance.now()`, or any time-dependent value in the core. Visual-only fields (`spawnTime`, `echoFadeAtTime`) should be set by the presentation layer after `processAction()` returns, not inside game logic.

### 1.3 Visual Timestamps Refactor

Move `spawnTime` and `echoFadeAtTime` assignments out of game logic:

**Before (game.ts:628):**
```ts
state.smokeEffects.push({ ...pos, spawnTime: performance.now() });
```

**After:**
Game logic pushes a smoke effect with `spawnTime: 0`. The presentation layer (`main.ts`) stamps it:
```ts
// In onAction(), after processAction():
for (const fx of state.smokeEffects) {
  if (fx.spawnTime === 0) fx.spawnTime = performance.now();
}
```

This keeps game state fully deterministic. The sim-test never calls `performance.now()` — smoke effects just have `spawnTime: 0` and that's fine for headless.

---

## Part 2: Data-Flow Engine Architecture

### 2.1 Design Philosophy

The current codebase is **imperative and mutation-heavy**: functions reach into GameState and change things directly, with call order determining behavior. The new architecture is **data-flow-driven**: the game is a pipeline where data declarations feed into a generic engine, and state mutations are concentrated in a single resolver.

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  DATA LAYER  │──▶│  INTENT LAYER│──▶│ RESOLVE LAYER│──▶│ RENDER LAYER │
│              │   │              │   │              │   │              │
│ entity-defs  │   │ AI decides   │   │ single point │   │ async DOM    │
│ room-events  │   │ player input │   │ of mutation  │   │ update       │
│ hazard-defs  │   │ hazard ticks │   │ (resolver)   │   │ audio queue  │
│ balance.ts   │   │ room events  │   │              │   │ glitch fx    │
│ scenarios    │   │              │   │              │   │              │
│ narrative    │   │ → Intent[]   │   │ → GameState' │   │ → DOM/Audio  │
└──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
     pure data        pure functions      single mutator     async/non-det OK
     (no logic)       (no side effects)   (deterministic)    (presentation)
```

### 2.2 The Four Layers

**Layer 1 — Data Layer (pure declarations, no logic)**

Everything that defines game content is declared as typed data objects, not code:

| Data File | What It Defines | Used By |
| --- | --- | --- |
| `entity-defs.ts` | Entity stats, glyphs, factions, state tables | AI dispatch, `makeEntity()` |
| `room-events.ts` | trigger→condition→effect rules for rooms | Event dispatcher |
| `hazard-defs.ts` | Hazard types, tier thresholds, spread rates | Room events, cluster gen |
| `balance.ts` | All tunable constants (damage, spawn rates, intervals) | Everything |
| `scenario-defs.ts` | Room scenario definitions (spooky_astronauts, etc.) | Room events |
| `narrative/*.ts` | Trigger definitions, dialog trees, terminal content | Room events, overlays |

Key principle: **if you can express it as a JSON-like object, it's data, not code.** Complex behaviors use `custom` fn escape hatches, but the goal is to minimize those over time.

**Layer 2 — Intent Layer (pure functions, no side effects)**

All decision-making produces intents, never mutations:

- **Entity AI**: reads GameState + EntityDef → returns `Intent[]`
- **Player input**: reads GameState + PlayerAction → returns `Intent[]`
- **Room events**: reads GameState + RoomEvent conditions → returns `Intent[]`
- **Hazard ticks**: reads GameState + HazardDef → returns `Intent[]`

These functions may read any part of GameState but **never write to it**. They are pure in the sense that given the same state, they produce the same intents (deterministic via seeded RNG).

**Layer 3 — Resolve Layer (single mutation point)**

`resolveIntents(state, intents)` is the **only function that mutates GameState**. All state changes flow through it:

- Movement conflicts resolved here (two entities → same tile)
- Damage modifiers applied here (immunity, resistance, bonuses)
- Kill cascades handled here (death → smoke → room event → more intents)
- Message/sound/glitch effects queued here (not applied — just queued)

This is deterministic and synchronous. It runs in the core tick.

#### Layer 4 — Render Layer (async, non-deterministic OK)

After the tick completes, the presentation layer consumes queued effects:

- DOM rendering (async via requestAnimationFrame)
- Audio playback (async Web Audio API)
- Glitch/animation effects (async CSS transitions)
- `performance.now()` timestamps applied here
- **Combat/beam animations** — played to completion before the next player input is accepted

This layer never feeds back into game state. It's fire-and-forget.

#### Animations and the Data-Flow Boundary

The current code has a `state.animation` field and `runAnimationLoop()` that blocks player input while a shooting animation plays. This looks like it violates the data-flow model — the animation loop reads game state and blocks the tick pipeline.

**It does not violate the architecture.** Here's why:

The tick pipeline is: `input → intents → resolve → state'`. Animations happen **after** `resolve` completes. The animation system is a **gate** between the render layer and the next input, not between phases of a tick:

```
Tick N:  input → intents → resolve → state' → [animation queue populated]
                                                       │
                                              ┌────────▼────────┐
                                              │  Animation Loop  │  (async, rAF)
                                              │  plays beam/shot │
                                              │  blocks INPUT    │
                                              │  (not tick logic) │
                                              └────────┬────────┘
                                                       │ animation done
Tick N+1: input → intents → resolve → state'' → ...
```

The key rules:
1. Animations **read** state (positions, colors) but **never write** to it
2. The resolver queues animation descriptors (`shoot_animation` intents become entries in `state.animationQueue`)
3. The presentation layer plays them after the tick, blocking the **input handler** — not the game logic
4. `state.animationQueue` is consumed and cleared by the render layer, not by game logic
5. In headless mode (sim-test, AI player), animations are simply skipped — the queue is ignored

This means:
- **Determinism preserved** — animations don't affect game state
- **Testable** — AI player runs ticks without waiting for animations
- **The resolver can queue multiple animations per tick** — the render layer plays them in sequence

The `animation` intent type in the resolver:
```ts
case 'shoot_animation':
  state.animationQueue.push({
    from: intent.from,
    to: intent.to,
    style: intent.style,
  });
  break;
```

The presentation layer in main.ts:
```ts
async function onAction(action: PlayerAction) {
  processAction(state, action);                    // sync: full tick completes
  await playAnimationQueue(state.animationQueue);  // async: blocks next input, not game logic
  state.animationQueue = [];                       // clear after playing
  renderAll(state);                                // sync DOM update
}
```

### 2.3 Async Boundaries

The game has natural async boundaries that the current code doesn't exploit:

```
SYNC (must complete in tick)              ASYNC (can run in background)
───────────────────────────               ─────────────────────────────
Intent generation (AI, events)            Cluster pre-generation
Intent resolution                         DOM rendering
State hashing (determinism)               Audio playback
                                          Glitch/animation effects
                                          FOV computation (can be async*)
                                          Pathfinding for AI (can be async*)
```

*FOV and pathfinding are currently synchronous and fast enough, but the architecture should not prevent making them async later.

#### 2.3.1 Async Cluster Pre-Generation

Currently, cluster generation happens synchronously inside `tryTransfer()`, causing a visible hitch when the player steps through an exit. With the data-flow architecture:

```ts
// When player is within N tiles of an exit, pre-generate the next cluster
async function preGenerateNextCluster(state: GameState): Promise<void> {
  const nearbyExit = findNearbyExit(state, threshold: 8);
  if (!nearbyExit || state.clusters.has(nearbyExit.targetClusterId)) return;
  if (state._pendingGeneration) return; // already generating

  state._pendingGeneration = true;
  // Run generation off the main thread (or at least async to yield to rendering)
  const cluster = await generateClusterAsync(nearbyExit.targetClusterId, state.seed);
  state.clusters.set(nearbyExit.targetClusterId, cluster);
  state._pendingGeneration = false;
}
```

The core tick remains synchronous. Pre-generation is a background optimization. If the player reaches the exit before generation completes, we fall back to synchronous generation (current behavior).

#### 2.3.2 Async Rendering Pipeline

Currently, `renderAll()` is synchronous and blocks the main thread. With the data-flow architecture, the render layer receives a **snapshot** of the state it needs:

```ts
// After processAction completes:
const renderSnapshot = extractRenderSnapshot(state); // cheap: just copies relevant fields
requestAnimationFrame(() => {
  renderer.render(renderSnapshot);  // DOM updates happen async
  stampVisualTimestamps(state);     // performance.now() applied to smoke/echo effects
  playQueuedSounds(state);         // audio triggered async
});
```

This means the game can process the next tick before the previous frame finishes rendering (important for auto-walk speed and AI player performance).

#### 2.3.3 Web Worker for Heavy Computation (Optional Future)

The data-flow architecture makes it possible to move cluster generation and pathfinding to a Web Worker, since they operate on serializable data (no DOM references):

```ts
// Future possibility — NOT required for initial overhaul
const worker = new Worker('game-worker.ts');
worker.postMessage({ kind: 'generate_cluster', id: 3, seed: 42 });
worker.onmessage = (e) => {
  state.clusters.set(e.data.id, e.data.cluster);
};
```

This is mentioned for architectural clarity — the data-flow design enables it, but it's not a Phase 1 goal.

### 2.4 Core Tick Pipeline

The `processAction()` function becomes a clean pipeline:

```ts
export function processAction(state: GameState, action: PlayerAction): void {
  // ── 1. Player intent ──
  const playerIntents = resolvePlayerAction(state, action);       // pure fn → Intent[]
  if (playerIntents.length === 0) return;
  resolveIntents(state, playerIntents);                           // single mutation point

  state.tick++;

  // ── 2. Environment reacts ──
  recomputeFOV(state);                                            // reads tiles, writes visibility
  const doorIntents = autoCloseDoors(state);                      // pure fn → Intent[]
  resolveIntents(state, doorIntents);

  // ── 3. Room events (hazards, scenarios, narrative) ──
  const cluster = currentCluster(state);
  const eventIntents = fireAllRoomEvents(state, cluster);         // pure fn → Intent[]
  resolveIntents(state, eventIntents);

  // ── 4. Tile hazard damage ──
  const hazardDmg = computeHazardDamage(state, cluster);          // pure fn → Intent[]
  resolveIntents(state, hazardDmg);

  // ── 5. Entity AI ──
  const entityIntents = computeAllEntityIntents(state, cluster);   // pure fn → Intent[]
  resolveIntents(state, entityIntents);

  // ── 6. Cleanup ──
  removeDeadEntities(state);
  updateModules(state);
  checkPlayerDeath(state);
}
```

Every numbered phase is: **read state → produce intents → resolve intents**. No phase reaches into another phase's data. The order is explicit and documented.

### 2.5 Data-Driven Hazard Definitions

Currently hazards are coded as functions in `hazards.ts`. With data-driven definitions:

```ts
// src/hazard-defs.ts

interface HazardDef {
  type: RoomType;
  name: string;
  // Balance params (from balance.ts)
  tickInterval: number;           // how often this hazard ticks (1 = every tick)
  spreadChance: number;           // probability of spreading per tick
  playerDamage: number;           // damage per tile per tick
  wallDegradation: number;        // chance to degrade adjacent walls

  // Room events this hazard registers (generated at cluster build time)
  events: RoomEvent[];

  // Visual
  tileOverlay: HazardOverlayType;
  stages: number;                 // how many visual stages (e.g., corruption has 4)
  color: string;
}

export const HAZARD_DEFS: Record<RoomType, HazardDef> = {
  corrupted: {
    type: 'corrupted',
    name: 'Corrupted Zone',
    tickInterval: 1,
    spreadChance: 0.08,
    playerDamage: 3,
    wallDegradation: 0.05,
    tileOverlay: 'corruption',
    stages: 4,
    color: '#884488',
    events: [
      {
        id: 'corrupted_spread',
        trigger: { kind: 'tick' },
        condition: { roomType: 'corrupted', hazardActive: true },
        effects: [{ kind: 'custom', fn: corruptionSpread }],
      },
      {
        id: 'corrupted_player_enter',
        trigger: { kind: 'player_enter' },
        condition: { roomType: 'corrupted' },
        effects: [
          { kind: 'message', text: 'Corruption crackles underfoot.', style: 'hazard' },
          { kind: 'glitch', effect: 'chromatic' },
        ],
      },
    ],
  },
  unstable: {
    type: 'unstable',
    name: 'Unstable Process',
    tickInterval: 1,
    spreadChance: 0,
    playerDamage: 7,
    wallDegradation: 0,
    tileOverlay: 'spark',
    stages: 1,
    color: '#ffcc00',
    events: [
      {
        id: 'unstable_sparks',
        trigger: { kind: 'tick' },
        condition: { roomType: 'unstable', hazardActive: true },
        effects: [{ kind: 'custom', fn: unstablePlaceSparks }],
      },
    ],
  },
  // ... other hazard types
};
```

At cluster build time, each hazard room's events are registered into the event system automatically from its `HazardDef`. No switch/case dispatch needed.

### 2.6 Data-Driven Room Scenarios

Same pattern for scenarios:

```ts
// src/scenario-defs.ts

interface ScenarioDef {
  id: RoomScenario;
  name: string;
  minCluster: number;             // earliest cluster this can appear
  spawnChance: number;            // probability per eligible room
  requiredTags?: FunctionalTag[]; // room must have one of these tags
  props: ScenarioPropDef[];       // entities to spawn
  events: RoomEvent[];            // behavior over time
}

export const SCENARIO_DEFS: Record<RoomScenario, ScenarioDef> = {
  spooky_astronauts: {
    id: 'spooky_astronauts',
    name: 'Spooky Astronauts',
    minCluster: 1,
    spawnChance: 0.15,
    props: [
      { glyph: '☠', fg: '#666666', name: 'Frozen Crewmember', propTag: 'spooky_crew' },
    ],
    events: [
      {
        id: 'spooky_broadcast',
        trigger: { kind: 'tick_interval', every: 15 },
        condition: { custom: (s, r) => r.scenario === 'spooky_astronauts' && r.scenarioState?.phase === 'active' },
        effects: [
          { kind: 'message', text: '[ECHO]: ...we were supposed to be alone...', style: 'system' },
          { kind: 'glitch', effect: 'chromatic' },
          { kind: 'custom', fn: spookyAstronautsTick },
        ],
      },
    ],
  },
  // ...
};
```

### 2.7 Where Async Fits in Each Layer

| Layer | Sync/Async | Rationale |
| --- | --- | --- |
| **Data Layer** | Sync (loaded at boot) | Static declarations, imported at module load |
| **Intent Generation** | Sync | Must be deterministic within a tick; seeded RNG |
| **Intent Resolution** | Sync | Single mutation pass, must complete before next phase |
| **FOV Computation** | Sync (could be async later) | Currently fast (<1ms), reads tiles, writes visibility |
| **Cluster Generation** | **Async** (pre-generation) | 5-20ms, can run in background when player approaches exit |
| **DOM Rendering** | **Async** (requestAnimationFrame) | Decoupled from tick; reads snapshot, never writes state |
| **Audio Playback** | **Async** (Web Audio API) | Fire-and-forget from sound queue |
| **Glitch/Animation FX** | **Async** (CSS transitions, rAF) | Purely visual, no state feedback |
| **Pathfinding** | Sync per entity (could batch async) | Currently BFS <1ms per call; could batch for many entities |
| **AI Player (test)** | **Async** (per-seed runs in parallel) | Integration tests can run multiple seeds concurrently |

### 2.8 Async Test Runner

The integration test suite can run seeds in parallel since each seed creates an independent GameState:

```ts
// src/integration-test.ts
async function runAllTests(): Promise<TestResult[]> {
  const seeds = Array.from({ length: 50 }, (_, i) => i + 1);

  // Run room/key/reach tests in parallel across seeds
  const roomResults = await Promise.all(
    seeds.map(seed => runRoomPlacementTests(seed))
  );

  // Run AI player completions in parallel
  const aiResults = await Promise.all(
    seeds.slice(0, 20).map(seed => runAIPlayerTest(seed))
  );

  // Determinism tests: sequential (comparing two runs per seed)
  const deterResults: TestResult[] = [];
  for (const seed of seeds.slice(0, 5)) {
    deterResults.push(await runDeterminismTest(seed));
  }

  return [...roomResults.flat(), ...aiResults, ...deterResults];
}
```

This makes test runs significantly faster — 50 seeds run on all CPU cores instead of sequentially.

---

## Part 3: Intent-Based Actions & Event-Driven Core Loop

### 2.1 Problem: Direct State Mutation

Currently, entities (and player actions) directly mutate game state wherever they act:

```ts
// ai.ts — Bit-Mite attack (current)
target.coherence = Math.max(0, target.coherence - entity.attackValue);  // direct mutation
state.pendingSounds.push('hit');                                        // direct mutation
tile.doorOpen = true; tile.walkable = true; tile.glyph = '▯';          // direct mutation
entity.position = { ...target };                                        // direct mutation
```

This creates several problems:
- **Untestable AI decisions** — can't inspect what an entity *wants* to do without it *doing* it
- **No interception** — can't cancel, modify, or react to actions before they happen (e.g., "this entity tries to attack but is blocked by a shield")
- **Order-dependent bugs** — entity A kills entity B mid-loop, entity B still acts this tick because it was already iterated
- **Mixed concerns** — AI decision logic is tangled with state mutation, sound queuing, and message formatting
- **Hard to add modifiers** — damage bonuses, resistances, status effects all require touching every attack function

### 2.2 Solution: Intent System

Entities don't mutate state. They return **intents** — descriptions of what they want to do. The game loop collects all intents, then resolves them in a single pass.

```ts
// src/intents.ts

type Intent =
  // Movement
  | { kind: 'move'; entityId: number; to: Position }
  | { kind: 'open_door'; entityId: number; at: Position }
  | { kind: 'push_entity'; pusherId: number; targetId: number; to: Position }

  // Combat
  | { kind: 'melee_attack'; attackerId: number; targetId: number; damage: number }
  | { kind: 'ranged_attack'; attackerId: number; targetId: number; damage: number; style: string }
  | { kind: 'aoe_attack'; attackerId: number; targetIds: number[]; damage: number; style: string }
  | { kind: 'pull'; pullerId: number; targetId: number; toward: Position }

  // Interaction
  | { kind: 'interact'; entityId: number; interactableId: string }
  | { kind: 'transfer'; entityId: number; direction: 'forward' | 'back' }
  | { kind: 'activate_terminal'; entityId: number; terminalId: string }

  // Entity lifecycle
  | { kind: 'spawn_entity'; entityKind: EntityKind; position: Position; overrides?: Partial<Entity> }
  | { kind: 'remove_entity'; entityId: number; cause: 'killed' | 'despawn' | 'dissolve' }

  // AI internal
  | { kind: 'change_state'; entityId: number; newState: string }
  | { kind: 'set_invisible'; entityId: number; invisible: boolean }
  | { kind: 'set_target'; entityId: number; targetId: number | undefined }
  | { kind: 'catalog'; entityId: number; targetId: number }

  // Effects (queued for presentation layer)
  | { kind: 'message'; text: string; style?: string }
  | { kind: 'sound'; id: string }
  | { kind: 'glitch'; effect: string }
  | { kind: 'reveal'; positions: string[]; duration: number }
  | { kind: 'smoke'; position: Position; color: string }
  | { kind: 'shoot_animation'; from: Position; to: Position; style: string }

  // Hazard / room effects
  | { kind: 'damage_tile'; position: Position; hazardType: string; stage: number }
  | { kind: 'spread_hazard'; roomId: number; hazardType: string }
  | { kind: 'seal_door'; position: Position }
  | { kind: 'unseal_door'; position: Position }
  ;
```

### 2.3 How Entities Emit Intents

AI functions return an array of intents instead of mutating state:

```ts
// Before (current ai.ts):
function bitMiteAttack(state: GameState, entity: Entity, target: Entity) {
  target.coherence = Math.max(0, target.coherence - entity.attackValue);
  if (pi) state.pendingSounds.push('hit');
  addAiMessage(state, `Bit-Mite attacks ${target.name}!`, 'combat', pi);
  if (target.coherence <= 0) {
    removeEntity(state, target);
    entity.ai!.aiState = 'wander';
  }
}

// After (intent-based):
function bitMiteAttack(entity: Entity, target: Entity): Intent[] {
  return [
    { kind: 'melee_attack', attackerId: entity.id, targetId: target.id, damage: entity.attackValue },
    // The resolver handles: coherence reduction, kill check, messages, sounds, state transitions
  ];
}
```

The state handler returns intents too:

```ts
// EntityDef state handler returns intents
const BIT_MITE: EntityDef = {
  // ...
  states: {
    wander: (ctx) => {
      if (ctx.target) {
        return {
          nextState: 'chase',
          intents: [{ kind: 'set_target', entityId: ctx.entity.id, targetId: ctx.target.id }],
        };
      }
      if (random() < 0.2) {
        const doorPos = findAdjacentDoor(ctx);
        if (doorPos) return { nextState: 'wander', intents: [{ kind: 'open_door', entityId: ctx.entity.id, at: doorPos }] };
      }
      const step = randomWalkStep(ctx.cluster, ctx.entity.position);
      if (step) return { nextState: 'wander', intents: [{ kind: 'move', entityId: ctx.entity.id, to: step }] };
      return { nextState: 'wander', intents: [] };
    },
    chase: (ctx) => {
      if (!ctx.target) return { nextState: 'wander', intents: [] };
      if (ctx.adjacentToTarget) {
        return {
          nextState: 'chase',
          intents: [{ kind: 'melee_attack', attackerId: ctx.entity.id, targetId: ctx.target.id, damage: ctx.entity.attackValue }],
        };
      }
      const step = stepToward(ctx.cluster, ctx.entity.position, ctx.target.position);
      if (step) return { nextState: 'chase', intents: [{ kind: 'move', entityId: ctx.entity.id, to: step }] };
      return { nextState: 'wander', intents: [] };
    },
  },
};
```

### 2.4 Intent Resolution

A single `resolveIntents()` function processes all intents in order, applying state mutations:

```ts
// src/intent-resolver.ts

export function resolveIntents(state: GameState, intents: Intent[]): void {
  const cluster = currentCluster(state);

  for (const intent of intents) {
    switch (intent.kind) {
      case 'move': {
        const entity = getEntity(state, intent.entityId);
        if (!entity) break;
        const tile = cluster.tiles[intent.to.y]?.[intent.to.x];
        if (!tile?.walkable) break;
        // Check occupancy conflicts
        if (isOccupied(state, cluster.id, intent.to)) break;
        entity.position = { ...intent.to };
        break;
      }

      case 'melee_attack': {
        const attacker = getEntity(state, intent.attackerId);
        const target = getEntity(state, intent.targetId);
        if (!attacker || !target) break;

        // ── Interception point: damage modifiers, immunity, shields ──
        let damage = intent.damage;
        if (target.id === state.player.id && state.aiPlayerImmune) damage = 0;
        // Future: check target.resistances, attacker.bonuses, status effects

        target.coherence = Math.max(0, (target.coherence ?? 0) - damage);

        // Auto-generate combat message
        const pi = target.id === state.player.id;
        if (pi || state.debugMode) {
          state.messages.push({
            text: `${attacker.name} attacks ${target.name}! −${damage} coherence. (${target.coherence}/${target.maxCoherence})`,
            type: 'combat', tick: state.tick,
          });
        }
        if (pi && damage > 0) state.pendingSounds.push('hit');

        // Kill check
        if (target.coherence <= 0 && target.id !== state.player.id) {
          target._pendingRemoval = true;
          state.pendingSounds.push('entity_death');
          // Queue smoke effect (spawnTime stamped by presentation layer)
          state.smokeEffects.push({ x: target.position.x, y: target.position.y, fg: factionColor(target), spawnTime: 0 });
          // Fire room event for entity death
          const room = findRoomAt(cluster, target.position);
          if (room) fireRoomEvents(state, 'entity_killed_in_room', room, cluster, { entity: target });
        }
        break;
      }

      case 'ranged_attack': {
        // Same as melee but with shoot animation
        // ...resolve damage...
        state.shootingEffects.push({ from: attacker.position, to: target.position, style: intent.style });
        break;
      }

      case 'open_door': {
        const tile = cluster.tiles[intent.at.y]?.[intent.at.x];
        if (!tile || tile.type !== TileType.Door || tile.glyph === '▪') break; // can't open sealed doors
        tile.doorOpen = true;
        tile.walkable = true;
        tile.transparent = true;
        tile.glyph = '▯';
        tile.doorCloseTick = undefined;
        break;
      }

      case 'spawn_entity': {
        const newEntity = makeEntity(intent.entityKind, intent.position, cluster.id, intent.overrides);
        state.entities.push(newEntity);
        break;
      }

      case 'remove_entity': {
        const target = getEntity(state, intent.entityId);
        if (target) target._pendingRemoval = true;
        break;
      }

      case 'change_state': {
        const entity = getEntity(state, intent.entityId);
        if (entity?.ai) entity.ai.aiState = intent.newState;
        break;
      }

      // Effects — just queue for presentation layer
      case 'message': state.messages.push({ text: intent.text, type: intent.style ?? 'normal', tick: state.tick }); break;
      case 'sound':   state.pendingSounds.push(intent.id); break;
      case 'glitch':  state.pendingGlitch = intent.effect; break;
      case 'smoke':   state.smokeEffects.push({ ...intent.position, fg: intent.color, spawnTime: 0 }); break;
      case 'reveal':  state.revealEffects.push({ positions: intent.positions, expireTick: state.tick + intent.duration }); break;

      // ... other intent kinds
    }
  }
}
```

### 2.5 Event-Driven Core Loop

The current `processAction()` is a linear sequence of 18 imperative steps. The new loop is organized around **phases** that collect and resolve intents:

```ts
// src/game.ts — new processAction

export function processAction(state: GameState, action: PlayerAction): void {
  // ── Phase 1: Player action → intents ──
  const playerIntents = resolvePlayerAction(state, action);
  if (playerIntents.length === 0) return;  // invalid action, no tick
  resolveIntents(state, playerIntents);

  state.tick++;

  // ── Phase 2: Environment reacts ──
  recomputeFOV(state);
  autoCloseDoors(state);  // emits door intents internally

  // ── Phase 3: Room events fire (hazards, scenarios, narrative) ──
  const cluster = currentCluster(state);
  const playerRoom = findPlayerRoom(state, cluster);
  if (playerRoom) {
    fireRoomEvents(state, 'player_enter', playerRoom, cluster);
  }
  const tickIntents = fireTickEvents(state, cluster);  // returns intents from hazard/scenario custom fns
  resolveIntents(state, tickIntents);

  // ── Phase 4: Apply tile hazard damage to player ──
  const hazardIntents = computeHazardDamage(state, cluster);
  resolveIntents(state, hazardIntents);

  // ── Phase 5: Entity AI → intents (no direct mutation) ──
  const entityIntents: Intent[] = [];
  for (const entity of state.entities) {
    if (entity.clusterId !== state.currentClusterId) continue;
    if (entity._pendingRemoval) continue;
    entity.energy += 10;
    if (entity.energy >= entity.speed) {
      entity.energy -= entity.speed;
      const intents = computeEntityIntents(state, entity);  // AI decides, returns intents
      entityIntents.push(...intents);
    }
  }
  resolveIntents(state, entityIntents);

  // ── Phase 6: Cleanup ──
  state.entities = state.entities.filter(e => !e._pendingRemoval);
  updateModules(state);
  checkPlayerDeath(state);
}
```

**Key differences from current code:**

| Aspect | Current | New |
| --- | --- | --- |
| Entity attacks | `target.coherence -= dmg` in AI code | AI returns `{ kind: 'melee_attack', damage }`, resolver applies |
| Door opening | `tile.doorOpen = true` in 3 places | `{ kind: 'open_door', at }` intent, resolved once |
| Kill handling | Inline in every attack function | Centralized in resolver's `melee_attack`/`ranged_attack` case |
| Sound queuing | `state.pendingSounds.push()` in 15+ places | Explicit `{ kind: 'sound' }` intents or auto-generated by resolver |
| Damage immunity | Would need checks in every attack fn | Single check in resolver: `if (state.aiPlayerImmune) damage = 0` |
| Entity spawning | Direct `state.entities.push()` | `{ kind: 'spawn_entity' }` intent |
| Message logging | `addMessage()` / `addAiMessage()` scattered | Auto-generated by resolver or explicit `{ kind: 'message' }` intents |

### 2.6 Player Actions as Intents

The player is treated the same way — input is converted to intents:

```ts
function resolvePlayerAction(state: GameState, action: PlayerAction): Intent[] {
  switch (action.kind) {
    case 'move': {
      const nx = state.player.position.x + action.dx;
      const ny = state.player.position.y + action.dy;
      const tile = cluster.tiles[ny]?.[nx];

      // Door bump
      if (tile?.type === TileType.Door && !tile.doorOpen) {
        return [{ kind: 'open_door', entityId: state.player.id, at: { x: nx, y: ny } }];
      }
      // Entity bump
      const bumped = findEntityAt(state, cluster.id, nx, ny);
      if (bumped) {
        const relation = getRelation('player', bumped.ai?.faction ?? 'neutral', state.alertLevel);
        if (relation === 'attack') {
          return [{ kind: 'melee_attack', attackerId: state.player.id, targetId: bumped.id, damage: MELEE_DAMAGE }];
        }
        return [{ kind: 'push_entity', pusherId: state.player.id, targetId: bumped.id, to: state.player.position }];
      }
      // Normal move
      return [{ kind: 'move', entityId: state.player.id, to: { x: nx, y: ny } }];
    }

    case 'transfer':
      return [{ kind: 'transfer', entityId: state.player.id, direction: 'forward' }];

    case 'wait':
      return [{ kind: 'message', text: '', style: 'system' }];  // no-op intent to signal valid action

    case 'shoot':
      return [{ kind: 'ranged_attack', attackerId: state.player.id, targetId: action.targetId, damage: CORRUPT_M_DAMAGE, style: 'beam' }];
  }
}
```

### 2.7 Room Events Emit Intents Too

The room event system's `custom` fn handlers return intents instead of mutating state:

```ts
// Before (hazards.ts — direct mutation):
function unstablePlaceSparks(state: GameState, room: Room, cluster: Cluster) {
  const interior = roomInterior(room);
  for (const pos of interior) {
    if (random() < 0.15) {
      cluster.tiles[pos.y][pos.x].hazardOverlay = { type: 'spark', stage: 1 };  // direct mutation
    }
  }
}

// After (intent-based):
function unstablePlaceSparks(state: GameState, room: Room, cluster: Cluster): Intent[] {
  const intents: Intent[] = [];
  const interior = roomInterior(room);
  for (const pos of interior) {
    if (random() < 0.15) {
      intents.push({ kind: 'damage_tile', position: pos, hazardType: 'spark', stage: 1 });
    }
  }
  return intents;
}
```

Updated `fireRoomEvents()` collects intents from custom fns and returns them for resolution:

```ts
export function fireRoomEvents(state, triggerKind, room, cluster, context?): Intent[] {
  const allIntents: Intent[] = [];
  for (const event of EVENT_REGISTRY) {
    if (!matches(event, triggerKind, state, room, cluster, context)) continue;
    for (const effect of event.effects) {
      if (effect.kind === 'custom') {
        allIntents.push(...effect.fn(state, room, cluster));
      } else {
        allIntents.push(effectToIntent(effect, room));  // convert simple effects to intents
      }
    }
  }
  return allIntents;
}
```

### 2.8 Benefits of Intent Architecture

- **Testable AI** — assert that an entity *intends* to attack without checking if damage was applied
- **Single mutation point** — all state changes flow through `resolveIntents()`, easy to audit and debug
- **Interception/modifiers** — damage resistance, shields, status effects, immunity all live in the resolver
- **Conflict resolution** — two entities try to move to the same tile? Resolver picks winner. Currently this is scattered across `move()` calls
- **Replay/undo** — intent logs are a complete record of what happened; can replay a game from seed + intents
- **Event cascading** — an entity dying can fire room events, which emit more intents, all resolved in the same pass
- **AI player simplicity** — the test AI player just returns intents like any other entity

### 2.9 Migration Strategy

The intent system can be introduced incrementally:

1. **Define the `Intent` type** and `resolveIntents()` function
2. **Wrap existing AI** — each `updateEntityAI()` call collects intents in a local array, passes to `resolveIntents()`. Internally the AI functions still mutate, but the wrapper catches the pattern
3. **Convert one entity at a time** — start with Chronicler (simplest), then Bit-Mite, then others
4. **Convert player actions** — `resolvePlayerAction()` returns intents
5. **Convert hazard effects** — custom fns return intents
6. **Delete direct mutation paths** — remove `addAiMessage()`, inline `target.coherence -=` patterns, etc.

At each step, sim-test results must stay identical.

---

## Part 3: Entity AI Behavior Abstraction

### 2.1 Problem

Currently every entity type is a separate hand-written state machine. Common patterns are duplicated:

| Pattern | Duplicated In |
|---------|---------------|
| "wander randomly" | Chronicler, Bit-Mite, Repair Scrapper, Titan Spawn |
| "find attack target via faction table + LOS" | Bit-Mite, Logic Leech, Sentry, Gate-Keeper, Titan Spawn |
| "chase target, fall back to last-known-pos" | Bit-Mite, Sentry (nearly identical ~30 lines each) |
| "melee attack + damage + kill check + message" | Bit-Mite (`bitMiteAttack`), Logic Leech (`leechMeleeAttack`), inline in charge |
| "ranged attack + LOS check + animation" | Sentry (`sentryAttack`), Gate-Keeper (inline), Titan Spawn (inline AoE) |
| "patrol room + 10% chance to move to adjacent" | Sentry, Repair Scrapper |
| "door bash" | Bit-Mite (inline, 20% chance) |

Adding a new entity means copy-pasting 80-100 lines and tweaking constants. The behavior logic can't be tested in isolation.

### 2.2 Behavior Primitives

Extract reusable behavior functions that each handle one concern. Each returns a `BehaviorResult` indicating what happened:

```ts
type BehaviorResult =
  | { done: true; acted: boolean }   // behavior completed, may or may not have spent a turn
  | { done: false }                  // behavior needs more ticks (e.g., still chasing)
  ;

// ── Movement behaviors ──
function behaviorWander(entity, cluster, state): BehaviorResult;
function behaviorWallWalk(entity, cluster, state): BehaviorResult;
function behaviorPatrol(entity, cluster, state): BehaviorResult;      // room patrol + adjacent room drift
function behaviorChase(entity, cluster, state): BehaviorResult;       // chase target or last-known-pos
function behaviorCharge(entity, cluster, state, dir, steps): BehaviorResult; // cardinal charge N tiles
function behaviorStepToward(entity, cluster, target): BehaviorResult;

// ── Combat behaviors ──
function behaviorMeleeAttack(entity, target, state): BehaviorResult;
function behaviorRangedAttack(entity, target, state, style): BehaviorResult;
function behaviorAoeAttack(entity, targets, state, style): BehaviorResult;
function behaviorPullTargets(entity, cluster, state): BehaviorResult;  // Gate-Keeper gravity pull

// ── Sensing behaviors ──
function behaviorFindTarget(entity, cluster, state): Entity | undefined;  // faction-aware LOS scan
function behaviorScanForCorrupted(entity, cluster): Position | undefined; // Repair Scrapper

// ── Utility behaviors ──
function behaviorBashDoor(entity, cluster, chance): BehaviorResult;
function behaviorCooldown(entity, ticks): BehaviorResult;  // decrement cooldown, done when 0
function behaviorCatalog(entity, target, state, cluster): BehaviorResult; // Chronicler observe+broadcast
```

### 2.3 Data-Driven Entity Definitions

Replace 8 factory functions + 7 update functions with a single entity registry:

```ts
interface EntityDef {
  kind: EntityKind;
  name: string;
  glyph: string;
  fg: string;
  faction: Faction;
  // Stats
  speed: number;
  coherence: number;
  attackValue: number;
  attackDistance: number;
  sightRadius: number;
  wallPenetration: number;
  // Behavior — defines the AI state machine as a table
  initialState: string;
  states: Record<string, AIStateHandler>;
}

// Each state handler returns the next state (or same state to continue)
type AIStateHandler = (ctx: AIContext) => string;  // returns next state name

interface AIContext {
  entity: Entity;
  cluster: Cluster;
  state: GameState;
  // Pre-computed helpers (populated before handler call)
  target: Entity | undefined;       // result of behaviorFindTarget
  distToTarget: number;
  adjacentToTarget: boolean;
}
```

**Example: Bit-Mite defined as data:**
```ts
const BIT_MITE: EntityDef = {
  kind: 'bit_mite',
  name: 'Bit-Mite Swarm',
  glyph: '⁕',
  fg: '#cc4444',
  faction: 'aggressive',
  speed: 12,
  coherence: 15,
  attackValue: 4,
  attackDistance: 1,
  sightRadius: 8,
  wallPenetration: 0,
  initialState: 'wander',
  states: {
    wander: (ctx) => {
      if (ctx.target) return 'chase';             // spotted target → chase
      behaviorBashDoor(ctx.entity, ctx.cluster, 0.2);
      behaviorWander(ctx.entity, ctx.cluster, ctx.state);
      return 'wander';
    },
    chase: (ctx) => {
      if (!ctx.target) return 'wander';            // lost target → wander
      if (ctx.adjacentToTarget) {
        behaviorMeleeAttack(ctx.entity, ctx.target, ctx.state);
        return 'chase';                            // stay in chase after attack
      }
      behaviorChase(ctx.entity, ctx.cluster, ctx.state);
      return 'chase';
    },
  },
};
```

**Example: Logic Leech (more complex):**
```ts
const LOGIC_LEECH: EntityDef = {
  kind: 'logic_leech',
  name: 'Logic Leech',
  glyph: '⌒',
  fg: '#cc4444',
  faction: 'aggressive',
  speed: 20,
  coherence: 25,
  attackValue: 12,
  attackDistance: 1,
  sightRadius: 15,
  wallPenetration: 2,
  initialState: 'wall_walk',
  states: {
    wall_walk: (ctx) => {
      if (ctx.adjacentToTarget) { behaviorMeleeAttack(ctx.entity, ctx.target!, ctx.state); return 'wall_walk'; }
      if (ctx.target) { ctx.entity.ai!.actionCooldown = 3; ctx.entity.ai!.invisible = true; return 'stalk'; }
      behaviorWallWalk(ctx.entity, ctx.cluster, ctx.state);
      return 'wall_walk';
    },
    stalk: (ctx) => {
      if (!ctx.target) { ctx.entity.ai!.invisible = false; return 'wall_walk'; }
      const result = behaviorCooldown(ctx.entity, 1);
      if (result.done) { computeChargeDir(ctx); ctx.entity.ai!.invisible = false; return 'charge'; }
      return 'stalk';
    },
    charge: (ctx) => {
      const result = behaviorCharge(ctx.entity, ctx.cluster, ctx.state, ctx.entity.ai!.chargeDir!, 1);
      if (result.done) return 'rest';
      return 'charge';
    },
    rest: (ctx) => {
      if (ctx.adjacentToTarget) { behaviorMeleeAttack(ctx.entity, ctx.target!, ctx.state); return 'rest'; }
      const result = behaviorCooldown(ctx.entity, 1);
      if (result.done) return 'wall_walk';
      return 'rest';
    },
  },
};
```

### 2.4 Entity Registry

```ts
// src/entity-defs.ts
export const ENTITY_DEFS: Record<EntityKind, EntityDef> = {
  bit_mite: BIT_MITE,
  logic_leech: LOGIC_LEECH,
  chronicler: CHRONICLER,
  sentry: SENTRY,
  gate_keeper: GATE_KEEPER,
  repair_scrapper: REPAIR_SCRAPPER,
  titan_spawn: TITAN_SPAWN,
};

// Single factory for all entities
export function makeEntity(kind: EntityKind, pos: Position, clusterId: number, overrides?: Partial<Entity>): Entity {
  const def = ENTITY_DEFS[kind];
  return {
    id: _nextEntityId++,
    name: def.name,
    glyph: def.glyph,
    fg: def.fg,
    position: { ...pos },
    clusterId,
    speed: def.speed,
    energy: 0,
    coherence: def.coherence,
    maxCoherence: def.coherence,
    attackDistance: def.attackDistance,
    attackValue: def.attackValue,
    ai: {
      kind,
      faction: def.faction,
      aiState: def.initialState,
      sightRadius: def.sightRadius,
      wallPenetration: def.wallPenetration,
    },
    ...overrides,
  };
}
```

### 2.5 Unified AI Dispatch

Replaces the current 7-way switch in `updateEntityAI()`:

```ts
export function updateEntityAI(state: GameState, entity: Entity) {
  const ai = entity.ai;
  if (!ai) return;
  const cluster = state.clusters.get(entity.clusterId);
  if (!cluster) return;
  const def = ENTITY_DEFS[ai.kind];
  if (!def) return;

  // Build context
  const target = behaviorFindTarget(entity, cluster, state);
  const dx = target ? Math.abs(entity.position.x - target.position.x) : Infinity;
  const dy = target ? Math.abs(entity.position.y - target.position.y) : Infinity;

  const ctx: AIContext = {
    entity, cluster, state, target,
    distToTarget: dx + dy,
    adjacentToTarget: dx + dy <= 1,
  };

  // Run current state handler → get next state
  const handler = def.states[ai.aiState];
  if (handler) {
    ai.aiState = handler(ctx);
  }
}
```

### 2.6 Benefits

- **Adding a new entity = adding a data entry** — no new update function, no new factory, no new switch case
- **Behaviors are testable in isolation** — `behaviorChase()` can be unit-tested without creating a full entity
- **Common bugs caught once** — fix chase logic in one place, all chasers benefit
- **Variants are trivial** — `makeDamagedBitMite` becomes `makeEntity('bit_mite', pos, id, { coherence: 5, speed: 18, fg: '#aa6644' })`

---

## Part 3: Room Event System

### 3.1 Problem

The codebase has **three separate event-like systems** that all do similar things:

1. **Narrative triggers** (`narrative/triggers.ts`) — condition → message/alert_delta effects, checked at specific points in `processAction()`
2. **Room scenarios** (`hazards.ts:updateRoomScenarios()`) — per-tick state machines hardcoded per scenario name, 187 lines of switch/case
3. **Micro-events** (`hazards.ts:tryFireMicroEvent()`) — one-shot random events on room entry, string-based dispatch
4. **Hazard updates** (`hazards.ts:updateHazards()`) — per-room-type tick handlers, switch/case on `room.roomType`

Each uses different mechanisms for the same conceptual pattern: "when X happens in/to a room, do Y." Adding a new room behavior means touching 2-3 files and knowing which system to hook into.

### 3.2 Unified Room Event Architecture

Generalize all room-level behaviors into a single **trigger→condition→effect** system:

```ts
// src/events.ts

// ── When does this event fire? ──
type RoomEventTrigger =
  | { kind: 'tick' }                           // every game tick (for ongoing hazards)
  | { kind: 'tick_interval'; every: number }   // every N ticks
  | { kind: 'player_enter' }                   // player steps into this room
  | { kind: 'player_exit' }                    // player leaves this room
  | { kind: 'entity_enter'; faction?: Faction } // any entity enters
  | { kind: 'entity_killed_in_room' }          // entity dies in this room
  | { kind: 'terminal_activated' }             // terminal in this room is used
  | { kind: 'hazard_deactivated' }             // room hazard is turned off
  | { kind: 'cluster_enter' }                  // player enters this cluster (once)
  | { kind: 'collapse_threshold'; min: number } // room collapse exceeds threshold
  ;

// ── Should this event actually fire? (optional filter) ──
interface RoomEventCondition {
  minTick?: number;                // don't fire before this tick
  maxTick?: number;                // don't fire after this tick
  minCollapse?: number;            // room collapse >= this
  maxCollapse?: number;            // room collapse <= this
  roomType?: RoomType;             // room must be this type
  functionalTag?: FunctionalTag;   // room must have this tag
  hazardActive?: boolean;          // room hazard must be active/inactive
  once?: boolean;                  // fire at most once per room per run (default false)
  probability?: number;            // random chance [0,1] (uses seeded RNG)
  clusterId?: number;              // exact cluster
  clusterIdMin?: number;           // cluster >= this
  playerInRoom?: boolean;          // only fire if player is in this room
  custom?: (state: GameState, room: Room, cluster: Cluster) => boolean;  // escape hatch
}

// ── What happens when it fires? ──
type RoomEventEffect =
  // Communication
  | { kind: 'message'; text: string; style?: string }
  | { kind: 'sound'; id: string }
  | { kind: 'glitch'; effect: string }
  // State mutation
  | { kind: 'damage_player'; amount: number }
  | { kind: 'damage_entities'; amount: number; faction?: Faction }
  | { kind: 'alert_delta'; amount: number }
  | { kind: 'spawn_entity'; entityKind: EntityKind; count?: number }
  | { kind: 'modify_tiles'; fn: (tiles: Tile[][], room: Room) => void }
  | { kind: 'spread_hazard'; hazardType: HazardOverlayType; chance: number }
  | { kind: 'seal_doors' | 'unseal_doors' }
  | { kind: 'set_room_state'; key: string; value: any }
  // Meta
  | { kind: 'fire_event'; eventId: string }     // cascade: trigger another event
  | { kind: 'remove_self' }                      // one-shot: remove this event after firing
  | { kind: 'custom'; fn: (state: GameState, room: Room, cluster: Cluster) => void }
  ;

// ── The event definition ──
interface RoomEvent {
  id: string;
  trigger: RoomEventTrigger;
  condition?: RoomEventCondition;
  effects: RoomEventEffect[];
  priority?: number;               // lower runs first (default 0)
}
```

### 3.3 How Existing Systems Map to Room Events

#### Narrative Triggers → Room Events

**Before (narrative/triggers.ts):**
```ts
{
  id: 'c1_enter',
  condition: { event: 'cluster_enter', clusterId: 1, once: true },
  effects: [
    { kind: 'message', text: '[SYSTEM STATUS]: WARNING!', style: 'system' },
  ],
}
```

**After (same data, unified type):**
```ts
{
  id: 'c1_enter',
  trigger: { kind: 'cluster_enter' },
  condition: { clusterId: 1, once: true },
  effects: [
    { kind: 'message', text: '[SYSTEM STATUS]: WARNING!', style: 'system' },
  ],
}
```

Nearly identical — the NarrativeTrigger type was already close to this. The key change is that narrative triggers now live in the same system as room behaviors.

#### Hazard Updates → Room Events

**Before (hazards.ts, hardcoded switch):**
```ts
case 'unstable':
  updateUnstable(state, cluster, room);  // 30 lines of inline logic
  break;
```

**After:**
```ts
// Unstable room: random spark tiles each tick
{
  id: 'unstable_sparks',
  trigger: { kind: 'tick' },
  condition: { roomType: 'unstable', hazardActive: true },
  effects: [
    { kind: 'custom', fn: unstablePlaceSparks },  // extracted 15-line function
    { kind: 'custom', fn: unstableApplyDamage },   // extracted 10-line function
  ],
}
```

Complex hazards (firewall, corruption) keep their `custom` fn handlers but are registered as events instead of being dispatched via switch/case. The event system is the single dispatch mechanism.

#### Room Scenarios → Room Events

**Before (hazards.ts:updateRoomScenarios, 187-line switch):**
```ts
case 'spooky_astronauts':
  // 30 lines of inline state machine
  break;
```

**After:**
```ts
// Spooky Astronauts: entities periodically broadcast alerts
{
  id: 'scenario_spooky_astronauts',
  trigger: { kind: 'tick_interval', every: 15 },
  condition: { custom: (s, r) => r.scenario === 'spooky_astronauts' && r.scenarioState?.phase === 'active' },
  effects: [
    { kind: 'message', text: '[ECHO]: ...we were supposed to be alone...', style: 'system' },
    { kind: 'glitch', effect: 'chromatic' },
    { kind: 'custom', fn: spookyAstronautsTick },
  ],
}
```

#### Micro-Events → Room Events

**Before (hazards.ts:tryFireMicroEvent, string dispatch):**
```ts
const events = ['door_slam', 'log_spam', 'light_flicker', ...];
const pick = events[Math.floor(random() * events.length)];
// 100 lines of if/else on pick
```

**After:** Each micro-event is a separate room event with `probability` and `once`:
```ts
{
  id: 'micro_door_slam',
  trigger: { kind: 'player_enter' },
  condition: { clusterIdMin: 2, once: true, probability: 0.025 },  // 0.25 / 10 events
  effects: [
    { kind: 'sound', id: 'door_slam' },
    { kind: 'message', text: 'A door slams shut somewhere behind you.', style: 'hazard' },
    { kind: 'custom', fn: doorSlamCloseDoors },
  ],
}
```

### 3.4 Event Dispatch

Single dispatch point replaces 4 separate systems:

```ts
// src/events.ts

// Global registry (populated at startup from narrative + hazard + scenario + micro definitions)
const EVENT_REGISTRY: RoomEvent[] = [];

export function registerRoomEvents(events: RoomEvent[]) {
  EVENT_REGISTRY.push(...events);
  EVENT_REGISTRY.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
}

// Called from processAction() at appropriate points
export function fireRoomEvents(
  state: GameState,
  triggerKind: RoomEventTrigger['kind'],
  room: Room,
  cluster: Cluster,
  context?: { entity?: Entity; faction?: Faction },
) {
  const firedSet = state.firedEventIds;  // replaces firedTriggerIds

  for (const event of EVENT_REGISTRY) {
    if (event.trigger.kind !== triggerKind) continue;
    if (event.condition?.once && firedSet.has(event.id)) continue;
    if (!matchesCondition(event.condition, state, room, cluster, context)) continue;

    // Fire effects
    for (const effect of event.effects) {
      applyEffect(effect, state, room, cluster);
    }

    if (event.condition?.once) firedSet.add(event.id);
  }
}

// Called from processAction() for tick-based events on all rooms
export function fireTickEvents(state: GameState, cluster: Cluster) {
  for (const room of cluster.rooms) {
    fireRoomEvents(state, 'tick', room, cluster);
  }
}
```

### 3.5 Integration with processAction()

**Before:**
```ts
// processAction() calls 4 different systems:
checkNarrativeTriggers(state, 'room_enter', { room });
updateHazards(state);             // switch on roomType
updateRoomScenarios(state);       // switch on scenario name
tryFireMicroEvent(state, room);   // random string dispatch
```

**After:**
```ts
// processAction() calls one system:
fireRoomEvents(state, 'player_enter', newRoom, cluster);
fireTickEvents(state, cluster);  // handles hazards, scenarios, collapse effects
```

### 3.6 Benefits

- **One system to learn** — new content authors write `RoomEvent` objects, not code
- **Composable** — a quarantine room can have hazard tick events + entry message + deactivation trigger all as separate events
- **Testable** — fire a specific trigger kind on a test room, assert effects applied
- **Extensible** — new trigger kinds (e.g., `item_used`, `module_activated`) just add a new `fireRoomEvents()` call site
- **Data-driven content** — scenarios, micro-events, and narrative triggers all live in `.ts` data files, no logic to maintain
- **Room-event tests** — integration tests can fire triggers and assert specific effects, making room behavior fully testable

### 3.7 Migration Strategy

Phase the migration to avoid breaking everything at once:

1. **Define the types** (`RoomEvent`, `RoomEventTrigger`, etc.) and the dispatch function
2. **Migrate narrative triggers** first — they're already almost the right shape, low risk
3. **Migrate micro-events** — simple one-shot events, easy to convert
4. **Migrate room scenarios** — extract each scenario's tick logic into a `custom` fn, register as events
5. **Migrate hazard updates** — each hazard type becomes 1-3 room events with `custom` fns for complex logic
6. **Remove old dispatch** — delete `checkNarrativeTriggers()`, `updateRoomScenarios()`, `tryFireMicroEvent()`, and the `updateHazards()` switch/case

The `custom` fn escape hatch is critical here — complex hazards like firewall and corruption keep their update logic as functions, but are registered and dispatched through the event system rather than a hardcoded switch. Over time, complex custom fns can be further decomposed into primitive effects.

---

## Part 4: Code Leanness

### 4.1 main.ts Decomposition (2360 lines → ~600 + 5 modules)

| New Module | Lines Moved | Contents |
|------------|-------------|----------|
| `src/ui/admin-panel.ts` | ~320 | `initAdminPanel()`, `updateAdminPanel()`, all debug wiring |
| `src/ui/overlays.ts` | ~500 | Terminal, interactable, victory, death overlay open/close/render |
| `src/ui/target-panel.ts` | ~160 | `renderTargetPanel()`, `glitchTargetText()` |
| `src/ui/settings.ts` | ~200 | Theme presets, color pickers, font/volume, localStorage |
| `src/ui/boot.ts` | ~120 | Loading screen, boot scramble, first-gesture handler |
| `src/main.ts` | ~600 | Bootstrap, `renderAll()` (simplified), `onAction()`, input wiring, auto-walk, animation loop |

**`renderAll()` simplification** — currently 147 lines with 11 responsibilities. After extraction:
```ts
function renderAll() {
  if (checkGameOver()) return;
  syncGridDimensions();
  expireCollapseGlitches();
  const overlays = computeOverlays();
  renderer.render(state, overlays);
  updateSelfPanel();
  updateTargetPanel();
  updateStatusBar();
  openQueuedOverlays();
}
```

### 4.2 game.ts Decomposition (1476 lines → ~800 + helpers)

**Extract `processAction()` phases into named functions:**
```ts
function processAction(state, action) {
  const acted = dispatchAction(state, action);  // move/transfer/wait/shoot
  if (!acted) return;
  state.tick++;
  recomputeFOV(state);
  processRoomEntry(state);         // → fireRoomEvents(state, 'player_enter', ...)
  autoCloseDoors(state);
  fireTickEvents(state, cluster);  // replaces updateHazards + updateRoomScenarios + collapse
  applyTileHazardDamage(state);
  updateModules(state);
  updateEntities(state);
  removeDeadEntities(state);
  checkPlayerDeath(state);
}
```

Each phase is a small function (10-30 lines) in the same file. No new modules needed — just named extraction for readability.

**Extract entity spawning weights** into a data table:
```ts
const ENTITY_SPAWN_WEIGHTS: Record<EntityKind, (depth: number, room: Room) => number> = {
  bit_mite:   (d, r) => 2.0 + d * 0.4 + (r.collapse > 0.5 ? 1.0 : 0),
  logic_leech:(d, r) => d >= 2 ? 0.8 + (r.tags.geometric === 'dead_end' ? 0.5 : 0) : 0,
  chronicler: (d, r) => 1.2,
  sentry:     (d, r) => d >= 2 ? 0.6 : 0,
  // ...
};
```

### 4.3 cluster.ts Simplification (2572 lines → ~1800 + balance.ts)

**Extract balance constants to `src/balance.ts`:**
```ts
// src/balance.ts — all tunable game parameters in one place
export const HAZARD_TIER_THRESHOLDS = { SAFE: 0.1, LOW: 0.3, MID: 0.5, HIGH: 0.6 };
export const HAZARD_ROOM_FRACTION = [0.25, 0.25, 0.50, 0.50, 0.75, 0.75]; // per cluster
export const NOISE_PARAMS = { scale: 0.13, octaves: 3, persistence: 0.65 };
export const DAMAGE_PARAMS = { base: 0.40, increment: 0.20 };
export const ENTITY_BASE_CHANCE = 0.05;
export const ENTITY_CHANCE_PER_DEPTH = 0.025;
export const ENTITY_COOLDOWN_ROOMS = 8;
export const SPAWN_INTERVALS = { bit_mite: 60, sentry: 100, gate_keeper: 120 };
// ... etc
```

**Eliminate global `_activeW`/`_activeH`** — pass bounds as parameter to `wallGlyph()` and `isOuterPos()`.

**Simplify `assignFunctionalTags()`** — extract three passes into:
- `anchorRooms(rooms, entry, exit, bfs)` → Map<roomId, tag>
- `propagateTags(rooms, anchors, rules)` → Map<roomId, tag>
- `fillRemainingTags(rooms, tagged, allowed)` → void

### 4.4 hazards.ts Simplification (1380 lines → ~800)

After migrating to the room event system, hazards.ts becomes a library of **effect functions** (the `custom` fn handlers) rather than a dispatch hub:

```ts
// Pure hazard update functions — no dispatch logic, just mechanics
export function corruptionSpread(state, room, cluster): void { ... }
export function corruptionDamage(state, room, cluster): void { ... }
export function triggerTrapActivate(state, room, cluster): void { ... }
export function triggerTrapDetonate(state, room, cluster): void { ... }
export function firewallSweep(state, room, cluster): void { ... }
export function memoryLeakFlood(state, room, cluster): void { ... }
export function unstableSparks(state, room, cluster): void { ... }
export function echoChamberTrail(state, room, cluster): void { ... }
export function gravityWellPull(state, room, cluster): void { ... }
```

The `updateHazards()` switch/case and `updateRoomScenarios()` switch/case are deleted. The event system dispatches to these functions.

### 4.5 ai.ts Cleanup (1068 lines → ~400 + entity-defs.ts + behaviors.ts)

After the behavior abstraction:

| New File | Contents |
|----------|----------|
| `src/behaviors.ts` (~250 lines) | All behavior primitives: wander, chase, patrol, melee, ranged, etc. |
| `src/entity-defs.ts` (~200 lines) | `ENTITY_DEFS` registry, `makeEntity()` factory |
| `src/ai.ts` (~400 lines) | `updateEntityAI()` dispatch, `AIContext` builder, helpers (`canSee`, `findAttackTarget`, etc.) |

### 4.6 Dead Code & Cleanup

- Remove `(state as any)[key]` type-unsafe admin toggle access → use typed dispatch map
- Deduplicate overlay close pattern (terminal & interactable share identical cleanup)
- Deduplicate kill-count aggregation (victory & death overlays)
- Remove `_genSizeOverride` / `_damageBase` / `_damageIncrement` globals → pass as params to `generateCluster()`

---

## Part 5: Integration Test Suite

### 5.1 Test Runner Architecture

Keep `sim-test.ts` as the existing balancing suite. Add a new `src/integration-test.ts` with focused scenario tests.

```
npx tsx src/integration-test.ts           # run all integration tests
npx tsx src/integration-test.ts --filter entity   # run only entity tests
npx tsx src/integration-test.ts --filter reach    # run only reachability tests
npx tsx src/integration-test.ts --filter ai       # run only AI player tests
npx tsx src/integration-test.ts --filter event    # run only room event tests
```

**Test harness (no external framework):**
```ts
interface TestResult { name: string; passed: boolean; detail?: string }
function test(name: string, fn: () => void): TestResult { ... }
function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(msg); }
function assertEq<T>(a: T, b: T, msg?: string): void { ... }
```

### 5.2 Test Categories

#### A. Room Placement Tests (10-15 tests)

```
room/entry_exit_exist        — every cluster has exactly 1 entry and 1 exit interface
room/entry_on_left_edge      — entry interface at x=0
room/exit_on_right_edge      — exit interface at x=width-1
room/no_overlapping_rooms    — no two rooms share interior tiles
room/all_rooms_have_doors    — every non-hall room has ≥1 door
room/room_connectivity       — BFS from entry reaches all rooms (at tick 0)
room/hall_connectivity       — every hall connects to ≥1 room on each end
room/min_room_count          — cluster has ≥8 rooms (excl. halls)
room/functional_tags_valid   — all assigned tags are in FUNCTIONAL_TAG enum
room/hazard_rooms_have_type  — rooms with hazardState have matching RoomType
```

**Setup:** Generate 50 clusters at depths 0-5 with fixed seeds. Pure generation tests — no simulation.

#### B. Key Placement & Access Tests (8-10 tests)

```
key/terminal_exists          — every cluster has exactly 1 terminal with hasKey=true
key/terminal_reachable_t0    — key terminal adjacent tile reachable from entry at tick 0
key/exit_locked_initially    — cluster.exitLocked === true at generation
key/exit_unlocks_on_key      — after activating key terminal, exitLocked becomes false
key/terminal_not_in_entry    — key terminal not in entry room
key/terminal_not_in_exit     — key terminal not in exit room
key/terminal_room_type       — key terminal room has appropriate functional tag
key/quarantine_deactivatable — if key is in quarantine room, deactivation switch is reachable
```

**Setup:** Generate clusters, simulate terminal activation via `executeInteractableAction()`.

#### C. Reachability Tests (8-10 tests)

```
reach/exit_from_entry_t0       — BFS path exists entry→exit at tick 0
reach/key_without_high_hazard  — path entry→key terminal exists that avoids D/E hazard rooms
reach/exit_after_key           — path key_terminal→exit exists
reach/no_isolated_rooms_t0     — no rooms with 0 reachable tiles at tick 0
reach/chokepoints_traversable  — all chokepoint rooms have walkable tiles
reach/quarantine_bypassable    — if quarantine blocks critical path, deactivation switch is reachable without entering quarantine
reach/full_path_damage_bounded — entry→key→exit path total hazard damage < 50 (survivable)
reach/path_avoids_lethal_rooms — at least one entry→exit path exists with 0 D/E rooms (clusters 0-2)
```

**Key test: `reach/key_without_high_hazard`** — This validates the core design promise: the player can always get the key without entering a dangerous room.

Implementation:
```ts
function testKeyWithoutHighHazard(cluster: Cluster): boolean {
  // BFS from entry, but EXCLUDE tiles in rooms with hazardState in [HIGH, EXTREME]
  const dangerousRoomIds = new Set(
    cluster.rooms.filter(r => r.hazardState && ['quarantine','cascade','gravity_well'].includes(r.hazardState.type)).map(r => r.id)
  );
  const reachable = bfsExcludingRooms(cluster, cluster.entryPos, dangerousRoomIds);
  const keyTerminal = cluster.terminals.find(t => t.hasKey);
  return keyTerminal && reachable.has(keyAdjacentPos(keyTerminal));
}
```

#### D. Entity Behavior Tests (12-15 tests)

```
entity/bit_mite_chases_player    — Bit-Mite in sight range enters 'chase' state
entity/bit_mite_attacks_adjacent — Bit-Mite adjacent to player deals damage
entity/logic_leech_wall_walks    — Logic Leech moves along walls when no target
entity/logic_leech_charges       — Logic Leech charges cardinally at spotted target
entity/chronicler_wanders        — Chronicler changes position over 20 ticks
entity/chronicler_no_attack      — Chronicler never deals damage to player
entity/sentry_patrols            — Sentry moves between patrol waypoints
entity/sentry_attacks_hostile    — Sentry attacks aggressive entities in range
entity/gate_keeper_pulls         — Gate-Keeper pulls nearby enemies closer
entity/repair_scrapper_repairs   — Repair Scrapper heals corrupted interactables
entity/titan_aoe_damage          — Titan Spawn deals AoE damage in range
entity/faction_relations_correct — friendly doesn't attack player, aggressive does
entity/spawn_counts_scale        — later clusters spawn more entities
entity/behavior_wander_moves     — behaviorWander changes position on open tile
entity/behavior_chase_approaches — behaviorChase reduces distance to target
entity/behavior_melee_deals_dmg  — behaviorMeleeAttack reduces target coherence
```

**Setup:** Create minimal cluster with known layout, place entity + player at known positions, simulate N ticks, verify state changes.

```ts
function testBitMiteChases() {
  const state = createTestState({ seed: 1, clusterId: 1 });
  const mite = spawnEntityAt(state, 'bit_mite', { x: 10, y: 5 });
  state.player.position = { x: 13, y: 5 }; // 3 tiles away, in sight

  for (let i = 0; i < 5; i++) processAction(state, { kind: 'wait' });

  const dist = Math.abs(mite.position.x - state.player.position.x)
             + Math.abs(mite.position.y - state.player.position.y);
  assert(dist < 3, `Bit-Mite should chase player, dist=${dist}`);
  assert(mite.ai!.aiState === 'chase', `Expected chase state, got ${mite.ai!.aiState}`);
}
```

#### E. Room Event Tests (8-10 tests)

```
event/narrative_fires_on_cluster_enter   — cluster entry message appears
event/narrative_once_guard               — once:true events don't fire twice
event/hazard_tick_fires_for_active_room  — corruption spread fires each tick
event/hazard_tick_skips_normal_room      — normal rooms don't run hazard events
event/micro_event_fires_on_entry         — micro-event triggers on player_enter with probability
event/micro_event_once_per_room          — same room doesn't fire micro-event twice
event/scenario_fires_at_interval         — tick_interval events fire at correct cadence
event/cascade_trigger                    — fire_event effect triggers another event
event/condition_collapse_min             — collapseMin filter works correctly
event/custom_effect_runs                 — custom fn effects execute and modify state
```

**Setup:** Register test events, create minimal state, fire triggers, assert effects applied.

```ts
function testNarrativeOnceGuard() {
  const state = createTestState({ seed: 1 });
  const events = [{
    id: 'test_once',
    trigger: { kind: 'player_enter' as const },
    condition: { once: true },
    effects: [{ kind: 'message' as const, text: 'hello', style: 'system' }],
  }];
  registerRoomEvents(events);

  const room = state.clusters.get(0)!.rooms[0];
  fireRoomEvents(state, 'player_enter', room, state.clusters.get(0)!);
  assert(state.messages.length === 1, 'First fire should add message');

  fireRoomEvents(state, 'player_enter', room, state.clusters.get(0)!);
  assert(state.messages.length === 1, 'Second fire should not add message (once guard)');
}
```

#### F. Determinism Tests (5-8 tests)

```
determ/same_seed_same_cluster    — generate cluster twice with same seed → identical tiles
determ/same_seed_same_entities   — same seed → same entity positions and IDs
determ/same_seed_same_hazards    — same seed → same hazard room assignments
determ/full_game_deterministic   — AI player completes game twice with same seed → identical action log
determ/entity_ai_deterministic   — simulate 100 ticks twice → identical entity positions
determ/hazard_spread_deterministic — simulate 200 ticks twice → identical hazard tile counts
determ/narrative_triggers_deterministic — same seed → same triggers fired in same order
determ/room_events_deterministic — same seed → same room events fired in same order
```

**The full-game determinism test** is the gold standard. It runs the AI player (see Part 6) twice with the same seed and asserts that every tick produces identical game state.

```ts
function testFullGameDeterminism(seed: number) {
  const log1 = runAIPlayer(seed);
  const log2 = runAIPlayer(seed);
  assertEq(log1.length, log2.length, 'Action log length mismatch');
  for (let i = 0; i < log1.length; i++) {
    assertEq(log1[i].action, log2[i].action, `Action mismatch at step ${i}`);
    assertEq(log1[i].stateHash, log2[i].stateHash, `State hash mismatch at step ${i}`);
  }
}
```

---

## Part 6: AI Player

### 6.1 Purpose

A deterministic AI that completes the full game (clusters 0-5) using the seeded PRNG for tie-breaking. Used for:

1. **Determinism validation** — run twice, compare state hashes
2. **Reachability proof** — if AI can't reach key or exit, test fails
3. **Hazard survivability** — AI takes hazard damage, must survive with coherence > 0
4. **Balance smoke test** — tracks coherence at each cluster transfer

### 6.2 Design

The AI player is **immune to entity damage** (entities still move and act, but their attacks deal 0 to the AI player). Hazard damage applies normally. This isolates map/hazard balance from combat balance.

```ts
interface AIPlayerConfig {
  seed: number;
  maxTicksPerCluster: number;  // safety limit, default 500
  maxTotalTicks: number;       // safety limit, default 5000
  entityDamageImmune: boolean; // true for testing
}

interface AIPlayerResult {
  completed: boolean;          // reached cluster 5 exit
  clustersCleared: number;
  totalTicks: number;
  coherenceLog: number[];      // coherence at each cluster transfer
  actionLog: AIActionEntry[];  // for determinism comparison
  deathCause?: string;         // if !completed: 'hazard_damage' | 'stuck' | 'timeout'
}

interface AIActionEntry {
  tick: number;
  action: PlayerAction;
  stateHash: number;           // hash of key game state fields
}
```

### 6.3 AI Strategy (Simple, Deterministic)

The AI uses a fixed priority strategy with no learning — just BFS pathfinding and simple decision-making. All randomness comes from the seeded PRNG.

```
Per-cluster loop:
  1. BFS from current position to key terminal (avoiding high-hazard rooms if possible)
  2. Walk the path, activating the key terminal when adjacent
  3. BFS from current position to exit interface
  4. Walk the path, transfer to next cluster
  5. If stuck (no path found), try relaxed pathfinding (allow hazard rooms)
  6. If still stuck, wait N ticks (hazards may open new paths via wall corruption)
  7. If timeout, report failure
```

**Pathfinding with hazard avoidance:**
```ts
function aiBFS(cluster: Cluster, from: Position, to: Position, avoidDangerous: boolean): Position[] | null {
  // Standard BFS but with tile cost weighting:
  // - Normal floor: cost 1
  // - Hazard tile (low): cost 3
  // - Hazard tile (high): cost 10 (or blocked if avoidDangerous)
  // - Quarantine sealed door: blocked
  // Returns shortest path, or null if unreachable
}
```

**Action selection per tick:**
```ts
function aiChooseAction(state: GameState): PlayerAction {
  const cluster = currentCluster(state);
  const phase = cluster.exitLocked ? 'seek_key' : 'seek_exit';

  if (phase === 'seek_key') {
    const keyTerminal = findKeyTerminal(cluster);
    if (isAdjacent(state.player, keyTerminal)) {
      return { kind: 'interact', target: keyTerminal }; // activate terminal
    }
    const path = aiBFS(cluster, state.player.position, adjacentTo(keyTerminal), true);
    if (path && path.length > 0) return moveToward(path[0]);
    // Fallback: allow dangerous rooms
    const fallback = aiBFS(cluster, state.player.position, adjacentTo(keyTerminal), false);
    if (fallback && fallback.length > 0) return moveToward(fallback[0]);
    return { kind: 'wait' }; // stuck, wait for hazard changes
  }

  if (phase === 'seek_exit') {
    const exit = findExitInterface(cluster);
    if (isOnTile(state.player, exit)) return { kind: 'transfer' };
    const path = aiBFS(cluster, state.player.position, exit, true);
    if (path && path.length > 0) return moveToward(path[0]);
    const fallback = aiBFS(cluster, state.player.position, exit, false);
    if (fallback && fallback.length > 0) return moveToward(fallback[0]);
    return { kind: 'wait' };
  }
}
```

### 6.4 Entity Damage Immunity Implementation

In `processAction()` or entity AI attack functions, check a flag:

```ts
// In behaviors.ts, in the shared attack functions:
if (target.id === state.player.id && state.aiPlayerImmune) {
  // Skip damage, still run animations/messages for state consistency
  return;
}
```

This flag is set only during AI test runs, not during normal gameplay.

### 6.5 State Hashing for Determinism

```ts
function hashGameState(state: GameState): number {
  let h = state.tick;
  h = hash(h, state.player.position.x, state.player.position.y, state.player.coherence);
  h = hash(h, state.currentClusterId);
  for (const e of state.entities) {
    h = hash(h, e.id, e.position.x, e.position.y, e.coherence, e.ai?.aiState ?? 0);
  }
  // Hash a sample of hazard tiles (every 5th tile)
  const cluster = state.clusters.get(state.currentClusterId)!;
  for (let i = 0; i < cluster.tiles.length; i += 5) {
    for (let j = 0; j < cluster.tiles[0].length; j += 5) {
      const t = cluster.tiles[i][j];
      h = hash(h, t.type, t.hazardOverlay?.type ?? 0, t.hazardOverlay?.stage ?? 0);
    }
  }
  return h;
}
```

---

## Part 7: Implementation Order

### Phase 1: Foundation — Determinism + Intent Types (2-3 hours)

1. Fix `Date.now()` in `game.ts:1037` → use `_nextEntityId++`
2. Move `performance.now()` assignments from game logic to presentation layer
3. Define `Intent` type union in `src/intents.ts`
4. Implement `resolveIntents()` in `src/intent-resolver.ts` — start with move, melee_attack, open_door, message, sound
5. Add `determ/same_seed_same_cluster` test
6. Verify existing sim-test determinism check still passes

### Phase 2: Data Layer — Balance + Definitions (2-3 hours)

1. Create `src/balance.ts` with all magic numbers from cluster.ts, hazards.ts, ai.ts, game.ts
2. Create `src/hazard-defs.ts` with `HAZARD_DEFS` registry (data-driven hazard definitions)
3. Create `src/scenario-defs.ts` with `SCENARIO_DEFS` registry
4. Define `RoomEvent` types in `src/events.ts`, implement `fireRoomEvents()` dispatch
5. Replace inline numbers with imported constants
6. Remove `_damageBase`/`_damageIncrement`/`_activeW`/`_activeH` globals — pass as params

### Phase 3: Intent Pipeline — Convert Core Loop (3-4 hours)

1. Convert `processAction()` to the 6-phase pipeline (player intents → environment → events → hazards → entities → cleanup)
2. Convert `resolvePlayerAction()` — player input returns `Intent[]` instead of direct mutation
3. Convert `autoCloseDoors()` to return `Intent[]`
4. Convert `computeHazardDamage()` to return `Intent[]`
5. Wire animation queue: resolver queues `shoot_animation` intents → presentation layer plays them after tick
6. Verify sim-test results unchanged

### Phase 4: Entity AI — Behaviors + Data-Driven Definitions (3-4 hours)

1. Create `src/behaviors.ts` with intent-returning behavior primitives (wander, chase, patrol, melee, ranged, etc.)
2. Create `src/entity-defs.ts` with `ENTITY_DEFS` registry and `makeEntity()` factory
3. Refactor `ai.ts`: state handlers return `{ nextState, intents }` instead of mutating
4. Convert each entity type to `EntityDef` with state table (start with Chronicler → Bit-Mite → others)
5. Delete old factory functions and per-entity update functions
6. Verify sim-test results unchanged after each entity conversion

### Phase 5: Room Event System Migration (3-4 hours)

1. Migrate narrative triggers → room events (nearly 1:1 mapping)
2. Migrate micro-events → room events (each becomes a separate event with probability)
3. Migrate room scenarios → room events with `custom` fns returning `Intent[]`
4. Migrate hazard updates → room events with `custom` fns returning `Intent[]`
5. Delete `checkNarrativeTriggers()`, `updateRoomScenarios()`, `tryFireMicroEvent()`, `updateHazards()` switch
6. Verify sim-test results unchanged

### Phase 6: Integration Test Suite (3-4 hours)

1. Create `src/integration-test.ts` with async test harness (parallel seed execution)
2. Implement room placement tests (A)
3. Implement key placement tests (B)
4. Implement reachability tests (C) — especially `key_without_high_hazard`
5. Implement entity behavior tests (D) — assert on intents, not just state
6. Implement room event tests (E)
7. Run across 50 seeds in parallel, report pass/fail

### Phase 7: AI Player + Full Determinism (4-5 hours)

1. Create `src/ai-player.ts` with `aiChooseAction()` and `runAIPlayer()`
2. Implement hazard-aware BFS pathfinding
3. Implement terminal interaction + cluster transfer logic
4. Add entity damage immunity in intent resolver (`aiPlayerImmune` flag)
5. Implement `hashGameState()` for determinism comparison
6. Test: AI completes cluster 0-5 on 20 seeds (run in parallel)
7. Run AI player twice per seed, compare action logs + state hashes
8. Fix any remaining non-determinism found

### Phase 8: Async Boundaries + Presentation Layer (3-4 hours)

1. Implement async cluster pre-generation (background when player approaches exit)
2. Refactor `onAction()` in main.ts: `processAction()` (sync) → `playAnimationQueue()` (async) → `renderAll()` (sync)
3. Extract `src/ui/admin-panel.ts`, `src/ui/overlays.ts`, `src/ui/target-panel.ts`, `src/ui/settings.ts`, `src/ui/boot.ts`
4. Simplify remaining main.ts to ~600 lines
5. Verify game runs correctly in browser with async rendering

---

## Part 8: Test Output Format

```
$ npx tsx src/integration-test.ts

  Room Placement (50 seeds × 6 clusters)
    ✓ entry_exit_exist .................. 300/300
    ✓ entry_on_left_edge ............... 300/300
    ✓ exit_on_right_edge ............... 300/300
    ✓ no_overlapping_rooms ............. 300/300
    ✓ all_rooms_have_doors ............. 300/300
    ✓ room_connectivity ................ 300/300
    ✗ min_room_count ................... 298/300 (seed 42 cluster 4: 7 rooms)

  Key Placement (50 seeds × 6 clusters)
    ✓ terminal_exists .................. 300/300
    ✓ terminal_reachable_t0 ............ 300/300
    ✓ exit_locked_initially ............ 300/300

  Reachability (50 seeds × 6 clusters)
    ✓ exit_from_entry_t0 ............... 300/300
    ✓ key_without_high_hazard .......... 300/300
    ✓ full_path_damage_bounded ......... 297/300

  Entity Behavior (10 seeds)
    ✓ bit_mite_chases_player ........... 10/10
    ✓ logic_leech_charges .............. 10/10
    ✓ chronicler_no_attack ............. 10/10
    ✓ behavior_wander_moves ............ 10/10
    ✓ behavior_chase_approaches ........ 10/10

  Room Events (10 seeds)
    ✓ narrative_fires_on_cluster_enter . 10/10
    ✓ narrative_once_guard ............. 10/10
    ✓ hazard_tick_fires ................ 10/10
    ✓ micro_event_once_per_room ........ 10/10
    ✓ cascade_trigger .................. 10/10

  Determinism (5 seeds, full game)
    ✓ full_game_deterministic .......... 5/5
    ✓ entity_ai_deterministic .......... 5/5
    ✓ room_events_deterministic ........ 5/5

  AI Player (20 seeds, full game)
    ✓ completes_game ................... 20/20
    avg coherence at exit: 47.3
    avg ticks per cluster: 82.1
    avg total ticks: 493.2

  55/56 passed, 1 failed
```

---

## Appendix A: New File Structure

```
src/
  # ── Data Layer (pure declarations) ──
  balance.ts          NEW — all tunable constants in one place
  entity-defs.ts      NEW — data-driven entity definitions + makeEntity()
  hazard-defs.ts      NEW — data-driven hazard type definitions
  scenario-defs.ts    NEW — data-driven room scenario definitions
  room-events.ts      NEW — all room event declarations (narrative, micro, hazard, scenario)

  # ── Intent Layer (pure functions → Intent[]) ──
  intents.ts          NEW — Intent type union
  intent-resolver.ts  NEW — resolveIntents() — single mutation point
  behaviors.ts        NEW — composable AI behavior primitives (return Intent[])
  events.ts           NEW — room event engine (trigger matching, dispatch → Intent[])

  # ── Core Engine ──
  ai.ts               REFACTORED — dispatch + helpers, state handlers return intents (~400 lines)
  game.ts             REFACTORED — processAction as 6-phase intent pipeline
  cluster.ts          REFACTORED — globals eliminated, uses balance.ts + hazard-defs.ts
  hazards.ts          REFACTORED — pure effect functions returning Intent[], no dispatch
  pathfinding.ts      UNCHANGED — BFS (reads state, no mutation)
  fov.ts              UNCHANGED — shadowcasting (reads tiles, writes visibility)
  rng.ts              UNCHANGED — seeded PRNG
  noise.ts            UNCHANGED — Perlin noise

  # ── Testing ──
  ai-player.ts        NEW — deterministic AI player for full-game testing
  integration-test.ts NEW — async integration test suite (parallel seeds)

  # ── Presentation Layer (async, non-deterministic OK) ──
  main.ts             REFACTORED — ~600 lines: bootstrap, onAction, async animation gate
  renderer.ts         UNCHANGED — DOM grid rendering
  audio.ts            UNCHANGED — Web Audio singleton
  glitch.ts           UNCHANGED — CSS/canvas effects

  ui/
    admin-panel.ts    NEW — extracted from main.ts
    overlays.ts       NEW — extracted from main.ts
    target-panel.ts   NEW — extracted from main.ts
    settings.ts       NEW — extracted from main.ts
    boot.ts           NEW — extracted from main.ts

  narrative/
    triggers.ts       MIGRATED — triggers converted to RoomEvent[] format
    (other files unchanged)

  types.ts            MODIFIED — Intent types, AIContext, animationQueue, aiPlayerImmune
```

## Appendix B: Architecture Diagram

```
                         DATA LAYER (pure declarations)
    ┌───────────┐  ┌────────────┐  ┌──────────────┐  ┌──────────────┐
    │ balance.ts│  │entity-defs │  │ hazard-defs  │  │scenario-defs │
    │ constants │  │ stats+AI   │  │ spread/dmg   │  │ props+events │
    └─────┬─────┘  └─────┬──────┘  └──────┬───────┘  └──────┬───────┘
          │              │                │                  │
          └──────────────┼────────────────┼──────────────────┘
                         │                │
                         ▼                ▼
                  ┌─────────────┐  ┌─────────────┐
                  │ behaviors.ts│  │room-events.ts│
                  │ wander/chase│  │ all triggers │
                  │ → Intent[]  │  │ → Intent[]   │
                  └──────┬──────┘  └──────┬───────┘
                         │                │
          INTENT LAYER   │                │   (pure functions, no side effects)
          ───────────────┼────────────────┼──────────────────────────
                         │                │
                         ▼                ▼
     ┌──────────┐  ┌──────────┐   ┌──────────┐
     │ player   │  │ ai.ts    │   │events.ts │
     │ input    │  │ AI state │   │ dispatch │
     │→ Intent[]│  │→ Intent[]│   │→ Intent[]│
     └────┬─────┘  └────┬─────┘   └────┬─────┘
          │              │              │
          └──────────────┼──────────────┘
                         │
          RESOLVE LAYER  ▼  (single mutation point, deterministic)
          ─────────────────────────────────────────────────
                  ┌──────────────────┐
                  │ intent-resolver  │
                  │ resolveIntents() │
                  │                  │
                  │ • move entity    │
                  │ • apply damage   │
                  │ • open doors     │
                  │ • spawn/remove   │
                  │ • queue effects  │
                  └────────┬─────────┘
                           │
                     GameState'
                           │
          RENDER LAYER     ▼  (async, non-deterministic OK)
          ─────────────────────────────────────────────────
                  ┌──────────────────┐
                  │ main.ts onAction │
                  │                  │
                  │ 1. processAction │  ← sync: full tick
                  │ 2. playAnims()   │  ← async: blocks next input
                  │ 3. renderAll()   │  ← sync: DOM update
                  │ 4. playSounds()  │  ← async: fire-and-forget
                  └──────────────────┘
```
