# Plan: Create Design Document

## Action

Save the gameplay design to `design/emergent_puzzle.md` for review. **No source code changes.** The document covers core loop, enemies, stealth, modules, interactive objects, key system, and endgame. Once reviewed and iterated, implementation begins in a separate session.

## File to create

- `/home/andrey/projects/coherence_7drl/design/emergent_puzzle.md` — full gameplay design document (content below)

---

# COHERENCE — Core Gameplay Design

## Context

The game has solid environmental hazards and map generation but lacks core gameplay: no enemies, no objectives beyond "find the exit," no module mechanics, no win/lose conditions. The player needs reasons to explore, things to interact with, and pressure to create moment-to-moment decisions.

**Design pillars**: Limited combat (costly last resort), linear gauntlet (no backtracking), collect encryption keys for a root terminal in the final cluster (missing keys = harder/impossible endgame).

---

## 1. CORE LOOP (per cluster)

1. Enter cluster → interface exit is **locked**
2. Find and activate **2 access nodes** (1 in early clusters) to unlock the exit
3. Optionally retrieve the cluster's **encryption key** from a data cache in a dangerous location
4. Navigate hazards, avoid/fight enemy processes, use modules strategically
5. Reach unlocked exit → transfer to next cluster

**Moment-to-moment**: Move or wait? Safe route or fast route? Use a module now or save it? Risk getting the key or skip it?

---

## 2. INTERACTIVE OBJECTS

Implemented as `ClusterObject` entries on `Cluster`, rendered as special tiles.

```typescript
export type ObjectType = 'access_node' | 'terminal' | 'data_cache' | 'repair_station' | 'power_relay';
export interface ClusterObject {
  type: ObjectType;
  position: Position;
  roomId: number;
  activated: boolean;
}
```

| Object | Glyph | Interaction | Effect | Noise |
|--------|-------|-------------|--------|-------|
| **Access Node** | `◇`→`◆` `#44ddaa` | Stand on + interact, 3 ticks | Unlocks exit when all activated | 2 (2 rooms) |
| **Terminal** | `□` `#44aacc` | Adjacent + interact, 2 ticks | Reveals access nodes & data cache on map | 1 (1 room) |
| **Data Cache** | `≡` `#ffcc00` | Walk onto tile | Collect encryption key (instant) | 0 |
| **Repair Station** | `+` `#22ff88` | Stand on + interact, 5 ticks | Restore 25 coherence + repair 1 damaged module. One use. | 2 (2 rooms) |
| **Power Relay** | `⚡` `#ffaa22` | Adjacent + interact, 1 tick | Disable connected room's hazard for 20 ticks (30-tick cooldown) | 1 (1 room) |

**Placement rules**: Access nodes go in rooms BFS distance ≥2 from entry, prefer near hazard rooms. Data cache goes in/adjacent to hazard or guarded rooms. Terminal in normal rooms. Power relay on shared wall between hazard and normal rooms. Repair station in normal room (0-1 per cluster).

**New action type**: `ActionInteract { kind: 'interact' }` bound to `e` key.

**Exit gating**: `tryTransfer()` checks `cluster.exitUnlocked` before allowing transfer.

---

## 3. ENEMY SYSTEM

Enemies are system processes/daemons. They use the existing `Entity` type with a new `ai?: EnemyAI` field.

```typescript
export type AIState = 'idle' | 'patrolling' | 'investigating' | 'alert' | 'returning';
export interface EnemyAI {
  type: 'scanner' | 'hunter' | 'warden' | 'watcher';
  state: AIState;
  homeRoomId: number;
  patrolPath: number[];      // room IDs to cycle through
  patrolIndex: number;
  targetPos: Position | null;
  alertTicks: number;
  lastKnownPlayerPos: Position | null;
}
```

### Enemy Types

| Type | Glyph | Speed | HP | Behavior | Combat cost |
|------|-------|-------|----|----------|-------------|
| **Scanner** `fw-scanner` | `s` `#ffcc44` | 14 (slow) | 15 | Patrols 2-3 rooms. 3-tile frontal scan cone. Broadcasts alarm when alert (draws other enemies). | corrupt.m: 8 coherence |
| **Hunter** `fw-hunter` | `H` `#ff4444` | 8 (fast) | 25 | Idle until alerted. Chases player relentlessly. Contact: 8-12 damage. | corrupt.m: 15 coherence |
| **Warden** `sys-warden` | `W` `#aa88ff` | 12 | 30 | Guards one room (data cache or access node). Paces corners. Detects player anywhere in room. Doesn't broadcast. | corrupt.m: 12 coherence |
| **Watcher** `net-watcher` | `e` `#44ff44` | N/A | 10 | Stationary on wall. 5-tile FOV cone, rotates 90° every 8 ticks. Broadcasts cluster-wide alarm. | corrupt.m: 5 coherence |

