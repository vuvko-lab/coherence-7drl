# Predefined Room Types & Environmental Hazards

Room types are assigned post-generation to leaf rooms produced by recursive division. Each cluster gets 1-3 special rooms (scaling with depth). The rest remain `normal`. Special rooms create tactical decisions and emergent narrative through environmental hazards, sound propagation, and module interactions.

---

## 1. Corrupted Zone

**Lore**: A section of ship memory where data has begun to decay. Bit-rot spreads like fire, consuming floor tiles.

**Visuals**:

| Stage | Glyph | Color | Effect |
|-------|-------|-------|--------|
| Seed | `◈` | `#ff0044` | Source of corruption |
| Degrading | `░` | `#cc2222` | 1 coherence/tick while standing |
| Corrupted | `▒` | `#ff4444` | 3 coherence/tick while standing |
| Collapsed | `█` | `#881111` | Impassable (like wall) |

**Mechanics**:

- 1-3 floor tiles start as corruption seeds (stage: degrading)
- Every 8-12 ticks, each corrupted tile spreads to one random adjacent floor tile
- Tiles progress: degrading -> corrupted -> collapsed
- Spread crosses doors into adjacent rooms at half rate
- Corruption never stops once started

**Sound propagation**:

- Same room: `"Data structures crack and fragment around you."` (important)
- Adjacent room (1 door): `"You hear cracking through the walls."` (normal)
- 2 rooms away: `"A faint crackling echoes from somewhere."` (normal, only on spread events)

**Alert.m interaction**: From adjacent room: `"alert.m: Corruption signatures detected in adjacent sector."` Reveals room tint on remembered walls (pulsing red).

**Tactical decision**: Rush through before tiles collapse and block the path? Or find another route? Overclock.m lets you sprint through. Waiting makes it worse.

---

## 2. Trigger Trap

**Lore**: A dormant data-bomb -- a security countermeasure left by the antivirus or a virus trap. Entering the room starts a countdown.

**Visuals**:

| Phase | Floor glyph | Color | Notes |
|-------|-------------|-------|-------|
| Dormant | `·` | normal | Indistinguishable from normal room |
| Active (>10 ticks) | `·` | pulses normal/`#ff8800` | Slow pulse |
| Active (5-10 ticks) | `∙` | pulses `#ff8800` | Medium pulse |
| Active (<5 ticks) | `•` | `#ff4400` | Fast pulse |
| Detonated | `▓` | `#664422` | Scorched, inert, safe |

**Mechanics**:

- Room has `fuseLength` (15-25 ticks)
- Timer starts when player first steps onto any floor tile in the room
- Each tick: `ticksRemaining--`
- At 5 ticks remaining: ticking sound propagates to adjacent rooms
- At 0: **Detonation**
  - Entities in room: 40-60 coherence damage
  - Entities in adjacent rooms: 15-25 coherence damage
  - All floor tiles become scorched (walkable, inert)
  - Screen flash effect
- Post-detonation room is permanently safe

**Alert.m interaction**:

- Adjacent to dormant room: `"alert.m: Dormant data-bomb detected. Timer: ~${fuseLength} ticks."`
- Inside activated room: `"alert.m: WARNING -- Detonation in ${ticksRemaining} ticks!"` (important)
- Without alert.m: no warning before entry, only visual pulsing after triggering

**Tactical decision**: Alert.m reveals the trap before walking in. Overclock.m lets you dash through before detonation. Or trigger it and wait outside for it to clear.

---

## 3. Memory Leak

**Lore**: A malfunctioning process dumps garbage data into this room, flooding it with rising "liquid" -- like water flooding a ship compartment.

**Visuals**:

| Depth | Glyph | Color | BG |
|-------|-------|-------|----|
| Shallow (1-2 rows) | `~` | `#2266aa` | `#0a1a3a` |
| Deep (3+ rows) | `≈` | `#1144cc` | `#0a1a3a` |
| Leak source | `◎` | `#4488cc` | — |

**Mechanics**:

- Leak source placed on one wall (visual marker)
- `floodLevel` starts at 0, increments every 6 ticks
- Fills from bottom row of room upward
- Shallow flood: movement costs 2x ticks, drains 1 coherence/tick
- Deep flood: movement costs 3x ticks, drains 2 coherence/tick
- Flood caps at room height - 4 (top 2 rows stay clear)
- Does NOT cross sealed doors
- If a door to an adjacent room is opened while flooded, adjacent room begins flooding at half rate

**Alert.m interaction**: `"alert.m: Memory allocation anomaly -- sector flooding with unaddressed data."`

**Tactical decision**: Wade through for a shortcut (costs coherence + time)? Open a door to drain it (spreads the problem)? Overclock.m helps move at normal speed through shallow flood.

---

## 4. Firewall Checkpoint

**Lore**: The ship's antivirus has established a security checkpoint. Scanning beams sweep back and forth.

**Visuals**:

- Scanner beam: line of tiles with fg `#ffcc00` (yellow), sweeping across room
- Checkpoint terminal: `▣` fg `#ffcc00` on one wall
- Alarm triggered: room walls flash fg `#ff0000` for several ticks

**Mechanics**:

- 1-2 scanner beams (horizontal or vertical) span the room
- Each beam moves 1 tile per 2 ticks, bouncing at room walls
- Player on beam line when it sweeps = "scanned"
- Without spoof.m or cloak.m: alarm triggers
  - Spawns 1-2 fw-hunter entities
  - Increases global suspicion counter
- Beams are visible through FOV as yellow tile overlay

**Alert.m interaction**: `"alert.m: Firewall scan-grid active. Beam sweep interval: 2 ticks."` Also reveals beam positions when not in FOV.

**Tactical decision**: Time movement between sweeps. Cloak.m = invisible to scans. Spoof.m = pass as friendly. Overclock.m = dash between sweeps. Or just fight the hunters.

---

## 5. Unstable Process

**Lore**: A dying process thrashes, causing random tiles to spike with electric discharge. Chaotic but brief.

**Visuals**:

- Spark: glyph `*` fg `#ffff00` on bg `#332200` (1 tick only)
- Process core: `◆` fg `#ffaa00` (center of room, always safe)

**Mechanics**:

- Every tick: 1-3 random floor tiles spark for that tick only
- Stepping on / standing on a sparked tile: 5-10 coherence damage
- Larger rooms = more sparks but more safe tiles
- Process core tile is always safe
- Destroying the core with corrupt.m stops sparking permanently (raises suspicion)

**Alert.m interaction**: `"alert.m: Unstable process detected. Random discharge pattern."` Highlights which tiles will spark NEXT tick (1-tick precognition for careful navigation).

**Tactical decision**: Rush through and take random hits? Use alert.m precognition to dodge? Corrupt.m destroys source but has consequences. Small room = harder to dodge.

---

## 6. Quarantine Lock

**Lore**: The antivirus has sealed this room as a quarantine zone. Doors are locked.

**Visuals**:

- Locked doors: glyph `▪` fg `#ff2222` (instead of normal `+`)
- Interior visible through FOV (doors are transparent but not walkable)
- Inside: normal room with valuable contents

**Mechanics**:

- All doors to this room start locked (walkable = false, transparent = true)
- To unlock: spend 5 ticks adjacent to locked door performing "hack" action
- Hacking raises global suspicion by 2
- Alternative: finding a keycard data fragment elsewhere in cluster unlocks all quarantine rooms
- Inside always contains something valuable: module pickup, terminal, or coherence restore

**Alert.m interaction**: `"alert.m: Quarantine seal detected. Authorization level: elevated. Estimated hack time: 5 ticks."` Reveals whether the room contains a module or terminal.

**Tactical decision**: Spend 5 exposed ticks hacking + raise suspicion for the reward? Or skip it? Encourages exploration to find keycards instead.

---

## 7. Data Echo Chamber

