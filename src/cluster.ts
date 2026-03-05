import {
  Cluster, Tile, TileType, Room, Position, InterfaceExit,
  RoomType, CorruptionStage, HazardOverlayType, FunctionalTag, ScannerBeam,
  TerminalDef,
  CLUSTER_WIDTH, CLUSTER_HEIGHT, COLORS,
  createRoomTags,
} from './types';
import { generate, CellType, RoomDef, Hall } from './gen-halls';
import { random, randInt, pick } from './rng';
import { initNoise, collapseNoise } from './noise';

// ── Tile factories ──

function makeTile(type: TileType, glyph: string, fg: string, roomId = -1): Tile {
  const walkable = type === TileType.Floor || type === TileType.Door || type === TileType.InterfaceExit;
  const transparent = type !== TileType.Wall;
  return {
    type, glyph, fg,
    bg: COLORS.bg,
    walkable, transparent,
    roomId,
    visible: false,
    seen: false,
  };
}

function voidTile(): Tile {
  return makeTile(TileType.Void, ' ', COLORS.void);
}

function floorTile(roomId: number): Tile {
  return makeTile(TileType.Floor, '·', COLORS.floorFg, roomId);
}

function doorTile(roomId: number): Tile {
  const t = makeTile(TileType.Door, '+', COLORS.door, roomId);
  t.walkable = false;    // doors start closed
  t.transparent = false;
  return t;
}

function entryInterfaceTile(): Tile {
  return makeTile(TileType.InterfaceExit, '⇏', COLORS.interfaceExit);
}

function exitInterfaceTile(): Tile {
  return makeTile(TileType.InterfaceExit, '⇨', COLORS.interfaceExit);
}

// ── Active generation bounds (set per generateCluster call) ──

let _activeW = CLUSTER_WIDTH;
let _activeH = CLUSTER_HEIGHT;

// ── Wall glyph selection ──

function isOuterPos(y: number, x: number): boolean {
  return y === 0 || y === _activeH - 1 || x === 0 || x === _activeW - 1;
}

function wallGlyph(cells: CellType[][], x: number, y: number, outer: boolean): string {
  const isWall = (ty: number, tx: number) => {
    if (ty < 0 || ty >= CLUSTER_HEIGHT || tx < 0 || tx >= CLUSTER_WIDTH) return false;
    return cells[ty][tx] === 'wall' || cells[ty][tx] === 'door';
  };

  const n = isWall(y - 1, x);
  const s = isWall(y + 1, x);
  const e = isWall(y, x + 1);
  const w = isWall(y, x - 1);

  if (outer) {
    if (n && s && e && w) return '╬';
    if (n && s && e) return '╠';
    if (n && s && w) return '╣';
    if (n && e && w) return '╩';
    if (s && e && w) return '╦';
    if (n && s) return '║';
    if (e && w) return '═';
    if (s && e) return '╔';
    if (s && w) return '╗';
    if (n && e) return '╚';
    if (n && w) return '╝';
    if (n || s) return '║';
    return '═';
  }

  // Mixed junction glyphs where inner meets outer
  const nOuter = isOuterPos(y - 1, x) && isWall(y - 1, x);
  const sOuter = isOuterPos(y + 1, x) && isWall(y + 1, x);
  const eOuter = isOuterPos(y, x + 1) && isWall(y, x + 1);
  const wOuter = isOuterPos(y, x - 1) && isWall(y, x - 1);

  if (nOuter || sOuter) {
    if (e && w) return nOuter ? '╤' : '╧';
  }
  if (eOuter || wOuter) {
    if (n && s) return eOuter ? '╟' : '╢';
  }

  if (n && s && e && w) return '┼';
  if (n && s && e) return '├';
  if (n && s && w) return '┤';
  if (n && e && w) return '┴';
  if (s && e && w) return '┬';
  if (n && s) return '│';
  if (e && w) return '─';
  if (s && e) return '┌';
  if (s && w) return '┐';
  if (n && e) return '└';
  if (n && w) return '┘';
  if (n || s) return '│';
  return '─';
}

// ── Room ID map ──

function buildRoomIdMap(rawRooms: RoomDef[], halls: Hall[], hallIdOffset: number): number[][] {
  const map: number[][] = [];
  for (let y = 0; y < CLUSTER_HEIGHT; y++) {
    map[y] = new Array(CLUSTER_WIDTH).fill(-1);
  }
  // Mark rooms with expanded bounds (including surrounding walls)
  // so adjacency scan can detect rooms separated by a single wall row/col
  for (const rd of rawRooms) {
    const r = rd.rect;
    for (let ry = r.y - 1; ry < r.y + r.h + 1; ry++) {
      for (let rx = r.x - 1; rx < r.x + r.w + 1; rx++) {
        if (ry >= 0 && ry < CLUSTER_HEIGHT && rx >= 0 && rx < CLUSTER_WIDTH) {
          map[ry][rx] = rd.id;
        }
      }
    }
  }
  for (const hall of halls) {
    const r = hall.rect;
    for (let ry = r.y; ry < r.y + r.h; ry++) {
      for (let rx = r.x; rx < r.x + r.w; rx++) {
        if (ry >= 0 && ry < CLUSTER_HEIGHT && rx >= 0 && rx < CLUSTER_WIDTH) {
          // Only assign hall ID to cells not already claimed by a room
          if (map[ry][rx] === -1) {
            map[ry][rx] = hall.id + hallIdOffset;
          }
        }
      }
    }
  }
  return map;
}

// ── Room adjacency ──

function addEdge(adj: Map<number, number[]>, a: number, b: number) {
  if (a === b) return;
  if (!adj.has(a) || !adj.has(b)) return;
  if (!adj.get(a)!.includes(b)) adj.get(a)!.push(b);
  if (!adj.get(b)!.includes(a)) adj.get(b)!.push(a);
}