### Detection State Machine

```
idle/patrolling → [hears noise] → investigating
idle/patrolling → [sees player] → alert
investigating → [sees player] → alert
investigating → [timeout 8 ticks] → returning
alert → [no LOS 20 ticks] → returning
returning → [reaches home] → idle/patrolling
```

**Enemy LOS**: Simple raycast (not full shadowcasting). Check if player is within range and line is unobstructed.

---

## 4. STEALTH & NOISE

### Noise Generation

| Action | Level | Range (rooms) |
|--------|-------|---------------|
| Normal movement | 0 | 0 |
| Opening door (walk through) | 1 | 1 |
| Activating access node | 2 | 2 |
| Using repair station | 2 | 2 |
| Using terminal | 1 | 1 |
| corrupt.m on scanner | 3 | 3 |
| corrupt.m on hunter | 4 | 4 |
| Scanner/watcher alarm | 3-5 | 3-all |
| Trigger trap detonation | 4 | 4 |

### Propagation

Uses existing `roomDistance()` BFS. When noise emitted from room R at level L, all enemies within `roomDistance <= L` receive the event and update AI state.

```typescript
function emitNoise(state: GameState, sourceRoomId: number, level: number, sourcePos: Position)
```

### Echo Chamber interaction

Noise generated inside an echo_chamber room gets +2 range. Both a danger and a tool.

---

## 5. MODULE MECHANICS

Add `ActionUseModule { kind: 'use_module'; moduleId: ModuleId }`. Bind to number keys (1-5).

Add to `PlayerModule`:
```typescript
cooldownUntil?: number;  // tick when cooldown expires
activeUntil?: number;    // tick when effect expires
```

| Module | Type | Duration | Cost | Cooldown | Effect |
|--------|------|----------|------|----------|--------|
| **alert.m** | Passive | Always | 0 | — | Detects hazards + enemies within 2 rooms. If damaged: current room only. |
| **overclock.m** | Active | 8 ticks | 5 + 1/tick | 30 ticks | Player gets 2 actions per turn. Sprint through hazards, outrun hunters. |
| **corrupt.m** | Active | Instant | 5-15 (varies) | 10 ticks | Destroy adjacent enemy or object. Generates high noise. The "combat" option. |
| **cloak.m** | Active | 12 ticks | 8 + 1/move | 25 ticks | Invisible to visual detection. Noise still propagates. Found in cluster 2-3. |
| **spoof.m** | Active | 20 ticks | 3 | 20 ticks | Appear as friendly process. Enemies ignore you. Breaks on hostile action. Found in cluster 1-2. |

**Module damage**: Taking >20 coherence in one hit, standing in deep corruption (10%/tick), or cascade reaching player → random loaded module becomes `damaged`. Repair at repair stations.

---

## 6. KEY SYSTEM & ENDGAME

### Structure

- **7 clusters** (0-6). Clusters 0-5 each have 1 encryption key in a data cache.
- **6 keys possible**, **4 required** for clean win.
- Track in `GameState`: `encryptionKeys: number`, `currentClusterNumber: number`

### Root Terminal (Cluster 6)

No interface exit. Instead, a root terminal in the final room:

| Keys | Outcome |
|------|---------|
| 4+ | Clean victory. Instant access. |
| 3 | Partial — brute-force decryption: 15 ticks channeling + 30 coherence cost. Survive = win. |
| 2 | Desperate — 25 ticks + 50 coherence. Very hard to survive. |
| 0-1 | Terminal rejects access. Narrative loss. |

---

## 7. DIFFICULTY SCALING

| Cluster | Access Nodes | Hazard Rooms | Enemies | Notes |
|---------|-------------|--------------|---------|-------|
| 0 | 1 | 1 | 0-1 scanner | Tutorial. Repair station guaranteed. |
| 1 | 1 | 1-2 | 1 scanner | First terminal. spoof.m in cache. |
| 2 | 2 | 2 | 1-2 scanners, 0-1 watcher | cloak.m in cache. |
| 3 | 2 | 2-3 | 2 scanners, 1 watcher, 0-1 hunter | Harder hazards. |
| 4 | 2 | 2-3 | 2 scanners, 1 watcher, 1 hunter | Faster hazard timers. |
| 5 | 2 | 3 | 2-3 scanners, 1-2 watchers, 1 hunter | No repair station. |
| 6 | 2 | 3 | 3 scanners, 2 watchers, 1-2 hunters, 1 warden | Root terminal. Warden guards it. |

