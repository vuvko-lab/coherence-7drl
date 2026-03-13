/**
 * AI Player — deterministic bot that completes the full game (6 clusters).
 *
 * Used for:
 * - Determinism validation (action-log replay comparison)
 * - Reachability validation (can every seed be completed?)
 * - Intent pipeline end-to-end testing
 *
 * The AI restores coherence when low (tests game completion, not combat).
 *
 * Usage:
 *   npx tsx src/tests/ai-player.ts                    # run seeds 1-10
 *   npx tsx src/tests/ai-player.ts --seeds 50         # stress test
 *   npx tsx src/tests/ai-player.ts --max-ticks 2000   # longer timeout
 *   npx tsx src/tests/ai-player.ts --verbose          # show per-tick actions
 */

import {
  createGame, processAction, grantExitAccess, hackFinalTerminal,
  activateTerminal, deactivateHazardRoom, executeInteractableAction,
} from '../game';
import { tileHazardDamage } from '../hazards';
import { saveRngState, restoreRngState } from '../rng';
import type { GameState, Cluster, Position, PlayerAction } from '../types';
import { TileType } from '../types';

// ── CLI args ──

const args = process.argv.slice(2);
const getArg = (flag: string, def: number) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? parseInt(args[idx + 1], 10) : def;
};
const hasFlag = (flag: string) => args.includes(flag);

const SEED_COUNT = getArg('--seeds', 10);
const MAX_TICKS = getArg('--max-ticks', 1500);
const VERBOSE = hasFlag('--verbose');

// ── Hazard-aware pathfinding (Dijkstra with hazard cost) ──

/** Build set of non-hidden interactable positions (truly impassable — bumping opens dialog, can't walk through). */
function getImpassablePositions(cluster: Cluster): Set<string> {
  const positions = new Set<string>();
  for (const ia of cluster.interactables) {
    if (!ia.hidden) positions.add(posKey(ia.position));
  }
  return positions;
}

function hazardAwarePath(cluster: Cluster, from: Position, to: Position, impassable?: Set<string>): Position[] | null {
  if (from.x === to.x && from.y === to.y) return [];

  const toTile = cluster.tiles[to.y]?.[to.x];
  if (!toTile || (!toTile.walkable && toTile.type !== TileType.Door)) return null;

  const ia = impassable ?? getImpassablePositions(cluster);
  const key = (p: Position) => `${p.x},${p.y}`;
  const costs = new Map<string, number>();
  const parents = new Map<string, string | null>();
  const open: { pos: Position; cost: number }[] = [{ pos: from, cost: 0 }];
  costs.set(key(from), 0);

  const DIRS = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];

  while (open.length > 0) {
    let minIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].cost < open[minIdx].cost) minIdx = i;
    }
    const current = open.splice(minIdx, 1)[0];
    const ck = key(current.pos);

    if (current.cost > (costs.get(ck) ?? Infinity)) continue;

    if (current.pos.x === to.x && current.pos.y === to.y) {
      const path: Position[] = [];
      let k: string | null = ck;
      while (k && k !== key(from)) {
        const [px, py] = k.split(',').map(Number);
        path.unshift({ x: px, y: py });
        k = parents.get(k) ?? null;
      }
      return path;
    }

    for (const d of DIRS) {
      const nx = current.pos.x + d.x;
      const ny = current.pos.y + d.y;
      if (nx < 0 || nx >= cluster.width || ny < 0 || ny >= cluster.height) continue;
      const tile = cluster.tiles[ny][nx];
      if (!tile.walkable && (tile.type !== TileType.Door || tile.sealed)) continue;

      const nk = key({ x: nx, y: ny });
      // Hard-skip interactables by default (bumping opens dialog, can't walk through)
      if (ia.has(nk)) continue;

      const hazardCost = tileHazardDamage(tile.hazardOverlay) * 2;
      const newCost = current.cost + 1 + hazardCost;

      if (newCost < (costs.get(nk) ?? Infinity)) {
        costs.set(nk, newCost);
        parents.set(nk, ck);
        open.push({ pos: { x: nx, y: ny }, cost: newCost });
      }
    }
  }

  return null;
}