/** Wall adjacency: rooms that share a wall (adjacent tiles with different room IDs) */
function buildWallAdjacency(allRooms: Room[], roomIdAt: number[][]): Map<number, number[]> {
  const adj = new Map<number, number[]>();
  for (const r of allRooms) adj.set(r.id, []);

  for (let y = 0; y < CLUSTER_HEIGHT; y++) {
    for (let x = 0; x < CLUSTER_WIDTH; x++) {
      const rid = roomIdAt[y][x];
      if (rid < 0) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= CLUSTER_WIDTH || ny >= CLUSTER_HEIGHT) continue;
        const nrid = roomIdAt[ny][nx];
        if (nrid >= 0 && nrid !== rid) {
          addEdge(adj, rid, nrid);
        }
      }
    }
  }

  return adj;
}

/** Door adjacency: rooms connected through a door tile */
function buildDoorAdjacency(allRooms: Room[], cells: CellType[][], roomIdAt: number[][]): Map<number, number[]> {
  const adj = new Map<number, number[]>();
  for (const r of allRooms) adj.set(r.id, []);

  for (let y = 0; y < CLUSTER_HEIGHT; y++) {
    for (let x = 0; x < CLUSTER_WIDTH; x++) {
      if (cells[y][x] !== 'door') continue;
      // Collect distinct room IDs from cardinal neighbors
      const neighborIds = new Set<number>();
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= CLUSTER_WIDTH || ny < 0 || ny >= CLUSTER_HEIGHT) continue;
        const nrid = roomIdAt[ny][nx];
        if (nrid >= 0) neighborIds.add(nrid);
      }
      // Connect all pairs of rooms that share this door
      const ids = [...neighborIds];
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          addEdge(adj, ids[i], ids[j]);
        }
      }
    }
  }

  return adj;
}

// ── Convert gen-halls grid to tile grid ──

function gridToTiles(cells: CellType[][], roomIdAt: number[][]): Tile[][] {
  const tiles: Tile[][] = [];

  for (let y = 0; y < CLUSTER_HEIGHT; y++) {
    tiles[y] = [];
    for (let x = 0; x < CLUSTER_WIDTH; x++) {
      const cell = cells[y][x];
      switch (cell) {
        case 'floor':
          tiles[y][x] = floorTile(roomIdAt[y][x]);
          break;
        case 'hall':
          tiles[y][x] = floorTile(roomIdAt[y][x]);
          break;
        case 'door': {
          // Find room ID from nearest floor neighbor
          let rid = -1;
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < CLUSTER_WIDTH && ny >= 0 && ny < CLUSTER_HEIGHT) {
              if (roomIdAt[ny][nx] >= 0) { rid = roomIdAt[ny][nx]; break; }
            }
          }
          tiles[y][x] = doorTile(rid);
          break;
        }
        case 'wall': {
          const outer = isOuterPos(y, x);
          const glyph = wallGlyph(cells, x, y, outer);
          tiles[y][x] = makeTile(TileType.Wall, glyph, outer ? COLORS.wallOuter : COLORS.wall);
          break;
        }
        case 'interface':
          tiles[y][x] = x === 0 ? entryInterfaceTile() : exitInterfaceTile();
          break;
        default:
          tiles[y][x] = voidTile();
          break;
      }
    }
  }

  return tiles;
}

// ── Extract interface exits from grid ──

function extractInterfaces(cells: CellType[][]): InterfaceExit[] {
  const exits: InterfaceExit[] = [];

  // Scan all columns x > 0 for interface tiles (right-side exits).
  // x=0 is always the entry interface; any interface with x > 0 is a forward exit.
  for (let y = 0; y < CLUSTER_HEIGHT; y++) {
    for (let x = 1; x < CLUSTER_WIDTH; x++) {
      if (cells[y][x] === 'interface') {
        exits.push({ position: { x, y }, targetClusterId: -1, targetPosition: null });
      }
    }
  }

  return exits;
}

// ── Entry point ──

export function placeEntryPoint(tiles: Tile[][], _rooms: Room[]): Position {
  // Gen-halls places a left interface at (0, y).
  // The first walkable cell inside is the entry point.
  for (let y = 0; y < CLUSTER_HEIGHT; y++) {
    if (tiles[y][0].type === TileType.InterfaceExit) {
      for (let x = 1; x < CLUSTER_WIDTH; x++) {
        if (tiles[y][x].walkable) return { x, y };
      }
      // Fallback: carve entry
      tiles[y][1] = floorTile(-1);
      return { x: 1, y };
    }
  }

  // Fallback if no left interface (shouldn't happen)
  const room = _rooms[0];
  return { x: room.x + 1, y: Math.floor(room.y + room.h / 2) };
}

// ── Room type assignment ──

// ── Collapse heatmap ──

/**
 * Damage scale for a cluster: cluster 0 is mostly safe (scale=0.4),
 * rising to full intensity (scale=1.0) at cluster 3+.
 * Multiplying the raw noise by this keeps early clusters at low collapse values
 * while later clusters unlock higher-tier hazards.
 */
let _damageBase = 0.40;
let _damageIncrement = 0.20;

export function setDamageParams(base: number, inc: number): void {
  _damageBase = Math.max(0.05, Math.min(1.0, base));
  _damageIncrement = Math.max(0.0, Math.min(0.5, inc));
}

export function getDamageParams(): { base: number; inc: number } {
  return { base: _damageBase, inc: _damageIncrement };
}

function clusterDamageScale(clusterId: number): number {
  return Math.min(1.0, _damageBase + clusterId * _damageIncrement);
}

function generateCollapseMap(clusterId: number): number[][] {
  initNoise();
  const offsetX = clusterId * CLUSTER_WIDTH;
  const scale = clusterDamageScale(clusterId);
  const map: number[][] = [];
  for (let y = 0; y < _activeH; y++) {
    map[y] = [];
    for (let x = 0; x < _activeW; x++) {
      map[y][x] = Math.min(1.0, collapseNoise(x + offsetX, y, 0.08, 2, 0.5) * scale);
    }
  }
  return map;
}

function sampleRoomCollapse(room: Room, collapseMap: number[][]): number {
  const cx = Math.floor(room.x + room.w / 2);
  const cy = Math.floor(room.y + room.h / 2);
  const safeX = Math.max(0, Math.min(_activeW - 1, cx));
  const safeY = Math.max(0, Math.min(_activeH - 1, cy));
  return collapseMap[safeY][safeX];
}

// ── Hazard assignment by collapse ──

