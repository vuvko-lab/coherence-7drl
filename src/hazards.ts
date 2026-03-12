import {
  GameState, Cluster, Room, Position, TileType, Faction,
  CorruptionStage, CLUSTER_WIDTH, CLUSTER_HEIGHT, COLORS,
  ALERT_SUSPICIOUS, ALERT_ENEMY, FACTION_RELATIONS,
} from './types';
import type { Intent } from './intents';
import { addMessage } from './game';
import { random, randInt, shuffle } from './rng';
import { makeEntity } from './entity-defs';
import { resolveIntents } from './intent-resolver';

function roomInterior(room: Room): { x1: number; y1: number; x2: number; y2: number } {
  return { x1: room.x + 1, y1: room.y + 1, x2: room.x + room.w - 2, y2: room.y + room.h - 2 };
}

function posInRoom(pos: Position, room: Room): boolean {
  const { x1, y1, x2, y2 } = roomInterior(room);
  return pos.x >= x1 && pos.x <= x2 && pos.y >= y1 && pos.y <= y2;
}

function playerRoom(state: GameState, cluster: Cluster): Room | undefined {
  return cluster.rooms.find(r => posInRoom(state.player.position, r));
}


/** BFS distance between two rooms via adjacency graph. Returns -1 if unreachable. */
function roomDistance(adj: Map<number, number[]>, fromId: number, toId: number): number {
  if (fromId === toId) return 0;
  const visited = new Set<number>([fromId]);
  const queue: { id: number; dist: number }[] = [{ id: fromId, dist: 0 }];
  while (queue.length > 0) {
    const { id, dist } = queue.shift()!;
    for (const neighbor of (adj.get(id) ?? [])) {
      if (neighbor === toId) return dist + 1;
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ id: neighbor, dist: dist + 1 });
      }
    }
  }
  return -1;
}


function tileIntegrity(cluster: Cluster, x: number, y: number): number {
  const tile = cluster.tiles[y]?.[x];
  if (!tile) return 99;
  if (tile.integrity != null) return tile.integrity;
  if (tile.type === TileType.Wall) return 6;
  if (tile.type === TileType.Door) return 3;
  return 99;
}

// ── Corruption ──

const CORRUPTION_STAGES: CorruptionStage[] = ['degrading', 'corrupted', 'collapsed', 'dissolved'];

function nextCorruptionStage(stage: CorruptionStage): CorruptionStage | null {
  const idx = CORRUPTION_STAGES.indexOf(stage);
  return idx < CORRUPTION_STAGES.length - 1 ? CORRUPTION_STAGES[idx + 1] : null;
}

function corruptionOverlayStage(stage: CorruptionStage): number {
  return CORRUPTION_STAGES.indexOf(stage);
}

function updateCorruption(state: GameState, cluster: Cluster, room: Room): Intent[] {
  const hz = room.hazardState!;
  if (!hz.corruptionTiles) return [];

  const spreadInterval = randInt(20, 30);
  if (state.tick - (hz.lastSpreadTick ?? 0) < spreadInterval) return [];

  const intents: Intent[] = [
    { kind: 'set_hazard_field', roomId: room.id, field: 'lastSpreadTick', value: state.tick },
  ];

  // Work on a copy of corruptionTiles so we can build the new map
  const updatedTiles = new Map(hz.corruptionTiles);
  const newEntries: [string, CorruptionStage][] = [];

  for (const [key, stage] of hz.corruptionTiles.entries()) {
    // Progress existing tiles
    const next = nextCorruptionStage(stage);
    if (next) {
      updatedTiles.set(key, next);
      const [cx, cy] = key.split(',').map(Number);
      intents.push({ kind: 'damage_tile', position: { x: cx, y: cy }, hazardType: 'corruption', stage: corruptionOverlayStage(next) });
    }

    // Spread to adjacent tile (floor, wall, or door)
    const [cx, cy] = key.split(',').map(Number);
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const shuffled = shuffle([...dirs]);
    for (const [dx, dy] of shuffled) {
      const nx = cx + dx;
      const ny = cy + dy;
      const nkey = `${nx},${ny}`;
      if (nx < 0 || nx >= CLUSTER_WIDTH || ny < 0 || ny >= CLUSTER_HEIGHT) continue;
      if (updatedTiles.has(nkey)) continue;

      const target = cluster.tiles[ny][nx];
      if (target.type === TileType.Floor) {
        newEntries.push([nkey, 'degrading']);
        updatedTiles.set(nkey, 'degrading'); // guard against duplicate spread
        break;
      } else if (target.type === TileType.Wall || target.type === TileType.Door) {
        const degradeChance = target.type === TileType.Wall ? 0.25 : 0.50;
        // Always show corruption overlay (visual cracking)
        intents.push(
          { kind: 'damage_tile', position: { x: nx, y: ny }, hazardType: 'corruption', stage: 0 },
          { kind: 'mark_tile_hazard', position: { x: nx, y: ny }, hazardType: 'corruption' },
        );

        if (random() < degradeChance) {
          const integrity = tileIntegrity(cluster, nx, ny);
          const newIntegrity = integrity - 1;
          if (newIntegrity <= 0) {
            intents.push({ kind: 'breach_tile', position: { x: nx, y: ny } });
            newEntries.push([nkey, 'degrading']);
            updatedTiles.set(nkey, 'degrading'); // guard against duplicate spread
          } else {
            intents.push({ kind: 'set_tile_props', position: { x: nx, y: ny }, props: { integrity: newIntegrity } });
          }
        }
        break;
      }
    }
  }

  for (const [key, stage] of newEntries) {
    updatedTiles.set(key, stage);
    const [cx, cy] = key.split(',').map(Number);
    intents.push(
      { kind: 'damage_tile', position: { x: cx, y: cy }, hazardType: 'corruption', stage: corruptionOverlayStage(stage) },
      { kind: 'mark_tile_hazard', position: { x: cx, y: cy }, hazardType: 'corruption' },
    );
  }

  intents.push({ kind: 'set_hazard_field', roomId: room.id, field: 'corruptionTiles', value: updatedTiles });

  // Sound propagation
  if (newEntries.length > 0) {
    const pRoom = playerRoom(state, cluster);
    if (pRoom) {
      const dist = roomDistance(cluster.doorAdjacency, pRoom.id, room.id);
      if (dist === 0) {
        intents.push({ kind: 'message', text: 'Data structures crack and fragment around you.', style: 'important' });
      } else if (dist === 1) {
        intents.push({ kind: 'message', text: 'You hear cracking through the walls.' });
      } else if (dist === 2) {
        intents.push({ kind: 'message', text: 'A faint crackling echoes from somewhere.' });
      }
    }
  }

  if (state.debugMode) {
    intents.push({ kind: 'message', text: `[DBG] Corruption room ${room.id}: ${updatedTiles.size} tiles, +${newEntries.length} new`, style: 'system' });
  }

  return intents;
}

// ── Trigger Trap ──

