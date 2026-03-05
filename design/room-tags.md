# Room Tags & General-Purpose Interactables

## Philosophy

Instead of designing bypass objects per-hazard ("drain valve counters memory leak"), we design **general-purpose systems** that gain meaning from placement context. A terminal near a quarantine offers "override seal"; the same terminal near a firewall offers "disable scanner grid." One object type, many uses.

Rooms get **tags** — functional labels assigned during or after generation. Tags drive what gets placed where, creating emergent puzzles through combinations rather than hand-crafted solutions.

---

## 1. Tag Categories

### 1a. Structural Tags (derived from topology)

Computed automatically from the room graph. These are facts about the room's shape and position.

| Tag | Criteria | Notes |
|-----|----------|-------|
| `entry` | Contains left interface tile | Player spawn. Always exactly 1. |
| `exit` | Contains right interface exit tiles | Always exactly 1. |
| `hall` | Generated as hall by gen-halls (aspect ratio ≥ 3:1) | Long, narrow, high connectivity. |
| `chokepoint` | On ≥60% of simple entry→exit paths | Computed via path enumeration (existing algorithm). |
| `dead_end` | Degree 1 in room adjacency graph | Only one way in/out. |
| `hub` | Degree ≥ 3 in room adjacency graph | Multiple connections, crossroads. |
| `large` | Interior area ≥ 25 tiles (5×5+) | Enough space for complex hazards. |
| `small` | Interior area ≤ 12 tiles | Tight quarters. |
| `peripheral` | Not on any entry→exit shortest path | Off the beaten track, exploration reward. |

### 1b. Hazard Tags (assigned post-generation)

The existing hazard types. A room gets at most one hazard tag. Hazard placement uses the greedy hitting set algorithm to target chokepoints.

| Tag | Grade |
|-----|-------|
| `echo_chamber` | S (safe) |
| `quarantine` | B (barrier) |
| `unstable` | C (caution) |
| `firewall` | C (caution) |
| `trigger_trap` | D (danger) |
| `memory_leak` | D (danger) |
| `gravity_well` | E (extreme) |
| `corrupted` | E (extreme) |

### 1c. Utility Tags (placed based on context)

These determine what interactable objects appear in the room. A room can have multiple utility tags.

| Tag | What it means | Typical placement |
|-----|---------------|-------------------|
| `terminal` | Room contains an access terminal | Adjacent to hazard rooms, or in peripheral rooms |
| `power_node` | Room contains a power junction | On shared wall with hazard room |
| `cache` | Room contains a data cache (pickups) | Dead-ends, guarded rooms, behind hazards |
| `repair` | Room contains a repair station | Safe rooms, away from hazards |
| `access_node` | Room contains a mandatory access node | BFS dist ≥2 from entry, near hazards |
| `vent` | Room has a maintenance vent (shortcut) | Connects non-adjacent rooms |

### 1d. Content Tags (what populates the room)

Inspired by the B/X stocking principle (~33% threat, 17% trap, 17% special, 33% empty) and the Goblin Punch dungeon checklist (something to steal, something to kill you, someone to talk to, something to experiment with, something hidden).

| Tag | What it means |
|-----|---------------|
| `guarded` | Contains an enemy process |
| `loot` | Contains module/keycard/coherence pickup |
| `lore` | Contains readable terminal with narrative |
| `objective` | Player needs to visit (access node, encryption key) |
| `research` | Contains narrative, but also upgrades for modules |
| `warzone` | Contains entities from rivaling factions fighting each other |
| `derelict` | Contains half-destroyed parts of ship functionality |
| `empty` | No special content — floor tiles, maybe debris. Pacing room. |
| `npc` | Contains a friendly/neutral entity (trapped process, dormant AI fragment) |
| `experiment` | Contains something interactive with uncertain outcome |
| `secret` | Hidden content — false wall, buried data, requires scan to detect |

### 1e. Theme Tags (ship metaphor — what the room represents)

