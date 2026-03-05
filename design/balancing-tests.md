# Balancing Test Suite Design

Automated tests that simulate clusters over time and extract metrics to catch balance problems before playtesting. No rendering, no input — pure simulation against the game's existing logic.

---

## 1. Test Architecture

### 1a. Simulation Harness

Each test creates a game state with a fixed seed, then drives it forward by calling `processAction(state, { kind: 'wait' })` in a loop. One `wait` = one tick. The player never moves — it sits at the spawn point while hazards evolve around it.

```typescript
// Pseudo-code for a single test run
function simulateCluster(seed: number, ticks: number, clusterId = 0): SimSnapshot[] {
  const state = createGame(seed);
  const snapshots: SimSnapshot[] = [snapshotCluster(state, clusterId)];

  for (let t = 0; t < ticks; t++) {
    processAction(state, { kind: 'wait' });
    if (t % 10 === 9) snapshots.push(snapshotCluster(state, clusterId)); // every 10 ticks
  }

  return snapshots;
}
```

A `SimSnapshot` captures the metrics below at a point in time. Comparing snapshot[0] vs snapshot[N] gives before/after deltas.

### 1b. Test Scenarios

Run each metric suite against a **matrix of seeds × cluster IDs**. For deterministic results, use a fixed seed list (e.g. the first 50 seeds starting at 1). For stress testing, generate 200 random seeds.

| Scenario | Purpose | Params |
|----------|---------|--------|
| `early_cluster` | Early-game balance | `clusterId = 0`, scale 22×16, seeds 1-50 |
| `mid_cluster` | Mid-game balance | `clusterId = 2`, scale 35×24, seeds 1-50 |
| `late_cluster` | Late-game balance | `clusterId = 5`, scale 50×30, seeds 1-50 |
| `hazard_only_corrupted` | Isolation test | Force only `corrupted` rooms, all seeds |
| `hazard_only_memory_leak` | Isolation test | Force only `memory_leak` rooms, all seeds |
| `max_density` | Worst-case spread | Max `hallChance`, all hazard types enabled |

To force a specific hazard type for isolation tests, add a `forcedRoomType` parameter to `generateCluster()` that overrides `chooseHazardRooms()`.

### 1c. Snapshot Structure

```typescript
interface SimSnapshot {
  tick: number;

  // Connectivity (required metrics)
  exitReachable: boolean;
  keyTerminalReachable: boolean;
  entryExitPathLength: number;    // BFS tile steps; Infinity if unreachable
  isolatedRooms: number[];        // room IDs with no walkable path to entry

  // Path analysis (required metrics)
  projectedPathDamage: number;    // coherence damage walking shortest entry→exit path
  hazardRoomsOnCriticalPath: number;
  chokepointStatus: {             // per chokepoint room
    roomId: number;
    traversable: boolean;
    connectedToEntry: boolean;
    connectedToExit: boolean;
  }[];

  // Entities (required metrics)
  totalEntities: number;
  destroyedEntities: number;      // cumulative since tick 0

  // Diagnostic data (no pass/fail targets — informational only)
  hazardTileCounts: Record<HazardOverlayType, number>;
  collapsedTileCount: number;     // corruption stage === 'collapsed'
  floodLevel: number;             // max floodLevel across all memory_leak rooms
  walkableTiles: number;
  totalTiles: number;             // non-void tiles
}
```

---

## 2. Required Metrics

### 2a. Entity Destroyed / Collapsed Count

**What to measure:**

- `destroyedEntities`: entities removed from `state.entities` over the simulation
- Entity count at tick 0, tick 50, tick 100 — does the cluster depopulate?

**Balancing targets:**

- Fractals and Sentinels should still be fighting at tick 100 (not all dead by tick 30)
- Player's starting room should not have entities enter it before tick 20 (breathing room)
- At least one entity of each faction should survive to tick 100 in `mid_cluster` and above

**Red flags:**

- All entities dead before tick 40 (too lethal — player arrives to empty cluster)
- Entities never encounter each other despite being in the same cluster (faction AI not working)

---

### 2b. Exit Interface Reachability

**What to measure:**

- BFS from entry interface tile to exit interface tile(s), using current walkable tiles only
- `exitReachable`: any exit interface reachable?
- `entryExitPathLength`: tile steps in shortest path (Infinity if none)

```typescript
function checkReachability(cluster: Cluster, fromPos: Position, toSet: Set<string>): number {
  // BFS on cluster.tiles, walkable === true
  // Returns shortest path length, or Infinity
}
```

**Balancing targets:**