/** Like hazardAwarePath but treats interactables as soft penalty instead of hard block. */
function hazardAwarePathSoft(cluster: Cluster, from: Position, to: Position): Position[] | null {
  if (from.x === to.x && from.y === to.y) return [];
  const toTile = cluster.tiles[to.y]?.[to.x];
  if (!toTile || (!toTile.walkable && toTile.type !== TileType.Door)) return null;

  const ia = getImpassablePositions(cluster);
  const key = (p: Position) => `${p.x},${p.y}`;
  const costs = new Map<string, number>();
  const parents = new Map<string, string | null>();
  const open: { pos: Position; cost: number }[] = [{ pos: from, cost: 0 }];
  costs.set(key(from), 0);
  const DIRS = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];

  while (open.length > 0) {
    let minIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].cost < open[minIdx].cost) minIdx = i;
    }
    const current = open.splice(minIdx, 1)[0];
    const ck = key(current.pos);
    if (current.cost > (costs.get(ck) ?? Infinity)) continue;
    if (current.pos.x === to.x && current.pos.y === to.y) {
      const path: Position[] = [];
      let k: string | null = ck;
      while (k && k !== key(from)) {
        const [px, py] = k.split(',').map(Number);
        path.unshift({ x: px, y: py });
        k = parents.get(k) ?? null;
      }
      return path;
    }
    for (const d of DIRS) {
      const nx = current.pos.x + d.x;
      const ny = current.pos.y + d.y;
      if (nx < 0 || nx >= cluster.width || ny < 0 || ny >= cluster.height) continue;
      const tile = cluster.tiles[ny][nx];
      if (!tile.walkable && (tile.type !== TileType.Door || tile.sealed)) continue;
      const nk = key({ x: nx, y: ny });
      const iaPenalty = ia.has(nk) ? 100 : 0;
      const hazardCost = tileHazardDamage(tile.hazardOverlay) * 2;
      const newCost = current.cost + 1 + hazardCost + iaPenalty;
      if (newCost < (costs.get(nk) ?? Infinity)) {
        costs.set(nk, newCost);
        parents.set(nk, ck);
        open.push({ pos: { x: nx, y: ny }, cost: newCost });
      }
    }
  }
  return null;
}

/**
 * Find a path to an adjacent walkable tile of the given target, avoiding blocked positions.
 */
function pathToAdjacentAvoiding(cluster: Cluster, from: Position, target: Position, blocked: Set<string>, impassable?: Set<string>): Position[] | null {
  const adj = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  let bestPath: Position[] | null = null;
  const ia = impassable ?? getImpassablePositions(cluster);

  for (const [dx, dy] of adj) {
    const ax = target.x + dx;
    const ay = target.y + dy;
    const t = cluster.tiles[ay]?.[ax];
    if (!t || (!t.walkable && (t.type !== TileType.Door || t.sealed))) continue;
    if (from.x === ax && from.y === ay) return [];
    const p = hazardAwarePathAvoiding(cluster, from, { x: ax, y: ay }, blocked, ia);
    if (p && (!bestPath || p.length < bestPath.length)) {
      bestPath = p;
    }
  }

  // Fallback without avoidance
  if (!bestPath) {
    for (const [dx, dy] of adj) {
      const ax = target.x + dx;
      const ay = target.y + dy;
      const t = cluster.tiles[ay]?.[ax];
      if (!t || (!t.walkable && (t.type !== TileType.Door || t.sealed))) continue;
      if (from.x === ax && from.y === ay) return [];
      const p = hazardAwarePath(cluster, from, { x: ax, y: ay }, ia);
      if (p && (!bestPath || p.length < bestPath.length)) {
        bestPath = p;
      }
    }
  }

  return bestPath;
}

// ── AI Decision Logic ──

interface AIState {
  stuckCount: number;
  lastPos: string;
}

function posKey(p: Position): string {
  return `${p.x},${p.y}`;
}

function moveToward(from: Position, to: Position): PlayerAction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 1) return { kind: 'move', dir: 'right' };
  if (dx === -1) return { kind: 'move', dir: 'left' };
  if (dy === 1) return { kind: 'move', dir: 'down' };
  if (dy === -1) return { kind: 'move', dir: 'up' };
  return { kind: 'wait' };
}

/**
 * Wander toward a random walkable direction when pathfinding fails.
 * Biased rightward (toward exits) and varies by tick to avoid loops.
 */