function updateTriggerTrap(state: GameState, cluster: Cluster, room: Room): Intent[] {
  const hz = room.hazardState!;
  if (hz.detonated || !hz.activated) return [];

  const newTicksRemaining = (hz.ticksRemaining ?? 0) - 1;
  const intents: Intent[] = [
    { kind: 'set_hazard_field', roomId: room.id, field: 'ticksRemaining', value: newTicksRemaining },
  ];

  // Sound at 5 ticks remaining
  if (newTicksRemaining === 5) {
    const pRoom = playerRoom(state, cluster);
    if (pRoom) {
      const dist = roomDistance(cluster.doorAdjacency, pRoom.id, room.id);
      if (dist <= 1) {
        intents.push({ kind: 'message', text: `Rapid ticking from ${dist === 0 ? 'this room' : 'nearby'}!`, style: 'hazard' });
      }
    }
  }

  // Detonation
  if (newTicksRemaining <= 0) {
    intents.push({ kind: 'set_hazard_field', roomId: room.id, field: 'detonated', value: true });
    const { x1, y1, x2, y2 } = roomInterior(room);

    // Scorch all floor tiles
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        if (cluster.tiles[y][x].type === TileType.Floor) {
          intents.push({ kind: 'damage_tile', position: { x, y }, hazardType: 'scorch' });
        }
      }
    }

    // Break all doors on room perimeter
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (x < 0 || x >= CLUSTER_WIDTH || y < 0 || y >= CLUSTER_HEIGHT) continue;
        if (cluster.tiles[y][x].type === TileType.Door) {
          intents.push(
            { kind: 'breach_tile', position: { x, y } },
            { kind: 'damage_tile', position: { x, y }, hazardType: 'scorch' },
            { kind: 'mark_tile_hazard', position: { x, y }, hazardType: 'scorch' },
          );
        }
      }
    }

    // Damage: player in room = 40-60, adjacent = 15-25
    const pRoom = playerRoom(state, cluster);
    if (pRoom) {
      const dist = roomDistance(cluster.doorAdjacency, pRoom.id, room.id);
      if (dist === 0) {
        intents.push(
          { kind: 'message', text: 'DETONATION! The data-bomb tears through the room!', style: 'hazard' },
          { kind: 'sound', id: 'explosion' },
          { kind: 'damage_player', amount: randInt(40, 60), source: 'trigger_trap' },
        );
      } else if (dist === 1) {
        intents.push(
          { kind: 'message', text: 'An explosion shakes the walls!', style: 'hazard' },
          { kind: 'damage_player', amount: randInt(15, 25), source: 'trigger_trap' },
        );
      } else if (dist <= 3) {
        intents.push({ kind: 'message', text: 'A distant explosion rumbles through the structure.' });
      }
    }
  }

  if (state.debugMode) {
    intents.push({ kind: 'message', text: `[DBG] Trap room ${room.id}: ${newTicksRemaining <= 0 ? 'DETONATED' : `ticks=${newTicksRemaining}`}`, style: 'system' });
  }

  return intents;
}

function onPlayerEnterTriggerTrap(_state: GameState, room: Room) {
  const hz = room.hazardState!;
  if (hz.activated || hz.detonated) return;
  hz.activated = true;
}

// ── Memory Leak ──

function updateMemoryLeak(state: GameState, cluster: Cluster, room: Room): Intent[] {
  const hz = room.hazardState!;
  let effectiveFloodLevel = hz.floodLevel ?? 0;
  const innerH = room.h - 2;
  const maxFlood = Math.max(0, innerH - 4);
  const intents: Intent[] = [];

  // Rise every 6 ticks — resolve immediately so door pressure sees updated state
  if (state.tick % 6 === 0 && effectiveFloodLevel < maxFlood) {
    effectiveFloodLevel += 1;
    const riseIntents: Intent[] = [
      { kind: 'set_hazard_field', roomId: room.id, field: 'floodLevel', value: effectiveFloodLevel },
    ];

    const { x1, y1, x2, y2 } = roomInterior(room);
    for (let row = 0; row < effectiveFloodLevel; row++) {
      const fy = y2 - row;
      if (fy < y1) break;
      for (let x = x1; x <= x2; x++) {
        if (cluster.tiles[fy][x].type === TileType.Floor) {
          riseIntents.push({ kind: 'damage_tile', position: { x, y: fy }, hazardType: 'flood', stage: row >= 2 ? 1 : 0 });
        }
      }
    }

    const pRoom = playerRoom(state, cluster);
    if (pRoom) {
      const dist = roomDistance(cluster.doorAdjacency, pRoom.id, room.id);
      if (dist === 0) {
        riseIntents.push({ kind: 'message', text: 'Data floods rise around your feet.', style: 'hazard' });
      } else if (dist === 1 && effectiveFloodLevel === 1) {
        riseIntents.push({ kind: 'message', text: 'You hear liquid data gurgling through the walls.' });
      }
    }

    // Resolve rise intents immediately so door pressure sees flood overlays
    resolveIntents(state, riseIntents);
  }

  // Flood pressure on doors — 30% chance per tick to breach
  if (effectiveFloodLevel > 0) {
    const { x1, y1, x2, y2 } = roomInterior(room);

    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (x < 0 || x >= CLUSTER_WIDTH || y < 0 || y >= CLUSTER_HEIGHT) continue;
        if (cluster.tiles[y][x].type !== TileType.Door) continue;

        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const adjacentToFlood = dirs.some(([dx, dy]) => {
          const ax = x + dx, ay = y + dy;
          return ax >= x1 && ax <= x2 && ay >= y1 && ay <= y2 &&
            cluster.tiles[ay]?.[ax]?.hazardOverlay?.type === 'flood';
        });

        if (adjacentToFlood && random() < 0.30) {
          intents.push(
            { kind: 'breach_tile', position: { x, y } },
            { kind: 'damage_tile', position: { x, y }, hazardType: 'flood', stage: 0 },
            { kind: 'mark_tile_hazard', position: { x, y }, hazardType: 'flood' },
            { kind: 'message', text: 'A door bursts open under flood pressure!', style: 'hazard' },
          );
        }
      }
    }
  }

  if (state.debugMode) {
    intents.push({ kind: 'message', text: `[DBG] Leak room ${room.id}: flood=${effectiveFloodLevel}/${maxFlood}`, style: 'system' });
  }

  return intents;
}

// ── Firewall Checkpoint ──

const FW_ENTER_MSG: Record<string, string> = {
  pingpong: 'Scan beams sweep back and forth.',
  wipe:     'A full-room sweep — wait for the gap!',
  inward:   'Scan rings close in from the walls.',
  cross:    'Perpendicular scan beams cross the room.',
  spiral:   'A spiral scan traces through the room.',
};


