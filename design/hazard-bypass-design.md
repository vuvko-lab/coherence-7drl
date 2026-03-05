# Hazard Grading, Bypass Strategies & Emergent Puzzles

## 1. Hazard Difficulty Grading

Each hazard graded by how hard it is to walk through unscathed, considering a player with no modules or tools.

| Grade | Hazard | Damage Profile | Time Pressure | Can Block Path? |
|-------|--------|----------------|---------------|-----------------|
| **S** (safe) | Echo Chamber | None | None | No |
| **B** (barrier) | Quarantine Lock | None directly | None | Yes — doors locked |
| **C** (caution) | Unstable Process | 5-10/tick (random sparks) | None, constant | No |
| **C** (caution) | Firewall | 0 (alarm → future threat) | Beam timing 2 ticks | No |
| **D** (danger) | Trigger Trap | 40-60 on detonation | 15-25 tick fuse | No (safe post-blast) |
| **D** (danger) | Memory Leak | 1-2/tick (rising flood) | Flood rises every 6 ticks | Eventually (deep flood = 3x slow) |
| **E** (extreme) | Gravity Well | 8-15/pull at center | Pull every 3 ticks | No, but repositions you |
| **E** (extreme) | Corrupted Zone | 1-3/tick + tiles collapse | Spreads every 8-12 ticks | Yes — collapsed tiles impassable |

### Design Principle

Grade **S-C** hazards are "tax" rooms — you take some damage or spend time, but passage is reliable. Grade **D-E** hazards are "puzzle" rooms — brute-forcing costs significant coherence, so the player should look for a bypass.

When placed on chokepoints (via greedy hitting set), **D-E** hazards create the core puzzle: "How do I get past this?" The bypass tools placed in adjacent or nearby rooms provide the answer.

---

## 2. Bypass Objects

Interactive objects placed in rooms near hazards. Each has a specific hazard it counters. Placed during cluster generation based on which hazards are present.

### 2a. Power Relay

- **Glyph**: `⚡` fg `#ffaa22`
- **Placement**: Normal room adjacent to a hazard room (shared wall/door)
- **Interaction**: Stand adjacent + interact (2 ticks)
- **Effect**: Disables the connected hazard room for 20 ticks. Cooldown 30 ticks.
- **Counters**: Firewall (beams stop), Unstable (sparks stop), Gravity Well (pull stops)
- **Cannot counter**: Corruption (too organic), Memory Leak (physical), Trigger Trap (already armed)
- **Visual**: Pulsing yellow when available, dim when on cooldown

### 2b. Drain Valve

- **Glyph**: `◇` fg `#2288cc`
- **Placement**: On wall of memory_leak room (player interacts from adjacent walkable tile)
- **Interaction**: Interact (1 tick)
- **Effect**: Reduces flood level by half (rounded down). One-use (breaks after).
- **Counters**: Memory Leak only
- **Visual**: Blue diamond on wall. Changes to `◆` (filled) when used.

### 2c. Containment Field

- **Glyph**: `◈` fg `#cc4444`
- **Placement**: Normal room adjacent to corrupted zone
- **Interaction**: Interact (2 ticks)
- **Effect**: Stops corruption spread permanently. Existing corruption remains. One-use.
- **Counters**: Corrupted Zone only
- **Visual**: Red diamond pulsing. Turns dim after activation.
- **Note**: Doesn't clear existing corruption tiles, just freezes them. Player still has to navigate degraded/corrupted tiles but they won't get worse.

### 2d. Blast Shutter

- **Glyph**: `▣` fg `#aa8844`
- **Placement**: On door between trigger_trap room and adjacent room
- **Interaction**: Interact from the safe side (1 tick)
- **Effect**: Seals the door with a blast-proof shutter. Detonation deals 0 damage through sealed doors. Opens automatically after detonation.
- **Counters**: Trigger Trap only
- **Strategy**: Activate trap (enter room → leave immediately), seal shutter, wait for detonation. Room is safe post-blast with zero risk.

### 2e. Keycard Data

- **Glyph**: `≡` fg `#44ddaa`
- **Placement**: Normal room, 2+ rooms from quarantine
- **Interaction**: Walk over to auto-collect
- **Effect**: Unlocks all quarantine doors in this cluster
- **Counters**: Quarantine Lock only
- **Alternative**: Player can still hack quarantine doors (5 ticks adjacent) without keycard

### 2f. Gravity Anchor

- **Glyph**: `⊕` fg `#aa44ff`
- **Placement**: Inside the gravity_well room, on a wall tile near entrance
- **Interaction**: Auto-activate on entry (passive)
- **Effect**: While player is within 2 tiles of anchor, pull is nullified. Creates a "safe zone" near the door to plan movement.
- **Counters**: Gravity Well only
- **Note**: Player must still cross the room to reach the other side. Anchor just gives a breather near the entrance.

---

## 3. Module-Based Bypasses

Existing modules (designed but not yet implemented) provide softer bypasses. These don't eliminate the hazard — they reduce the cost of brute-forcing through.