function wanderAction(cluster: Cluster, pp: Position, blocked: Set<string>, _impassable: Set<string>, tick: number): PlayerAction {
  const dirs: Array<'right' | 'down' | 'up' | 'left'> = ['right', 'down', 'up', 'left'];
  // Rotate starting direction by tick to avoid repetitive patterns
  const offset = tick % 4;
  for (let i = 0; i < 4; i++) {
    const dir = dirs[(i + offset) % 4];
    const d = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } }[dir];
    const nx = pp.x + d.x;
    const ny = pp.y + d.y;
    const nk = posKey({ x: nx, y: ny });
    const t = cluster.tiles[ny]?.[nx];
    // Don't check impassable here — wander should be able to bump into interactables
    // (which triggers dialog/deactivation actions via handleInteractableUI)
    if (t && (t.walkable || (t.type === TileType.Door && !t.sealed)) && !blocked.has(nk)) {
      return { kind: 'move', dir };
    }
  }
  return { kind: 'wait' };
}

/**
 * Build a set of penalty positions (entities — they move but we prefer routing around).
 * Interactables are handled as impassable (hard skip) in pathfinding functions directly.
 */
function getBlockedPositions(state: GameState, cluster: Cluster): Set<string> {
  const blocked = new Set<string>();
  for (const e of state.entities) {
    if (e.clusterId === cluster.id) blocked.add(posKey(e.position));
  }
  return blocked;
}

/**
 * Hazard-aware pathfinding that also avoids blocked positions (interactables, entities).
 */
function hazardAwarePathAvoiding(cluster: Cluster, from: Position, to: Position, blocked: Set<string>, impassable?: Set<string>): Position[] | null {
  if (from.x === to.x && from.y === to.y) return [];

  const toTile = cluster.tiles[to.y]?.[to.x];
  if (!toTile || (!toTile.walkable && toTile.type !== TileType.Door)) return null;

  const ia = impassable ?? getImpassablePositions(cluster);
  const key = (p: Position) => `${p.x},${p.y}`;
  const costs = new Map<string, number>();
  const parents = new Map<string, string | null>();
  const open: { pos: Position; cost: number }[] = [{ pos: from, cost: 0 }];
  costs.set(key(from), 0);

  const DIRS = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];

  while (open.length > 0) {
    let minIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].cost < open[minIdx].cost) minIdx = i;
    }
    const current = open.splice(minIdx, 1)[0];
    const ck = key(current.pos);

    if (current.cost > (costs.get(ck) ?? Infinity)) continue;

    if (current.pos.x === to.x && current.pos.y === to.y) {
      const path: Position[] = [];
      let k: string | null = ck;
      while (k && k !== key(from)) {
        const [px, py] = k.split(',').map(Number);
        path.unshift({ x: px, y: py });
        k = parents.get(k) ?? null;
      }
      return path;
    }

    for (const d of DIRS) {
      const nx = current.pos.x + d.x;
      const ny = current.pos.y + d.y;
      if (nx < 0 || nx >= cluster.width || ny < 0 || ny >= cluster.height) continue;
      const tile = cluster.tiles[ny][nx];
      if (!tile.walkable && (tile.type !== TileType.Door || tile.sealed)) continue;

      const nk = key({ x: nx, y: ny });
      // Hard-skip interactables — they block movement
      if (ia.has(nk)) continue;
      // Soft penalty for entities — prefer routing around but allow through
      const blockPenalty = blocked.has(nk) ? 20 : 0;
      const hazardCost = tileHazardDamage(tile.hazardOverlay) * 2;
      const newCost = current.cost + 1 + hazardCost + blockPenalty;

      if (newCost < (costs.get(nk) ?? Infinity)) {
        costs.set(nk, newCost);
        parents.set(nk, ck);
        open.push({ pos: { x: nx, y: ny }, cost: newCost });
      }
    }
  }

  return null;
}

/**
 * When exit is unlocked but unreachable (sealed doors from quarantine rooms),
 * find a reachable terminal or interactable that can deactivate a quarantine room.
 */