function updateFirewall(state: GameState, cluster: Cluster, room: Room): Intent[] {
  const hz = room.hazardState!;
  const { x1, y1, x2, y2 } = roomInterior(room);
  const pattern = hz.firewallPattern ?? 'pingpong';
  const intents: Intent[] = [];

  // Each pattern controls its own tick gating
  const active: { x: number; y: number }[] = [];

  // Clone beams for mutation-via-intent
  const beams = hz.beams ? hz.beams.map((b: any) => ({ ...b })) : [];
  let newStep = hz.firewallStep ?? 0;

  switch (pattern) {
    case 'pingpong':
    case 'cross': {
      if (state.tick % 2 !== 0) break;
      for (const beam of beams) {
        beam.position += beam.direction;
        if (beam.position >= beam.max) { beam.position = beam.max; beam.direction = -1; }
        if (beam.position <= beam.min) { beam.position = beam.min; beam.direction =  1; }
        if (beam.axis === 'horizontal') {
          for (let x = x1; x <= x2; x++) active.push({ x, y: beam.position });
        } else {
          for (let y = y1; y <= y2; y++) active.push({ x: beam.position, y });
        }
      }
      intents.push({ kind: 'set_hazard_field', roomId: room.id, field: 'beams', value: beams });
      break;
    }

    case 'wipe': {
      if (state.tick % 2 !== 0) break;
      const axis = hz.firewallAxis ?? 'horizontal';
      const size  = axis === 'horizontal' ? (y2 - y1 + 1) : (x2 - x1 + 1);
      const cycle = size + 4;
      const step  = hz.firewallStep ?? 0;
      newStep = (step + 1) % cycle;

      if (step < size) {
        if (axis === 'horizontal') {
          for (let x = x1; x <= x2; x++) active.push({ x, y: y1 + step });
        } else {
          for (let y = y1; y <= y2; y++) active.push({ x: x1 + step, y });
        }
      }
      intents.push({ kind: 'set_hazard_field', roomId: room.id, field: 'firewallStep', value: newStep });
      break;
    }

    case 'inward': {
      if (state.tick % 3 !== 0) break;
      const maxInset = Math.floor(Math.min(x2 - x1, y2 - y1) / 2);
      const cycle  = Math.max(1, maxInset * 2);
      const pos    = (hz.firewallStep ?? 0) % cycle;
      const inset  = pos <= maxInset ? pos : cycle - pos;
      newStep = ((hz.firewallStep ?? 0) + 1) % cycle;

      const rx1 = x1 + inset, ry1 = y1 + inset;
      const rx2 = x2 - inset, ry2 = y2 - inset;
      if (rx1 <= rx2 && ry1 <= ry2) {
        for (let x = rx1; x <= rx2; x++) { active.push({ x, y: ry1 }); if (ry2 > ry1) active.push({ x, y: ry2 }); }
        for (let y = ry1 + 1; y < ry2; y++) { active.push({ x: rx1, y }); if (rx2 > rx1) active.push({ x: rx2, y }); }
      }
      intents.push({ kind: 'set_hazard_field', roomId: room.id, field: 'firewallStep', value: newStep });
      break;
    }

    case 'spiral': {
      if (state.tick % 2 !== 0) break;
      const path = hz.firewallPath;
      if (!path || path.length === 0) break;
      const step = hz.firewallStep ?? 0;
      const band = Math.max(3, Math.floor(path.length / 6));
      for (let i = 0; i < band; i++) active.push(path[(step + i) % path.length]);
      newStep = (step + 1) % path.length;
      intents.push({ kind: 'set_hazard_field', roomId: room.id, field: 'firewallStep', value: newStep });
      break;
    }
  }

  // Clear old beam overlays and mark new ones
  intents.push({ kind: 'clear_overlays', region: { x1, y1, x2, y2 }, overlayType: 'beam' });
  for (const cell of active) {
    if (cluster.tiles[cell.y]?.[cell.x]?.type === TileType.Floor) {
      intents.push({ kind: 'damage_tile', position: cell, hazardType: 'beam' });
    }
  }

  // Charge accumulation: beam detects aggressive entity OR player with alert >= suspicious
  const currentCharge = hz.firewallCharge ?? 0;
  const maxCharge = hz.firewallMaxCharge ?? 3;
  const beamSet = new Set(active.map(c => `${c.x},${c.y}`));
  let detected = false;
  if (!state.invisibleMode && posInRoom(state.player.position, room)) {
    if (beamSet.has(`${state.player.position.x},${state.player.position.y}`)) {
      intents.push({ kind: 'message', text: '[FIREWALL SCAN]: Crew ego detected. Identity: [ERROR]', style: 'alert' });
      if (state.alertLevel >= ALERT_SUSPICIOUS) detected = true;
    }
  }
  for (const e of state.entities) {
    if (e.clusterId !== state.currentClusterId) continue;
    if (e.ai?.faction !== 'aggressive') continue;
    if (beamSet.has(`${e.position.x},${e.position.y}`)) { detected = true; break; }
  }
  if (detected) {
    const newCharge = currentCharge + 1;
    intents.push(
      { kind: 'set_hazard_field', roomId: room.id, field: 'firewallCharge', value: newCharge },
      { kind: 'message', text: `Firewall scanner charge: ${newCharge}/${maxCharge}`, style: 'alert' },
    );
    if (newCharge >= maxCharge) {
      intents.push(
        { kind: 'set_hazard_field', roomId: room.id, field: 'firewallCharge', value: 0 },
        { kind: 'set_hazard_field', roomId: room.id, field: 'firewallLastSpawnTick', value: state.tick },
      );
      // Spawn sentry in room (respect entity cap)
      const entityCap = 15 + cluster.id * 5;
      const currentCount = state.entities.filter(e => e.clusterId === cluster.id).length;
      const spawnPos = currentCount < entityCap ? findSpawnPosInRoom(state, cluster, room) : undefined;
      if (spawnPos) {
        intents.push(
          { kind: 'spawn_entity', entityKind: 'sentry', position: spawnPos, clusterId: cluster.id, overrides: { id: _nextSpawnId++ } },
          { kind: 'message', text: 'FIREWALL: Defensive sentry deployed.', style: 'alert' },
        );
      }
    }
  }

  if (state.debugMode) {
    intents.push({ kind: 'message', text: `[DBG] Firewall (${pattern}) room ${room.id}: step=${newStep} active=${active.length}`, style: 'system' });
  }

  return intents;
}

// ── Unstable Process ──

function updateUnstable(state: GameState, cluster: Cluster, room: Room): Intent[] {
  const hz = room.hazardState!;
  if (hz.coreDestroyed) return [];

  const { x1, y1, x2, y2 } = roomInterior(room);
  const intents: Intent[] = [];

  // Clear previous sparks
  if (hz.sparkedTiles) {
    for (const sp of hz.sparkedTiles) {
      intents.push({ kind: 'clear_tile_overlay', position: { x: sp.x, y: sp.y }, overlayType: 'spark' });
    }
  }

  const sparkCount = randInt(1, 3);
  const sparks: Position[] = [];
  for (let i = 0; i < sparkCount; i++) {
    const sx = randInt(x1, x2);
    const sy = randInt(y1, y2);
    if (hz.corePos && sx === hz.corePos.x && sy === hz.corePos.y) continue;
    if (cluster.tiles[sy][sx].type !== TileType.Floor) continue;
    sparks.push({ x: sx, y: sy });
    intents.push({ kind: 'damage_tile', position: { x: sx, y: sy }, hazardType: 'spark' });
  }
  intents.push({ kind: 'set_hazard_field', roomId: room.id, field: 'sparkedTiles', value: sparks });

  const pp = state.player.position;
  if (!state.invisibleMode && sparks.some(s => s.x === pp.x && s.y === pp.y)) {
    intents.push(
      { kind: 'message', text: 'Electric discharge surges through you!', style: 'hazard' },
      { kind: 'damage_player', amount: randInt(5, 10), source: 'unstable' },
      { kind: 'sound', id: 'hit' },
    );
  }

  return intents;
}

// ── Trigger Trap visual pulsing ──