Each room in the virtual space is a **manifestation of ship infrastructure**. The theme tag determines visual flavor (wall tints, floor patterns, ambient text) and what makes narrative sense to find there. Theme doesn't affect mechanics directly — that's what hazard and utility tags are for — but it drives flavor text, object dressing, and makes the world feel like a coherent ship system rather than abstract rooms.

Themes drawn from real ship/station architecture (Traveller, Alien RPG, SS13, FTL) mapped onto digital equivalents.

| Theme | Ship metaphor | Digital manifestation | Visual hint |
|-------|--------------|----------------------|-------------|
| `server_rack` | Computer core | Dense memory banks, blinking status lights | Rows of `▐` glyphs, blue-white tint |
| `reactor` | Engine room / reactor | Power generation process, high-energy computation | Orange-red tint, `~` floor particles |
| `medbay` | Medical bay | Self-repair / integrity-check subroutine | Green tint, `+` floor markings |
| `bridge` | Command deck | Control node, high-privilege process space | Bright terminals, centered `◇` console |
| `cargo` | Cargo bay / storage | Data warehouse, cold storage archive | Wide open floor, `≡` crate glyphs |
| `barracks` | Crew quarters | Process dormitory — sleeping/idle threads | Dim, `▫` bed glyphs along walls |
| `mess` | Mess hall / galley | Data exchange commons — processes swap buffers | Tables `╤`, warm yellow tint |
| `lab` | Science lab | Debug/analysis chamber, experimental sandbox | `◇` instruments, cyan tint |
| `armory` | Armory / security | Firewall toolkit storage, defense module cache | `▪` lockers, red-orange tint |
| `brig` | Brig / prison | Quarantine sandbox — isolated faulty processes | Barred doors `╫`, grey tint |
| `comms` | Communications array | Routing hub, signal relay, cluster uplink | `◎` antenna, flickering glyphs |
| `maintenance` | Maintenance crawlspace | Low-level system service tunnel | Narrow, pipe glyphs `│`, dim |
| `hangar` | Shuttle bay / airlock | I/O port, cluster interface staging area | Wide, `⇋` near exits |
| `hydroponics` | Life support / gardens | Resource regeneration loop, coolant cycling | Green `¤` flora glyphs |
| `observatory` | Observation deck | Monitoring/logging station, read-only system view | `*` starfield, wide window wall |

**Assignment**: 1 theme per room. Chosen weighted by room size, position, and existing tags:
- `entry` rooms → `hangar` or `comms` (arrival point)
- `exit` rooms → `hangar` (departure point)
- `dead_end` + `cache` → `cargo` or `armory` (storage makes sense)
- `repair` → `medbay` (self-repair station)
- `large` → `cargo`, `mess`, `hangar`, `reactor` (big spaces)
- `small` → `maintenance`, `barracks`, `comms` (tight spaces)
- `research` → `lab` (research equipment)
- `objective` → `bridge`, `server_rack` (important systems)
- Remaining → weighted random, avoid duplicates when possible

**Pacing note**: Not every room needs a unique theme. Like B/X's "empty" rooms (~33%), some should be generic server space or bare infrastructure. These provide contrast that makes themed rooms feel special. Aim for ~40-50% themed, rest generic.

### 1f. State Modifier Tags (how the room behaves)

A new orthogonal layer: state modifiers change HOW a room works regardless of its theme, hazard, or content. A room can have 0-1 state modifiers. Applied during generation, weighted by cluster depth (harder modifiers in later clusters).

| Modifier | Effect | Visual | Source |
|----------|--------|--------|--------|
| `encrypted` | All interactions take 2x ticks; rewards are higher quality | Glyph overlay `▓`, teal tint | Gemini/EP research |
| `orphaned` | Disconnected from cluster mesh — no map updates propagate here, alert.m doesn't detect into/out of this room | Dark, no ambient glow | Gemini/EP research |
| `overclocked` | +1 tile movement speed for everyone in room; enemy detection range +2 | Bright, fast-pulsing floor | Gemini/EP research |
| `hard_wired` | Cannot interact remotely (terminal options require standing ON the terminal, not adjacent) | Thick wall glyphs, heavy border | Gemini/EP research |
| `degraded` | Room is failing — random tiles flicker between floor and void each tick (cosmetic + minor navigation hazard) | Flickering tiles | Gemini/EP research |