---

## 8. GAME OVER / WIN

- **Coherence = 0**: 5-tick grace period to reach repair station. If not: `"Process terminated. Ego-fragment lost."` + stats screen.
- **Win**: Root terminal with 4+ keys.
- **Soft loss**: Root terminal with 0-1 keys. Narrative rejection, game doesn't force-end.

---

## 9. EMERGENT PUZZLE EXAMPLES

**Flooded Key**: Data cache in memory_leak room. Flood rising. Power relay on adjacent wall. Rush in early (take damage), disable relay first (costs time near a watcher), overclock through (costs coherence), or skip the key.

**Alarm Cascade**: Access node near firewall room + watcher in corridor + scanner patrol. Use spoof (walk past but noise from activation may alert scanner), cloak (invisible but still noisy), corrupt the watcher (loud, draws scanner), or trigger watcher alarm deliberately and slip through during chaos.

**Trap Shortcut**: Fast path through trigger_trap, slow path through spreading corruption. Enter trap + overclock out before detonation, wait for detonation then cross scorched room, or wade through corruption accepting damage.

**Guarded Repair**: Low coherence, repair station guarded by warden, data cache in adjacent quarantine room. Spoof past warden (but 5-tick repair generates noise), cloak (burns cooldown needed for quarantine), corrupt warden (costs precious coherence), or skip repair entirely.

---

## 10. STRATEGIC HAZARD PLACEMENT — ALGORITHM RESEARCH

### The Problem

Currently `assignRoomTypes()` in `cluster.ts` picks hazard rooms **randomly** from candidates (any room with interior ≥ 3x3, excluding entry/exit). This means hazards can cluster uselessly in dead-end branches or leave wide-open safe corridors to the exit. The player should always face a meaningful decision: which danger to traverse, not whether danger exists at all.

**Goal**: Place hazards so that **every route from entry to exit passes through at least one hazard room**, while allowing the player to *choose which* hazard to face.

### Current Map Generation Recap

1. BSP recursive division → 10-20 rooms per cluster
2. Spanning tree (union-find on shuffled room pairs) guarantees connectivity
3. ~30% of remaining pairs get extra doors → creates loops / alternate routes
4. `roomAdjacency: Map<number, number[]>` is already built and available
5. Entry = leftmost room, Exit = rightmost room (interface exit)

The room graph is **sparse** (spanning tree + ~30% extras ≈ 1.3 edges/node average). This means there are usually few distinct routes, making strategic placement both feasible and impactful.

### Algorithms Considered

#### A. Articulation Points (Tarjan's Algorithm)

**What**: Find rooms whose removal disconnects the graph (mandatory chokepoints).

**Complexity**: O(N + M) — single DFS pass.

**Verdict**: Useful as a pre-pass. If an articulation point exists between entry and exit, it's the *perfect* hazard location — the player literally cannot avoid it. But with the 30% extra doors creating cycles, articulation points may not exist. Still worth detecting as "free wins."

#### B. Betweenness Centrality (Brandes' Algorithm)

**What**: For each room, count what fraction of all shortest paths (between all pairs) pass through it. High-centrality rooms are "traffic hubs."

**Complexity**: O(N * M) — BFS from each node.

**Verdict**: Good for ranking rooms by importance, but measures *all-pairs* traffic, not just entry→exit. Useful as a tiebreaker, not the primary signal.

#### C. Min Vertex Cut (Ford-Fulkerson / Menger's Theorem)

**What**: The minimum number of rooms whose removal disconnects entry from exit. By Menger's theorem, this equals the maximum number of vertex-disjoint paths.

**Complexity**: O(N * M) with node-splitting trick.

**Verdict**: Tells you the *minimum* number of hazards needed to block all routes. Useful for difficulty calibration: if min-cut = 1, one hazard suffices; if min-cut = 3, you need at least 3. For typical BSP clusters with sparse connectivity, min-cut is usually 1-2.

#### D. Full Simple Path Enumeration + Greedy Hitting Set (**RECOMMENDED**)

**What**: Enumerate all simple (non-repeating) paths from entry to exit via DFS. Then greedily place hazards on the rooms that appear in the most paths.

**Complexity**: Path enumeration O(paths * N) — with 10-20 rooms and sparse connectivity, typically a few dozen to a few hundred paths. Hitting set is O(paths * N) per iteration.