function updateTriggerTrapVisuals(cluster: Cluster, room: Room, tick: number): Intent[] {
  const hz = room.hazardState!;
  if (!hz.activated || hz.detonated) return [];

  const remaining = hz.ticksRemaining ?? 0;
  const { x1, y1, x2, y2 } = roomInterior(room);
  const intents: Intent[] = [];

  let pulseRate: number;
  if (remaining > 10) pulseRate = 8;
  else if (remaining > 5) pulseRate = 4;
  else pulseRate = 2;

  const pulseOn = (tick % pulseRate) < (pulseRate / 2);

  if (pulseOn) {
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        if (cluster.tiles[y][x].type === TileType.Floor && !cluster.tiles[y][x].hazardOverlay) {
          intents.push({ kind: 'damage_tile', position: { x, y }, hazardType: 'scorch', stage: remaining <= 5 ? 2 : 1 });
        }
      }
    }
  } else {
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        const overlay = cluster.tiles[y][x].hazardOverlay;
        if (overlay?.type === 'scorch' && (overlay.stage === 1 || overlay.stage === 2)) {
          intents.push({ kind: 'clear_tile_overlay', position: { x, y }, overlayType: 'scorch' });
        }
      }
    }
  }

  return intents;
}

// ── Echo Chamber ──

const ECHO_GLITCH_CHARS = ['░', '▒', '▓', '█', '┃', '⌇', '¦'];

function updateEchoChamber(state: GameState, cluster: Cluster, room: Room): Intent[] {
  const hz = room.hazardState!;
  const px = state.player.position.x;
  const py = state.player.position.y;
  const playerInRoom = px >= room.x && px < room.x + room.w &&
                       py >= room.y && py < room.y + room.h;
  const intents: Intent[] = [];

  // Update echo trail — record player position if inside room
  if (!hz.echoTrail) hz.echoTrail = [];
  if (playerInRoom) {
    const last = hz.echoTrail[0];
    if (!last || last.x !== px || last.y !== py) {
      const newTrail = [{ x: px, y: py }, ...hz.echoTrail].slice(0, 4);
      intents.push({ kind: 'set_hazard_field', roomId: room.id, field: 'echoTrail', value: newTrail });
    }
  }

  // Update wall glitches — restore expired, spawn new
  if (!hz.wallGlitches) hz.wallGlitches = [];

  const surviving: typeof hz.wallGlitches = [];
  for (const wg of hz.wallGlitches) {
    const newTicksLeft = wg.ticksLeft - 1;
    if (newTicksLeft <= 0) {
      // Restore original wall glyph
      const tile = cluster.tiles[wg.y]?.[wg.x];
      if (tile && tile.type === TileType.Wall) {
        intents.push({ kind: 'set_tile_props', position: { x: wg.x, y: wg.y }, props: { glyph: wg.origGlyph, fg: COLORS.wall } });
      }
    } else {
      surviving.push({ ...wg, ticksLeft: newTicksLeft });
    }
  }

  // Spawn new wall glitches (1-2 per tick, ~40% chance each)
  const newGlitches = [...surviving];
  if (random() < 0.4) {
    const { x1, y1, x2, y2 } = roomInterior(room);
    const wallTiles: { x: number; y: number }[] = [];
    const glitchKeys = new Set(newGlitches.map(g => `${g.x},${g.y}`));
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (x > x1 && x < x2 && y > y1 && y < y2) continue;
        const tile = cluster.tiles[y]?.[x];
        if (tile?.type === TileType.Wall && !glitchKeys.has(`${x},${y}`)) {
          wallTiles.push({ x, y });
        }
      }
    }
    if (wallTiles.length > 0) {
      const count = randInt(1, Math.min(2, wallTiles.length));
      for (let i = 0; i < count; i++) {
        const idx = Math.floor(random() * wallTiles.length);
        const wt = wallTiles.splice(idx, 1)[0];
        const tile = cluster.tiles[wt.y][wt.x];
        const glyphChar = ECHO_GLITCH_CHARS[Math.floor(random() * ECHO_GLITCH_CHARS.length)];
        newGlitches.push({
          x: wt.x, y: wt.y,
          origGlyph: tile.glyph,
          ticksLeft: randInt(1, 3),
        });
        intents.push({ kind: 'set_tile_props', position: { x: wt.x, y: wt.y }, props: { glyph: glyphChar, fg: '#335544' } });
      }
    }
  }

  intents.push({ kind: 'set_hazard_field', roomId: room.id, field: 'wallGlitches', value: newGlitches });

  return intents;
}

// ── Gravity Well ──

function updateGravityWell(state: GameState, cluster: Cluster, room: Room): Intent[] {
  const hz = room.hazardState!;
  if (!hz.singularityPos) return [];

  const interval = hz.pullInterval ?? 3;
  if (state.tick - (hz.lastPullTick ?? 0) < interval) return [];

  const intents: Intent[] = [
    { kind: 'set_hazard_field', roomId: room.id, field: 'lastPullTick', value: state.tick },
  ];

  // Pull player if in room (invisible mode: player doesn't exist on map)
  if (!state.invisibleMode && posInRoom(state.player.position, room)) {
    const pp = state.player.position;
    const sp = hz.singularityPos;

    // Calculate pull direction (1 tile toward singularity)
    let dx = 0, dy = 0;
    if (pp.x < sp.x) dx = 1;
    else if (pp.x > sp.x) dx = -1;
    if (pp.y < sp.y) dy = 1;
    else if (pp.y > sp.y) dy = -1;

    // Only pull one axis at a time (prefer the longer distance)
    if (Math.abs(pp.x - sp.x) >= Math.abs(pp.y - sp.y)) {
      dy = 0;
    } else {
      dx = 0;
    }

    if (dx !== 0 || dy !== 0) {
      const nx = pp.x + dx;
      const ny = pp.y + dy;
      if (cluster.tiles[ny]?.[nx]?.walkable) {
        intents.push(
          { kind: 'move_player', to: { x: nx, y: ny } },
          { kind: 'message', text: 'The gravity well pulls you inward!', style: 'hazard' },
        );
      }
    }

    // Damage on singularity
    if (pp.x === sp.x && pp.y === sp.y) {
      intents.push(
        { kind: 'message', text: 'The singularity tears at your coherence!', style: 'hazard' },
        { kind: 'damage_player', amount: randInt(8, 15), source: 'gravity_well' },
        { kind: 'sound', id: 'hit' },
      );
    }
  }

  return intents;
}

// ── Entity spawning helpers ──

const GLITCH_FLOOR_CHARS = '░▒▓▄▀◌◍◎';
const GLITCH_WALL_CHARS = '╬╫╪▣▤▥▦▧▨▩';
const GLITCH_COLORS = ['#cc4422', '#aa2244', '#cc6600', '#886622', '#aa4400'];
let _nextSpawnId = 10000; // avoid collisions with game.ts entity IDs

/** Find a walkable, unoccupied position inside a room for spawning. */
function findSpawnPosInRoom(state: GameState, cluster: Cluster, room: Room): Position | undefined {
  const { x1, y1, x2, y2 } = roomInterior(room);
  const candidates: { x: number; y: number }[] = [];
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      const t = cluster.tiles[y]?.[x];
      if (!t || !t.walkable) continue;
      const occupied = state.player.position.x === x && state.player.position.y === y && state.player.clusterId === cluster.id;
      const hasEntity = state.entities.some(e => e.clusterId === cluster.id && e.position.x === x && e.position.y === y);
      if (!occupied && !hasEntity) candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) return undefined;
  return candidates[Math.floor(random() * candidates.length)];
}