type HazardTier = { type: RoomType; weight: number }[];

const TIER_SAFE: HazardTier = [];
const TIER_LOW: HazardTier = [
  { type: 'echo_chamber', weight: 2 },
  { type: 'quarantine', weight: 1 },
];
const TIER_MID: HazardTier = [
  { type: 'unstable', weight: 2 },
  { type: 'firewall', weight: 2 },
];
const TIER_HIGH: HazardTier = [
  { type: 'trigger_trap', weight: 2 },
  { type: 'memory_leak', weight: 2 },
];
const TIER_EXTREME: HazardTier = [
  { type: 'gravity_well', weight: 2 },
  { type: 'corrupted', weight: 2 },
];

function weightedPick(pool: HazardTier): RoomType {
  const total = pool.reduce((s, e) => s + e.weight, 0);
  let r = random() * total;
  for (const entry of pool) {
    r -= entry.weight;
    if (r <= 0) return entry.type;
  }
  return pool[pool.length - 1].type;
}

function hazardTierForCollapse(c: number): HazardTier {
  if (c < 0.3) return TIER_SAFE;
  if (c < 0.5) return TIER_LOW;
  if (c < 0.7) return TIER_MID;
  if (c < 0.85) return TIER_HIGH;
  return TIER_EXTREME;
}

function assignHazardsByCollapse(allRooms: Room[]) {
  // Find entry/exit by geometric tag — never assign hazards
  const entryIds = new Set(
    allRooms.filter(r => r.tags.geometric.has('entry') || r.tags.geometric.has('exit')).map(r => r.id)
  );

  // Sort rooms by collapse descending so highest-collapse rooms get priority
  const sorted = [...allRooms]
    .filter(r => !entryIds.has(r.id))
    .sort((a, b) => b.collapse - a.collapse);

  let hazardCount = 0;
  const MAX_HAZARDS = 4;
  const usedTypes = new Set<RoomType>();

  for (const room of sorted) {
    if (hazardCount >= MAX_HAZARDS) break;

    const isHall = room.tags.geometric.has('hall');
    const interior = isHall ? room.w * room.h : (room.w - 2) * (room.h - 2);

    // Halls need high collapse and sufficient length
    if (isHall) {
      if (room.collapse < 0.7 || Math.max(room.w, room.h) < 6) continue;
    } else {
      // Non-hall rooms need min 3x3 interior
      if ((room.w - 2) < 3 || (room.h - 2) < 3) continue;
    }
    if (interior < 9) continue;

    const tier = hazardTierForCollapse(room.collapse);
    if (tier.length === 0) continue;

    // Filter out already-used types
    const available = tier.filter(e => !usedTypes.has(e.type));
    if (available.length === 0) continue;

    const type = weightedPick(available);
    usedTypes.add(type);
    room.roomType = type;
    hazardCount++;
  }
}

// ── Functional tag generation (three-pass) ──

// Cluster-stage pools: which functional tags can appear by cluster depth.
// Early  (0-1): engine room, cargo, crew, maintenance, hangar
// Mid    (2)  : reactor, comms, lab, medbay, server_rack, archive, maintenance
// Late   (3+) : armory, bridge, comms, reactor, medbay, sensor_matrix, server_rack, hangar, archive
const FUNC_POOL_EARLY: FunctionalTag[] = ['engine_room', 'cargo', 'barracks', 'maintenance', 'hangar'];
const FUNC_POOL_MID: FunctionalTag[]   = ['reactor', 'comms', 'lab', 'medbay', 'server_rack', 'archive', 'maintenance', 'barracks'];
const FUNC_POOL_LATE: FunctionalTag[]  = ['armory', 'bridge', 'comms', 'reactor', 'medbay', 'sensor_matrix', 'server_rack', 'hangar', 'archive', 'maintenance'];

function clusterFunctionalPool(clusterId: number): FunctionalTag[] {
  if (clusterId <= 1) return [...FUNC_POOL_EARLY];
  if (clusterId <= 2) return [...FUNC_POOL_MID];
  return [...FUNC_POOL_LATE];
}

/**
 * Select which functional tags will actually appear in this cluster.
 * Each 5 rooms (halls excluded) unlock one tag slot; minimum 1.
 */
function selectClusterTags(allRooms: Room[], clusterId: number): FunctionalTag[] {
  const pool = clusterFunctionalPool(clusterId);
  const nonHallCount = allRooms.filter(r => !r.tags.geometric.has('hall')).length;
  const numTags = Math.max(1, Math.floor(nonHallCount / 5));
  const shuffled = [...pool].sort(() => random() - 0.5);
  return shuffled.slice(0, Math.min(numTags, shuffled.length));
}

const PROPAGATION_RULES: Partial<Record<FunctionalTag, { tag: FunctionalTag; weight: number }[]>> = {
  engine_room: [{ tag: 'maintenance', weight: 4 }, { tag: 'cargo', weight: 2 }],
  reactor: [{ tag: 'maintenance', weight: 4 }, { tag: 'lab', weight: 2 }],
  medbay: [{ tag: 'lab', weight: 3 }, { tag: 'barracks', weight: 2 }],
  armory: [{ tag: 'bridge', weight: 2 }, { tag: 'cargo', weight: 2 }],
  hangar: [{ tag: 'cargo', weight: 4 }, { tag: 'comms', weight: 2 }],
  bridge: [{ tag: 'comms', weight: 3 }, { tag: 'server_rack', weight: 2 }],
  lab: [{ tag: 'archive', weight: 2 }, { tag: 'sensor_matrix', weight: 2 }],
  server_rack: [{ tag: 'comms', weight: 3 }, { tag: 'maintenance', weight: 2 }],
  cargo: [{ tag: 'hangar', weight: 2 }, { tag: 'maintenance', weight: 2 }],
  barracks: [{ tag: 'maintenance', weight: 2 }, { tag: 'cargo', weight: 1 }],
  comms: [{ tag: 'bridge', weight: 2 }, { tag: 'sensor_matrix', weight: 2 }],
  maintenance: [{ tag: 'cargo', weight: 2 }, { tag: 'maintenance', weight: 1 }],
  archive: [{ tag: 'lab', weight: 2 }, { tag: 'server_rack', weight: 2 }],
  sensor_matrix: [{ tag: 'comms', weight: 2 }, { tag: 'lab', weight: 1 }],
};