**Lore**: Residual process echoes replay on loop. Ghost entities flicker, replaying their final moments. Harmless unless interacted with.

**Visuals**:

- Floor bg tint: `#0a0a14` (faint blue-purple)
- Echo entities: original glyphs (`@`, `H`, `V`) in fg `#4444aa` (dim blue-purple), phasing in/out every 3-5 ticks
- Echo terminal: `□` fg `#6644aa`

**Mechanics**:

- 2-4 echo entities phase in and out, moving along predetermined paths (1 step per 3 ticks)
- Echoes are intangible (walkable through)
- Bumping an echo: 40% lore fragment, 30% reveal nearby room types, 20% scramble FOV for 3 ticks, 10% small coherence boost
- Echo terminal: reveals full cluster map (all rooms become "seen")
- Completely safe room -- no coherence cost

**Alert.m interaction**: `"alert.m: Residual process echoes detected. Data fragments recoverable."` Reveals outcome of each echo before interaction.

**Tactical decision**: Breather room with info rewards. FOV scramble risk creates mild gamble. Echo terminal is a powerful reward.

---

## 8. Gravity Well

**Lore**: A rogue gravitational subroutine has formed a singularity at the center of this room, pulling everything toward it.

**Visuals**:

| Element | Glyph | Color | BG |
|---------|-------|-------|----|
| Singularity | `●` | `#aa44ff` | `#1a0a2a` |
| Near field (dist ≤ 2) | `◉` | `#8833cc` | `#140a1a` |
| Far field (dist > 2) | tile glyph | `#6622aa` | `#0a0a14` |

**Mechanics**:

- Singularity placed at room center
- Every 3 ticks, player is pulled 1 tile toward singularity (prefers longer axis)
- Pull only moves along one axis at a time
- Pull is blocked by unwalkable tiles
- Standing on singularity: 8-15 coherence damage per pull tick
- Directional arrows displayed on interior floor tiles indicating pull direction

**Sound propagation**:

- On entry: `"You feel a gravitational pull toward the center..."` (hazard)
- On pull: `"The gravity well pulls you inward!"` (hazard)
- On singularity: `"The singularity tears at your coherence!"` (hazard)

**Alert.m interaction**: Always detected from current room and adjacent rooms.

**Tactical decision**: Move perpendicular to the pull direction to traverse safely. Time your movements between pull ticks. Standing still means being dragged to the center.

---

## ~~9. Cascade Failure~~ (removed)

~~**Lore**: A structural subsystem is failing, causing the room's floor to progressively collapse from one edge inward.~~

~~**Mechanics**: Room picks a random collapse edge at generation. Activated on player entry. 3-stage wave (warning → crumble → collapsed) sweeps from chosen edge every 2 ticks. Collapsed tiles become impassable. Standing on collapsed tile: 10-20 coherence damage.~~

---

## Room Assignment Rules

- Assigned post-generation to leaf rooms from recursive division
- 1-3 special rooms per cluster (no duplicate types)
- Minimum 3x3 interior (9 cells) for any special room
- Entry/exit rooms are never special
- Weighted pool: corrupted (3), trigger_trap (2), memory_leak (2), firewall (1), unstable (3), quarantine (2), echo_chamber (1), gravity_well (2)

## Sound Propagation

Uses room adjacency graph (built from door connections), not Euclidean distance:

- **Distance 0** (same room): Direct messages, full hazard effects
- **Distance 1** (shares door): Muffled sounds, some hazard warnings
- **Distance 2** (2 rooms away): Faint sounds, only loud events (detonation, corruption spread)
- **Distance 3+**: No sound

## Module Interactions Summary

| Module | Interaction |
|--------|------------|
| alert.m | Detect hazard rooms from adjacent, reveal timers/patterns, precognition for sparks |
| overclock.m | Move faster through hazards, escape traps before detonation |
| corrupt.m | Destroy unstable process cores, hack quarantine locks |
| cloak.m | Bypass firewall scans undetected |
| spoof.m | Pass firewall scans as friendly process |