**Placement rules**:
- `encrypted` → rooms with `cache` or `objective` (protect valuables, 30%)
- `orphaned` → `peripheral` or `dead_end` rooms (20%)
- `overclocked` → `reactor` themed rooms (40%) or random (10%)
- `hard_wired` → rooms with `terminal` (20%, makes terminal riskier)
- `degraded` → `derelict` content rooms (60%), or random in late clusters (15%)
- Max 2 modified rooms per cluster in early game, 3-4 in late game

**Design note**: These modifiers are cheap to implement (most are multipliers on existing mechanics) and add variety without new object types. An `encrypted` + `cache` room behind a `trigger_trap` is a different puzzle than a normal `cache` — worth more but costs more time to loot.

### 1g. Room Stocking Reference

The research draws on these established room content systems:

**B/X dungeon stocking** (Moldvay): d6 → 33% monster, 17% trap, 17% special, 33% empty. Key insight: ~1/3 of rooms should be empty for pacing.

**Goblin Punch dungeon checklist** (Arnold K): Every dungeon should have: (1) something to steal, (2) something to be killed, (3) something to kill you, (4) different paths, (5) someone to talk to, (6) something to experiment with, (7) something players probably won't find. Map to our tags: loot, guarded, hazard, hub, npc, experiment, secret.

**FTL ship model**: Every room IS a subsystem — shields, weapons, medbay, engines, doors. Rooms have power levels, can be damaged, catch fire, lose atmosphere. Relevant: our rooms should feel like they serve a ship function, not just be containers.

**SS13 department model**: Rooms organized by department (command, engineering, medical, science, security, cargo, service). Each department has 5-15 room types. Relevant: our themes map roughly to departments.

**Cyberpunk RED NET architecture**: Virtual spaces are layered — each level has one of: password, file, control node, or ICE. Deepest = most valuable. Relevant: our clusters are linear gauntlets with increasing value/danger.

**D&D 5e Techbase (homebrew)**: Sci-fi room tables organized by zone — command, refinery, laboratory, general. Each zone d20 table. Hazard table includes: busted steam pipe, faulty electrics, anomalous gravity, toxic spill, irradiated zone. Maps well to our hazard types.

---

## 2. General-Purpose Interactables

### 2a. Terminal (`□` fg `#44aacc`)

A system console. The player interacts (e key, 2 ticks) and gets a **context-sensitive menu** based on the terminal's location and what's nearby.

**Base options** (always available):
- `[scan]` — Reveal room types for all rooms in cluster (like the echo terminal reveal)
- `[logs]` — Read system logs (lore text, flavor)

**Context options** (appear based on nearby rooms/state):

| Context | Option | Effect |
|---------|--------|--------|
| Adjacent to `quarantine` room | `[override seal]` | Unlock quarantine doors. Raises suspicion +2. |
| Adjacent to `firewall` room | `[disable scanners]` | Stops beams for 25 ticks. |
| Adjacent to `unstable` room | `[kill process]` | Permanently stops sparks. Raises suspicion +1. |
| Adjacent to `memory_leak` room | `[flush buffers]` | Reduces flood level by half. |
| Adjacent to `trigger_trap` room | `[disarm payload]` | Deactivates the fuse (if not already triggered). |
| Cluster has access nodes | `[locate nodes]` | Marks access node positions on map. |
| Player coherence < 50% | `[request maintenance]` | Restores 10 coherence. One-use. |
| Adjacent to `corrupted` room | `[quarantine sector]` | Stops corruption spread (existing tiles remain). |