const GEO_PREFERENCES: Record<string, { tag: FunctionalTag; weight: number }[]> = {
  dead_end: [{ tag: 'cargo', weight: 3 }, { tag: 'armory', weight: 2 }, { tag: 'archive', weight: 2 }],
  hub: [{ tag: 'bridge', weight: 3 }, { tag: 'comms', weight: 2 }, { tag: 'server_rack', weight: 2 }],
  large: [{ tag: 'cargo', weight: 3 }, { tag: 'hangar', weight: 2 }, { tag: 'reactor', weight: 2 }],
  small: [{ tag: 'maintenance', weight: 3 }, { tag: 'barracks', weight: 2 }, { tag: 'comms', weight: 2 }],
};

const HALL_POOL: { tag: FunctionalTag | null; weight: number }[] = [
  { tag: 'maintenance', weight: 6 },
  { tag: 'comms', weight: 2 },
  { tag: null, weight: 2 },
];

function pickWeighted<T>(pool: { tag: T; weight: number }[]): T {
  const total = pool.reduce((s, e) => s + e.weight, 0);
  let r = random() * total;
  for (const entry of pool) {
    r -= entry.weight;
    if (r <= 0) return entry.tag;
  }
  return pool[pool.length - 1].tag;
}

/** BFS distance from a set of source room IDs using doorAdjacency */
function bfsDistances(sources: Set<number>, doorAdj: Map<number, number[]>): Map<number, number> {
  const dist = new Map<number, number>();
  const queue: number[] = [];
  for (const id of sources) {
    dist.set(id, 0);
    queue.push(id);
  }
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const d = dist.get(cur)!;
    for (const nb of (doorAdj.get(cur) ?? [])) {
      if (!dist.has(nb)) {
        dist.set(nb, d + 1);
        queue.push(nb);
      }
    }
  }
  return dist;
}

function assignFunctionalTags(
  allRooms: Room[],
  _wallAdjacency: Map<number, number[]>,
  doorAdjacency: Map<number, number[]>,
  clusterId: number,
) {
  // Select the functional tags allowed in this cluster based on its depth and room count
  const allowedTags = selectClusterTags(allRooms, clusterId);
  const allowedSet = new Set<FunctionalTag>(allowedTags);

  const claimed = new Set<number>(); // rooms that can't be picked as anchors

  function claimWithNeighbors(roomId: number) {
    claimed.add(roomId);
    for (const nb of (doorAdjacency.get(roomId) ?? [])) {
      claimed.add(nb);
    }
  }

  // ── Pass 1: Anchor rooms ──
  const anchorIds = new Set<number>();

  // Entry room → first tag in pool that fits; prefer hangar/engine_room/cargo
  const entryRoom = allRooms.find(r => r.tags.geometric.has('entry'));
  if (entryRoom) {
    const entryPrefer: FunctionalTag[] = ['hangar', 'engine_room', 'cargo', 'comms'];
    const entryTag = entryPrefer.find(t => allowedSet.has(t)) ?? allowedTags[0];
    entryRoom.tags.functional = entryTag;
    anchorIds.add(entryRoom.id);
    claimWithNeighbors(entryRoom.id);
  }

  // Exit room → prefer hangar/bridge/comms
  const exitRoom = allRooms.find(r => r.tags.geometric.has('exit'));
  if (exitRoom && exitRoom !== entryRoom) {
    const exitPrefer: FunctionalTag[] = ['hangar', 'bridge', 'comms', 'engine_room'];
    const exitTag = exitPrefer.find(t => allowedSet.has(t)) ?? allowedTags[allowedTags.length - 1];
    exitRoom.tags.functional = exitTag;
    anchorIds.add(exitRoom.id);
    claimWithNeighbors(exitRoom.id);
  }

  // Place anchor rooms, one per allowed tag, farthest-first
  const shuffledPool = [...allowedTags].sort(() => random() - 0.5);
  let poolIdx = 0;
  const numExtra = Math.min(shuffledPool.length, randInt(2, 4));

  for (let i = 0; i < numExtra && poolIdx < shuffledPool.length; i++) {
    const dist = bfsDistances(anchorIds, doorAdjacency);
    let bestRoom: Room | null = null;
    let bestDist = -1;
    for (const r of allRooms) {
      if (claimed.has(r.id)) continue;
      if (r.tags.geometric.has('hall')) continue;
      const d = dist.get(r.id) ?? 0;
      if (d > bestDist) { bestDist = d; bestRoom = r; }
    }
    if (!bestRoom) break;

    bestRoom.tags.functional = shuffledPool[poolIdx++];
    anchorIds.add(bestRoom.id);
    claimWithNeighbors(bestRoom.id);
  }

  // ── Pass 2: Propagation (BFS from entry) ──
  const startId = entryRoom?.id ?? allRooms[0]?.id ?? 0;
  const bfsOrder: number[] = [];
  const visited = new Set<number>();
  const bfsQueue = [startId];
  visited.add(startId);
  while (bfsQueue.length > 0) {
    const cur = bfsQueue.shift()!;
    bfsOrder.push(cur);
    for (const nb of (doorAdjacency.get(cur) ?? [])) {
      if (!visited.has(nb)) {
        visited.add(nb);
        bfsQueue.push(nb);
      }
    }
  }

  for (const roomId of bfsOrder) {
    const room = allRooms.find(r => r.id === roomId);
    if (!room || room.tags.functional !== null) continue;

    const isHall = room.tags.geometric.has('hall');

    // Hall rooms: pick from allowed tags, preferring maintenance/comms
    if (isHall) {
      const hallAllowed = HALL_POOL.filter(e => e.tag === null || allowedSet.has(e.tag));
      const result = pickWeighted(hallAllowed.length > 0 ? hallAllowed : HALL_POOL);
      room.tags.functional = result;
      continue;
    }

    // Collect propagation influence from tagged neighbors, filtered to allowed tags
    const influences: { tag: FunctionalTag; weight: number }[] = [];

    for (const nbId of (doorAdjacency.get(roomId) ?? [])) {
      const nb = allRooms.find(r => r.id === nbId);
      if (!nb || nb.tags.functional === null) continue;
      const rules = PROPAGATION_RULES[nb.tags.functional] ?? [];
      for (const rule of rules) {
        if (allowedSet.has(rule.tag)) influences.push(rule);
      }
    }

    // Add geometric preferences filtered to allowed tags
    for (const geoTag of room.tags.geometric) {
      const prefs = GEO_PREFERENCES[geoTag] ?? [];
      for (const pref of prefs) {
        if (allowedSet.has(pref.tag)) influences.push(pref);
      }
    }

    if (influences.length > 0) {
      room.tags.functional = pickWeighted(influences);
    }
  }

  // ── Pass 3: Fill remaining (~30% stay null for pacing) ──
  for (const room of allRooms) {
    if (room.tags.functional !== null) continue;
    if (random() < 0.3) continue;
    room.tags.functional = pick(allowedTags);
  }
}