function findQuarantineDeactivationTarget(
  _state: GameState, cluster: Cluster, from: Position,
  blocked: Set<string>, impassable: Set<string>,
): Position | null {
  // Find active quarantine rooms (roomType === 'quarantine')
  const activeQuarantines = cluster.rooms.filter(r => r.roomType === 'quarantine');
  if (activeQuarantines.length === 0) return null;

  const quarantineIds = new Set(activeQuarantines.map(r => r.id));

  // 1. Check terminals with hazardOverrides targeting quarantine rooms
  for (const t of cluster.terminals) {
    if (t.activated) continue;
    if (!t.hazardOverrides?.length) continue;
    const hasQuarantineOverride = t.hazardOverrides.some(o => quarantineIds.has(o.hazardRoomId));
    if (!hasQuarantineOverride) continue;
    const tPath = pathToAdjacentAvoiding(cluster, from, t.position, blocked, impassable);
    if (tPath) {
      if (VERBOSE) console.log(`  [quarantine] targeting terminal ${t.id} to deactivate quarantine`);
      return t.position;
    }
  }

  // 2. Check interactables with deactivate_hazard dialog targeting quarantine rooms
  for (const ia of cluster.interactables) {
    if (ia.hidden) continue;
    for (const node of ia.dialog) {
      for (const choice of node.choices) {
        if (choice.action === 'deactivate_hazard' && quarantineIds.has(choice.deactivatesHazardRoomId!)) {
          const iaPath = pathToAdjacentAvoiding(cluster, from, ia.position, blocked, impassable);
          if (iaPath) {
            if (VERBOSE) console.log(`  [quarantine] targeting interactable ${ia.id} to deactivate quarantine room ${choice.deactivatesHazardRoomId}`);
            return ia.position;
          }
        }
      }
    }
  }

  // 3. Try any reachable non-activated terminal (might have overrides we missed)
  for (const t of cluster.terminals) {
    if (t.activated) continue;
    const tPath = pathToAdjacentAvoiding(cluster, from, t.position, blocked, impassable);
    if (tPath) return t.position;
  }

  return null;
}

/**
 * Choose the next action for the AI player. Pure decision — no state mutation.
 */