**Placement**: 1-2 per cluster. Prefer rooms adjacent to grade D-E hazard rooms. Never in hazard rooms themselves. Never in entry/exit. At least one terminal should be reachable without passing through a D-E hazard.

**Design note**: The terminal IS the general-purpose bypass. Its power comes from placement — a terminal next to a trigger trap is much more valuable than one in a dead end with nothing dangerous nearby. The player's route choice becomes: "do I go get the terminal first, or just brute-force through?"

### 2b. Power Junction (`⚡` fg `#ffaa22`)

Controls power flow to connected rooms. Interaction: adjacent + e key, 1 tick.

**Options**:
- `[cut power]` — Target room goes dark (no visibility unless player has light) and all powered hazards stop: firewall beams, unstable sparks. Gravity well still pulls (not powered). Corruption still spreads (organic). Duration: 20 ticks, then auto-restores. Cooldown: 30 ticks.
- `[overload]` — Permanent shutdown of target room's powered systems. One-use, junction breaks (glyph dims). Raises suspicion +3. Loud noise.

**Connected rooms**: The junction targets one specific adjacent room (determined at placement). Displayed as a line of dim `·` tiles on the shared wall, making the connection visible.

**Placement**: 0-1 per cluster. Adjacent to a hazard room (firewall, unstable, trigger_trap). On the safe side of the shared wall.

### 2c. Maintenance Panel (`▣` fg `#aa8844`)

Physical infrastructure control. Interaction: adjacent + e key, 1 tick.

**Options** (context-dependent):
- Adjacent to `memory_leak`: `[seal bulkhead]` — Closes the door to the flooded room permanently. Flood stops spreading but room is now blocked.
- Adjacent to `trigger_trap`: `[blast shutter]` — Seals door with blast-proof shutter. Detonation deals 0 damage through sealed door.
- Adjacent to `corrupted`: `[firebreak]` — Destroys the shared wall/door, creating a gap corruption can't cross (collapsed wall tiles are not floor).
- Generic: `[lock door]` — Permanently locks an adjacent door. Useful for blocking enemy patrols.

**Placement**: 0-2 per cluster. On walls shared with D-E hazard rooms. The maintenance panel offers a physical solution vs. the terminal's software solution.

### 2d. Data Cache (`≡` fg `#ffcc00`)

Container with pickups. Walk onto tile to loot.

**Contents** (weighted random):
- Module pickup (40%)
- Coherence patch +15-25 (30%)
- Encryption key — one per cluster (20%, guaranteed once)
- Keycard — unlocks all quarantine rooms in cluster (10%)

**Placement**: 1-2 per cluster. Prefer: behind hazards (reward for solving the puzzle), dead-ends (reward for exploration), guarded rooms (risk/reward). The encryption key cache is always in the hardest-to-reach location.

### 2e. Repair Station (`✦` fg `#22ff88`)

Restores coherence and repairs damaged modules. Interaction: stand on + e key, 5 ticks (slow, vulnerable).

**Effect**: Restore 25 coherence. Repair one damaged module to loaded. One-use (depletes after).

**Placement**: 0-1 per cluster. In safe rooms (no hazard tag). Away from chokepoints. Skipped in high-difficulty clusters.

---

## 3. Tag Interaction Rules

### 3a. Blocking Rules (tag A prevents tag B on same room)

```
entry         → blocks: ALL hazard tags, guarded
exit          → blocks: ALL hazard tags, guarded
hall          → blocks: gravity_well, corrupted, memory_leak (need space)
small         → blocks: gravity_well, firewall (need space for mechanics)
terminal      → blocks: ALL hazard tags (utility rooms are safe havens)
repair        → blocks: ALL hazard tags
access_node   → blocks: repair (shouldn't be too easy)
```

### 3b. Affinity Rules (tag A on room X encourages tag B on adjacent room Y)

These are soft rules — probabilities, not guarantees.