// ── Terminal placement ──

const TERMINAL_FUNC_TAGS = new Set<string>(['bridge', 'comms', 'maintenance', 'server_rack']);

const TERMINAL_LABELS: Record<string, string> = {
  bridge:      'BRIDGE ACCESS TERMINAL',
  comms:       'COMMS ROUTING TERMINAL',
  maintenance: 'MAINTENANCE CONTROL PANEL',
  server_rack: 'SERVER RACK INTERFACE',
};

// Narrative content pools per functional tag
const TERMINAL_CONTENT_POOLS: Record<string, string[]> = {
  bridge: [
    'NAVIGATION: Course locked. Manual override offline.',
    "CAPTAIN'S LOG: Cluster integrity failing. Evacuation... incomplete.",
    'WARNING: Hull breach detected. Containment status: FAILED.',
    'HELM: Auto-pilot disengaged. Last heading: [CORRUPTED].',
    'SECURITY: Personnel count: 0. Access logs wiped.',
    'FLIGHT RECORDER: Final entry at tick 000847. No further data.',
    'EMERGENCY PROTOCOL: Abandon ship order issued. Compliance: UNKNOWN.',
  ],
  comms: [
    'SIGNAL RECEIVED: [CORRUPTED DATA — 847 BYTES LOST]',
    'RELAY STATUS: 3 of 7 nodes responding.',
    "LAST BROADCAST: '...can anyone hear this? We need—' [END OF RECORD]",
    'ROUTING: All outbound channels blocked. Reason: SYSTEM FAILURE.',
    'ARCHIVE: 1,337 unread messages. Sender field: [NULL].',
    'DISTRESS BEACON: Active. Duration: 23 days. Responses: 0.',
    'ENCRYPTION KEY: Expired. Re-authentication required.',
  ],
  maintenance: [
    'REPAIR LOG: Patch applied to sector 4B. Result: FAILED.',
    'SYSTEM TEMP: 340K — CRITICAL. Cooling array offline.',
    'PRESSURE MONITOR: 0.2 atm. Structural integrity: POOR.',
    'AUTOMATED TASK: Re-routing power to sector 2... attempt 847 of ∞.',
    'FAULT LOG: 1,337 critical errors since last reboot.',
    'COOLANT LEVELS: 2%. Recommend immediate refill. Technician: [UNAVAILABLE].',
    'SELF-DIAGNOSTIC: 14 of 20 subsystems returning errors.',
  ],
  server_rack: [
    'PROCESS 0x3A7F: Status unknown. Memory: fragmented.',
    'UPTIME: 847 days, 14 hours. Last maintenance: NEVER.',
    'STORAGE: 97% corrupt. Readable sectors: 3%.',
    'BACKUP INTEGRITY: CHECKSUM MISMATCH. Data unreliable.',
    'ACTIVE PROCESSES: 1. Identity: EGO-FRAGMENT. State: RUNNING.',
    'MEMORY DUMP: [REDACTED]. Classification: EYES ONLY.',
    'INDEX: 12,441 entries found. Accessible: 0.',
  ],
};

const FALLBACK_CONTENT: string[] = [
  'SYSTEM STATUS: Nominal. (Last updated: NEVER)',
  'ERROR: Unable to retrieve log. Disk read failure.',
  'NOTICE: This terminal has been decommissioned.',
  'ACCESS LOG: Last accessed by: [USER DELETED].',
];

// Lines added to the key-bearing terminal
const KEY_CONTENT_LINES: string[] = [
  'COMMAND OVERRIDE PROTOCOL: Exit authorization key detected.',
  'AUTH CODE: ████████-████ — Bearer may activate cluster egress.',
];

function generateTerminalContent(functionalTag: string | null): string[] {
  const pool = (functionalTag && TERMINAL_CONTENT_POOLS[functionalTag]) ?? FALLBACK_CONTENT;
  // Pick 2-3 random lines without repeating
  const shuffled = [...pool].sort(() => random() - 0.5);
  return shuffled.slice(0, randInt(2, 3));
}