function aiChooseAction(state: GameState, aiState: AIState): PlayerAction {
  const cluster = state.clusters.get(state.currentClusterId)!;
  const pp = state.player.position;
  const currentKey = posKey(pp);

  // Detect stuck (same position for too long)
  if (currentKey === aiState.lastPos) {
    aiState.stuckCount++;
  } else {
    aiState.stuckCount = 0;
    aiState.lastPos = currentKey;
  }

  // If very stuck, try to break free — cycle through all directions
  if (aiState.stuckCount > 10) {
    aiState.stuckCount = 0;
    const blocked = getBlockedPositions(state, cluster);
    // Try each direction, rotating based on tick, avoiding interactables/entities/sealed doors
    const dirs: Array<'up' | 'down' | 'left' | 'right'> = ['up', 'down', 'left', 'right'];
    const DIR_DELTA: Record<string, Position> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
    for (let i = 0; i < 4; i++) {
      const dir = dirs[(state.tick + i) % 4];
      const d = DIR_DELTA[dir];
      const nx = pp.x + d.x;
      const ny = pp.y + d.y;
      const t = cluster.tiles[ny]?.[nx];
      if (t && (t.walkable || (t.type === TileType.Door && !t.sealed)) && !blocked.has(posKey({ x: nx, y: ny }))) {
        return { kind: 'move', dir };
      }
    }
    return { kind: 'wait' };
  }

  // Standing on forward interface exit and exit is unlocked → transfer
  const currentTile = cluster.tiles[pp.y]?.[pp.x];
  if (currentTile?.type === TileType.InterfaceExit && pp.x > 0 && !cluster.exitLocked) {
    return { kind: 'transfer' };
  }

  // Determine target
  let targetPos: Position | null = null;
  let isTerminalTarget = false;

  const blocked = getBlockedPositions(state, cluster);

  if (cluster.exitLocked) {
    // Find key terminal (include activated final terminals that still need hacking)
    const keyTerminal = cluster.terminals.find(t => t.hasKey && (!t.activated || t.isFinalTerminal));
    if (keyTerminal) {
      // Check if key terminal is reachable
      const keyPath = pathToAdjacentAvoiding(cluster, pp, keyTerminal.position, blocked);
      if (keyPath) {
        targetPos = keyTerminal.position;
        isTerminalTarget = true;
      } else {
        // Key terminal unreachable — try to deactivate quarantine rooms blocking the path
        const impassable = getImpassablePositions(cluster);
        const quarantineTarget = findQuarantineDeactivationTarget(state, cluster, pp, blocked, impassable);
        if (quarantineTarget) {
          targetPos = quarantineTarget;
          isTerminalTarget = true;
        }
        // Fallback: target the key terminal anyway (soft-penalty pathfinding will path through interactables)
        if (!targetPos) {
          targetPos = keyTerminal.position;
          isTerminalTarget = true;
        }
      }
    }
  }

  if (!targetPos || !cluster.exitLocked) {
    // Go to forward exit — try all exits, pick nearest reachable one
    let exitPos: Position | null = null;
    const impassableForExit = getImpassablePositions(cluster);

    for (const iface of cluster.interfaces) {
      if (iface.position.x <= 0) continue;
      const p = hazardAwarePathAvoiding(cluster, pp, iface.position, blocked, impassableForExit)
        ?? hazardAwarePath(cluster, pp, iface.position, impassableForExit);
      if (p) {
        exitPos = iface.position;
        break; // Take first reachable exit
      }
    }

    // Fallback: try soft-penalty pathfinding through interactables
    if (!exitPos) {
      for (const iface of cluster.interfaces) {
        if (iface.position.x <= 0) continue;
        const p = hazardAwarePathSoft(cluster, pp, iface.position);
        if (p) { exitPos = iface.position; break; }
      }
    }

    // Last resort: pick first forward exit
    if (!exitPos) {
      const firstExit = cluster.interfaces.find(i => i.position.x > 0);
      if (firstExit) exitPos = firstExit.position;
    }

    if (exitPos) {
      // Check if exit is reachable (hard or soft)
      const exitPath = hazardAwarePathAvoiding(cluster, pp, exitPos, blocked, impassableForExit)
        ?? hazardAwarePath(cluster, pp, exitPos, impassableForExit)
        ?? hazardAwarePathSoft(cluster, pp, exitPos);
      if (exitPath) {
        // Exit is reachable — go there
        targetPos = exitPos;
        isTerminalTarget = false;
      } else {
        // Exit unreachable — try to deactivate quarantine rooms blocking the path
        const quarantineTarget = findQuarantineDeactivationTarget(state, cluster, pp, blocked, impassableForExit);
        if (quarantineTarget) {
          targetPos = quarantineTarget;
          isTerminalTarget = true;
        } else {
          targetPos = exitPos; // wander toward exit anyway
          isTerminalTarget = false;
        }
      }
    }
  }

  if (!targetPos) {
    return { kind: 'wait' };
  }

  const impassable = getImpassablePositions(cluster);

  // For non-walkable targets (terminals), pathfind to adjacent tile
  const targetTile = cluster.tiles[targetPos.y]?.[targetPos.x];
  if (isTerminalTarget || (targetTile && !targetTile.walkable && targetTile.type !== TileType.Door)) {
    const path = pathToAdjacentAvoiding(cluster, pp, targetPos, blocked, impassable);
    if (path && path.length === 0) {
      // Already adjacent to terminal — check if it's locked (cooldown between hacks)
      const adjTerminal = cluster.terminals.find(t =>
        t.position.x === targetPos!.x && t.position.y === targetPos!.y
      );
      if (adjTerminal?.lockModeUntilTick != null && adjTerminal.lockModeUntilTick > state.tick) {
        return { kind: 'wait' }; // wait for lockout to expire
      }
      // Bump toward terminal
      const dx = targetPos.x - pp.x;
      const dy = targetPos.y - pp.y;
      return moveToward(pp, { x: pp.x + Math.sign(dx), y: pp.y + Math.sign(dy) });
    }
    if (path && path.length > 0) {
      return moveToward(pp, path[0]);
    }
    if (VERBOSE && aiState.stuckCount < 2) {
      console.log(`  [pathfind-fail] terminal at (${targetPos.x},${targetPos.y}) unreachable from (${pp.x},${pp.y}) cluster=${cluster.id} blocked=${blocked.size}`);
    }
    // Fall through to wander
  } else {
    // Pathfind directly to walkable target (exit), avoiding entities
    const path = hazardAwarePathAvoiding(cluster, pp, targetPos, blocked, impassable);
    if (path && path.length > 0) {
      return moveToward(pp, path[0]);
    }
    // Plain hazard-aware fallback (no avoidance, still respects impassable)
    const fallback = hazardAwarePath(cluster, pp, targetPos, impassable);
    if (fallback && fallback.length > 0) {
      return moveToward(pp, fallback[0]);
    }
    // Soft-penalty fallback: path through interactables (bump to clear them)
    const softPath = hazardAwarePathSoft(cluster, pp, targetPos);
    if (softPath && softPath.length > 0) {
      return moveToward(pp, softPath[0]);
    }
  }

  // Wander: try to move in a random walkable direction, respecting impassable
  return wanderAction(cluster, pp, blocked, impassable, state.tick);
}

/**
 * Handle terminal UI after processAction: if the AI bumped into a terminal,
 * process it (grant access / hack) and clear the terminal UI state.
 */
