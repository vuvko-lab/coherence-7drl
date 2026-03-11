# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Coherence — a cyberpunk roguelike where you play as an uploaded mind navigating crumbling virtual ship systems. Built for 7DRL 2026. Vite + TypeScript, DOM-based monospace grid. Uses `rot-js` for the canvas renderer only; all game logic is custom.

## Commands

- `npm run dev` — Start Vite dev server with HMR
- `npm run build` — Type-check (`tsc`) then bundle (`vite build`)
- `npm run preview` — Serve the production build locally

No linter is configured. Tests use a custom headless harness (no framework).

- `npm test` — Run all tests (dialog-input, sim-test, ai-player)
- `npm run test:sim` — Balancing/integration sim-test (default 50 seeds, 250 ticks)
  - `-- --seeds N` / `-- --ticks N` / `-- --cluster N`
- `npm run test:dialog` — Dialog input unit + integration tests
- `npm run test:ai` — AI player full-game completion tests (default 10 seeds)
  - `-- --seeds N` / `-- --max-ticks N` / `-- --verbose`
- `npm run gen-html` — Generate animated HTML map visualizations (output to `maps/`)
  - `-- --seeds 1,3,7` / `-- --cluster N` / `-- --ticks N`

## Architecture

**Game loop flow:** Input → `processAction()` → move/transfer → `computeFOV()` → `updateHazards()` → `render()`