function placeTerminals(tiles: Tile[][], allRooms: Room[], clusterId: number): TerminalDef[] {
  const terminals: TerminalDef[] = [];

  // Eligible: non-hall rooms with matching functional tag, not entry/exit
  const eligible = allRooms.filter(r =>
    !r.tags.geometric.has('hall') &&
    !r.tags.geometric.has('entry') &&
    !r.tags.geometric.has('exit') &&
    r.tags.functional !== null &&
    TERMINAL_FUNC_TAGS.has(r.tags.functional!)
  );

  // Shuffle and take 2-3
  const shuffled = [...eligible].sort(() => random() - 0.5);
  const count = Math.max(2, Math.min(3, shuffled.length));

  for (let i = 0; i < count && i < shuffled.length; i++) {
    const room = shuffled[i];
    const innerX1 = room.x + 1, innerY1 = room.y + 1;
    const innerX2 = room.x + room.w - 2, innerY2 = room.y + room.h - 2;

    // Place on a floor tile near one of the interior walls
    const side = i % 4;
    let tx: number, ty: number;
    switch (side) {
      case 0: tx = Math.floor((innerX1 + innerX2) / 2); ty = innerY1; break;
      case 1: tx = innerX2; ty = Math.floor((innerY1 + innerY2) / 2); break;
      case 2: tx = Math.floor((innerX1 + innerX2) / 2); ty = innerY2; break;
      default: tx = innerX1; ty = Math.floor((innerY1 + innerY2) / 2); break;
    }

    // Ensure it's a floor tile
    if (!tiles[ty]?.[tx] || tiles[ty][tx].type !== TileType.Floor) continue;

    const id = `term-${clusterId}-${i}`;
    const label = TERMINAL_LABELS[room.tags.functional!] ?? 'ACCESS TERMINAL';
    const content = generateTerminalContent(room.tags.functional);

    tiles[ty][tx].type = TileType.Terminal;
    tiles[ty][tx].glyph = '◈';
    tiles[ty][tx].fg = '#00aaff';
    tiles[ty][tx].walkable = false;
    tiles[ty][tx].transparent = true;
    tiles[ty][tx].terminalId = id;

    terminals.push({ id, roomId: room.id, label, position: { x: tx, y: ty }, activated: false, content, hasKey: false });
  }

  // Fallback: if we got < 2, place a generic terminal in any non-hazard non-hall room
  if (terminals.length < 2) {
    const fallbacks = allRooms.filter(r =>
      !r.tags.geometric.has('hall') &&
      !r.tags.geometric.has('entry') &&
      !r.tags.geometric.has('exit') &&
      r.roomType === 'normal' &&
      !terminals.some(t => t.roomId === r.id)
    );
    for (const room of fallbacks.sort(() => random() - 0.5)) {
      if (terminals.length >= 2) break;
      const cx = Math.floor(room.x + room.w / 2);
      const cy = Math.floor(room.y + room.h / 2);
      if (!tiles[cy]?.[cx] || tiles[cy][cx].type !== TileType.Floor) continue;
      const id = `term-${clusterId}-fb${terminals.length}`;
      tiles[cy][cx].type = TileType.Terminal;
      tiles[cy][cx].glyph = '◈';
      tiles[cy][cx].fg = '#00aaff';
      tiles[cy][cx].walkable = false;
      tiles[cy][cx].transparent = true;
      tiles[cy][cx].terminalId = id;
      terminals.push({
        id, roomId: room.id, label: 'SYSTEM TERMINAL',
        position: { x: cx, y: cy }, activated: false,
        content: generateTerminalContent(null), hasKey: false,
      });
    }
  }

  // Assign key to one terminal — prefer bridge/comms, else random
  if (terminals.length > 0) {
    const cluster = state_findKeyTerminal(terminals, allRooms);
    cluster.hasKey = true;
    cluster.content = [...KEY_CONTENT_LINES, ...cluster.content];
    // Give key terminal a distinct color
    const tile = tiles[cluster.position.y][cluster.position.x];
    tile.fg = '#ffaa00';
  }

  return terminals;
}

function state_findKeyTerminal(terminals: TerminalDef[], allRooms: Room[]): TerminalDef {
  // Prefer a bridge or comms terminal if available
  const preferred = terminals.find(t => {
    const room = allRooms.find(r => r.id === t.roomId);
    return room?.tags.functional === 'bridge' || room?.tags.functional === 'comms';
  });
  return preferred ?? terminals[Math.floor(random() * terminals.length)];
}

// ── Spiral path ──

/** Returns all interior positions in clockwise spiral order (outermost ring first). */
function computeSpiralPath(x1: number, y1: number, x2: number, y2: number): Position[] {
  const path: Position[] = [];
  let lx1 = x1, ly1 = y1, lx2 = x2, ly2 = y2;
  while (lx1 <= lx2 && ly1 <= ly2) {
    for (let x = lx1; x <= lx2; x++) path.push({ x, y: ly1 }); ly1++;
    for (let y = ly1; y <= ly2; y++) path.push({ x: lx2, y }); lx2--;
    if (ly1 <= ly2) { for (let x = lx2; x >= lx1; x--) path.push({ x, y: ly2 }); ly2--; }
    if (lx1 <= lx2) { for (let y = ly2; y >= ly1; y--) path.push({ x: lx1, y }); lx1++; }
  }
  return path;
}

