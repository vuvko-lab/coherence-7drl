# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Coherence — a cyberpunk roguelike where you play as an uploaded mind navigating crumbling virtual ship systems. Built for 7DRL 2026. Vite + TypeScript, DOM-based monospace grid, no external game libraries.

## Commands

- `npm run dev` — Start Vite dev server with HMR
- `npm run build` — Type-check (`tsc`) then bundle (`vite build`)
- `npm run preview` — Serve the production build locally

No test framework is configured. No linter is configured.

## Architecture

**Game loop flow:** Input → `processAction()` → move/transfer → `computeFOV()` → `updateHazards()` → `render()`

- **main.ts** — Bootstrap, wires InputHandler callbacks to GameState, runs render loop with auto-walk timer
- **game.ts** — GameState creation and mutation: `processAction()`, `tryMove()`, `tryTransfer()`, `stepAutoPath()`, entity turn scheduling (speed-based energy accumulation)
- **cluster.ts** — Procedural level generation: BSP recursive division → maze-like door placement via union-find spanning tree → box-drawing wall glyphs → interface exits → hazard room assignment
- **hazards.ts** — All 9 hazard types (corrupted, trigger_trap, memory_leak, firewall, unstable, quarantine, echo_chamber, gravity_well, cascade) with per-tick update logic, spreading mechanics, and damage application
- **renderer.ts** — Creates a DOM grid of `<span>` cells (50×30). Renders tiles by visibility state, overlays hazards/entities/player, updates SELF panel and message log
- **fov.ts** — 4-quadrant recursive shadowcasting, radius 20, doors block LOS unless you stand on them
- **pathfinding.ts** — BFS 4-directional, only pathfinds through seen walkable tiles
- **input.ts** — WASD/arrows for movement, Enter for cluster transfer, click-to-move (adjacent=immediate, far=auto-walk)
- **types.ts** — All type definitions, enums, constants, color palette

**Key concepts:**
- **Clusters** are self-contained 50×30 tile maps connected by `⇋` interface exits on left/right edges
- **Rooms** are generated via BSP and connected with a spanning tree + extra doors for loops
- **Hazard overlays** are separate from tile types — tiles have a `hazardOverlay` field and rooms have a `RoomHazardState`
- **Speed-based turns** — entities accumulate energy each tick, act when energy ≥ speed
- **Three visibility states** — visible (full color), seen/remembered (dimmed), unexplored (black)
- **Wall glyphs** — double-line box-drawing (`═║╔╗`) for outer walls, single-line (`─│┌┐`) for inner walls

## Design Docs

The `design/` directory contains game concept (`idea.md`), room generation research, predefined room templates, and inspiration notes. The sibling project at `/home/andrey/projects/7drl_2026/design/` has broader roguelike design research.