function spawnEntityInRoom(state: GameState, cluster: Cluster, room: Room, kind: 'sentry' | 'bit_mite' | 'gate_keeper') {
  // Soft cap: don't flood the cluster beyond a depth-scaled limit
  const entityCap = 15 + cluster.id * 5; // cluster 2→25, cluster 5→40
  const currentCount = state.entities.filter(e => e.clusterId === cluster.id).length;
  if (currentCount >= entityCap) return;

  const pos = findSpawnPosInRoom(state, cluster, room);
  if (!pos) return;
  const entity = makeEntity(kind, pos, cluster.id);
  entity.id = _nextSpawnId++;
  state.entities.push(entity);
}

/** Collapse-driven ambient visual glitch and entity spawning. */
function updateCollapseEffects(state: GameState, cluster: Cluster) {
  const tick = state.tick;
  for (const room of cluster.rooms) {
    if (room.collapse <= 0) continue;

    // collapse > 0: periodically glitch a random visible floor tile (visual artifact)
    if (tick % 8 === (room.id % 8) && random() < 0.3 * room.collapse) {
      const { x1, y1, x2, y2 } = roomInterior(room);
      const floorTiles: { x: number; y: number }[] = [];
      for (let y = y1; y <= y2; y++) {
        for (let x = x1; x <= x2; x++) {
          const t = cluster.tiles[y]?.[x];
          if (t?.type === TileType.Floor && t.visible) floorTiles.push({ x, y });
        }
      }
      if (floorTiles.length > 0) {
        const { x, y } = floorTiles[Math.floor(random() * floorTiles.length)];
        const glyph = GLITCH_FLOOR_CHARS[Math.floor(random() * GLITCH_FLOOR_CHARS.length)];
        const fg = GLITCH_COLORS[Math.floor(random() * GLITCH_COLORS.length)];
        state.collapseGlitchTiles.set(`${x},${y}`, { glyph, fg, expireTick: tick + 2 });
      }
    }

    // collapse > 0.2: periodically glitch a visible wall tile
    if (room.collapse > 0.2 && tick % 12 === (room.id % 12) && random() < 0.2) {
      const wallTiles: { x: number; y: number }[] = [];
      for (let y = room.y; y < room.y + room.h; y++) {
        for (let x = room.x; x < room.x + room.w; x++) {
          const t = cluster.tiles[y]?.[x];
          if (t?.type === TileType.Wall && t.visible) wallTiles.push({ x, y });
        }
      }
      if (wallTiles.length > 0) {
        const { x, y } = wallTiles[Math.floor(random() * wallTiles.length)];
        const glyph = GLITCH_WALL_CHARS[Math.floor(random() * GLITCH_WALL_CHARS.length)];
        const fg = GLITCH_COLORS[Math.floor(random() * GLITCH_COLORS.length)];
        state.collapseGlitchTiles.set(`${x},${y}`, { glyph, fg, expireTick: tick + randInt(3, 5) });
      }
    }

    // collapse > 0.4: periodic enemy spawning; Gate-Keeper appears in very high-collapse rooms
    // Skip entity spawning in starter clusters (0 and 1 are enemy-free)
    if (room.collapse > 0.4 && tick > 0 && cluster.id >= 2) {
      // Bit-Mite: every 60-80 ticks (down from 20-30 — spawning was too aggressive)
      const miteInterval = room.collapse > 0.7 ? 60 : 80;
      if (tick % miteInterval === (room.id % miteInterval)) spawnEntityInRoom(state, cluster, room, 'bit_mite');
      // Sentry: every 100 ticks
      if (tick % 100 === (room.id % 100)) spawnEntityInRoom(state, cluster, room, 'sentry');
      // Gate-Keeper: every 120 ticks in very high-collapse rooms; at most one per room
      if (room.collapse > 0.7 && tick % 120 === (room.id % 120)) {
        const alreadyHasKeeper = state.entities.some(
          e => e.clusterId === cluster.id && e.ai?.kind === 'gate_keeper' &&
          e.position.x >= room.x && e.position.x < room.x + room.w &&
          e.position.y >= room.y && e.position.y < room.y + room.h
        );
        if (!alreadyHasKeeper) spawnEntityInRoom(state, cluster, room, 'gate_keeper');
      }
    }
  }
}

// ── Room scenario updates ──