**Verdict**: The best fit. Exact, cheap at this scale, produces intuitive results. This is formally the **Greedy Hitting Set** algorithm — a well-studied O(log k) approximation to the NP-hard minimum hitting set, but at our scale it's essentially optimal.

#### E. Random Path Sampling (The User's Suggestion)

The original suggestion — sample K random DFS paths, count frequencies, place on highest — is exactly Greedy Hitting Set on a *sampled* path collection. For 10-20 rooms, full enumeration is cheap enough to replace sampling. But the core idea is sound and has formal backing.

### Recommended Algorithm: Progressive Greedy Hitting Set

```
Input:  room graph (adjacency map), entry room, exit room, hazard budget N
Output: set of room IDs to assign hazard types

1. blocked ← {}
2. for i = 1..N:
   a. paths ← enumerate all simple paths from entry to exit,
              treating rooms in `blocked` as "hazardous but passable"
   b. safePaths ← paths that don't pass through any room in `blocked`
   c. if safePaths is empty → stop (no safe route remains)
   d. freq[r] ← count of safePaths that include room r (exclude entry/exit)
   e. bestRoom ← argmax(freq)
   f. blocked ← blocked ∪ {bestRoom}
3. return blocked
```

**Key detail in step 2a/2b**: We enumerate paths through the full graph (hazard rooms are passable, just dangerous). We only count "safe paths" — those avoiding all `blocked` rooms — for frequency analysis. This ensures we're always targeting the remaining safe corridors.

### Code Sketch (TypeScript)

```typescript
/** Enumerate all simple paths via DFS, optionally tracking which pass through "blocked" rooms */
function enumerateSimplePaths(
  adj: Map<number, number[]>,
  start: number,
  end: number,
  excludeFromSafe: Set<number>, // rooms that count as "not safe"
): { all: number[][]; safe: number[][] } {
  const all: number[][] = [];
  const safe: number[][] = [];
  const visited = new Set<number>();

  function dfs(current: number, path: number[], hitBlocked: boolean) {
    if (current === end) {
      all.push([...path]);
      if (!hitBlocked) safe.push([...path]);
      return;
    }
    visited.add(current);
    for (const neighbor of (adj.get(current) ?? [])) {
      if (visited.has(neighbor)) continue;
      path.push(neighbor);
      dfs(neighbor, path, hitBlocked || excludeFromSafe.has(neighbor));
      path.pop();
    }
    visited.delete(current);
  }

  dfs(start, [start], false);
  return { all, safe };
}

/** Place hazards at chokepoints using progressive greedy hitting set */
function chooseHazardRooms(
  adj: Map<number, number[]>,
  entryRoomId: number,
  exitRoomId: number,
  maxHazards: number,
  candidates: Set<number>, // eligible room IDs (min size, not entry/exit)
): number[] {
  const hazardRooms: number[] = [];
  const blocked = new Set<number>();

  for (let i = 0; i < maxHazards; i++) {
    const { safe } = enumerateSimplePaths(adj, entryRoomId, exitRoomId, blocked);
    if (safe.length === 0) break; // all routes already pass through a hazard

    // Count room frequency across safe paths only
    const freq = new Map<number, number>();
    for (const path of safe) {
      for (const roomId of path) {
        if (roomId === entryRoomId || roomId === exitRoomId) continue;
        if (!candidates.has(roomId)) continue;
        freq.set(roomId, (freq.get(roomId) ?? 0) + 1);
      }
    }

    // Pick highest-frequency room
    let bestRoom = -1, bestCount = 0;
    for (const [roomId, count] of freq) {
      if (count > bestCount) { bestCount = count; bestRoom = roomId; }
    }
    if (bestRoom === -1) break;

    hazardRooms.push(bestRoom);
    blocked.add(bestRoom);
  }

  return hazardRooms;
}
```

### Integration with Existing Code

Replace the random selection in `assignRoomTypes()` (`cluster.ts:489-521`):