function initRoomHazards(tiles: Tile[][], rooms: Room[]) {
  for (const room of rooms) {
    if (room.roomType === 'normal') continue;

    const innerX1 = room.x + 1;
    const innerY1 = room.y + 1;
    const innerX2 = room.x + room.w - 2;
    const innerY2 = room.y + room.h - 2;

    switch (room.roomType) {
      case 'corrupted': {
        const seedCount = randInt(1, 3);
        const corruptionTiles = new Map<string, CorruptionStage>();
        for (let s = 0; s < seedCount; s++) {
          const sx = randInt(innerX1, innerX2);
          const sy = randInt(innerY1, innerY2);
          const key = `${sx},${sy}`;
          corruptionTiles.set(key, 'degrading');
          tiles[sy][sx].hazardOverlay = { type: 'corruption', stage: 0 };
        }
        room.hazardState = { corruptionTiles, lastSpreadTick: 0 };
        break;
      }

      case 'trigger_trap': {
        const fuseLength = randInt(15, 25);
        room.hazardState = {
          fuseLength,
          ticksRemaining: fuseLength,
          activated: false,
          detonated: false,
        };
        break;
      }

      case 'memory_leak': {
        room.hazardState = { floodLevel: 0 };
        // Place leak source on inner floor tile along a wall-adjacent edge row/col
        const wallSide = randInt(0, 3);
        let lx: number, ly: number;
        switch (wallSide) {
          case 0: lx = randInt(innerX1, innerX2); ly = innerY1; break;
          case 1: lx = randInt(innerX1, innerX2); ly = innerY2; break;
          case 2: lx = innerX1; ly = randInt(innerY1, innerY2); break;
          default: lx = innerX2; ly = randInt(innerY1, innerY2); break;
        }
        if (tiles[ly]?.[lx]) {
          tiles[ly][lx].glyph = '◎';
          tiles[ly][lx].fg = '#4488cc';
        }
        break;
      }

      case 'firewall': {
        const FW_PATTERNS = ['pingpong', 'wipe', 'inward', 'cross', 'spiral'] as const;
        type FWPat = typeof FW_PATTERNS[number];
        const pattern: FWPat = pick([...FW_PATTERNS]);

        let beams: ScannerBeam[] = [];

        if (pattern === 'pingpong') {
          const beamCount = randInt(1, 2);
          for (let b = 0; b < beamCount; b++) {
            const axis = random() < 0.5 ? 'horizontal' as const : 'vertical' as const;
            if (axis === 'horizontal') {
              beams.push({ axis, position: randInt(innerY1, innerY2), direction: 1, min: innerY1, max: innerY2 });
            } else {
              beams.push({ axis, position: randInt(innerX1, innerX2), direction: 1, min: innerX1, max: innerX2 });
            }
          }
        } else if (pattern === 'cross') {
          beams.push({ axis: 'horizontal', position: randInt(innerY1, innerY2), direction: 1, min: innerY1, max: innerY2 });
          beams.push({ axis: 'vertical',   position: randInt(innerX1, innerX2), direction: 1, min: innerX1, max: innerX2 });
        }

        const firewallPath = pattern === 'spiral'
          ? computeSpiralPath(innerX1, innerY1, innerX2, innerY2)
          : undefined;

        room.hazardState = {
          beams,
          alarmTriggered: false,
          firewallPattern: pattern,
          firewallAxis: random() < 0.5 ? 'horizontal' : 'vertical', // used by wipe
          firewallStep: 0,
          firewallPath,
        };

        // Place terminal on inner floor tile (rightmost interior column, mid-height)
        const tx = innerX2;
        const ty = Math.max(innerY1, Math.min(innerY2, Math.floor(room.y + room.h / 2)));
        if (tiles[ty]?.[tx]) {
          tiles[ty][tx].glyph = '▣';
          tiles[ty][tx].fg = '#ffcc00';
        }
        break;
      }

      case 'unstable': {
        const cx = Math.floor(room.x + room.w / 2);
        const cy = Math.floor(room.y + room.h / 2);
        room.hazardState = { corePos: { x: cx, y: cy }, coreDestroyed: false, sparkedTiles: [] };
        tiles[cy][cx].glyph = '◆';
        tiles[cy][cx].fg = '#ffaa00';
        break;
      }

      case 'quarantine': {
        room.hazardState = { locked: true };
        for (let y = room.y; y < room.y + room.h; y++) {
          for (let x = room.x; x < room.x + room.w; x++) {
            if (x < 0 || x >= CLUSTER_WIDTH || y < 0 || y >= CLUSTER_HEIGHT) continue;
            if (tiles[y][x].type === TileType.Door) {
              tiles[y][x].glyph = '▪';
              tiles[y][x].fg = '#ff2222';
              tiles[y][x].walkable = false;
              tiles[y][x].doorOpen = false;
            }
          }
        }
        break;
      }

      case 'echo_chamber': {
        for (let y = innerY1; y <= innerY2; y++) {
          for (let x = innerX1; x <= innerX2; x++) {
            if (tiles[y]?.[x]?.type === TileType.Floor) {
              tiles[y][x].bg = '#0a0a14';
            }
          }
        }
        room.hazardState = {};
        break;
      }

      case 'gravity_well': {
        const cx = Math.floor(room.x + room.w / 2);
        const cy = Math.floor(room.y + room.h / 2);
        room.hazardState = {
          singularityPos: { x: cx, y: cy },
          pullInterval: 3,
          lastPullTick: 0,
        };
        tiles[cy][cx].glyph = '●';
        tiles[cy][cx].fg = '#aa44ff';
        tiles[cy][cx].hazardOverlay = { type: 'gravity', stage: 2 };
        for (let y = innerY1; y <= innerY2; y++) {
          for (let x = innerX1; x <= innerX2; x++) {
            if (x === cx && y === cy) continue;
            if (tiles[y][x].type !== TileType.Floor) continue;
            const dx = cx - x;
            const dy = cy - y;
            const dist = Math.abs(dx) + Math.abs(dy);
            const stage = dist <= 2 ? 1 : 0;
            tiles[y][x].hazardOverlay = { type: 'gravity', stage };
          }
        }
        break;
      }

    }
  }
}

// ── Structural tags ──

function assignStructuralTags(
  allRooms: Room[],
  wallAdjacency: Map<number, number[]>,
  doorAdjacency: Map<number, number[]>,
  cells: CellType[][],
) {
  // entry — room nearest to left interface; exit — room nearest to right interface
  let entryRoom: Room | null = null;
  let exitRoom: Room | null = null;
  for (let y = 0; y < CLUSTER_HEIGHT; y++) {
    if (cells[y][0] === 'interface') {
      const nonHall = allRooms.filter(r => !r.tags.geometric.has('hall'));
      entryRoom = nonHall.reduce((best, r) => (r.x < best.x ? r : best), nonHall[0]);
      break;
    }
  }
  // Find any right-side interface (x > 0) to locate the exit room
  outer: for (let y = 0; y < CLUSTER_HEIGHT; y++) {
    for (let x = 1; x < CLUSTER_WIDTH; x++) {
      if (cells[y][x] === 'interface') {
        const nonHall = allRooms.filter(r => !r.tags.geometric.has('hall'));
        exitRoom = nonHall.reduce((best, r) => (r.x + r.w > best.x + best.w ? r : best), nonHall[0]);
        break outer;
      }
    }
  }
  if (entryRoom) entryRoom.tags.geometric.add('entry');
  if (exitRoom && exitRoom !== entryRoom) exitRoom.tags.geometric.add('exit');

  // Degree-based tags: dead_end uses wall adjacency, hub uses door adjacency
  for (const r of allRooms) {
    const wallDegree = (wallAdjacency.get(r.id) ?? []).length;
    const doorDegree = (doorAdjacency.get(r.id) ?? []).length;
    if (wallDegree <= 1) r.tags.geometric.add('dead_end');
    if (doorDegree >= 3) r.tags.geometric.add('hub');
  }

  // Size-based tags (interior area = (w-2)*(h-2) for rooms, w*h for halls)
  for (const r of allRooms) {
    const interior = r.tags.geometric.has('hall') ? r.w * r.h : (r.w - 2) * (r.h - 2);
    if (interior >= 25) r.tags.geometric.add('large');
    if (interior <= 12) r.tags.geometric.add('small');
  }

  // Interface tags — tag rooms adjacent to interface tiles
  for (let y = 0; y < CLUSTER_HEIGHT; y++) {
    if (cells[y][0] === 'interface') {
      const adjRoom = allRooms.find(r =>
        1 >= r.x && 1 < r.x + r.w && y >= r.y && y < r.y + r.h
      );
      if (adjRoom) adjRoom.tags.geometric.add('entry_interface');
    }
    for (let x = 1; x < CLUSTER_WIDTH; x++) {
      if (cells[y][x] === 'interface') {
        const adjRoom = allRooms.find(r =>
          (x - 1) >= r.x && (x - 1) < r.x + r.w && y >= r.y && y < r.y + r.h
        );
        if (adjRoom) adjRoom.tags.geometric.add('exit_interface');
      }
    }
  }
}