function updateRoomScenarios(state: GameState, cluster: Cluster) {
  const tick = state.tick;

  for (const room of cluster.rooms) {
    if (!room.scenario) continue;

    const playerInRoom = posInRoom(state.player.position, room);

    switch (room.scenario) {
      case 'stuck_echo': {
        // Broadcast screaming messages periodically (even if player isn't in this room)
        const echo = cluster.interactables.find(
          i => i.roomId === room.id && i.broadcastLines && i.broadcastLines.length > 0
        );
        if (!echo) break;
        const period = echo.broadcastPeriod ?? 10;
        const lastTick = echo.lastBroadcastTick ?? -period;
        if (tick - lastTick >= period) {
          const idx = Math.floor(random() * echo.broadcastLines!.length);
          addMessage(state, echo.broadcastLines![idx], 'hazard');
          echo.lastBroadcastTick = tick;
          echo.broadcastPeriod = randInt(8, 13);
        }
        break;
      }

      case 'spooky_astronauts': {
        room.scenarioState ??= {};
        const ss = room.scenarioState;
        if (ss.triggered) break;

        if (!playerInRoom) {
          ss.playerEnteredAtTick = undefined; // reset timer when player leaves
          break;
        }

        ss.playerEnteredAtTick ??= tick;
        const ticksInRoom = tick - ss.playerEnteredAtTick;

        if (ticksInRoom === 5) {
          addMessage(state, 'alert.m: HOSTILES DETECTED — motion signatures detected.', 'alert');
          addMessage(state, 'alert.m: Multiple contacts. Sector compromised.', 'alert');
          state.pendingGlitch = 'chromatic';
        } else if (ticksInRoom === 6) {
          // Glitch out the spacesuit props
          const glitchGlyphs = ['╫', '╪', '▣', '╬', '╳'];
          for (const entity of state.entities) {
            if (entity.clusterId !== cluster.id) continue;
            if (entity.propTag !== 'spacesuit') continue;
            if (!posInRoom(entity.position, room)) continue;
            state.collapseGlitchTiles.set(`${entity.position.x},${entity.position.y}`, {
              glyph: glitchGlyphs[Math.floor(random() * glitchGlyphs.length)],
              fg: '#cc4444',
              expireTick: tick + 4,
            });
          }
          ss.triggered = true;
        }
        break;
      }

      case 'broken_sleever': {
        if (!playerInRoom) break;

        // Find the sleever device entity in this room
        const device = state.entities.find(
          e => e.clusterId === cluster.id && e.propTag === 'sleever_device' && posInRoom(e.position, room)
        );
        if (!device) break;

        // Animation tile: 1 tile below the device (or above if bottom row)
        const animX = device.position.x;
        const animY = device.position.y + 1;
        const animTile = cluster.tiles[animY]?.[animX];
        if (!animTile?.walkable) break;

        const phase = tick % 7;
        const key = `${animX},${animY}`;

        if (phase === 0) {
          state.collapseGlitchTiles.set(key, { glyph: '·', fg: '#555566', expireTick: tick + 2 });
        } else if (phase === 1) {
          state.collapseGlitchTiles.set(key, { glyph: '░', fg: '#7777aa', expireTick: tick + 2 });
        } else if (phase === 2) {
          state.collapseGlitchTiles.set(key, { glyph: '▒', fg: '#9999cc', expireTick: tick + 2 });
        } else if (phase === 3) {
          state.collapseGlitchTiles.set(key, { glyph: '@', fg: '#aaaadd', expireTick: tick + 2 });
          if (animTile.visible) {
            room.scenarioState ??= {};
            const last = room.scenarioState.lastMessageTick ?? -99;
            if (tick - last >= 7) {
              addMessage(state, '...infomorph template detected. Upload cycle failed.', 'system');
              room.scenarioState.lastMessageTick = tick;
            }
          }
        } else if (phase === 4) {
          state.collapseGlitchTiles.set(key, { glyph: '╳', fg: '#cc6644', expireTick: tick + 2 });
        }
        // phases 5-6: no overlay — tile returns to normal as key expires
        break;
      }

      case 'whispering_wall':
      case 'lost_expedition': {
        // Broadcast echoes in these rooms periodically (same mechanism as stuck_echo)
        for (const echo of cluster.interactables) {
          if (echo.roomId !== room.id || !echo.broadcastLines?.length) continue;
          const period = echo.broadcastPeriod ?? 12;
          const lastTick = echo.lastBroadcastTick ?? -period;
          if (tick - lastTick >= period) {
            if (echo.position && cluster.tiles[echo.position.y]?.[echo.position.x]?.visible) {
              const idx = Math.floor(random() * echo.broadcastLines.length);
              addMessage(state, echo.broadcastLines[idx], 'system');
            }
            echo.lastBroadcastTick = tick;
            echo.broadcastPeriod = randInt(10, 18);
          }
        }
        break;
      }

      case 'corruption_ritual': {
        room.scenarioState ??= {};
        const ss = room.scenarioState as Record<string, unknown>;
        if (!ss.triggered) break;

        // Broadcast ritual echo messages
        for (const echo of cluster.interactables) {
          if (echo.roomId !== room.id || !echo.broadcastLines?.length) continue;
          const period = echo.broadcastPeriod ?? 7;
          const lastTick = echo.lastBroadcastTick ?? -period;
          if (tick - lastTick >= period) {
            const idx = Math.floor(random() * echo.broadcastLines.length);
            addMessage(state, echo.broadcastLines[idx], 'hazard');
            echo.lastBroadcastTick = tick;
            echo.broadcastPeriod = randInt(5, 9);
          }
        }

        const enteredAt = room.scenarioState.playerEnteredAtTick ?? 0;
        const outcome = ss.ritualOutcome as string;
        const dt = tick - enteredAt;

        if (outcome === 'mite_burst' && dt === 1) {
          // Echoes dissolve into corrupted mite fragments
          for (const ia of cluster.interactables) {
            if (ia.roomId === room.id && ia.kind === 'lost_echo') {
              ia.echoFadeAtTime = -300; // negative = unstamped delay
            }
          }
          addMessage(state, 'The ritual echoes destabilize — fragments erupt!', 'hazard');
          state.pendingGlitch = 'static';
          ss.ritualOutcome = 'done';
        } else if (outcome === 'gk_corrupts' && dt === 1) {
          const gk = state.entities.find(
            e => e.clusterId === cluster.id && e.ai?.kind === 'gate_keeper' && posInRoom(e.position, room),
          );
          if (gk) {
            gk.fg = '#cc4444';
            gk.ai!.faction = 'aggressive';
            addMessage(state, 'The Gate-Keeper convulses — CORRUPTION PROTOCOL ENGAGED.', 'hazard');
            state.pendingGlitch = 'chromatic';
          }
          ss.ritualOutcome = 'done';
        } else if (outcome === 'gk_dies' && dt === 2) {
          // Destroy echoes
          for (const ia of cluster.interactables) {
            if (ia.roomId === room.id && ia.kind === 'lost_echo') {
              ia.echoFadeAtTime = -1; // negative = unstamped, immediate fade
            }
          }
          // Remove GateKeeper
          const gk = state.entities.find(
            e => e.clusterId === cluster.id && e.ai?.kind === 'gate_keeper' && posInRoom(e.position, room),
          );
          if (gk) {
            state.smokeEffects.push({ x: gk.position.x, y: gk.position.y, fg: '#23d2a6', spawnTime: 0 });
            state.entities = state.entities.filter(e => e.id !== gk.id);
            addMessage(state, 'The Gate-Keeper collapses. The ritual consumes itself.', 'hazard');
            state.pendingGlitch = 'tear';
          }
          ss.ritualOutcome = 'done';
        }
        break;
      }
    }
  }
}

// ── Main update ──

export function updateHazards(state: GameState) {
  const cluster = state.clusters.get(state.currentClusterId);
  if (!cluster) return;

  updateCollapseEffects(state, cluster);
  updateRoomScenarios(state, cluster);

  for (const room of cluster.rooms) {
    if (room.roomType === 'normal' || !room.hazardState) continue;

    let intents: Intent[] = [];

    switch (room.roomType) {
      case 'corrupted':
        intents = updateCorruption(state, cluster, room);
        break;
      case 'trigger_trap': {
        const trapIntents = updateTriggerTrap(state, cluster, room);
        resolveIntents(state, trapIntents);
        intents = updateTriggerTrapVisuals(cluster, room, state.tick);
        break;
      }
      case 'memory_leak':
        intents = updateMemoryLeak(state, cluster, room);
        break;
      case 'firewall':
        intents = updateFirewall(state, cluster, room);
        break;
      case 'unstable':
        intents = updateUnstable(state, cluster, room);
        break;
      case 'echo_chamber':
        intents = updateEchoChamber(state, cluster, room);
        break;
      case 'gravity_well':
        intents = updateGravityWell(state, cluster, room);
        break;
    }

    if (intents.length > 0) {
      resolveIntents(state, intents);
    }
  }
}

/** Called when player moves to a new room */
// ── Micro-events (clusters 2+, once per room) ──

const MICRO_EVENT_CHANCE = 0.25; // 25% chance per room entry