- **main.ts** — Bootstrap, wires InputHandler callbacks to GameState, runs render loop with auto-walk timer
- **game.ts** — GameState creation and mutation: `processAction()`, `tryMove()`, `tryTransfer()`, `stepAutoPath()`, entity turn scheduling (speed-based energy accumulation)
- **cluster.ts** — Translates `gen-halls` output into game `Cluster`: assigns wall glyphs, room types, hazard overlays, interface exits, terminals. Uses `collapseNoise` for hazard-by-collapse weighting.
- **gen-halls.ts** — Hall-first BSP layout generator. Phases: split space with corridors → subdivide blocks into rooms → merge small rooms → carve to grid → cut halls with wall+door chokepoints → place room doors → place interface exits → flood-fill connectivity guarantee. Exports `generate()`.
- **hazards.ts** — All 9 hazard types with intent-returning tick functions. `updateHazards()` collects intents and resolves them through `resolveIntents()`. Also contains `updateAlertModule()` which uses Dijkstra flood-fill to detect nearby hazards and hostile entities.
- **ai.ts** — Entity AI: `updateEntityAI()` dispatch + per-kind AI functions (Chronicler wanders/catalogs/broadcasts, Bit-Mite chases/attacks, Logic Leech wall-walks/stalks/charges, Sentry/Gate-Keeper patrols/attacks, Repair Scrapper repairs interactables, Titan Spawn hunts with AoE). All AI functions return `Intent[]`.
- **entity-defs.ts** — Data-driven entity registry (`ENTITY_DEFS`). `makeEntity(kind, pos, clusterId, overrides?)` creates entities from the registry. All entity stats (speed, coherence, attack, sight) defined here.
- **hazard-defs.ts** — Data-driven hazard type registry (`HAZARD_DEFS`). Declares collapse tiers, overlay types, generation weights. `getHazardsByTier()` used by cluster.ts for hazard room assignment.
- **intents.ts** — All intent type definitions (40+ types). Intents are pure data describing actions; resolved by `intent-resolver.ts`.
- **intent-resolver.ts** — Single mutation point: `resolveIntents(state, intents)` applies all state changes. Every game mutation flows through here.
- **behaviors.ts** — Reusable AI behavior primitives (wander, chase, flee, ranged attack, etc.) that return `Intent[]`.
- **renderer.ts** — Creates a DOM grid of `<span>` cells (50×30). Renders tiles by visibility state, overlays hazards/entities/player, updates SELF panel and message log
- **fov.ts** — 4-quadrant recursive shadowcasting, radius 20, doors block LOS unless you stand on them
- **pathfinding.ts** — BFS 4-directional, only pathfinds through seen walkable tiles
- **input.ts** — WASD/arrows for movement, Enter for cluster transfer, click-to-move (adjacent=immediate, far=auto-walk)
- **rng.ts** — Global seeded PRNG (mulberry32). Call `seed()` before generation; use `random()`, `randInt()`, `pick()`, `shuffle()` instead of `Math.random()` everywhere for reproducible maps.
- **noise.ts** — Seeded 2D Perlin noise (`initNoise()` + `collapseNoise()`). Used by `cluster.ts` to generate the infrastructure collapse heatmap that weights hazard room assignment.
- **glitch.ts** — Screen glitch effects: CSS effects (shake, chromatic, bars, flicker, hue) animate `#game`; canvas effects (static burst, horizontal tear, data bleed) use `GlitchRenderer.drawOver()`. Canvas effects are temporary — `renderAll()` in `main.ts` restores. `GLITCH_EFFECTS` registry used by admin panel.
- **audio.ts** — Web Audio API singleton `soundManager`. Categories: `sfx`, `ui`, `ambient` with independent gain controls. `play()` for one-shots, `startAmbient()` for looping hazard sounds, `startAmbientOnce()` for non-looping ambient (overlay sounds). Only one ambient source at a time; crossfades on switch.
- **narrative/** — Content modules: `terminals.ts` (terminal dialog trees per cluster), `echoes.ts` (lost echo encounters), `archives.ts` (data archive fragments), `whispers.ts` (ambient messages), `triggers.ts` (event-driven narrative beats), `epilogues.ts` (victory/death endings), `messages.ts` (system messages), `dialog.ts` (dialog node types), `index.ts` (re-exports)
- **dialog-input.ts** — Pure (no-DOM) overlay keyboard handling (`handleOverlayKey`) and map click logic (`mapClickAction`). Consumed by main.ts; tested headlessly by `tests/dialog-input-test.ts`.
- **editor/** — Map editor (`editor-main.ts`) with simulation playback; `serialize.ts` for map import/export
- **tests/** — All test and tool scripts (excluded from build via tsconfig):
  - `run-all.ts` — Test suite runner (`npm test`)
  - `sim-test.ts` — Headless balancing/integration tests. Severity levels: CRITICAL, HIGH, MEDIUM, LOW.
  - `dialog-input-test.ts` — Dialog input unit + integration tests (walk to terminal, select choices, close)
  - `ai-player.ts` — Deterministic bot that completes all 6 clusters. Tests reachability and determinism.
  - `gen-html.ts` — Generates animated HTML map visualizations for visual inspection
- **types.ts** — All type definitions, enums, constants, color palette

**Key concepts:**

- **Clusters** are self-contained 50×30 tile maps connected by interface exits: entry `⇏` (left edge, coming from previous cluster) and exit `⇨` (right edge, going forward)
- **Rooms** are generated via BSP and connected with a spanning tree + extra doors for loops
- **Hazard overlays** are separate from tile types — tiles have a `hazardOverlay` field and rooms have a `RoomHazardState`
- **Speed-based turns** — entities accumulate energy each tick, act when energy ≥ speed
- **Three visibility states** — visible (full color), seen/remembered (dimmed), unexplored (black)
- **Wall glyphs** — double-line box-drawing (`═║╔╗`) for outer walls, single-line (`─│┌┐`) for inner walls
- **Room tags** — four categories per room: `geometric` (hall/hub/dead_end/etc.), `functional` (engine_room/lab/medbay/etc.), `modifiers` (encrypted/degraded/etc.), `cosmetic`. Tags drive display and future gameplay logic.
- **Terminals & exit lock** — each cluster has one terminal with `hasKey=true`; `cluster.exitLocked` starts true and unlocks when that terminal is activated, gating the `⇨` exit transfer
- **Modules** — player carries loadout slots (`alert.m`, `overclock.m`, `corrupt.m`, `cloak.m`, `spoof.m`) with status `loaded | damaged | offline`; `alert.m` actively scans for hazards (red `!`) and hostile entities (orange `!`) each tick via Dijkstra flood-fill
- **Intent system** — all game mutations flow through pure-data intents resolved by a single mutation point (`intent-resolver.ts`). Entity AI, hazard ticks, and player actions all return `Intent[]`.
- **Chronicler marking** — Chroniclers catalog entities, making them globally visible (to player and AI). Marks tracked per-chronicler; cleared on chronicler death. Converging-square animation on first mark.
- **Seed reproduction** — append `#seed=N` to the URL to load a specific map; seed is logged to console on startup

## Design Docs

The `design/` directory contains game concept (`idea.md`), room generation research, predefined room templates, and inspiration notes. The sibling project at `/home/andrey/projects/7drl_2026/design/` has broader roguelike design research.