// ── Cluster scale params (size scales with cluster ID) ──

interface ClusterScale { w: number; h: number; hallChance: number }

const SCALE_TABLE: [maxId: number, w: number, h: number, hallChance: number][] = [
  [0, 22, 16, 0.00],
  [1, 28, 20, 0.10],
  [2, 35, 24, 0.20],
  [3, 42, 27, 0.32],
];
const SCALE_MAX: ClusterScale = { w: CLUSTER_WIDTH, h: CLUSTER_HEIGHT, hallChance: 0.40 };

export function clusterScaleForId(id: number): ClusterScale {
  for (const [maxId, w, h, hallChance] of SCALE_TABLE) {
    if (id <= maxId) return { w, h, hallChance };
  }
  return SCALE_MAX;
}

let _genSizeOverride: { w: number; h: number } | null = null;

export function setGenSizeOverride(w: number, h: number): void {
  _genSizeOverride = { w, h };
}
export function clearGenSizeOverride(): void {
  _genSizeOverride = null;
}
export function getGenSizeOverride(): { w: number; h: number } | null {
  return _genSizeOverride;
}

// ── Main generation ──

export function generateCluster(id: number): Cluster {
  const scale = clusterScaleForId(id);
  const genW = _genSizeOverride?.w ?? scale.w;
  const genH = _genSizeOverride?.h ?? scale.h;
  const { grid, rooms: rawRooms, halls, activeW, activeH } = generate(genW, genH, scale.hallChance);

  // Set active bounds for isOuterPos (used in gridToTiles → wallGlyph)
  _activeW = activeW;
  _activeH = activeH;

  // Convert RoomDef → Room (expand rect to include walls)
  const rooms: Room[] = rawRooms.map(r => ({
    id: r.id,
    x: r.rect.x - 1,
    y: r.rect.y - 1,
    w: r.rect.w + 2,
    h: r.rect.h + 2,
    roomType: 'normal' as RoomType,
    tags: createRoomTags(['room']),
    collapse: 0,
    containedHazards: new Set<HazardOverlayType>(),
  }));

  // Create hall Room objects (IDs continue after room IDs)
  const hallIdOffset = rawRooms.length;
  const hallRooms: Room[] = halls.map(h => ({
    id: h.id + hallIdOffset,
    x: h.rect.x,
    y: h.rect.y,
    w: h.rect.w,
    h: h.rect.h,
    roomType: 'normal' as RoomType,
    tags: createRoomTags(['hall']),
    collapse: 0,
    containedHazards: new Set<HazardOverlayType>(),
  }));

  const allRooms = [...rooms, ...hallRooms];

  // Build room ID map (assigns tiles to room/hall IDs)
  const roomIdAt = buildRoomIdMap(rawRooms, halls, hallIdOffset);

  // Build adjacency graphs
  const wallAdjacency = buildWallAdjacency(allRooms, roomIdAt);
  const doorAdjacency = buildDoorAdjacency(allRooms, grid.cells, roomIdAt);

  // Generate collapse heatmap and sample per room
  const collapseMap = generateCollapseMap(id);
  for (const r of allRooms) r.collapse = sampleRoomCollapse(r, collapseMap);

  // Assign hazards based on collapse intensity
  assignHazardsByCollapse(allRooms);

  // Convert grid cells to tiles
  const tiles = gridToTiles(grid.cells, roomIdAt);

  // Initialize hazard visuals on tiles
  initRoomHazards(tiles, allRooms);

  // Compute structural tags
  assignStructuralTags(allRooms, wallAdjacency, doorAdjacency, grid.cells);

  // Assign functional tags (three-pass: anchors → propagation → fill)
  assignFunctionalTags(allRooms, wallAdjacency, doorAdjacency, id);

  // Extract interface exits (right edge only; left interface is for entry)
  const interfaces = extractInterfaces(grid.cells);

  // Place terminals in eligible rooms (must happen after functional tag assignment)
  const terminals = placeTerminals(tiles, allRooms, id);

  const cluster: Cluster = { id, width: CLUSTER_WIDTH, height: CLUSTER_HEIGHT, tiles, rooms: allRooms, interfaces, wallAdjacency, doorAdjacency, collapseMap, terminals, exitLocked: true };

  // Debug output
  const hazardRooms = allRooms.filter(r => r.roomType !== 'normal');
  const hazardSummary = hazardRooms.map(r => `  room ${r.id}: ${r.roomType} (${r.w - 2}x${r.h - 2})`).join('\n');
  const degrees = allRooms.map(r => (doorAdjacency.get(r.id) ?? []).length);
  const avgDegree = degrees.length > 0 ? (degrees.reduce((a, b) => a + b, 0) / degrees.length).toFixed(1) : '0';
  const deadEnds = degrees.filter(d => d <= 1).length;
  console.log(
    `[Cluster ${id}] ${allRooms.length} rooms (${hallRooms.length} halls), ${hazardRooms.length} hazards, ` +
    `${interfaces.length} exits, avg degree ${avgDegree}, ${deadEnds} dead-ends\n` +
    (hazardSummary || '  (no hazards)')
  );

  return cluster;
}