- At tick 100: exit must be reachable in ≥ 95% of seeds tested
- Path length must not exceed 2× the tick-0 path length (hazards shouldn't force massive detours)

**Red flags:**

- Exit becomes unreachable in more than 5% of seeds by tick 60
- Path length grows unboundedly (corruption eating corridors)

---

### 2c. Key Terminal Reachability

**What to measure:**

- Find the terminal where `hasKey === true` in `cluster.terminals`
- BFS from entry interface to that terminal's position
- `keyTerminalReachable`: is there a walkable path?

**Balancing targets:**

- At tick 100: key terminal must be reachable in ≥ 98% of seeds (harder constraint than exit — losing the key is a softlock)
- If a `corrupted` room is between entry and key terminal at tick 0, that terminal placement is flagged

**Red flags:**

- Key terminal placed in a room that starts adjacent to a `corrupted` or `memory_leak` hazard (high softlock risk)
- Key terminal unreachable in ANY seed at tick 0 (generation bug)

---

### 2d. Critical Path Hazard Coverage

**What to measure:**

- Enumerate all simple entry→exit paths up to 2× the BFS shortest path length
- For each path, count how many D-E hazard rooms it passes through
- `hazardRoomsOnCriticalPath`: count on the actual shortest path

**Why**: Too few hazards on the critical path → game is trivially easy. Too many → player must fight through everything with no routing choices.

**Balancing targets:**

- 40–70% of paths should pass through exactly 1 D-E hazard room
- Less than 20% of paths should pass through 2 or more D-E hazard rooms
- At least one path with zero D-E hazards should exist (always a possible safe route, even if longer)

**Red flags:**

- All paths pass through ≥ 2 D-E hazards (no survivable route without tools)
- No paths pass through any hazard at all (cluster has no challenge)

---

### 2e. Chokepoint Integrity

**What to measure:**

- For each room tagged `chokepoint`, check at tick 0, 50, and 100:
  - Is it still walkable (any floor tile not collapsed)?
  - Is it still connected to both the entry-side and exit-side rooms?

**Why**: If corruption or flood seals a chokepoint, the cluster may become unsolvable regardless of exit reachability. A hazard room on a chokepoint consuming itself is by design; a normal corridor choke becoming impassable is not.

**Balancing targets:**

- All chokepoints still traversable at tick 100 in ≥ 90% of seeds
- No chokepoint tagged `normal` (non-hazard) should ever become impassable

**Red flags:**

- A non-hazard chokepoint blocked at tick 0 (generation bug)
- More than 2 chokepoints sealed by tick 50 in any seed

---

### 2f. Projected Path Damage

**What to measure:**

- Find the current shortest walkable path from entry to exit
- Walk it tile-by-tile and sum the coherence damage a player would accumulate from `applyTileHazardToPlayer()` per tile
- Compute at tick 0, 25, 50, 75, 100

**Why**: Measures how punishing the mandatory path is at a given moment without a real player. Catches paths that become death marches as hazards spread.

**Balancing targets at tick 50:**

- Grade C hazards on path: ≤ 15 coherence damage for the full crossing
- Grade D hazards on path: ≤ 35 coherence damage (forces the player to think, doesn't one-shot)
- Grade E hazards on path: no hard cap, but must flag any seed where path damage > 60 (needs a bypass)

**Red flags:**

- Path damage at tick 0 already > 50 (cluster generated with unavoidable lethal crossing)
- Path damage grows by more than 30 per 25 ticks (runaway escalation)

---

### 2g. Room Isolation Count

**What to measure:**

- Count rooms with no walkable path to entry (disconnected by collapsed tiles or sealed doors)
- Track at tick 0, 50, 100
- For any isolated room, record its tags (is it `objective`, `exit`, or contains `hasKey` terminal?)

**Why**: Isolated rooms containing key content are soft-locks. The exit or key terminal becoming unreachable is always critical; isolated dead-ends with loot are acceptable at late ticks.

**Balancing targets:**

- Zero rooms isolated at tick 0 (generation correctness)
- At tick 100: ≤ 2 isolated rooms, and none tagged `objective`, `key_terminal`, or `exit`

**Red flags:**

- Any room isolated at tick 0 (generation bug — `ensureConnectivity` failure)
- Exit or key terminal room isolated at any tick

---

### 2h. Seed Variance (Fairness)

**What to measure:**

- Across all seeds for a given cluster depth, compute:
  - Standard deviation of projected path damage at tick 50
  - Standard deviation of entry→key terminal BFS distance at tick 0
  - Fraction of seeds where exit is reachable at tick 100
- Coefficient of variation (CV = stddev / mean) for each scalar metric

**Why**: High variance means some seeds are trivially easy and others nearly impossible — a fairness problem for a 7DRL where players get one run. The generator should produce roughly consistent challenge levels.

**Balancing targets:**

- CV for path damage ≤ 0.4
- CV for key terminal distance ≤ 0.35
- Exit reachability fraction ≥ 0.95 with stddev ≤ 0.05

---

### 2i. Generation Time and Determinism

**What to measure:**

- Time `generateCluster(id)` for 200 seeds; record p50 and p95
- Run each seed twice, diff `cluster.tiles` glyph-by-glyph and all room/interface positions
- Verify no difference between runs

**Why**: Generation must be fast enough for lazy cluster generation between player moves. Determinism is required for save/reload (the game reconstructs clusters from seed rather than serialising tile grids).

**Balancing targets:**

- p95 generation time ≤ 50ms
- 100% of seeds produce identical output on repeated runs

**Red flags:**

- Any seed that produces different output between runs (RNG state leaking between calls)
- Generation time spike > 200ms for any single seed (BSP degenerate case)

---

## 3. Diagnostic Data

These are collected in every snapshot but have no hard pass/fail targets. They inform tuning decisions and explain *why* required metrics are failing.

### 3a. Hazard Overlay Tile Counts

Corruption can consume entire rooms by design; memory leak can flood entire rooms by design. The final tile count is not a balance failure — it is the intended outcome. Collect this data to understand spread *rate* and identify if hazards are spreading faster or slower than expected, not to cap the total.

| Field | What it tells you |
| ------- | ------------------- |
| `hazardTileCounts[type]` per snapshot | Spread curve shape — linear, exponential, stalled |
| `collapsedTileCount` over time | How quickly corruption renders tiles permanently impassable |
| `floodLevel` over time | Memory leak pressure building toward adjacent rooms |
| `walkableTiles / totalTiles` | Overall terrain decay — useful when diagnosing chokepoint failures |

Use these to cross-reference required metric failures: if chokepoint integrity fails, check the spread curve to see which hazard caused it and how fast.

---

### 3b. Hazard Density per Cluster Depth

| Cluster ID | Expected hazard room % | Allowed range |
| ------------ | ---------------------- | --------------- |
| 0 (22×16) | 15% | 10–25% |
| 1 (28×20) | 25% | 15–35% |
| 2 (35×24) | 35% | 25–45% |
| 3+ (42×27+) | 45% | 35–55% |

Outliers here are worth investigating but not automatic failures — a cluster with 5% hazard rooms is suspicious, but if all required metrics pass, it's acceptable.

---

### 3c. Alert Level Trajectory

Track `state.alertLevel` from passive hazard ticks alone (no player input). If it approaches 100 by tick 100, Sentinels will be in full hunt mode the moment the player enters. This is relevant context for tuning entity behaviour, not a blocker.

---

### 3d. Bypass Reachability

For each D-E hazard room on the critical path, check whether its associated bypass object (terminal, power junction, maintenance panel) is reachable without passing through another D-E hazard. This validates the solvability guarantee in `hazard-bypass-design.md`. Currently diagnostic because the bypass placement algorithm is not yet implemented; promote to required once it ships.

---

## 4. Pass / Fail Summary Table

| Metric | Fail condition | Severity |
| -------- | --------------- | ---------- |
| Exit reachable at tick 100 | < 95% of seeds | Critical |
| Key terminal reachable at tick 100 | < 98% of seeds | Critical |
| Key terminal reachable at tick 0 | < 100% | Critical (gen bug) |
| Any room isolated at tick 0 | > 0 rooms | Critical (gen bug) |
| Non-hazard chokepoint blocked at tick 0 | any | Critical (gen bug) |
| Chokepoints traversable at tick 100 | < 90% of seeds | High |
| Room isolation at tick 100 (objective/exit rooms) | any isolated | High |
| All paths pass through ≥ 2 D-E hazards | any seed | High |
| Projected path damage at tick 0 > 50 | any seed | High |
| Projected path damage (grade D) > 35 at tick 50 | > 25% of seeds | Medium |
| Path damage grows > 30 per 25 ticks | > 20% of seeds | Medium |
| All entities dead before tick 40 | > 10% of seeds | Medium |
| Seed variance CV (path damage) > 0.4 | always | Medium |
| No paths with zero D-E hazards exist | any seed | Medium |
| Seed determinism failure | any seed | Critical |
| Generation time p95 > 50ms | always | Low |

---

## 5. Implementation Roadmap

Since no test framework is configured, the test runner is a standalone script (`src/sim-test.ts`) that imports game logic directly and logs results to the console. Run with `npx tsx src/sim-test.ts`.

**Phase 1 — Core simulation loop:**

- Import `createGame`, `processAction` from `game.ts`
- Loop `processAction(state, { kind: 'wait' })` for N ticks
- Extract `SimSnapshot` fields from `state`

**Phase 2 — Connectivity checks:**

- Implement BFS on `cluster.tiles` (walkable only), reuse pathfinding logic
- Check exit tiles (`TileType.InterfaceExit` on right wall)
- Check terminal positions from `cluster.terminals`
- Identify isolated rooms by flood-filling from entry and finding rooms with no reachable tile

**Phase 3 — Path analysis:**

- Critical path enumeration: BFS for shortest path, DFS up to 2× length for path set
- For each path, tag which rooms it passes through and their hazard grade
- Projected damage: walk shortest path tile-by-tile, accumulate `applyTileHazardToPlayer()` result

**Phase 4 — Chokepoint checks:**

- Pull chokepoint rooms from `room.tags.geometric` (contains `'chokepoint'`)
- Per chokepoint: BFS to verify connection to entry-side and exit-side rooms

**Phase 5 — Statistics and reporting:**

- Print per-seed results as a table
- Print aggregates (mean, p5, p95, CV, % passing each target)
- Write failing seeds to a file for manual inspection with `#seed=N` URL hash
- Highlight any Critical failures prominently