function tryFireMicroEvent(state: GameState, cluster: Cluster, room: Room) {
  if (cluster.id < 2) return;
  room.scenarioState ??= {};
  if (room.scenarioState.microEventFired) return;
  if (random() > MICRO_EVENT_CHANCE) return;

  room.scenarioState.microEventFired = true;

  const events = [
    'door_slam', 'log_spam', 'light_flicker', 'entity_despawn',
    'false_radar', 'hud_glitch', 'map_distortion', 'distant_scream',
    'entity_teleport', 'footsteps',
  ];
  const pick = events[Math.floor(random() * events.length)];

  if (state.debugMode) {
    addMessage(state, `[DEBUG] Micro-event: ${pick} (room ${room.id})`, 'system');
  }

  switch (pick) {
    case 'door_slam': {
      // Close a random open door in or adjacent to the room
      for (let y = room.y; y < room.y + room.h; y++) {
        for (let x = room.x; x < room.x + room.w; x++) {
          const tile = cluster.tiles[y]?.[x];
          if (tile?.type === TileType.Door && tile.doorOpen) {
            tile.doorOpen = false;
            tile.walkable = false;
            tile.transparent = false;
            tile.glyph = tile.sealed ? '▪' : '+';
            addMessage(state, 'A door slams shut nearby.', 'system');
            return;
          }
        }
      }
      // Fallback: just a message
      addMessage(state, 'You hear a distant door slam.', 'system');
      break;
    }
    case 'log_spam': {
      const spamLines = [
        '...PROCESS OVERFLOW — STACK CORRUPTED...',
        '>>>ERR: MEMORY ADDR 0x7FFF OUT OF RANGE<<<',
        '...unauthorized read attempt blocked...',
        'WARN: ego-boundary integrity check FAILED',
        '...fragment detected in sector [REDACTED]...',
      ];
      const count = randInt(3, 5);
      for (let i = 0; i < count; i++) {
        addMessage(state, spamLines[Math.floor(random() * spamLines.length)], 'system');
      }
      break;
    }
    case 'light_flicker':
      state.pendingGlitch = 'flicker';
      break;
    case 'entity_despawn': {
      const roomEntities = state.entities.filter(
        e => e.clusterId === cluster.id && e.id !== state.player.id && posInRoom(e.position, room)
      );
      if (roomEntities.length > 0) {
        const target = roomEntities[Math.floor(random() * roomEntities.length)];
        target.coherence = 0;
        addMessage(state, `${target.name} destabilises and vanishes.`, 'system');
        state.smokeEffects.push({
          x: target.position.x, y: target.position.y,
          fg: '#aaaa66', spawnTime: 0, // stamped by presentation layer
        });
      }
      break;
    }
    case 'false_radar':
      addMessage(state, 'alert.m: THREAT DETECTED — motion signature in adjacent sector.', 'alert');
      addMessage(state, 'alert.m: ...signal lost. Possible false positive.', 'alert');
      break;
    case 'hud_glitch':
      state.pendingGlitch = 'shake';
      break;
    case 'map_distortion':
      state.pendingGlitch = 'tear';
      break;
    case 'distant_scream': {
      const screams = [
        '...a distorted cry echoes through the simulspace.',
        'Something screams in a register you cannot parse.',
        'A sound like tearing data echoes from deeper in the ship.',
        '...a voice, already fading: "—not like this—"',
      ];
      addMessage(state, screams[Math.floor(random() * screams.length)], 'hazard');
      break;
    }
    case 'entity_teleport': {
      const roomEntities = state.entities.filter(
        e => e.clusterId === cluster.id && e.id !== state.player.id && posInRoom(e.position, room)
      );
      if (roomEntities.length > 0) {
        const target = roomEntities[Math.floor(random() * roomEntities.length)];
        // Find a random walkable tile in the room
        const { x1, y1, x2, y2 } = roomInterior(room);
        for (let attempt = 0; attempt < 20; attempt++) {
          const nx = randInt(x1, x2);
          const ny = randInt(y1, y2);
          const tile = cluster.tiles[ny]?.[nx];
          if (tile?.walkable && !(nx === state.player.position.x && ny === state.player.position.y)) {
            target.position = { x: nx, y: ny };
            addMessage(state, `${target.name} flickers and relocates.`, 'system');
            break;
          }
        }
      }
      break;
    }
    case 'footsteps':
      addMessage(state, 'Something moves nearby...', 'system');
      break;
  }
}

export function onPlayerEnterRoom(state: GameState, room: Room) {
  if (state.invisibleMode) return; // player doesn't trigger room events

  // Micro-events (ambient dread, clusters 2+)
  const cluster = state.clusters.get(state.currentClusterId);
  if (cluster) tryFireMicroEvent(state, cluster, room);

  // Hazard-type entry hooks
  switch (room.roomType) {
    case 'trigger_trap':
      onPlayerEnterTriggerTrap(state, room);
      break;
    case 'firewall': {
      const pattern = room.hazardState?.firewallPattern ?? 'pingpong';
      addMessage(state, FW_ENTER_MSG[pattern] ?? 'Firewall scan active.', 'hazard');
      break;
    }
    case 'echo_chamber':
      addMessage(state, 'Residual process echoes shimmer around you...', 'system');
      state.pendingGlitch = 'static';
      break;
    case 'gravity_well':
      addMessage(state, 'You feel a gravitational pull toward the center...', 'hazard');
      break;
  }

  // Scenario entry hooks
  if (room.scenario === 'silent_alarm' && !room.scenarioState?.triggered) {
    room.scenarioState ??= {};
    room.scenarioState.triggered = true;
    addMessage(state, '[ALERT] Unauthorized access detected. Security protocol engaged.', 'alert');
    addMessage(state, '...signal lost. False positive logged.', 'system');
    state.pendingGlitch = 'chromatic';
  }

  if (room.scenario === 'corruption_ritual') {
    room.scenarioState ??= {};
    if (!room.scenarioState.triggered) {
      room.scenarioState.triggered = true;
      room.scenarioState.playerEnteredAtTick = state.tick;
      const outcome = (room.scenarioState as Record<string, unknown>).ritualOutcome as string;
      if (outcome === 'static') {
        addMessage(state, 'The Gate-Keeper holds vigil. The echoes chant in corrupted loops.', 'hazard');
      } else {
        addMessage(state, 'Something stirs as you enter. The ritual responds to your presence.', 'hazard');
        state.pendingGlitch = 'chromatic';
      }
    }
  }
}

/** Check which room player is in and return it */
export function getPlayerRoom(state: GameState): Room | undefined {
  const cluster = state.clusters.get(state.currentClusterId);
  if (!cluster) return undefined;
  return playerRoom(state, cluster);
}

/** Pure damage lookup for a hazard overlay (no state mutation). */
export function tileHazardDamage(overlay: { type: string; stage?: number } | undefined): number {
  if (!overlay) return 0;
  switch (overlay.type) {
    case 'corruption':
      if (overlay.stage === 0) return 3;   // degrading
      if (overlay.stage === 1) return 7;   // corrupted
      if (overlay.stage === 2) return 12;  // collapsed
      return 15;                           // dissolved
    case 'flood':
      if (overlay.stage === 0) return 1;
      return 2;
    case 'gravity':
      if (overlay.stage === 2) return 5;
      return 0;
    default:
      return 0;
  }
}

/** Apply per-tile hazard damage for standing on hazard tiles */
export function applyTileHazardToPlayer(state: GameState) {
  if (state.invisibleMode) return; // player doesn't exist on the map
  const cluster = state.clusters.get(state.currentClusterId);
  if (!cluster) return;

  const { x, y } = state.player.position;
  const dmg = tileHazardDamage(cluster.tiles[y]?.[x]?.hazardOverlay);
  if (dmg > 0 && !state.godMode && state.player.coherence != null) {
    state.player.coherence = Math.max(0, state.player.coherence - dmg);
    state.pendingSounds.push('hit');
  }
}

// ── Alert flood-fill ──

const ALERT_FILL_BUDGET = 15;
const ALERT_THROTTLE_TICKS = 10;