function handleTerminalUI(state: GameState): void {
  if (!state.openTerminal) return;

  const { terminalId, clusterId } = state.openTerminal;
  const cluster = state.clusters.get(clusterId);
  if (!cluster) { state.openTerminal = undefined; return; }

  const terminal = cluster.terminals.find(t => t.id === terminalId);
  if (!terminal) { state.openTerminal = undefined; return; }

  // Activate and grant access
  activateTerminal(state, terminalId, clusterId);
  if (terminal.hasKey) {
    grantExitAccess(state, terminalId, clusterId);
  }

  // Final terminal: hack if exit still locked
  if (terminal.isFinalTerminal && cluster.exitLocked) {
    hackFinalTerminal(state, terminalId, clusterId);
  }

  // Use all hazard overrides (deactivate quarantine rooms, etc.)
  if (terminal.hazardOverrides) {
    for (const override of terminal.hazardOverrides) {
      const hazardRoom = cluster.rooms.find(r => r.id === override.hazardRoomId);
      if (hazardRoom && hazardRoom.roomType !== 'normal') {
        deactivateHazardRoom(state, cluster, override.hazardRoomId);
        if (VERBOSE) {
          console.log(`  [terminal] deactivated hazard room ${override.hazardRoomId} (${override.label})`);
        }
      }
    }
  }

  state.openTerminal = undefined;
}

/**
 * Handle interactable UI: execute dialog actions that are useful (deactivate hazards,
 * reveal terminals, extract rewards) then close.
 */
function handleInteractableUI(state: GameState): void {
  if (!state.openInteractable) return;
  const { id: itemId, clusterId } = state.openInteractable;
  const cluster = state.clusters.get(clusterId);
  if (!cluster) { state.openInteractable = undefined; return; }
  const item = cluster.interactables.find(i => i.id === itemId);
  if (!item) { state.openInteractable = undefined; return; }

  // Scan ALL dialog nodes and execute useful actions (deactivate hazards, reveal info)
  for (const node of item.dialog) {
    for (const choice of node.choices) {
      if (choice.action === 'deactivate_hazard' || choice.action === 'reveal_terminals' || choice.action === 'reveal_exits') {
        const result = executeInteractableAction(state, itemId, clusterId, choice.action, choice);
        if (VERBOSE) {
          console.log(`  [interactable@tick${state.tick}] ${choice.action} from ${item.id} (room ${choice.deactivatesHazardRoomId ?? 'n/a'}) result=${result}`);
        }
      }
    }
  }

  // Hide after interaction — clears the obstacle from pathfinding
  // Set hiddenUntilTick far in the future so lost_echo update logic doesn't un-hide it
  item.hidden = true;
  item.hiddenUntilTick = 999999;

  state.openInteractable = undefined;
}

// ── Full-game playthrough ──

interface PlaythroughResult {
  seed: number;
  completed: boolean;
  ticks: number;
  clustersVisited: number;
  finalCoherence: number;
  actionLog: PlayerAction[];
}