```typescript
function assignRoomTypes(rooms, clusterId, roomAdjacency) {
  // Identify entry/exit rooms (already done via sortedByX)
  const sortedByX = [...rooms].sort((a, b) => a.x - b.x);
  const entryRoom = sortedByX[0];
  const exitRoom = sortedByX[sortedByX.length - 1];

  // Build candidate set (min 3x3 interior, not entry/exit)
  const candidates = new Set(
    rooms.filter(r =>
      r.id !== entryRoom.id && r.id !== exitRoom.id &&
      (r.w - 2) >= 3 && (r.h - 2) >= 3
    ).map(r => r.id)
  );

  const numHazards = Math.min(candidates.size, randInt(1, 3));

  // Get strategically placed hazard rooms
  const hazardRoomIds = chooseHazardRooms(
    roomAdjacency, entryRoom.id, exitRoom.id, numHazards, candidates
  );

  // Assign hazard types (no duplicates)
  const usedTypes = new Set<RoomType>();
  for (const roomId of hazardRoomIds) {
    const room = rooms.find(r => r.id === roomId);
    if (!room) continue;
    const available = HAZARD_WEIGHTS.filter(e => !usedTypes.has(e.type));
    if (available.length === 0) break;
    const type = weightedPick(available);
    usedTypes.add(type);
    room.roomType = type;
  }
}
```

### What This Achieves

**Before** (random): Hazards might all be in a dead-end branch. Player walks straight to the exit unimpeded.

**After** (chokepoint-targeted): The first hazard goes on the room that the most routes pass through — the central bottleneck. The second hazard covers the best remaining bypass. After 1-3 placements, every route to the exit passes through at least one hazard room. The player must *choose which danger to face*, not whether to face danger at all.

### Edge Cases

- **Linear graph** (no loops): Every room is an articulation point. One hazard anywhere on the path blocks the only route. The algorithm places it on the most "central" room by default.
- **Highly connected graph** (many loops): More hazards needed to cover all bypasses. The budget cap (1-3 per cluster) means some safe routes may survive — this is fine, keeps difficulty manageable.
- **Quarantine rooms**: These lock their doors (impassable until broken). If a quarantine room is chosen as a chokepoint hazard, it creates a *true* blockade the player must find another way around or find a way to breach. Consider: should quarantine rooms be excluded from chokepoint candidates and placed separately (since they block rather than threaten)?

### Optional Enhancements

1. **Articulation point pre-pass**: Run Tarjan's O(N+M) algorithm first. Any articulation point between entry and exit is a guaranteed chokepoint — auto-assign it a hazard before running the greedy set. This saves one iteration.

2. **Betweenness tiebreaker**: When two rooms have equal path frequency, prefer the one with higher betweenness centrality (the "busier" hub).

3. **Distance weighting**: Prefer rooms closer to the exit for hazards (forces the player to commit before encountering danger — more tension than front-loaded hazards).

4. **Object co-placement**: After choosing hazard rooms, place data caches and access nodes in/adjacent to them (already specified in Section 2 placement rules). The chokepoint algorithm gives us the *right* rooms; the object placement rules from Section 2 populate them with objectives.

5. **Multi-objective coverage**: Instead of just entry→exit paths, also compute paths from entry to each access node location and from entry to the data cache. Place hazards to cover routes to *all* objectives, not just the exit. This prevents the player from safely reaching all objectives even if the exit route is blocked.

---

## 11. IMPLEMENTATION PRIORITY

Ordered by gameplay impact per effort:

1. **Enemies (scanner + hunter)** — creates stealth tension. Wire into existing entity loop.
2. **Noise system** — one function using existing `roomDistance()`. Makes every action meaningful.
3. **Access nodes + exit gating** — transforms exploration into purposeful navigation.
4. **Modules (overclock.m, corrupt.m)** — gives player verbs beyond move/wait.
5. **Interactive objects (terminal, data cache, repair station)** — populate world with decisions.
6. **Encryption keys + endgame** — win condition and stakes.
7. **cloak.m and spoof.m** — expand stealth options (can cut if tight).
8. **Power relay** — hazard interaction (can cut).
9. **Warden + watcher** — enemy variety (can cut).
10. **Coherence-0 grace period** — polish (default to instant game-over).

## Key Files

- `src/types.ts` — New types: EnemyAI, ClusterObject, ActionInteract, ActionUseModule, GameState extensions
- `src/game.ts` — New action processing, entity AI tick, exit gating, game-over
- `src/cluster.ts` — Object placement, enemy spawning, difficulty scaling
- `src/hazards.ts` — Reuse `roomDistance()` for noise propagation
- `src/enemies.ts` (new) — AI state machine, detection, pathfinding, noise response
- `src/objects.ts` (new) — Interactive object logic
- `src/modules.ts` (new) — Module activation, cooldowns, effects
- `src/input.ts` — New keybinds: `e` (interact), `1-5` (modules)
- `src/renderer.ts` — Enemy rendering, object rendering, module cooldowns in SELF panel, game-over/victory screens