/** Get traversal cost for a tile. Returns Infinity for impassable. */
function tileWeight(tile: { type: TileType; doorOpen?: boolean }): number {
  switch (tile.type) {
    case TileType.Void: return Infinity;
    case TileType.Wall: return 10;
    case TileType.Door: return tile.doorOpen ? 2 : 5;
    case TileType.Floor:
    case TileType.InterfaceExit:
      return 1;
    default: return 1;
  }
}

/** Describe a threat tile for alert messages */
function describeTileThreat(tile: { hazardOverlay?: { type: string } }, room: Room | undefined): string {
  const parts: string[] = [];
  if (tile.hazardOverlay) parts.push(tile.hazardOverlay.type);
  if (room && room.roomType !== 'normal' && room.roomType !== 'echo_chamber') {
    if (!parts.includes(room.roomType)) parts.push(room.roomType);
  }
  return parts.join(', ') || 'unknown';
}

/** Check if a room has an active native hazard */
function isRoomDangerous(room: Room): boolean {
  if (room.containedHazards.size > 0) return true;
  if (room.roomType === 'normal' || room.roomType === 'echo_chamber') return false;
  const hz = room.hazardState;
  if (!hz) return false;
  switch (room.roomType) {
    case 'trigger_trap': return !hz.detonated;
    case 'corrupted': return !!(hz.corruptionTiles && hz.corruptionTiles.size > 0);
    case 'memory_leak': return (hz.floodLevel ?? 0) > 0;
    case 'firewall': return false; // danger detected via containedHazards when beam overlays are active
    case 'unstable': return !hz.coreDestroyed;
    case 'gravity_well': return true;
    case 'quarantine': return !!hz.locked;
    default: return false;
  }
}

/** Dijkstra flood-fill from player position with weighted tile costs */
function alertFloodFill(
  state: GameState,
  cluster: Cluster,
  origin: Position,
  budget: number,
): { filled: Map<string, number>; threats: { x: number; y: number; desc: string; source: 'hazard' | 'entity' }[] } {
  const filled = new Map<string, number>();
  const threats: { x: number; y: number; desc: string; source: 'hazard' | 'entity' }[] = [];
  const key = (x: number, y: number) => `${x},${y}`;

  // Simple priority queue via sorted array (map is small: 50x30)
  const open: { x: number; y: number; cost: number }[] = [];
  const push = (x: number, y: number, cost: number) => {
    // Binary insert by cost
    let lo = 0, hi = open.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (open[mid].cost < cost) lo = mid + 1; else hi = mid;
    }
    open.splice(lo, 0, { x, y, cost });
  };

  // Start at player position with cost 0
  const k0 = key(origin.x, origin.y);
  filled.set(k0, 0);
  push(origin.x, origin.y, 0);

  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  while (open.length > 0) {
    const { x, y, cost } = open.shift()!;
    const k = key(x, y);

    // Skip if we already found a cheaper path
    if ((filled.get(k) ?? Infinity) < cost) continue;

    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= cluster.width || ny < 0 || ny >= cluster.height) continue;

      const tile = cluster.tiles[ny][nx];
      const w = tileWeight(tile);
      if (w === Infinity) continue;

      const newCost = cost + w;
      if (newCost > budget) continue;

      const nk = key(nx, ny);
      const existing = filled.get(nk);
      if (existing !== undefined && existing <= newCost) continue;

      filled.set(nk, newCost);
      push(nx, ny, newCost);
    }
  }

  // Scan filled tiles for threats
  const seenThreats = new Set<string>(); // dedupe by description
  for (const [k, _cost] of filled) {
    const [xs, ys] = k.split(',');
    const x = Number(xs), y = Number(ys);
    if (x === origin.x && y === origin.y) continue; // skip player tile

    const tile = cluster.tiles[y][x];
    const rid = tile.roomId;
    const room = rid >= 0 ? cluster.rooms.find(r => r.id === rid) : undefined;

    let isThreat = false;

    // Check tile hazard overlay
    if (tile.hazardOverlay) {
      isThreat = true;
    }

    // Check if tile is in a dangerous room (only flag once per room)
    if (!isThreat && room && isRoomDangerous(room)) {
      const roomKey = `room:${rid}`;
      if (!seenThreats.has(roomKey)) {
        isThreat = true;
        seenThreats.add(roomKey);
      }
    }

    if (isThreat) {
      threats.push({ x, y, desc: describeTileThreat(tile, room), source: 'hazard' });
    }
  }

  // Scan for hostile entities within the filled area
  const hostileFactions = new Set<Faction>();
  for (const rel of Object.entries(FACTION_RELATIONS.player ?? {})) {
    if (rel[1] === 'attack') hostileFactions.add(rel[0] as Faction);
  }
  // Friendly faction becomes hostile at high alert
  if (state.alertLevel >= ALERT_ENEMY) hostileFactions.add('friendly');

  for (const entity of state.entities) {
    if (entity.clusterId !== cluster.id) continue;
    if (entity._pendingRemoval) continue;
    const faction = entity.ai?.faction;
    if (!faction || !hostileFactions.has(faction)) continue;
    const ek = key(entity.position.x, entity.position.y);
    if (!filled.has(ek)) continue;
    threats.push({
      x: entity.position.x, y: entity.position.y,
      desc: `hostile: ${entity.name}`,
      source: 'entity',
    });
  }

  return { filled, threats };
}

/** Update alert.m module detection state via weighted flood-fill */
export function updateAlertModule(state: GameState) {
  const alertMod = state.player.modules?.find(m => m.id === 'alert.m' && m.status === 'loaded');
  if (!alertMod) {
    state.alertFill = undefined;
    state.alertThreats = undefined;
    return;
  }

  const cluster = state.clusters.get(state.currentClusterId);
  if (!cluster) return;

  if (!alertMod.lastAlertTicks) alertMod.lastAlertTicks = new Map();

  const wasActive = alertMod.alertActive ?? false;
  const { filled, threats } = alertFloodFill(state, cluster, state.player.position, ALERT_FILL_BUDGET);

  // Store for debug overlay
  state.alertFill = filled;
  state.alertThreats = threats;

  const detected = threats.length > 0;
  alertMod.alertActive = detected;

  // Post throttled alert messages — group by description
  const threatsByDesc = new Map<string, { x: number; y: number; desc: string; source: 'hazard' | 'entity' }>();
  for (const t of threats) {
    if (!threatsByDesc.has(t.desc)) threatsByDesc.set(t.desc, t);
  }
  for (const [desc, t] of threatsByDesc) {
    const lastTick = alertMod.lastAlertTicks.get(desc) ?? -Infinity;
    if (state.tick - lastTick >= ALERT_THROTTLE_TICKS) {
      const style = t.source === 'entity' ? 'combat' as const : 'alert' as const;
      addMessage(state, `alert.m ▲ ${desc}`, style);
      alertMod.lastAlertTicks.set(desc, state.tick);
    }
  }

  // Clear message when transitioning to safe
  if (!detected && wasActive) {
    addMessage(state, 'alert.m ▽ area clear', 'alert');
    alertMod.lastAlertTicks.clear();
  }

  if (state.debugMode && detected) {
    const descs = [...threatsByDesc.keys()].join(', ');
    addMessage(state, `[DBG] Alert: ${threats.length} threat tiles — ${descs}`, 'debug');
  }
}