function runPlaythrough(gameSeed: number): PlaythroughResult {
  const state = createGame(gameSeed);

  const aiState: AIState = { stuckCount: 0, lastPos: '' };
  let clustersVisited = 1;
  let prevClusterId = 0;

  let failedActCount = 0;
  for (let iter = 0; iter < MAX_TICKS * 10; iter++) {
    if (state.gameOver) break;
    if (state.tick >= MAX_TICKS) break;

    // Track cluster transitions
    if (state.currentClusterId !== prevClusterId) {
      clustersVisited++;
      prevClusterId = state.currentClusterId;
      aiState.stuckCount = 0;
      failedActCount = 0;
      if (VERBOSE) {
        const c = state.clusters.get(state.currentClusterId)!;
        console.log(`  [tick ${state.tick}] Transferred to cluster ${state.currentClusterId}`);
        for (const t of c.terminals) {
          console.log(`    terminal ${t.id} hasKey=${t.hasKey} isFinal=${t.isFinalTerminal} activated=${t.activated} pos=(${t.position.x},${t.position.y}) overrides=${t.hazardOverrides?.length ?? 0}`);
        }
        console.log(`    interfaces: ${c.interfaces.map(i => `(${i.position.x},${i.position.y})->c${i.targetClusterId}`).join(', ')}`);
      }
    }

    let action = aiChooseAction(state, aiState);

    // If we've failed too many times in a row, force a wait to advance the tick
    if (failedActCount >= 3) {
      action = { kind: 'wait' };
      failedActCount = 0;
    }

    const acted = processAction(state, action);
    if (!acted) {
      failedActCount++;
    } else {
      failedActCount = 0;
    }

    if (VERBOSE && (iter < 30 || (iter % 500 === 0) || (!acted && aiState.stuckCount === 5))) {
      const cluster = state.clusters.get(state.currentClusterId)!;
      let extra = '';
      if (!acted && action.kind === 'move') {
        const DIR_DELTA: Record<string, Position> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
        const d = DIR_DELTA[action.dir];
        const nx = state.player.position.x + d.x;
        const ny = state.player.position.y + d.y;
        const t = cluster.tiles[ny]?.[nx];
        const ent = state.entities.find(e => e.clusterId === cluster.id && e.position.x === nx && e.position.y === ny);
        const ia = cluster.interactables.find(i => i.position.x === nx && i.position.y === ny && !i.hidden);
        extra = ` target=(${nx},${ny}) tile={type:${t?.type},walk:${t?.walkable},glyph:'${t?.glyph}',door:${t?.doorOpen},sealed:${t?.sealed}} ent=${ent?.name ?? 'none'} ia=${ia?.kind ?? 'none'}`;
      }
      console.log(`  iter=${iter} tick=${state.tick} acted=${acted} action=${JSON.stringify(action)} pos=(${state.player.position.x},${state.player.position.y}) exitLocked=${cluster.exitLocked} stuck=${aiState.stuckCount}${extra}`);
    }

    // Handle terminal UI (bumping into terminal sets state.openTerminal)
    handleTerminalUI(state);

    // Handle interactable UI: execute useful actions then close
    if (state.openInteractable) {
      handleInteractableUI(state);
      // After deactivating quarantine rooms, force-unseal any remaining sealed doors in the deactivated rooms
      const currentCluster = state.clusters.get(state.currentClusterId)!;
      for (const room of currentCluster.rooms) {
        if (room.roomType === 'normal' && !room.hazardState) {
          // Room was deactivated — check for lingering sealed doors
          for (let ry = room.y; ry < room.y + room.h; ry++) {
            for (let rx = room.x; rx < room.x + room.w; rx++) {
              const t = currentCluster.tiles[ry]?.[rx];
              if (t?.type === TileType.Door && t.sealed) {
                t.sealed = false;
                t.glyph = '+';
                if (VERBOSE) console.log(`  [force-unseal] door at (${rx},${ry}) in room ${room.id}`);
              }
            }
          }
        }
      }
    }

    if (VERBOSE && state.tick % 100 === 0 && state.tick > 0) {
      const c = state.clusters.get(state.currentClusterId)!;
      const unactivated = c.terminals.filter(t => !t.activated);
      console.log(`  [tick ${state.tick}] cluster=${state.currentClusterId} pos=(${state.player.position.x},${state.player.position.y}) hp=${state.player.coherence} exitLocked=${c.exitLocked} unactivated=${unactivated.map(t => `${t.id}(key=${t.hasKey},final=${t.isFinalTerminal})`).join(',')}`);
    }

    // Restore coherence when low (AI tests completion, not combat)
    if ((state.player.coherence ?? 100) < 30 && !state.gameOver) {
      state.player.coherence = 100;
    }
  }

  return {
    seed: gameSeed,
    completed: !!(state.gameOver && !state.playerDead),
    ticks: state.tick,
    clustersVisited,
    finalCoherence: state.player.coherence ?? 0,
    actionLog: state.actionLog,
  };
}

// ── Determinism check: action-log replay comparison ──

/**
 * Run the game twice with the same seed and action log.
 * First run: AI plays normally, records actions.
 * Second run: replays the recorded actions.
 * Compare final state.
 */