```
chokepoint + hazard  →  strong (greedy hitting set drives this)
hazard(D-E) → terminal in adjacent room (80% if terminal budget allows)
hazard(D-E) → maintenance_panel on shared wall (50%)
hazard(C)   → power_junction adjacent (40%)
dead_end    → cache (60%) or lore (30%)
hub         → echo_chamber (20%) — interesting crossroads
guarded     → cache or access_node in same room (70%)
peripheral  → cache or terminal (50%) — reward for exploration
access_node → near hazard room, dist ≤ 2 (strong)
```

### 3c. Anti-affinity Rules (avoid placing these near each other)

```
repair + repair (max 1 per cluster)
terminal + terminal (spread them out, min distance 3)
two D-E hazards adjacent (too punishing, buffer with C or normal)
cache + cache adjacent (spread loot)
```

---

## 4. Tag Assignment Algorithm

```
Phase 1: Structural tags (automatic)
  For each room:
    - Compute degree → hub / dead_end
    - Compute area → large / small
    - Check interface tiles → entry / exit
    - Check gen-halls source → hall
  Compute all entry→exit paths:
    - Tag chokepoint rooms (≥60% of paths)
    - Tag peripheral rooms (on 0 shortest paths)

Phase 2: Hazard tags (strategic)
  Run greedy hitting set on chokepoints → assign hazard types
  Apply blocking rules (halls can't get gravity_well, etc.)
  Fallback: if blocked, try next-best chokepoint

Phase 3: Utility tags (context-driven)
  Place terminals (1-2):
    - Prefer rooms adjacent to D-E hazard rooms
    - At least one reachable without passing through D-E
    - Never in hazard rooms, entry, or exit
  Place power junctions (0-1):
    - Adjacent to powered hazard (firewall, unstable, trigger_trap)
  Place maintenance panels (0-2):
    - On walls shared with D-E hazard rooms
  Place data caches (1-2):
    - Encryption key: hardest-to-reach safe room
    - Other: dead-ends, behind hazards, guarded rooms
  Place repair station (0-1):
    - Safe room, not on chokepoint
  Place access nodes (1-2 depending on difficulty):
    - BFS dist ≥2 from entry
    - Near (but not inside) hazard rooms

Phase 4: Content tags (populate)
  Place enemies based on difficulty curve
  Add lore terminals to echo_chambers
  Tag guarded rooms
```

---

## 5. Emergent Puzzles From Tags

The tag system creates puzzles through **placement context**, not scripted interactions.

**Example 1: Terminal Detour**
```
[entry] → [hall] → [TRIGGER TRAP chokepoint] → [exit path]
                        ↑ adjacent
              [terminal + dead_end]
```
Terminal offers `[disarm payload]` because it's adjacent to trigger_trap. Player chooses: go to the dead-end terminal first (safe but costs time), or rush through the trap.

**Example 2: Power Play**
```
[power junction] ─── wall ─── [FIREWALL chokepoint]
                                     │
                              [access_node room]
```
Power junction can `[cut power]` to the firewall room (disables beams for 20 ticks). Player must time their passage: cut power → rush through → activate access node before power restores.

**Example 3: Physical vs. Digital**
```
[terminal] ─── adj ─── [MEMORY LEAK]
                             │
                    [maintenance panel] on wall
```
Two solutions: terminal's `[flush buffers]` (halves flood, software fix) or panel's `[seal bulkhead]` (seals door permanently, blocks route but stops spread). Different tradeoffs.

**Example 4: Exploration Reward**
```
[entry] → [chokepoint hazard] → [exit]
                ↓ branch
          [hub] → [dead_end + cache]
                → [peripheral + terminal]
```
The cache might have a module that helps with the chokepoint hazard. The terminal might reveal access node locations. Exploring the branch costs time but gives tools/info.

**Example 5: Layered Challenge**
```
[UNSTABLE(C)] → [terminal] → [CORRUPTED(E) chokepoint] → [exit]
```
Terminal adjacent to both hazards. Offers `[kill process]` for unstable and `[quarantine sector]` for corruption. But using both takes time, and the unstable room damages you while you interact with the terminal. Player must choose which to disable, or burn coherence on both.

