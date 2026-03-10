# Bug Analysis — Coherence 7DRL

Root cause analysis for each bug in KNOWN_ISSUES.md, with code references and testing suggestions.

---

## 1. UI: Locked door shown with unlocked door glyph

**Root cause:** `closeDoor()` in [game.ts:56-62](src/game.ts#L56-L62) unconditionally sets `glyph = '+'`, losing the quarantine seal marker `'▪'`.

**How it triggers:**
1. Quarantine room created — doors get `glyph = '▪'`, `walkable = false` ([cluster.ts:1510-1523](src/cluster.ts#L1510-L1523))
2. ~~A door-slam micro-event fires in [hazards.ts:1009-1026](src/hazards.ts#L1009-L1026)~~ — **False positive**: micro-events only fire on player room entry (`tryFireMicroEvent`), and the player can't enter a sealed quarantine room. This path cannot corrupt the glyph.
3. Auto-close in [game.ts:754-782](src/game.ts#L754-L782) (`updateDoors`) calls `closeDoor()` which always writes `'+'` — but only fires on doors with `doorOpen = true`, and quarantine doors start closed. Only a risk if something else sets `doorOpen = true` first.
4. AI door opening in [ai.ts:83](src/ai.ts#L83) checks `glyph !== '▪'` to avoid sealed doors — this guard is correct.

**Actual severity:** Lower than initially assessed. The `closeDoor()` unconditional `'+'` is a latent bug (would corrupt quarantine doors if they ever got opened), but no current code path opens sealed quarantine doors. The main risk is future code adding door-opening logic without checking the sealed state.

**Result:** Currently unlikely to trigger in practice. The real fix is still to track sealed state separately (`tile.sealed = true`) rather than relying on the glyph, as a defensive measure.

**Fix direction:** Track door sealed state separately (e.g. `tile.sealed = true`) rather than relying on glyph. Or: `closeDoor()` should preserve `'▪'` glyph if the door's room is quarantine.

**Testing:** Sim-test can check: after `initRoomHazards` creates a quarantine room, run N ticks with `updateHazards`, verify all quarantine room doors still have `glyph === '▪'` and `walkable === false`. Run across many seeds.

---

## 2. Map generation: Entities from special events block door paths

**Root cause:** 3 of 6 scenario placement functions in [cluster.ts](src/cluster.ts) skip the `isAdjacentToDoor()` check when placing props:

| Function | Line | Door check? |
|---|---|---|
| `placeSpookyAstronauts()` | [2056-2093](src/cluster.ts#L2056-L2093) | **Missing** |
| `placeBrokenSleever()` | [2095-2134](src/cluster.ts#L2095-L2134) | Present (line 2118) |
| `placeStuckEcho()` | [1961-2054](src/cluster.ts#L1961-L2054) | **Partial** — echo position checked (line 1985), but **cage walls** at lines 1998-2009 have NO door check. Cage walls convert floor tiles to `TileType.Wall` and can seal adjacent doors. |
| `placeLostExpedition()` | [2203-2268](src/cluster.ts#L2203-L2268) | **Missing** |
| `placeCorruptionRitual()` | [2283-2363](src/cluster.ts#L2283-L2363) | **Missing** (hardcoded offsets from center) |

The `isAdjacentToDoor()` helper exists at [cluster.ts:1017-1019](src/cluster.ts#L1017-L1019) but is only fully applied by 2 functions. `placeStuckEcho` checks the echo position but not its cage walls — the cage converts floor tiles to walls ([cluster.ts:1998-2009](src/cluster.ts#L1998-L2009)) without checking if those tiles are adjacent to doors, which can seal a door path.

**Compounding factor:** Props are created as non-AI entities ([ai.ts:906-921](src/ai.ts#L906-L921)) with no `ai` field. Player treats them as neutral (can't attack or push) at [game.ts:584-624](src/game.ts#L584-L624). Pathfinding in [pathfinding.ts:50-53](src/pathfinding.ts#L50-L53) ignores entities entirely — it returns paths through props.

**Fix direction:** Add `isAdjacentToDoor()` checks to all three missing placement functions. Optionally: make props pushable (treat as friendly faction) or make pathfinding entity-aware.

**Testing:** Sim-test can verify: for each room with a scenario, BFS from the room's door tiles outward — confirm all doors are reachable from outside the room without passing through entity positions. Flag any seed where this fails.

---

## 3. Map generation: Quarantine key terminal has no deactivation interactable

**Intended design:** The key terminal SHOULD be placed inside a quarantine room in clusters 2+, and MUST be in quarantine at clusters 4-5. The player must find a deactivation interactable outside the quarantine room to unseal the doors and access the key terminal. This is by design.

**The primary bug (confirmed via sim-test):** `assignHazardDeactivation` ([cluster.ts:1604-1646](src/cluster.ts#L1604-L1646)) assigns deactivation overrides to **data archive interactables** (`isDataArchive: true`), which have a completely different dialog system. Archives are created with `dialog: []` (empty array, [cluster.ts:1356](src/cluster.ts#L1356)) and use a custom menu built from `archivePools`/`archiveCurrentCategory` — they never read `ia.dialog` for user-facing choices. When `assignHazardDeactivation` pushes a deactivation node into `ia.dialog` and tries to find a `'root'` node to inject a menu choice (line 1637), it gets `undefined` — the deactivation node exists in the array but is completely invisible to the player.

**Sim-test evidence:** Across 200 seeds × 6 clusters, ~100 quarantine rooms had at least one switch assigned to an archive echo with no root menu link. In the tested seeds, every quarantine room also had at least one working non-archive switch. But with fewer interactables or more hazard rooms, ALL switches could be archive echoes → softlock.

**Secondary risk — cross-quarantine assignment:**
The candidate filter at line 1607 (`i.roomId !== hazardRoom.id`) only excludes interactables inside the SAME hazard room. An interactable inside a DIFFERENT quarantine room is still a valid candidate. Only quarantine seals doors (other hazard types leave doors walkable), so this can create circular dependencies where quarantine A's override is behind quarantine B's sealed doors.

**Tertiary risk — zero candidates:**
Line 1609: `if (candidates.length === 0) continue;` silently skips. At cluster 4+ with `hazardFraction = 0.75`, the candidate pool can be entirely inside hazard rooms.

**Fix direction:**

1. **Critical:** Filter out `isDataArchive` interactables from candidates — they can't surface dialog choices: `candidates.filter(i => !i.isDataArchive && i.roomId !== hazardRoom.id)`
2. Also exclude interactables inside quarantine rooms from candidates for quarantine deactivation
3. Process quarantine rooms FIRST (before other hazard types) so they get priority access to the best candidates
4. Never silently skip — if `candidates.length === 0`, force-place an interactable in a reachable room

**Testing:** Sim-test now checks reachability AND root menu linkage (see `quarantineUnreachableSwitch` in [sim-test.ts](src/sim-test.ts)). Run `npx tsx src/sim-test.ts --seeds 200` to verify.

---

## 5. Map generation: Quarantine on hub/chokepoint room disconnects the map

**Root cause:** `assignHazardsByCollapse` ([cluster.ts:421-458](src/cluster.ts#L421-L458)) has no topology awareness. It assigns hazard types (including quarantine) purely by collapse value and room size — it never checks whether the room is a hub, chokepoint, or bridge node in the room connectivity graph.

**How it triggers:**
1. A room with collapse in the LOW tier range (0.1-0.3, or lower in clusters 2+) gets assigned `quarantine` via `weightedPick(TIER_LOW)` at [cluster.ts:454](src/cluster.ts#L454). Quarantine is in `TIER_LOW` with weight 1 ([cluster.ts:382](src/cluster.ts#L382)).
2. `initRoomHazards` ([cluster.ts:1510-1524](src/cluster.ts#L1510-L1524)) seals ALL doors of that room — setting `walkable = false` on every door tile.
3. If the room has 2+ doors connecting different parts of the map (hub or corridor room), sealing it cuts off all rooms behind it from the rest of the level.

**Why no existing guard catches this:**

- Chokepoint detection exists ([cluster.ts:1716-1753](src/cluster.ts#L1716-L1753)) but is only used for firewall assignment ([cluster.ts:1573-1587](src/cluster.ts#L1573-L1587)), not for filtering quarantine placement.
- `assignFirewallToChokepoints` skips rooms that already have a hazard (line 1577: `if (room.roomType !== 'normal') continue`), so a chokepoint room that got quarantine from `assignHazardsByCollapse` keeps it.
- Entry/exit rooms are protected (line 423-425), but interior hubs and chokepoints are not.
- The `doorAdjacency` graph is available at assignment time (built at line 2442) but not passed to `assignHazardsByCollapse`.

**Severity:** High in clusters 2+ where `hazardFraction` is 0.50-0.75 and `safeThreshold` drops to 0.02-0.01, making more rooms eligible for hazards including quarantine.

**Fix direction:**

1. `assignHazardsByCollapse` should skip quarantine for rooms with degree ≥ 2 in `doorAdjacency` (i.e., rooms connecting 2+ other rooms). Or better: run articulation point detection on the room graph and never assign quarantine to bridge nodes.
2. Alternatively, quarantine should only be assigned to dead-end rooms (degree ≤ 1) — thematically appropriate (isolated containment) and topologically safe.
3. The forced quarantine at cluster 4+ (line 2472-2482) already targets the key terminal room, which `state_findKeyTerminal` prefers to be a dead-end (line 868). But if no dead-end has the key, it falls back to any room — this fallback should also check degree.

**Testing:** Sim-test can verify: after `initRoomHazards`, run BFS/flood-fill from the entry room across all walkable tiles. Confirm that every non-quarantine room's interior is reachable from the entry. If any room is disconnected, flag the seed. Also: check that every quarantine room has degree ≤ 1 in the door adjacency graph (if the fix restricts quarantine to dead-ends).

---

## 6. Entity behavior: AI stops acting after turn 2000+

**Root cause:** Array mutation during iteration in [game.ts:867-874](src/game.ts#L867-L874).

The entity turn loop uses `for (const entity of state.entities)`. During iteration, `updateEntityAI` at line 872 can trigger `removeEntity` ([ai.ts:633](src/ai.ts#L633)) which does:
```typescript
state.entities = state.entities.filter(e => e.id !== target.id);
```
This **reassigns** `state.entities` to a new array. The `for...of` iterator continues over the old array reference, causing entities to be skipped or missed.

**Why it worsens over time:**
- Old cluster entities accumulate ([game.ts:707-708](src/game.ts#L707-L708)) — they're never removed on cluster transfer, just skipped via `clusterId` check (line 868)
- Each entity still gets energy incremented (line 869) even when skipped
- Unbounded growth of `messages`, `debugLog`, `actionLog` arrays ([game.ts:153, 157, 808](src/game.ts#L153)) degrades performance
- Message filtering in renderer is O(n) per frame ([renderer.ts:736](src/renderer.ts#L736))

**Fix direction:**
1. **Don't mutate during iteration** — queue removals and apply after the loop (the dead entity cleanup at [game.ts:889](src/game.ts#L889) already exists but happens too late to prevent the iterator break)
2. **Clean up old cluster entities** on transfer — remove entities whose `clusterId` is no longer active
3. **Cap array sizes** — trim messages/logs to a maximum length

**Testing:** The existing sim-test (`npx tsx src/sim-test.ts`) already runs 100 ticks per seed. Extending to 2000+ ticks with `--ticks 2500` and adding a check: compare number of entities with `clusterId === currentClusterId` that have `energy >= speed` against number that actually acted. If the count diverges, the iterator bug has triggered. Also: track `state.entities.length` growth over time and flag if it exceeds a threshold.

---

## Testing Strategy

The existing headless sim-test (`npx tsx src/sim-test.ts`) can be extended to catch all 5 bugs:

1. **Door glyph integrity** — after each tick, verify quarantine room doors maintain `'▪'` glyph
2. **Prop-door accessibility** — after generation, BFS from outside each scenario room to verify all doors are reachable without crossing entity positions
3. **Key terminal safety** — after generation, verify `hasKey` terminal is in a `roomType === 'normal'` room AND every hazard room has an accessible deactivation interactable
4. **Quarantine deactivation exists** — verify every quarantine room has at least one deactivation dialog option assigned to an accessible interactable
5. **Entity processing consistency** — run 2000+ ticks, verify entity counts and action counts stay consistent; flag array reference changes during the entity loop

For browser-based testing: a Playwright or Puppeteer script could load the game with `#seed=N`, simulate player movement, and verify the game state via `window.__debugState` (if exposed). This would catch rendering bugs (door glyphs) that sim-test can't see.
