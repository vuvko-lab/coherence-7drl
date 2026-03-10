# Known bugs and issues

## UI

* ~~At least one report of locked door shown with a unlocked door glyph.~~ Fixed: added `tile.sealed` flag; `closeDoor()` now preserves quarantine glyph `'▪'`.

## Map generation

* ~~Placed entities from special events can block the path to a door.~~ Fixed: added `isAdjacentToDoor()` checks to `placeSpookyAstronauts`, `placeLostExpedition`, `placeCorruptionRitual`, and `placeStuckEcho` cage walls.
* ~~"Key" placement for deactivating rooms can be placed such that they both cannot be retrieved.~~ Fixed: `assignHazardDeactivation` now supports data archives and terminals as deactivation targets; cross-quarantine filtering prevents circular dependencies.
* ~~I encountered at least one time when I could not open a quarantine room at cluster 4. Maybe check the quarantine room placement for clusters 4+.~~ Fixed: quarantine restricted to dead-end rooms (degree ≤ 1 in door adjacency graph).

## Entity behavior

* ~~After some time AI just stops (happened at turn 2000+).~~ Fixed: `removeEntity` now marks entities with `_pendingRemoval` instead of filtering mid-loop; old cluster entities cleaned up on transfer; log arrays capped at 500 entries.
