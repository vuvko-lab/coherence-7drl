# Room Generation Research — Ship/Office Interior Layouts

Research on generating tightly-packed rectangular rooms that look like ship interiors or office floor plans, not random dungeon caves.

---

## The Problem with BSP for Interiors

Our current BSP approach produces rooms that feel like a dungeon: random rectangles connected by L-shaped corridors through void space. Ship interiors and office buildings have a fundamentally different spatial character:

- **Rooms share walls directly** — no wasted corridor space between them
- **Rooms tile-pack the space** — almost every cell belongs to a room
- **Corridors are intentional**, not just connectors between distant rooms
- **Room sizes vary by purpose** — a bridge is large, a closet is small
- **Layout feels planned** — grid-aligned, right angles, not organic

---

## Algorithm 1: Wall-Growth / Feature Attachment

**Source**: [RogueBasin Dungeon-Building Algorithm](https://www.roguebasin.com/index.php/Dungeon-Building_Algorithm)

Start with one room, then grow the map by attaching new rooms to existing walls.

### Steps

1. Fill map with wall tiles
2. Carve an initial room at a random position
3. **Pick a random wall tile** that is adjacent to a floor tile
4. Choose a feature to attach (room or corridor)
5. Check if the feature's footprint (including its own walls) is entirely wall/void
6. If valid, carve the feature through the selected wall (place a door)
7. Repeat 3–6 until enough rooms exist or N attempts fail

### Why It Fits Ship Interiors

- Rooms are always directly adjacent — no floating void between them
- Walls are shared naturally (the new room's wall IS the existing room's wall)
- Grows outward organically but stays connected
- Easy to control density: stop when the area is full enough
- Guarantees full connectivity (every room grew from an existing one)

### Drawbacks

- Can produce irregular overall shapes (not rectangular cluster boundary)
- Random wall selection can cluster rooms on one side
- Needs many rejection attempts in tight spaces

### Adaptation for Our Game

Since clusters must be rectangular, we start by carving the outer boundary, then grow rooms inward. Pick wall tiles on the *inner* face of existing rooms. Control room sizes with min/max constraints. Place doors at attachment points.

---

## Algorithm 2: Superimposition (Overlap-and-Wall)

**Source**: [The Perfect Roguelike Dungeon — Superimposition](https://gravitymaker.github.io/posts/perfect-dungeon-1/)

Place rooms at random positions, allowing overlaps. Surround each room with walls after placement. Overlapping rooms merge naturally.

### Steps

1. Fill map with wall tiles
2. For N iterations:
   a. Pick random position and size for a room
   b. Carve floor tiles in that rectangle
   c. Surround the carved area with wall tiles (only on floor-adjacent cells)
3. Result: overlapping rooms create irregular merged shapes; non-overlapping rooms have shared walls where they touch

### "Swiss-Army Room" Variant

For tighter packing that resembles offices:
- Each room has a random margin (0, 2, or 3 cells) on each side
- Margin 0 = rooms share a wall directly
- Margin 2 = single-cell corridor between rooms
- Margin 3 = double-cell corridor
- Doors placed where margins meet walls

### Why It Fits

- Very fast (~45ms for 500 iterations on 79×79 in Python)
- Produces densely packed, irregular room clusters
- No explicit connectivity logic needed — overlaps create connections
- Easy to tune density by adjusting iteration count and room sizes

### Drawbacks

- Less control over individual room shapes
- Can create tiny unusable slivers
- No guarantee every room is reachable (need post-processing flood fill)

---

## Algorithm 3: Squarified Treemap Subdivision

**Source**: [Automatic Real-Time Generation of Floor Plans Based on Squarified Treemaps](https://onlinelibrary.wiley.com/doi/10.1155/2010/624817), [arxiv:1211.5842](https://ar5iv.labs.arxiv.org/html/1211.5842)

**Code reference**: [housify (GitHub)](https://github.com/Ryan-M3/housify)

Treat the cluster as a rectangle and subdivide it into rooms proportional to desired areas, optimizing for square-ish aspect ratios.

### Steps

1. Define desired room list with target areas (e.g., bridge=40, corridor=20, closet=8)
2. Sort rooms by area (largest first)
3. Apply squarified treemap layout:
   a. Place rooms in rows, choosing horizontal or vertical subdivision
   b. For each row, pick the split direction that minimizes worst aspect ratio
   c. Subdivide remaining space recursively
4. Snap all coordinates to grid
5. Place walls on room boundaries
6. Place doors between adjacent rooms using connectivity rules

### Why It Fits Ship Interiors

- **Every cell belongs to a room** — zero wasted space
- Rooms pack perfectly within the rectangular cluster boundary
- Aspect ratios stay reasonable (no long thin slivers)
- Room sizes are controllable — assign areas by room type
- Produces the "floor plan" / "office" aesthetic naturally
- Deterministic layout given a room list — easy to control

### Drawbacks

- Very regular/grid-like — can feel too uniform
- No organic variation without post-processing
- Corridors must be added as explicit rooms in the list

### Adaptation for Our Game

Define room types with area ranges:
- `server_room`: 30–50 cells
- `corridor`: 15–25 cells (long and thin, override aspect ratio)
- `terminal_alcove`: 8–12 cells
- `junction`: 12–20 cells
- `storage`: 10–15 cells

After treemap subdivision, randomly merge some adjacent small rooms. Add doors between all adjacent room pairs. Designate one room as the interface exit room.

---

## Algorithm 4: Tunneling with Room Excavation (Cogmind-style)

**Source**: [Cogmind Mapgen: Tunneling Algorithm](https://www.gridsagegames.com/blog/2014/06/mapgen-tunneling-algorithm/), [Map Composition](https://www.gridsagegames.com/blog/2015/05/map-composition/)

Autonomous agents ("tunnelers") dig corridors and carve rooms along their path.

### Steps

1. Fill map with walls
2. Spawn tunneler(s) at seed positions
3. Each tick, a tunneler:
   a. Moves forward, carving a corridor of configured width
   b. Randomly turns based on turn probability
   c. Randomly spawns a room adjacent to the corridor
   d. May spawn child tunnelers
   e. May change its own parameters as it moves
4. Tunnelers terminate when they hit boundaries or run out of energy
5. Post-process: identify junctions, rooms, doors

### Why It Fits

- Produces structured but organic layouts — feels like a facility
- Corridors are first-class elements, not afterthoughts
- Parametric: same algorithm generates many different layout styles
- Natural room-corridor-room flow matches ship interior navigation

### Drawbacks

- Complex to implement well (many parameters to tune)
- Can produce disconnected areas (need post-processing)
- Less deterministic — harder to guarantee specific room counts/types

---

## Algorithm 5: Grid Packing (Rogue-style)

**Source**: [RogueBasin](https://www.roguebasin.com/index.php/Dungeon-Building_Algorithm), Original Rogue

Divide the cluster into a grid of cells, then grow rooms within each cell.

### Steps

1. Divide cluster into a grid (e.g., 3×3 or 4×3 cells)
2. In each cell, carve a room with random size (within cell bounds, with margin)
3. Connect adjacent cells with corridors:
   a. For each pair of horizontally/vertically adjacent cells
   b. Pick a point on the shared wall of each room
   c. Carve a corridor between those points
4. Optionally skip some connections to create dead ends

### Why It Fits

- Very simple to implement
- Guarantees rooms don't overlap
- Grid structure naturally looks like a building floor plan
- Easy to control room count and distribution

### Drawbacks

- Rooms don't share walls (gaps between grid cells)
- Very regular — easily recognizable pattern
- Limited variety without extensive post-processing

### Adaptation for Our Game

Use a variable grid (not uniform cell sizes). Rooms fill their cells completely (no gap), sharing walls with neighbors. This becomes essentially a treemap with a grid constraint.

---

## Algorithm 6: Recursive Division (Modified)

**Source**: Maze generation literature; recursive division method.

Standard recursive division builds a maze by repeatedly bisecting chambers with walls that have a single passage hole. The key insight: **if we stop subdividing when chambers reach a target room size, the result is a floor plan of rectangular rooms that perfectly tile the space — with doors already placed.**

### Standard Algorithm

1. Start with the full rectangle as one open chamber (no internal walls)
2. Pick a random split direction (horizontal or vertical)
3. Place a wall across the chamber at a random position
4. Punch a 1-cell door hole at a random point in that wall
5. Recurse on both sub-chambers
6. Stop when a chamber is below minimum size

### Modified for Ship Interiors

The modifications turn a maze algorithm into a room generator:

**a) Variable stop condition by room type**
- Don't use a fixed minimum size — instead, stop based on area thresholds
- Large chambers (>40 cells) → always subdivide
- Medium chambers (15–40 cells) → subdivide with 60% probability
- Small chambers (<15 cells) → stop, this is a room
- This produces a natural mix of large and small rooms

**b) Biased split positions**
- Instead of purely random split positions, bias toward ratios that produce useful room shapes
- Prefer splits that create one large room + one small room (70/30 split)
- Or splits near the center for symmetric layouts (45/55 split)
- Avoid splits that create slivers (<4 cells wide)

**c) Multiple doors per wall**
- Ship interiors have more connectivity than mazes
- For long shared walls (>6 cells), place 1–2 doors instead of exactly 1
- For short walls (3–5 cells), always place 1 door
- Door positions avoid corners (min 1 cell from wall ends)

**d) Corridor injection**
- Before recursing, occasionally (20% chance) designate one sub-chamber as a "corridor"
- A corridor is a thin chamber (width 2–3) that spans the full length of the split
- This creates the hallway spines that make interiors feel like ship layouts
- The corridor consumes space from one side of the split before the algorithm recurses on the remainder

**e) Weighted split direction**
- Not purely random — prefer splitting the longer axis (aspect ratio > 1.5 → always split long axis)
- This prevents extremely elongated rooms
- For near-square chambers, alternate or randomize

### Step-by-Step Example (48×28 cluster)

```
Step 1: Full chamber 46×26 (inside outer walls)
        Split vertically at x=30 → left 28×26, right 18×26
        Door at (30, 12)

Step 2: Left chamber 28×26 too big
        Split horizontally at y=10 → top 28×9, bottom 28×16
        Door at (15, 10)

Step 3: Right chamber 18×26 too big
        Inject corridor: 3-wide vertical strip at x=30..32
        Remaining: 15×26, split horizontally...

Step 4: Top-left 28×9 → split vertically at x=14
        Creates two ~14×9 rooms. Both above minimum → could split again or stop.

...continue until all chambers are room-sized
```

Result:
```
╔══════════════╤════════════╤══╤═══════════╗
║              +            ║  ║           ║
║              │            ║  +           ║
║              │            ║  ║           ║
╟──────+───────┤            ║  ╟─────+─────╢
║              +            ║  ║           ║
║              │            +──+           ║
║              │            ║  ║           ║
╟──────────+───┼─────+──────╢  ╟─────+─────╢
║              │            ║  ║           ║
║              +            ║  ║           ║
║              │            ║  +           ║
╚══════════════╧════════════╧══╧═══════════╝
```

### Why It Fits Ship Interiors

- **100% space utilization** — every cell belongs to a room (like treemap)
- **Walls are shared by default** — the algorithm *places* shared walls, not room-local walls
- **Doors come free** — the passage holes ARE the doors
- **Hierarchical structure** — the recursion tree reflects spatial grouping (rooms near each other were split from the same parent = they're in the same "section")
- **Very simple to implement** — ~50 lines of code for the core algorithm
- **Naturally produces the box-drawing aesthetic** — walls are axis-aligned grid lines
- **Easy to control** — min/max room sizes, split ratios, door count, corridor injection rate

### Drawbacks

- Rooms are always rectangular (no L-shapes without post-processing)
- Long straight walls across the entire cluster (the "recursive division signature") — mitigated by corridor injection and varied split positions
- Less variety in room shapes than superimposition
- Split walls always span full width/height of their chamber

### Comparison to Treemap

| Property | Recursive Division | Squarified Treemap |
|---|---|---|
| Space utilization | 100% | 100% |
| Room shape control | Split ratio bias | Area weights |
| Corridors | Injected as thin chambers | Explicit in manifest |
| Doors | Free (passage holes) | Post-process shared walls |
| Implementation | ~50 lines | ~100 lines |
| Room size control | Probabilistic (stop condition) | Deterministic (area weights) |
| Variety | High with parameter tuning | Moderate |
| Wall sharing | Built-in | Built-in |

---

## Recommended Approach for Coherence

**Primary: Recursive Division (Algorithm 6, modified)** — simplest to implement, naturally produces ship-interior layouts with shared walls and doors.

Enhancements:
1. Variable stop condition based on area thresholds (mix of large/small rooms)
2. Corridor injection (20% chance per split) for hallway spines
3. Split-axis bias (prefer splitting longer axis)
4. Multiple doors on long shared walls
5. Post-process: assign room types based on size/position (terminal alcove, server room, junction)
6. Post-process: add visual detail tiles per room type

**Secondary: Squarified Treemap (Algorithm 3)** for clusters where specific room-type distributions matter (e.g., a cluster that must have exactly 1 large bridge room + 3 small server rooms).

**Fallback: Wall-Growth (Algorithm 1)** for damaged/organic clusters where structure has degraded.

**Primary: Squarified Treemap (Algorithm 3)** with enhancements:

1. Define a "room manifest" per cluster type with area weights
2. Treemap subdivides the cluster rectangle into rooms — zero wasted space
3. Add corridors as explicit thin rooms in the manifest
4. Place doors between adjacent rooms (shared wall detection)
5. Post-process: randomly knock out wall segments for wider openings
6. Post-process: add visual detail tiles (terminals, pipes, vents) per room type

**Why this over BSP:**
- BSP wastes space on corridors through void
- Treemap fills the cluster edge-to-edge (matches the design doc's "cluster is always a rectangle")
- Room sizes are controllable (important for gameplay — different room types)
- Looks like a floor plan, not a dungeon

**Fallback for variety**: Mix in Algorithm 1 (wall-growth) for damaged/organic clusters where the ship structure has degraded.

---

## Implementation Sketch (Treemap)

```
function generateCluster(width, height, roomManifest):
  // roomManifest = [{type: "server", area: 40}, {type: "corridor", area: 20}, ...]
  // Sort by area descending
  rooms = sortByArea(roomManifest)

  // Squarified treemap layout
  rects = squarify(rooms, {x:1, y:1, w: width-2, h: height-2})

  // Snap to integer grid
  for rect in rects:
    rect = snapToGrid(rect)

  // Fill tiles
  for each rect:
    carve floor tiles inside rect
    place wall tiles on rect boundary

  // Doors: find shared walls between adjacent rooms
  for each pair of adjacent rooms:
    find shared wall segment
    place door at midpoint of shared segment

  // Outer boundary: double-line box-drawing
  drawOuterWalls(width, height)
```

### Squarify Core (simplified)

```
function squarify(rooms, rect):
  if rooms.length == 0: return []
  if rooms.length == 1: return [assign rooms[0] to rect]

  // Try adding rooms to current row
  // Pick split direction: horizontal if rect is wider, vertical if taller
  horizontal = rect.w >= rect.h

  row = [rooms[0]]
  remaining = rooms.slice(1)
  bestRatio = worstAspectRatio(row, rect, horizontal)

  while remaining.length > 0:
    candidate = [row..., remaining[0]]
    ratio = worstAspectRatio(candidate, rect, horizontal)
    if ratio >= bestRatio: break  // adding more makes it worse
    row = candidate
    remaining = remaining.slice(1)
    bestRatio = ratio

  // Layout the row, recurse on remaining space
  rowRects = layoutRow(row, rect, horizontal)
  remainingRect = subtractRow(rect, row, horizontal)
  return [...rowRects, ...squarify(remaining, remainingRect)]
```

---

## Sources

- [RogueBasin: Dungeon-Building Algorithm](https://www.roguebasin.com/index.php/Dungeon-Building_Algorithm)
- [The Perfect Roguelike Dungeon: Superimposition](https://gravitymaker.github.io/posts/perfect-dungeon-1/)
- [Squarified Treemaps for Floor Plans (Marson 2010)](https://onlinelibrary.wiley.com/doi/10.1155/2010/624817)
- [Real-time Floor Plan Generation (Lopes et al. 2012)](https://ar5iv.labs.arxiv.org/html/1211.5842)
- [housify — treemap floor plan generator (GitHub)](https://github.com/Ryan-M3/housify)
- [Cogmind: Tunneling Algorithm](https://www.gridsagegames.com/blog/2014/06/mapgen-tunneling-algorithm/)
- [Cogmind: Map Composition](https://www.gridsagegames.com/blog/2015/05/map-composition/)
- [Cogmind: Procedural Map Generation Overview](https://www.gridsagegames.com/blog/2014/06/procedural-map-generation/)
- [Cogmind: Procedural Layouts](https://www.gridsagegames.com/blog/2019/03/roguelike-level-design-addendum-procedural-layouts/)