| Module | Hazard | Bypass |
|--------|--------|--------|
| overclock.m | Trigger Trap | Sprint through before detonation |
| overclock.m | Memory Leak | Move at normal speed through shallow flood |
| overclock.m | Corrupted Zone | Rush through before tiles collapse |
| corrupt.m | Unstable Process | Destroy process core — stops sparks permanently |
| corrupt.m | Quarantine Lock | Breach doors (alternative to hack or keycard) |
| cloak.m | Firewall | Invisible to scanner beams |
| spoof.m | Firewall | Pass as friendly process |
| alert.m | Trigger Trap | Reveals fuse timer before entering |
| alert.m | Unstable | Shows which tiles spark next tick |
| alert.m | All | Detects hazard type in adjacent rooms |

---

## 4. Emergent Puzzle Generation

### 4a. Algorithm Overview

After hazard rooms are placed on chokepoints (greedy hitting set), the generator places bypass objects to ensure each grade D-E hazard has at least one reachable bypass. The bypass may itself be behind a grade C hazard, creating layered puzzles.

```
For each hazard room H of grade D or E:
  1. Find candidate rooms for bypass placement:
     - Adjacent rooms (distance 1) preferred
     - Distance 2 rooms acceptable
     - Must not be another D-E hazard room
     - Must not be entry/exit room
  2. Select bypass type based on hazard:
     - corrupted → containment_field
     - trigger_trap → blast_shutter
     - memory_leak → drain_valve
     - gravity_well → gravity_anchor (placed IN the hazard room)
  3. Place the bypass object in the chosen room
  4. Optionally place a power_relay for C-grade hazards (50% chance)
```

### 4b. Puzzle Patterns That Emerge

**Pattern: Side Quest**
The bypass for hazard A is in a room behind hazard B. Player must handle B to reach A's bypass. If B is grade C (tankable), the player has a choice: take small damage going through B to disable A cleanly, or just brute-force through A.

```
[entry] → [unstable] → [CORRUPTED zone]
                ↓
          [containment field]
```
To reach the containment field (disables corruption spread), you must pass through sparking unstable room. Trade 5-10 spark damage for safe corruption passage, or skip it and rush through corruption directly.

**Pattern: Timer Race**
Trigger trap room blocks the path. Blast shutter is on the far side (requires going around). Player must decide: go around (safe but costs time — trap may detonate while they're in blast radius of adjacent room), or rush through the trap room (risky but fast).

```
[blast shutter] ─ [TRIGGER TRAP] ─ [exit path]
       ↑                                ↑
   [long way around] ──────────────────┘
```

**Pattern: Resource Gambit**
The bypass exists but costs a module charge. Player decides whether to use their limited module now or save it for a harder hazard later.

```
[FIREWALL] (blocks path)
  Option A: overclock.m — sprint between beam sweeps (costs module cooldown)
  Option B: power_relay in adjacent room — 20 tick disable window (costs 2 ticks + must go there first)
  Option C: just time it manually (costs nothing but skill)
```

**Pattern: Quarantine Payoff**
Quarantine room contains a bypass tool for another hazard. Player must hack the quarantine (5 ticks exposed) or find the keycard to reach the tool.

```
[quarantine] contains: containment_field
       ↓ (needs keycard or hack)
 enables safe passage through:
[CORRUPTED zone] ─ [exit path]
```

### 4c. Guaranteed Solvability

Every D-E hazard on a chokepoint MUST have at least one of:
1. A bypass object reachable without passing through another D-E hazard
2. A module-based solution the player might have
3. A brute-force path that costs ≤30 coherence (survivable)

This is verified during generation. If a bypass can't be placed (no suitable adjacent rooms), the hazard is downgraded to a C-grade type.

---

## 5. Object Interaction System

All bypass objects use the same interaction model:

```typescript
export type ObjectType =
  | 'power_relay'
  | 'drain_valve'
  | 'containment_field'
  | 'blast_shutter'
  | 'keycard'
  | 'gravity_anchor';

export interface ClusterObject {
  type: ObjectType;
  position: Position;
  roomId: number;          // room containing the object
  targetRoomId: number;    // hazard room this object affects
  activated: boolean;
  cooldownUntil?: number;  // tick when reusable (power_relay only)
}
```

**Interaction flow**:
1. Player moves adjacent to object (or onto it for keycard/gravity_anchor)
2. Press interact key (e)
3. Object activates after cast time (0-2 ticks)
4. Connected hazard is modified

Keycards are auto-pickup (walk over). Gravity anchors are passive (enter radius).

---

## 6. Implementation Priority

1. **ClusterObject type + rendering** — add objects to Cluster, render glyphs
2. **Interact action** — e key, cast time, activate object
3. **Power relay** — generic hazard disable, tests the pipeline
4. **Keycard + quarantine unlock** — simple auto-pickup
5. **Blast shutter** — trigger trap interaction
6. **Drain valve** — memory leak interaction
7. **Containment field** — corruption interaction
8. **Gravity anchor** — gravity well interaction
9. **Bypass placement algorithm** — integrate with chooseHazardRooms
10. **Solvability verification** — ensure all chokepoint hazards have a reachable bypass