---

## 6. Three-Faction Ecosystem

The game's lore already establishes a three-way conflict: antivirus defense, virus remnants, and the player (unauthorized ego). The Gemini research formalizes this into factions whose interactions create emergent scenarios.

### 6a. Factions

**Architects (Neutral/Maintenance)** — *"The ship must function."*
Ship repair processes. Indifferent to the player unless you consume resources or block their work. They fix hazards, which can help or hinder you.

| Entity | Glyph | Behavior |
|--------|-------|----------|
| Repair Scrubber | `r` `#cccccc` | Moves toward hazard tiles to repair them. Following one paves a safe path through hazards. |
| Load Balancer | `○` `#ffdd66` | Stationary. Standing near it reduces module cooldowns but makes the room dimmer (less cover). |
| Chronicler | `◎` `#44cc44` | Stationary. Records everything in LOS. Doesn't attack, but flags your position to Sentinels if you linger. |

**Fractals (Malware/Viruses)** — *"Consumption is the only logic."*
TITAN remnants and fall-era scrap code. Hostile to everything, including Sentinels. They destroy infrastructure.

| Entity | Glyph | Behavior |
|--------|-------|----------|
| Bit-Mite Swarm | `z` `#ff2244` | Attacks nearest non-malware entity. Can be lured toward Sentinels as distraction. |
| Logic Leech | `j` `#cc1133` | Waits on walls. Leaps onto entities that use abilities, draining coherence over time. Ignores inactive entities. |
| Disassembler | `Ø` `#880022` | Slow. Deletes floor tiles as it moves — permanent terrain destruction. Acts as a timer. |

**Sentinels (Defense/Anti-Virus)** — *"Identify. Quarantine. Purge."*
The ship's security. Views both malware AND the player as threats, but prioritizes malware if it's actively damaging systems.

| Entity | Glyph | Behavior |
|--------|-------|----------|
| Scanner (fw-scanner) | `s` `#ffcc44` | Patrols 2-3 rooms. Frontal scan cone. Broadcasts alarm. *Already designed.* |
| Hunter (fw-hunter) | `H` `#ff4444` | Idle until alerted. Relentless chase. Contact damage. *Already designed.* |
| Trace-Router | `T` `#ffaa44` | Doesn't look for the player — looks for *evidence* (hacked terminals, dead sentinels, opened quarantine doors). Triggers ship-wide search on finding evidence. |

### 6b. Faction Priorities

```
Sentinels: attack Fractals > attack Player > patrol
Fractals:  attack nearest non-Fractal (no preference)
Architects: repair hazards > avoid combat > ignore player
```

The player can exploit these priorities:
- Lure Bit-Mites into Sentinel patrols → both factions fight, player slips past
- Follow Repair Scrubbers through hazard rooms → free safe path
- Avoid leaving evidence (hacking, combat) → Trace-Routers never trigger

### 6c. The `warzone` Tag — Faction Encounter Scenarios

When a room gets the `warzone` content tag, it spawns a pre-built faction encounter. These are the "scenario rooms" that create the most dynamic gameplay.

| Scenario | Factions | Setup | Player options |
|----------|----------|-------|----------------|
| **The Siege** | Sentinels vs. Fractals | Sentinels defend a Load Balancer from Bit-Mite swarm | Slip past during combat, or help one side for a reward |
| **Infested Corridor** | Fractals only | Logic Leeches + Disassembler. Sentinels have quarantined the room (locked doors). | Hack the door while being hunted, or find another route |
| **Crumbling Core** | Architects vs. Fractals | Repair Scrubbers frantically fix tiles that a Disassembler keeps destroying | Rush through on repaired tiles, or harvest data from dying systems |
| **Feedback Loop** | Architects vs. Sentinels | Chronicler has been corrupted, broadcasting player position to all Sentinels | Overload the Chronicler (flashbang effect), or time movements to shadows |