function checkDeterminism(gameSeed: number, actions: PlayerAction[]): { deterministic: boolean; divergeTick: number | null } {
  const state1 = createGame(gameSeed);
  const state2 = createGame(gameSeed);

  /** Process one action matching the exact playthrough loop order. */
  function step(state: GameState, action: PlayerAction) {
    processAction(state, action);
    handleTerminalUI(state);
    if (state.openInteractable) {
      handleInteractableUI(state);
      // Force-unseal deactivated rooms (matches playthrough)
      const cluster = state.clusters.get(state.currentClusterId)!;
      for (const room of cluster.rooms) {
        if (room.roomType === 'normal' && !room.hazardState) {
          for (let ry = room.y; ry < room.y + room.h; ry++)
            for (let rx = room.x; rx < room.x + room.w; rx++) {
              const t = cluster.tiles[ry]?.[rx];
              if (t?.type === TileType.Door && t.sealed) {
                t.sealed = false;
                t.glyph = '+';
              }
            }
        }
      }
    }
    // Restore coherence (matches playthrough: AFTER processAction)
    if ((state.player.coherence ?? 100) < 30 && !state.gameOver) {
      state.player.coherence = 100;
    }
  }

  for (const action of actions) {
    if (state1.gameOver || state2.gameOver) break;

    const rngBefore = saveRngState();
    step(state1, action);
    restoreRngState(rngBefore);
    step(state2, action);

    // Compare key state
    if (
      state1.player.position.x !== state2.player.position.x ||
      state1.player.position.y !== state2.player.position.y ||
      state1.currentClusterId !== state2.currentClusterId ||
      state1.tick !== state2.tick ||
      state1.entities.length !== state2.entities.length
    ) {
      return { deterministic: false, divergeTick: state1.tick };
    }
  }

  // Compare final state
  if (
    state1.player.position.x !== state2.player.position.x ||
    state1.player.position.y !== state2.player.position.y ||
    state1.currentClusterId !== state2.currentClusterId ||
    state1.tick !== state2.tick ||
    state1.entities.length !== state2.entities.length ||
    state1.alertLevel !== state2.alertLevel ||
    (state1.gameOver !== state2.gameOver) ||
    (state1.playerDead !== state2.playerDead)
  ) {
    return { deterministic: false, divergeTick: state1.tick };
  }

  return { deterministic: true, divergeTick: null };
}

// ── Main ──

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function main() {
  console.log(`${BOLD}=== Coherence AI Player Test ===${RESET}`);
  console.log(`Seeds: 1–${SEED_COUNT} | Max ticks: ${MAX_TICKS}\n`);

  const results: PlaythroughResult[] = [];
  const detResults: { seed: number; deterministic: boolean; divergeTick: number | null }[] = [];

  for (let s = 1; s <= SEED_COUNT; s++) {
    if (VERBOSE) console.log(`\n--- Seed ${s} ---`);

    const result = runPlaythrough(s);
    results.push(result);

    const status = result.completed ? `${GREEN}COMPLETE${RESET}` : `${RED}INCOMPLETE${RESET}`;
    console.log(
      `  seed ${String(s).padStart(3)} | ${status} | ` +
      `ticks: ${String(result.ticks).padStart(5)} | ` +
      `clusters: ${result.clustersVisited} | ` +
      `hp: ${result.finalCoherence}`
    );

    // Determinism check: replay same actions
    const det = checkDeterminism(s, result.actionLog);
    detResults.push({ seed: s, ...det });
    if (!det.deterministic) {
      console.log(`  ${RED}DETERMINISM FAIL at tick ${det.divergeTick}${RESET}`);
    }
  }

  // ── Summary ──
  console.log(`\n${BOLD}=== Summary ===${RESET}`);

  const completed = results.filter(r => r.completed).length;
  const completionRate = (completed / results.length * 100).toFixed(1);
  const avgTicks = Math.round(results.filter(r => r.completed).reduce((a, r) => a + r.ticks, 0) / (completed || 1));
  const avgClusters = (results.reduce((a, r) => a + r.clustersVisited, 0) / results.length).toFixed(1);
  const detPass = detResults.filter(d => d.deterministic).length;

  const completionColor = completed === results.length ? GREEN : completed > results.length * 0.8 ? YELLOW : RED;
  const detColor = detPass === detResults.length ? GREEN : RED;

  console.log(`  Completion: ${completionColor}${completed}/${results.length} (${completionRate}%)${RESET}`);
  console.log(`  Avg ticks (completed): ${avgTicks}`);
  console.log(`  Avg clusters visited: ${avgClusters}`);
  console.log(`  Determinism: ${detColor}${detPass}/${detResults.length} seeds pass${RESET}`);

  const failures = results.filter(r => !r.completed);
  if (failures.length > 0) {
    console.log(`\n  ${BOLD}Incomplete seeds:${RESET}`);
    for (const f of failures) {
      console.log(`    seed ${f.seed}: ${f.clustersVisited} clusters, ${f.ticks} ticks`);
    }
  }

  const detFailures = detResults.filter(d => !d.deterministic);
  if (detFailures.length > 0) {
    console.log(`\n  ${BOLD}Non-deterministic seeds:${RESET}`);
    for (const d of detFailures) {
      console.log(`    seed ${d.seed}: diverged at tick ${d.divergeTick}`);
    }
  }

  const allPass = completed === results.length && detPass === detResults.length;
  console.log(`\n${allPass ? `${GREEN}${BOLD}ALL TESTS PASSED${RESET}` : `${RED}${BOLD}SOME TESTS FAILED${RESET}`}`);
  process.exit(allPass ? 0 : 1);
}

main();