**Placement**: 0-1 warzone per cluster. Prefer `hub` or `large` rooms. Never on `chokepoint` (too punishing as mandatory encounter). Warzone rooms are optional high-risk detours that the player can route around.

### 6d. Adjacency Bleed Effects

Intense rooms affect their neighbors. This creates spatial awareness — you can feel a warzone or apex hazard from the next room over.

| Source room | Bleed effect on adjacent rooms | Duration |
|-------------|-------------------------------|----------|
| `warzone` (active combat) | `[noise]` — enemies in adjacent rooms investigate | While combat lasts |
| `corrupted` (spreading) | `[cracking]` — cosmetic floor cracks, warns player | Permanent |
| `memory_leak` (deep flood) | `[damp]` — floor tiles show `~` near shared door, movement -1 speed in doorway | While flood is deep |
| `reactor` themed + `overclocked` | `[heat]` — adjacent rooms dim visibility by 2 tiles radius | Permanent |
| `disassembler` present | `[unstable]` — random tile flickers in adjacent room (1 per 10 ticks) | While Disassembler lives |

**Implementation**: Bleed is checked once when the player enters an adjacent room, and updated when source room state changes. Cheap — just check neighbor tags and apply a visual/mechanical modifier.

### 6e. Spoof Interaction with Factions

The existing `spoof.m` module gains faction-specific behavior:

- **Spoof Sentinel**: Sentinels ignore you, but Fractals treat you as high-priority target (you look like defense)
- **Spoof Fractal**: Move through Disassembler zones safely, but Sentinels hunt you with extreme prejudice
- **Spoof Architect**: Both factions mostly ignore you, but you can't interact with terminals or objects (you're "just a repair bot")

This creates meaningful choices beyond simple invisibility. Different clusters may favor different spoof targets.

---

## 7. Theme Tags With Gameplay Effects

The Gemini research suggests node types that aren't just visual — they grant mechanical bonuses. We can selectively merge this with our theme tags. Instead of ALL themes having effects (scope explosion), pick 3-4 themes that provide a passive room bonus when the player is inside:

| Theme | Passive effect | Justification |
|-------|---------------|---------------|
| `reactor` | Module cooldowns tick 2x faster | High-energy computation environment |
| `medbay` | Passive +1 coherence every 10 ticks while standing still | Self-repair subroutine |
| `lab` | alert.m range +1 room (better sensors) | Debug/analysis equipment |
| `comms` | Terminal `[scan]` option reveals enemy positions too | Signal relay infrastructure |

All other themes remain purely cosmetic. This keeps scope small while making some rooms worth seeking out.

---

## 8. Comparison: Specific vs. General

| Aspect | Hazard-specific objects | General-purpose tags |
|--------|----------------------|---------------------|
| Object count | 6+ unique types | 3-4 general types |
| Code complexity | Each needs custom logic | Shared interaction + context menu |
| Emergent variety | Fixed pairings | Combinatorial from placement |
| Player learning | "drain valve = anti-flood" | "terminals help with nearby problems" |
| 7DRL scope | Many small systems | Few flexible systems |
| Replayability | Same solution each time | Same object, different options per run |

The general approach is better for scope (fewer object types to implement) and replayability (same terminal does different things based on neighbors).

---

## 9. Implementation Priority

1. **Room tag computation** — structural tags from graph topology
2. **Three-faction entity system** — Architects, Fractals, Sentinels with priority AI
3. **Terminal** — context menu system, the core general-purpose interactable
4. **Access node + exit gating** — core loop objective
5. **Data cache** — pickups and encryption keys
6. **State modifier tags** — encrypted, orphaned, overclocked, etc.
7. **Power junction** — hazard disable with timer
8. **Maintenance panel** — physical bypass
9. **Repair station** — coherence recovery
10. **Theme tags with gameplay effects** — reactor/medbay/lab/comms bonuses
11. **Warzone scenarios** — faction encounter templates
12. **Adjacency bleed effects** — neighbor room modifiers
13. **Tag-driven placement algorithm** — full Phase 1-4 from Section 4
