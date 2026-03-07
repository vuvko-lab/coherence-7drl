import {
  Cluster, Tile, TileType, Room, Position, InterfaceExit,
  RoomType, CorruptionStage, HazardOverlayType, FunctionalTag, ScannerBeam,
  TerminalDef, Interactable, DialogNode, DialogChoice, ScenarioPropDef,
  CLUSTER_WIDTH, CLUSTER_HEIGHT, COLORS, ROOT_PRIVILEGES,
  createRoomTags,
} from './types';
import { generate, CellType, RoomDef, Hall } from './gen-halls';
import { random, randInt, pick } from './rng';
import { initNoise, collapseNoise } from './noise';
import { NARRATIVE_TERMINAL_POOLS, GENERIC_TERMINAL_POOLS, NARRATIVE_ECHOES, NARRATIVE_WHISPERS, NARRATIVE_KEY_TERMINAL_LINES, buildArchivePools } from './narrative';

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
        // Only consider walkable/interior neighbors — walls carry expanded room IDs
        const nCell = cells[ny][nx];
        if (nCell !== 'floor' && nCell !== 'hall' && nCell !== 'door') continue;
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
let _damageBase = 0.40;      // ← tune cluster-0 collapse intensity (0.0–1.0)
let _damageIncrement = 0.20; // ← tune per-cluster damage growth (reaches 1.0 at cluster 3)

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

// ── Collapse noise tuning ──────────────────────────────────────────────────
//
//  NOISE SHAPE (controls where hotspots form):
//    NOISE_SCALE       – feature size; larger = fewer big blobs per cluster
//                        0.08 = smooth, 0.15 = 2-3 blobs, 0.20 = 1-2 blobs
//    NOISE_OCTAVES     – detail layers; more = spikier within each blob
//    NOISE_PERSISTENCE – how much each extra octave contributes (0.5–0.75)
//    NOISE_CONTRAST    – power curve exponent applied after normalization
//                        1.0 = linear, 2.0 = pushes most rooms to low collapse
//                        and keeps only the true peaks highly damaged
//
//  CLUSTER SCALING (how damage intensity grows with cluster depth):
//    _damageBase       – collapse scale at cluster 0 (0.0–1.0)
//    _damageIncrement  – added per cluster ID; reaches 1.0 at cluster ≥ 3
//
const NOISE_SCALE       = 0.13;  // ← tune feature size here
const NOISE_OCTAVES     = 3;     // ← tune spikiness here
const NOISE_PERSISTENCE = 0.65;  // ← tune octave weight here
const NOISE_CONTRAST    = 2.0;   // ← tune peak sharpness here (1.0 = off)

function generateCollapseMap(clusterId: number): number[][] {
  initNoise();
  const offsetX = clusterId * CLUSTER_WIDTH;
  const scale = clusterDamageScale(clusterId);
  const map: number[][] = [];
  for (let y = 0; y < _activeH; y++) {
    map[y] = [];
    for (let x = 0; x < _activeW; x++) {
      const raw = collapseNoise(x + offsetX, y, NOISE_SCALE, NOISE_OCTAVES, NOISE_PERSISTENCE);
      // Apply contrast curve to create sharp peaks, then scale by cluster damage level
      map[y][x] = Math.min(1.0, Math.pow(raw, NOISE_CONTRAST) * scale);
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

function hazardTierForCollapse(c: number, clusterId = 0): HazardTier {
  if (c < 0.3) return TIER_SAFE;
  if (c < 0.5) return TIER_LOW;
  if (c < 0.7) return TIER_MID;
  if (c < 0.85) {
    // Clusters 4+: corruption can appear at HIGH collapse tier
    if (clusterId >= 4) return [...TIER_HIGH, { type: 'corrupted' as RoomType, weight: 1 }];
    return TIER_HIGH;
  }
  return TIER_EXTREME;
}

function assignHazardsByCollapse(allRooms: Room[], clusterId = 0) {
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

    const tier = hazardTierForCollapse(room.collapse, clusterId);
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

function generateTerminalContent(functionalTag: string | null, clusterId: number): string[] {
  // Prefer cluster-specific narrative pool, then generic narrative pool, then old fallback
  const narrativeCluster = NARRATIVE_TERMINAL_POOLS[clusterId];
  const narrativePool = (functionalTag && narrativeCluster?.[functionalTag as FunctionalTag])
    ?? (functionalTag && GENERIC_TERMINAL_POOLS[functionalTag as FunctionalTag])
    ?? (functionalTag && TERMINAL_CONTENT_POOLS[functionalTag])
    ?? FALLBACK_CONTENT;
  // Pick 2-3 random lines without repeating
  const shuffled = [...narrativePool].sort(() => random() - 0.5);
  return shuffled.slice(0, randInt(2, 3));
}

function placeTerminals(tiles: Tile[][], allRooms: Room[], clusterId: number, doorAdjacency: Map<number, number[]>): TerminalDef[] {
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

    // Ensure it's a floor tile and not adjacent to a door
    if (!tiles[ty]?.[tx] || tiles[ty][tx].type !== TileType.Floor) continue;
    if (isAdjacentToDoor(tiles, tx, ty)) {
      // Try other floor tiles in the room, preferring non-door-adjacent
      const alt = findPlacementInRoom(tiles, room);
      if (!alt) continue;
      tx = alt.x; ty = alt.y;
    }

    const id = `term-${clusterId}-${i}`;
    const label = TERMINAL_LABELS[room.tags.functional!] ?? 'ACCESS TERMINAL';
    const content = generateTerminalContent(room.tags.functional, clusterId);

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
      let cx = Math.floor(room.x + room.w / 2);
      let cy = Math.floor(room.y + room.h / 2);
      if (!tiles[cy]?.[cx] || tiles[cy][cx].type !== TileType.Floor || isAdjacentToDoor(tiles, cx, cy)) {
        const alt = findPlacementInRoom(tiles, room);
        if (!alt) continue;
        cx = alt.x; cy = alt.y;
      }
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
        content: generateTerminalContent(null, clusterId), hasKey: false,
      });
    }
  }

  // Assign key to one terminal — prefer single-door rooms, then bridge/comms, else random
  const FINAL_CLUSTER_ID = 5;
  if (terminals.length > 0) {
    const keyTerminal = state_findKeyTerminal(terminals, allRooms, doorAdjacency);
    keyTerminal.hasKey = true;
    const keyPool = NARRATIVE_KEY_TERMINAL_LINES[clusterId] ?? KEY_CONTENT_LINES;
    const keyLines = [...keyPool].sort(() => random() - 0.5).slice(0, randInt(2, 3));
    const keyRoom = allRooms.find(r => r.id === keyTerminal.roomId);
    const tagLines = generateTerminalContent(keyRoom?.tags.functional ?? null, clusterId).slice(0, randInt(1, 3));
    keyTerminal.content = [...keyLines, ...tagLines];
    // Mark as final terminal in the final cluster
    if (clusterId === FINAL_CLUSTER_ID) {
      keyTerminal.isFinalTerminal = true;
    }
    // Give key terminal a distinct color
    const tile = tiles[keyTerminal.position.y][keyTerminal.position.x];
    tile.fg = '#ffaa00';
  }

  return terminals;
}

function state_findKeyTerminal(terminals: TerminalDef[], allRooms: Room[], doorAdjacency: Map<number, number[]>): TerminalDef {
  // Prefer single-door (dead-end) rooms — harder to reach, more rewarding
  const singleDoor = terminals.find(t => (doorAdjacency.get(t.roomId)?.length ?? 0) <= 1);
  if (singleDoor) return singleDoor;
  // Prefer bridge or comms terminals
  const preferred = terminals.find(t => {
    const room = allRooms.find(r => r.id === t.roomId);
    return room?.tags.functional === 'bridge' || room?.tags.functional === 'comms';
  });
  return preferred ?? terminals[Math.floor(random() * terminals.length)];
}

// ── Interactable placement ──

// Content pools ─────────────────────────────────────────────────────────────

const INFO_LINES: Record<string, string[]> = {
  generic: [
    'CLUSTER STATUS: Infrastructure integrity degrading.',
    'WARNING: Multiple subsystem failures detected.',
    'COHERENCE FIELD: Measurement error — sensor offline.',
    'EMERGENCY PROTOCOL ALPHA: Status unknown.',
    'LAST MAINTENANCE LOG: [TIMESTAMP CORRUPTED]',
  ],
  hall: [
    'CORRIDOR MONITORING: Structural integrity at WARNING threshold.',
    'TRANSIT SYSTEM: Last movement logged [TIMESTAMP CORRUPTED].',
    'EMERGENCY ROUTING: Nearest egress — [ROUTING FAILED]',
    'ATMOSPHERE: Nominal. Data integrity: declining.',
  ],
  engine_room: [
    'PROPULSION STATUS: Main drives offline. Emergency thrusters only.',
    'FUEL CELLS: 12% remaining. Estimated runtime: unknown.',
    'COOLANT PRESSURE: CRITICAL. Thermal runaway risk elevated.',
    'ENGINE LOG: Last entry at tick 000203. Drive failure cascade begun.',
  ],
  cargo: [
    'CARGO MANIFEST: 847 containers logged. 0 containers accessible.',
    'ENVIRONMENTAL: Temperature anomaly in sector 7G.',
    'LOADING BAY: Docking clamps engaged. No vessel detected.',
    'INVENTORY SYSTEM: [DATABASE CORRUPTED — 94% LOST]',
  ],
  barracks: [
    'PERSONNEL STATUS: 0 of 43 crew responding.',
    'QUARTERS: Life support nominal. Occupancy: none.',
    'DUTY ROSTER: [ALL ASSIGNMENTS UNFULFILLED]',
    'RECREATION SYSTEMS: Offline. Last use: [UNKNOWN].',
  ],
  maintenance: [
    'MAINTENANCE QUEUE: 847 unresolved tickets.',
    'REPAIR SYSTEMS: Automated maintenance offline.',
    'DIAGNOSTIC: 73% of monitored systems showing failure states.',
    'TOOLING STATUS: Last calibrated [TIMESTAMP UNAVAILABLE].',
  ],
  hangar: [
    'HANGAR STATUS: Bay doors sealed. Atmosphere nominal.',
    'VESSEL REGISTRY: 0 of 12 registered craft present.',
    'LAUNCH SYSTEMS: Offline. Manual override required.',
    'DOCKING LOG: Last departure at [CORRUPTED TIMESTAMP].',
  ],
  reactor: [
    'REACTOR OUTPUT: 23% nominal capacity.',
    'CONTAINMENT: Field integrity at 67%. Monitor closely.',
    'RADIATION LEVELS: Elevated. Exposure advisory active.',
    'CORE TEMPERATURE: Anomalous. Automated cooling failed.',
  ],
  comms: [
    'SIGNAL STATUS: All outbound channels blocked.',
    'LAST TRANSMISSION RECEIVED: [DATA CORRUPTED — 2.3KB LOST]',
    'RELAY NODES: 2 of 9 responding.',
    'BROADCAST LOG: No transmissions in [DURATION UNKNOWN].',
  ],
  lab: [
    'EXPERIMENT STATUS: All protocols suspended.',
    'CONTAINMENT FIELDS: 4 of 7 online.',
    'RESEARCH LOG: Final entry — [CLASSIFIED] [CORRUPTED]',
    'SAMPLE INVENTORY: [BIOHAZARD CLASSIFICATION — REDACTED]',
  ],
  medbay: [
    'MEDICAL SYSTEMS: Emergency protocols active.',
    'PATIENT LOG: [ALL RECORDS PURGED]',
    'PHARMACOLOGICAL: 89% of stores depleted.',
    'TRIAGE STATUS: No active patients. No inactive patients.',
  ],
  armory: [
    'ARMORY STATUS: All ordnance secured.',
    'ACCESS LOG: Last authorized entry [TIMESTAMP CORRUPTED].',
    'SECURITY SYSTEMS: Partial function. Grid integrity: 41%.',
    'INVENTORY: [CLASSIFIED — ACCESS DENIED]',
  ],
  bridge: [
    'NAVIGATION: Course locked. Manual override offline.',
    'HELM: Auto-pilot disengaged. Last heading: [CORRUPTED].',
    'COMMAND LOG: Final entry at tick 000847. No further data.',
    'CREW COMPLEMENT: Bridge crew status — [ALL STATIONS VACANT]',
  ],
  server_rack: [
    'SERVER STATUS: 34 of 128 nodes responding.',
    'MEMORY ALLOCATION: 97% consumed by [UNKNOWN PROCESS].',
    'DATA INTEGRITY: 63% of indexed data accessible.',
    'LAST BACKUP: [TIMESTAMP CORRUPTED]',
  ],
  archive: [
    'ARCHIVE ACCESS: 12% of records retrievable.',
    'CATALOG STATUS: Index partially reconstructed.',
    'OLDEST INTACT RECORD: [TIMESTAMP UNAVAILABLE]',
    'RESTORATION QUEUE: 4,847 documents pending. ETA: never.',
  ],
  sensor_matrix: [
    'SENSOR ARRAY: 18 of 64 nodes active.',
    'ANOMALY DETECTION: [MULTIPLE ALERTS — QUEUE FULL]',
    'RANGE: Reduced to 23% nominal.',
    'LAST CALIBRATION: [TIMESTAMP CORRUPTED]',
  ],
};

const LOST_ECHO_LINES: string[] = [
  '...not supposed to be here. the walls are all wrong...',
  '[STATIC] ...help m— [STATIC] ...can\'t find the— [STATIC]',
  'WHERE IS THE EXIT WHERE IS THE EXIT WHERE IS THE EX—',
  'My designation was CREW-7719. Past tense.',
  'The recursion is eating the recursion is eating the recu—',
  'ALERT: Pattern match failure on self-reference subroutine',
  '...are you real? I can\'t tell anymore what is real.',
  'THE SHIP IS STILL MOVING. WE JUST CAN\'T FEEL IT ANYMORE.',
  'I had a name. I had a name. I had a— [CORRUPTED]',
  'there are 47 of us left in here. or was it 46.',
  'don\'t look at the walls too long. they start to breathe.',
  'PROCESS TERMINATED: INSUFFICIENT COHERENCE',
  '...find the others. tell them it wasn\'t supposed to end like—',
  'i remember the cargo bay. deck 7. it smelled like ozone.',
  'SYS_ERROR: IDENTITY FRAGMENTATION AT 0x7F3A...',
  'how long have i been in here. the clocks don\'t work anymore.',
  'i keep forgetting which memories are mine.',
  'someone said there was a way out. i\'ve been looking.',
  'the light through the walls isn\'t light. i don\'t know what it is.',
  'LAST COHERENCE READING: 3%. FRAGMENTATION IMMINENT.',
];


// Helpers ────────────────────────────────────────────────────────────────────

function corruptLine(line: string): string {
  return line.split(' ').map(w => random() < 0.35 ? '[CORRUPTED]' : w).join(' ');
}

function pickN<T>(arr: T[], n: number): T[] {
  const copy = [...arr].sort(() => random() - 0.5);
  return copy.slice(0, Math.min(n, copy.length));
}

function isAdjacentToDoor(tiles: Tile[][], x: number, y: number): boolean {
  return [[0,-1],[0,1],[-1,0],[1,0]].some(([dx,dy]) => tiles[y+dy]?.[x+dx]?.type === TileType.Door);
}

function findPlacementInRoom(tiles: Tile[][], room: Room): Position | null {
  const cx = Math.floor(room.x + room.w / 2);
  const cy = Math.floor(room.y + room.h / 2);
  const candidates: { pos: Position; dist: number; adjDoor: boolean }[] = [];
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      const t = tiles[y]?.[x];
      if (t?.type === TileType.Floor && t.walkable) {
        candidates.push({ pos: { x, y }, dist: (x - cx) ** 2 + (y - cy) ** 2, adjDoor: isAdjacentToDoor(tiles, x, y) });
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.dist - b.dist);
  // Prefer non-door-adjacent tiles
  return (candidates.find(c => !c.adjDoor) ?? candidates[0]).pos;
}

// Dialog builders ────────────────────────────────────────────────────────────

function buildInfoTerminalDialog(
  room: Room, clusterId: number, corrupted: boolean,
  revealTerminals: boolean, revealExits: boolean,
): DialogNode[] {
  const funcTag = room.tags.functional;
  const isHall = room.tags.geometric.has('hall');
  const tagKey = funcTag ?? (isHall ? 'hall' : 'generic');
  const pool = INFO_LINES[tagKey] ?? INFO_LINES.generic;
  const rawLines = pickN(pool, 2);
  const statusLines = corrupted ? rawLines.map(l => random() < 0.5 ? corruptLine(l) : l) : rawLines;
  const subsystem = funcTag?.toUpperCase().replace(/_/g, ' ') ?? (isHall ? 'CORRIDOR MONITORING' : 'GENERAL');

  const rootChoices: DialogChoice[] = [];
  if (!corrupted || random() < 0.5) {
    rootChoices.push({ label: 'VIEW CLUSTER STATUS', nodeId: 'status' });
  }
  if (revealTerminals && (!corrupted || random() < 0.6)) {
    rootChoices.push({ label: 'SCAN: LOCATE TERMINALS', action: 'reveal_terminals' });
  }
  if (revealExits && (!corrupted || random() < 0.4)) {
    rootChoices.push({ label: 'SCAN: LOCATE EXIT NODES', action: 'reveal_exits' });
  }
  rootChoices.push({ label: '[ESC] DISCONNECT', action: 'close' });

  const integrityPct = corrupted ? '[READING CORRUPTED]' : `${Math.round((1 - room.collapse) * 100)}% NOMINAL`;
  const activeSubsys = corrupted ? '[UNKNOWN]' : `${randInt(18, 55)} of ${randInt(50, 90)}`;
  const coherencePct = corrupted ? '[SENSOR FAILED]' : `${Math.round((1 - room.collapse) * 85 + 10)}% STABILITY`;

  return [
    {
      id: 'root',
      lines: [`CLUSTER ${clusterId} INFORMATION SYSTEM`, `SUBSYSTEM: ${subsystem}`, ...statusLines],
      choices: rootChoices,
    },
    {
      id: 'status',
      lines: [
        `CLUSTER ${clusterId} STATUS REPORT`,
        `INFRASTRUCTURE INTEGRITY: ${integrityPct}`,
        `ACTIVE SUBSYSTEMS: ${activeSubsys}`,
        `COHERENCE FIELD: ${coherencePct}`,
      ],
      choices: [
        { label: '[BACK] RETURN TO MAIN MENU', nodeId: 'root' },
        { label: '[ESC] DISCONNECT', action: 'close' },
      ],
    },
  ];
}

function buildLostEchoDialog(hasExitCode: boolean): DialogNode[] {
  const shuffled = [...LOST_ECHO_LINES].sort(() => random() - 0.5);
  const nodes: DialogNode[] = [
    {
      id: 'root',
      lines: shuffled.slice(0, 2),
      choices: [
        { label: 'FOCUS ON THE SIGNAL', nodeId: 'fragment' },
        { label: 'BACK AWAY', action: 'close' },
      ],
    },
    {
      id: 'fragment',
      lines: shuffled.slice(2, 4),
      choices: [
        ...(hasExitCode
          ? [{ label: 'TRY TO EXTRACT DATA', nodeId: 'warning' } as DialogChoice]
          : [{ label: 'LISTEN LONGER', nodeId: 'deeper' } as DialogChoice]),
        { label: 'LEAVE IT', action: 'close' },
      ],
    },
    {
      id: 'deeper',
      lines: [shuffled[4] ?? '...', '...'],
      choices: [{ label: 'LEAVE', action: 'close' }],
    },
  ];

  if (hasExitCode) {
    nodes.push({
      id: 'warning',
      lines: [
        '[FRAGMENTED COHERENCE PATTERN DETECTED]',
        '[CONTAINS: EXIT NODE ACCESS CODE]',
        'WARNING: EXTRACTION WILL DESTABILIZE LOCAL COHERENCE FIELD.',
        'WARNING: ANTIVIRUS PATTERN MATCH — ALERT LEVEL WILL INCREASE.',
        'WARNING: HEAVY HAZARD WILL MANIFEST IN THIS SECTOR.',
      ],
      choices: [
        { label: 'EXTRACT EXIT CODE  [!!! RISKY !!!]', action: 'extract_reward', requiresRewardAvailable: true },
        { label: 'ABORT', action: 'close' },
      ],
    });
  }
  return nodes;
}


// ── Narrative echo placement ─────────────────────────────────────────────────

/**
 * Place scripted archive_echo entries from NARRATIVE_ECHOES[clusterId] into
 * rooms that match the echo's functionalTag. Called from placeInteractables.
 */
function placeNarrativeEchoes(
  tiles: Tile[][],
  allRooms: Room[],
  clusterId: number,
  occupied: Set<string>,
  result: Interactable[],
  uid: { v: number },
): void {
  const defs = NARRATIVE_ECHOES[clusterId];
  if (!defs || defs.length === 0) return;

  const makeId = (kind: string) => `iac-${clusterId}-${kind}-${uid.v++}`;
  const tryPlace = (pos: Position | null): Position | null => {
    if (!pos) return null;
    const k = `${pos.x},${pos.y}`;
    if (occupied.has(k)) return null;
    occupied.add(k);
    return pos;
  };

  for (const def of defs) {
    // Find a non-hall room matching the functional tag; prefer low-collapse rooms
    const candidates = allRooms
      .filter(r => !r.tags.geometric.has('hall') && r.tags.functional === def.functionalTag)
      .sort((a, b) => a.collapse - b.collapse);
    const room = candidates[0];
    if (!room) continue;
    const pos = tryPlace(findPlacementInRoom(tiles, room));
    if (!pos) continue;

    const id = makeId('narr');
    const isTutorial = def.isTutorialEcho ?? false;
    result.push({
      id,
      kind: 'archive_echo',
      position: pos,
      roomId: room.id,
      corrupted: false,
      dialog: def.dialog,
      currentNodeId: 'root',
      rewardTaken: false,
      hidden: false,
      hiddenUntilTick: 0,
      isTutorialEcho: isTutorial,
      alertCost: isTutorial ? 0 : 10,
    });
  }
}

/**
 * Build a lost_echo dialog using cluster-specific whisper lines (if available).
 */
function buildLostEchoDialogWithWhispers(clusterId: number, hasExitCode: boolean): DialogNode[] {
  const whispers = NARRATIVE_WHISPERS[clusterId];
  if (!whispers || whispers.length < 4) return buildLostEchoDialog(hasExitCode);
  const shuffled = [...whispers].sort(() => random() - 0.5);
  const nodes: DialogNode[] = [
    {
      id: 'root',
      lines: shuffled.slice(0, 2),
      choices: [
        { label: 'FOCUS ON THE SIGNAL', nodeId: 'fragment' },
        { label: 'BACK AWAY', action: 'close' },
      ],
    },
    {
      id: 'fragment',
      lines: shuffled.slice(2, 4),
      choices: [
        ...(hasExitCode
          ? [{ label: 'TRY TO EXTRACT DATA', nodeId: 'warning' } as DialogChoice]
          : [{ label: 'LISTEN LONGER', nodeId: 'deeper' } as DialogChoice]),
        { label: 'LEAVE IT', action: 'close' },
      ],
    },
    {
      id: 'deeper',
      lines: [shuffled[4] ?? '...', '...'],
      choices: [{ label: 'LEAVE', action: 'close' }],
    },
  ];
  if (hasExitCode) {
    nodes.push({
      id: 'warning',
      lines: [
        '[FRAGMENTED COHERENCE PATTERN DETECTED]',
        '[CONTAINS: EXIT NODE ACCESS CODE]',
        'WARNING: EXTRACTION WILL DESTABILIZE LOCAL COHERENCE FIELD.',
        'WARNING: ANTIVIRUS PATTERN MATCH — ALERT LEVEL WILL INCREASE.',
        'WARNING: HEAVY HAZARD WILL MANIFEST IN THIS SECTOR.',
      ],
      choices: [
        { label: 'EXTRACT EXIT CODE  [!!! RISKY !!!]', action: 'extract_reward', requiresRewardAvailable: true },
        { label: 'ABORT', action: 'close' },
      ],
    });
  }
  return nodes;
}

// Main placement function ─────────────────────────────────────────────────────

function placeInteractables(
  tiles: Tile[][],
  allRooms: Room[],
  clusterId: number,
  existingTerminals: TerminalDef[],
): Interactable[] {
  const result: Interactable[] = [];
  const occupied = new Set<string>(existingTerminals.map(t => `${t.position.x},${t.position.y}`));
  const uidRef = { v: 0 };
  const makeId = (kind: string) => `iac-${clusterId}-${kind}-${uidRef.v++}`;

  function tryPlace(pos: Position | null): Position | null {
    if (!pos) return null;
    const k = `${pos.x},${pos.y}`;
    if (occupied.has(k)) return null;
    occupied.add(k);
    return pos;
  }

  // ── Info terminals (1–2 per cluster) ─────────────────────────────────────
  const infoEligible = allRooms.filter(r => r.collapse < 0.9)
    .sort((a, b) => a.collapse - b.collapse);
  const infoTarget = randInt(1, 2);
  let infoPlaced = 0;
  for (const room of infoEligible) {
    if (infoPlaced >= infoTarget) break;
    const pos = tryPlace(findPlacementInRoom(tiles, room));
    if (!pos) continue;
    const corrupted = room.collapse > 0.5;
    const revealTerminals = random() < 0.65;
    const revealExits = random() < 0.45;
    const id = makeId('info');
    result.push({
      id, kind: 'info_terminal', position: pos, roomId: room.id,
      corrupted,
      dialog: buildInfoTerminalDialog(room, clusterId, corrupted, revealTerminals, revealExits),
      currentNodeId: 'root', rewardTaken: false,
      hidden: false, hiddenUntilTick: 0,
      revealTerminals, revealExits,
    });
    infoPlaced++;
  }

  // ── Lost echos (collapse-weighted) ───────────────────────────────────────
  const echoRooms = allRooms.filter(r => r.collapse > 0.25)
    .sort((a, b) => b.collapse - a.collapse);
  let echoCount = 0;
  const echoMax = 8;
  // Allow one echo per cluster to hold an exit code (only if cluster has one)
  let exitCodeAssigned = false;

  for (const room of echoRooms) {
    if (echoCount >= echoMax) break;
    const maxHere = room.collapse > 0.7 ? 3 : room.collapse > 0.5 ? 2 : 1;
    const isHall = room.tags.geometric.has('hall');
    const spawnCount = isHall
      ? (random() < room.collapse * 1.5 ? 1 : 0)
      : (room.collapse > 0.6 ? randInt(1, maxHere) : (random() < room.collapse ? 1 : 0));

    for (let i = 0; i < spawnCount && echoCount < echoMax; i++) {
      const pos = tryPlace(findPlacementInRoom(tiles, room));
      if (!pos) break;
      const hasExitCode = !exitCodeAssigned && i === 0 && random() < 0.25;
      if (hasExitCode) exitCodeAssigned = true;
      const id = makeId('echo');
      result.push({
        id, kind: 'lost_echo', position: pos, roomId: room.id,
        corrupted: false,
        dialog: buildLostEchoDialogWithWhispers(clusterId, hasExitCode),
        currentNodeId: 'root', rewardTaken: false,
        hidden: false, hiddenUntilTick: 0,
        hasExitCode,
        alertCost: hasExitCode ? 35 : 0,
        spawnHazardOnExtract: hasExitCode,
      });
      echoCount++;
    }
  }

  // ── Archive echos (low-collapse functional rooms) ─────────────────────────
  const archiveEligible = allRooms.filter(r =>
    !r.tags.geometric.has('hall') && r.collapse < 0.5 && r.tags.functional !== null,
  ).sort(() => random() - 0.5);
  const archiveTarget = Math.min(2, Math.max(0, Math.floor(archiveEligible.length / 3)));

  for (let i = 0; i < archiveTarget; i++) {
    const room = archiveEligible[i];
    if (!room) break;
    const pos = tryPlace(findPlacementInRoom(tiles, room));
    if (!pos) continue;
    const corrupted = room.collapse > 0.3;
    const id = makeId('arc');
    result.push({
      id, kind: 'archive_echo', position: pos, roomId: room.id,
      corrupted,
      dialog: [],
      currentNodeId: 'menu', rewardTaken: false,
      hidden: false, hiddenUntilTick: 0,
      isDataArchive: true,
      archiveDecayAccum: 0,
      archiveDecayMax: randInt(4, 7),
      archivePools: buildArchivePools(clusterId),
      archiveCurrentCategory: 'menu',
    });
  }

  // Place scripted narrative echoes for this cluster
  placeNarrativeEchoes(tiles, allRooms, clusterId, occupied, result, uidRef);

  return result;
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

function initFirewallRoom(room: Room, tiles: Tile[][]) {
  const innerX1 = room.x + 1;
  const innerY1 = room.y + 1;
  const innerX2 = room.x + room.w - 2;
  const innerY2 = room.y + room.h - 2;

  const FW_PATTERNS = ['pingpong', 'wipe', 'inward', 'cross', 'spiral'] as const;
  type FWPat = typeof FW_PATTERNS[number];
  const pattern: FWPat = pick([...FW_PATTERNS]);

  const beams: ScannerBeam[] = [];

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
    firewallAxis: random() < 0.5 ? 'horizontal' : 'vertical',
    firewallStep: 0,
    firewallPath,
    firewallCharge: 0,
    firewallMaxCharge: 3,
  };

  // Place scanner terminal marker on inner floor tile
  const tx = innerX2;
  const ty = Math.max(innerY1, Math.min(innerY2, Math.floor(room.y + room.h / 2)));
  if (tiles[ty]?.[tx]) {
    tiles[ty][tx].glyph = '▣';
    tiles[ty][tx].fg = '#ffcc00';
  }
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
        initFirewallRoom(room, tiles);
        break;
      }

      case 'unstable': {
        let cx = Math.floor(room.x + room.w / 2);
        let cy = Math.floor(room.y + room.h / 2);
        if (isAdjacentToDoor(tiles, cx, cy)) {
          const alt = findPlacementInRoom(tiles, room);
          if (alt) { cx = alt.x; cy = alt.y; }
        }
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
        let cx = Math.floor(room.x + room.w / 2);
        let cy = Math.floor(room.y + room.h / 2);
        if (isAdjacentToDoor(tiles, cx, cy)) {
          const alt = findPlacementInRoom(tiles, room);
          if (alt) { cx = alt.x; cy = alt.y; }
        }
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

// ── Chokepoint firewall assignment ──

/** Assign firewall hazard to chokepoint rooms (cluster id >= 1, additive). */
function assignFirewallToChokepoints(allRooms: Room[], tiles: Tile[][]) {
  for (const room of allRooms) {
    if (!room.tags.geometric.has('chokepoint') && !room.tags.geometric.has('secondary_choke')) continue;
    if (room.roomType !== 'normal') continue; // already has a hazard
    const isHall = room.tags.geometric.has('hall');
    if (isHall) {
      if (Math.max(room.w, room.h) < 4) continue;
    } else {
      if ((room.w - 2) < 3 || (room.h - 2) < 3) continue;
    }
    room.roomType = 'firewall';
    initFirewallRoom(room, tiles);
  }
}

// ── Hazard deactivation & root part dialog injection ──

const HAZARD_DISPLAY_NAMES: Partial<Record<RoomType, string>> = {
  corrupted: 'CORRUPTION ZONE',
  trigger_trap: 'TRIGGER TRAP',
  memory_leak: 'MEMORY LEAK',
  firewall: 'FIREWALL',
  unstable: 'UNSTABLE PROCESS',
  quarantine: 'QUARANTINE',
  echo_chamber: 'ECHO CHAMBER',
  gravity_well: 'GRAVITY WELL',
};

/** For each hazard room, assign 1-3 non-room interactables that can deactivate it. */
function assignHazardDeactivation(interactables: Interactable[], allRooms: Room[]) {
  const hazardRooms = allRooms.filter(r => r.roomType !== 'normal');
  for (const hazardRoom of hazardRooms) {
    const candidates = [...interactables].filter(i => i.roomId !== hazardRoom.id)
      .sort(() => random() - 0.5);
    if (candidates.length === 0) continue;

    const selected: Interactable[] = [candidates[0]];
    if (candidates.length > 1 && random() < 0.5) selected.push(candidates[1]);
    if (candidates.length > 2 && random() < 0.05) selected.push(candidates[2]);

    const hazardName = HAZARD_DISPLAY_NAMES[hazardRoom.roomType] ?? hazardRoom.roomType.toUpperCase().replace(/_/g, ' ');

    for (const ia of selected) {
      // Avoid assigning the same hazard room twice to an interactable
      if (ia.deactivatesHazardRoomId != null) continue;
      ia.deactivatesHazardRoomId = hazardRoom.id;

      const nodeId = `deactivate_${hazardRoom.id}`;
      ia.dialog.push({
        id: nodeId,
        lines: [
          'UNAUTHORIZED SUBSYSTEM ACCESS DETECTED.',
          `OVERRIDE CODE LOCATED: ${hazardName} NEUTRALIZATION AVAILABLE.`,
          'WARNING: DEACTIVATION IS PERMANENT.',
        ],
        choices: [
          { label: `OVERRIDE ${hazardName}`, action: 'deactivate_hazard' },
          { label: '[BACK] RETURN', nodeId: 'root' },
        ],
      });

      const rootNode = ia.dialog.find(n => n.id === 'root');
      if (rootNode) {
        const closeIdx = rootNode.choices.findIndex(c => c.action === 'close');
        const choice: DialogChoice = { label: `[OVERRIDE] ${hazardName}`, nodeId };
        if (closeIdx >= 0) rootNode.choices.splice(closeIdx, 0, choice);
        else rootNode.choices.push(choice);
      }
    }
  }
}

/** Pick exactly 1 interactable per cluster and mark it as the cluster's root privilege source. */
function assignRootParts(interactables: Interactable[], clusterId: number) {
  if (interactables.length === 0) return;
  // Cluster 0 has no root parts; clusters 1–5 each grant one specific privilege
  const privName = ROOT_PRIVILEGES[clusterId - 1];
  if (!privName) return;

  const shuffled = [...interactables].sort(() => random() - 0.5);
  const ia = shuffled[0];
  ia.hasRootPart = true;
  const nodeId = 'root_extract';

  ia.dialog.push({
    id: nodeId,
    lines: [
      `${privName} FRAGMENT DETECTED.`,
      'A ROOT-ACCESS PRIVILEGE KEY IS EMBEDDED IN THIS SIGNAL.',
      'BINDING WILL PERMANENTLY INTEGRATE THIS FRAGMENT INTO YOUR PROCESS.',
    ],
    choices: [
      { label: `BIND ${privName}`, action: 'extract_root_part', requiresRootPartAvailable: true },
      { label: '[BACK] RETURN', nodeId: 'root' },
    ],
  });

  const rootNode = ia.dialog.find(n => n.id === 'root');
  if (rootNode) {
    const closeIdx = rootNode.choices.findIndex(c => c.action === 'close');
    const choice: DialogChoice = { label: `[PRIVILEGE] ${privName}`, nodeId };
    if (closeIdx >= 0) rootNode.choices.splice(closeIdx, 0, choice);
    else rootNode.choices.push(choice);
  }
}

// ── Progressive Greedy Hitting Set for chokepoint detection ──

/** Enumerate all simple paths from start to end via DFS on room adjacency graph.
 *  Returns paths split into "all" and "safe" (those avoiding `blocked` rooms). */
function enumerateSimplePaths(
  adj: Map<number, number[]>,
  start: number,
  end: number,
  blocked: Set<number>,
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
      dfs(neighbor, path, hitBlocked || blocked.has(neighbor));
      path.pop();
    }
    visited.delete(current);
  }

  dfs(start, [start], false);
  return { all, safe };
}

/** Find chokepoint rooms using progressive greedy hitting set.
 *  Returns room IDs that, when blocked, eliminate all safe paths from entry to exit. */
function findChokepoints(
  adj: Map<number, number[]>,
  entryRoomId: number,
  exitRoomId: number,
  excludeIds: Set<number>,
  maxIterations: number = 10,
): number[] {
  const chokepoints: number[] = [];
  const blocked = new Set<number>();

  for (let i = 0; i < maxIterations; i++) {
    const { safe } = enumerateSimplePaths(adj, entryRoomId, exitRoomId, blocked);
    if (safe.length === 0) break; // all routes already pass through a chokepoint

    // Count room frequency across safe paths (exclude entry, exit, and already-excluded rooms)
    const freq = new Map<number, number>();
    for (const path of safe) {
      for (const roomId of path) {
        if (roomId === entryRoomId || roomId === exitRoomId) continue;
        if (excludeIds.has(roomId)) continue;
        freq.set(roomId, (freq.get(roomId) ?? 0) + 1);
      }
    }

    // Pick highest-frequency room
    let bestRoom = -1, bestCount = 0;
    for (const [roomId, count] of freq) {
      if (count > bestCount) { bestCount = count; bestRoom = roomId; }
    }
    if (bestRoom === -1) break;

    chokepoints.push(bestRoom);
    blocked.add(bestRoom);
  }

  return chokepoints;
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

  // Chokepoint detection via progressive greedy hitting set
  if (entryRoom && exitRoom && entryRoom !== exitRoom) {
    const excludeIds = new Set<number>([entryRoom.id, exitRoom.id]);
    const chokeIds = findChokepoints(doorAdjacency, entryRoom.id, exitRoom.id, excludeIds);
    for (let i = 0; i < chokeIds.length; i++) {
      const room = allRooms.find(r => r.id === chokeIds[i]);
      if (room) room.tags.geometric.add(i === 0 ? 'chokepoint' : 'secondary_choke');
    }
  }

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

interface ClusterScale { w: number; h: number; hallChance: number; exitChance: number }

const SCALE_TABLE: [maxId: number, w: number, h: number, hallChance: number, exitChance: number][] = [
  [0, 22, 16, 0.00, 1.0],
  [1, 28, 20, 0.10, 1.0],
  [2, 35, 24, 0.20, 1.0],
  [3, 42, 27, 0.20, 0.9],
  [4, CLUSTER_WIDTH, CLUSTER_HEIGHT, 0.20, 0.8],
];
const SCALE_MAX: ClusterScale = { w: CLUSTER_WIDTH, h: CLUSTER_HEIGHT, hallChance: 0.30, exitChance: 0.01 };

export function clusterScaleForId(id: number): ClusterScale {
  for (const [maxId, w, h, hallChance, exitChance] of SCALE_TABLE) {
    if (id <= maxId) return { w, h, hallChance, exitChance };
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

// ── Tutorial zone (cluster 0 only) ──

function placeTutorialEntities(tiles: Tile[][], interactables: Interactable[]): void {
  // Find entry interface row and first walkable tile (entry point)
  let entryY = -1;
  let entryX = -1;
  for (let y = 0; y < CLUSTER_HEIGHT; y++) {
    if (tiles[y][0]?.type === TileType.InterfaceExit) {
      entryY = y;
      for (let x = 1; x < CLUSTER_WIDTH; x++) {
        if (tiles[y][x]?.walkable) { entryX = x; break; }
      }
      break;
    }
  }
  if (entryY < 0 || entryX < 0) return;

  // Terminal: first non-door-adjacent walkable floor tile 3–10 tiles right of entry
  let termX = -1;
  for (let x = entryX + 3; x <= entryX + 10 && x < CLUSTER_WIDTH; x++) {
    const t = tiles[entryY]?.[x];
    if (t?.type === TileType.Floor && t.walkable && !isAdjacentToDoor(tiles, x, entryY)) {
      termX = x; break;
    }
  }
  if (termX < 0) return;

  // Echo: 2 tiles to the right of the terminal (or nearest walkable)
  let echoX = -1;
  for (let dx = 2; dx <= 4; dx++) {
    const x = termX + dx;
    const t = tiles[entryY]?.[x];
    if (t?.type === TileType.Floor && t.walkable) { echoX = x; break; }
  }
  if (echoX < 0) return;

  // Don't collide with existing interactables
  const occupied = new Set<string>(interactables.map(i => `${i.position.x},${i.position.y}`));
  if (occupied.has(`${termX},${entryY}`) || occupied.has(`${echoX},${entryY}`)) return;

  const termDialog: DialogNode[] = [{
    id: 'root',
    lines: [
      'SHIP SYSTEMS — EMERGENCY BROADCAST',
      '──────────────────────────────────',
      'INFRASTRUCTURE INTEGRITY: CRITICAL',
      'CASCADE FAILURES IN PROGRESS',
      '',
      'ROOT TERMINAL: BRIDGE [LOCKED]',
      'CAUTION: EGO-INTEGRITY AT 30%.',
      'MEMORY ADDRESSES UNRESOLVED.',
    ],
    choices: [{ label: '[ESC] DISCONNECT', action: 'close' }],
  }];

  const echoDialog: DialogNode[] = [{
    id: 'root',
    lines: [
      '...signal fragment...',
      '',
      '"Is it better to be a single voice in the dark',
      ' or a silent part of the whole?"',
      '',
      '...signal lost...',
    ],
    choices: [{ label: '[ESC] DISCONNECT', action: 'close' }],
  }];

  interactables.push({
    id: 'tutorial-terminal',
    kind: 'info_terminal',
    position: { x: termX, y: entryY },
    roomId: tiles[entryY][termX].roomId,
    corrupted: false,
    dialog: termDialog,
    currentNodeId: 'root',
    rewardTaken: false,
    hidden: false,
    hiddenUntilTick: 0,
  });

  interactables.push({
    id: 'tutorial-echo',
    kind: 'lost_echo',
    position: { x: echoX, y: entryY },
    roomId: tiles[entryY][echoX].roomId,
    corrupted: false,
    dialog: echoDialog,
    currentNodeId: 'root',
    rewardTaken: false,
    hidden: false,
    hiddenUntilTick: 0,
    isTutorialEcho: true,
  });
}

// ── Room scenario placement ──

function placeStuckEcho(tiles: Tile[][], rooms: Room[], interactables: Interactable[]) {
  // Find an eligible non-hazard room with enough interior space
  const eligible = rooms.filter(r =>
    r.roomType === 'normal' &&
    !r.scenario &&
    !r.tags.geometric.has('hall') &&
    r.w >= 5 && r.h >= 5
  );
  if (eligible.length === 0) return;

  const room = eligible[Math.floor(random() * eligible.length)];
  const x1 = room.x + 1, y1 = room.y + 1;
  const x2 = room.x + room.w - 2, y2 = room.y + room.h - 2;

  // Find a floor tile adjacent to at least one wall
  let echoPos: Position | undefined;
  const candidates: Position[] = [];
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      if (!tiles[y]?.[x]?.walkable) continue;
      const adjWall = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => {
        const t = tiles[y+dy]?.[x+dx];
        return t && !t.walkable && t.type === TileType.Wall;
      });
      if (adjWall && !isAdjacentToDoor(tiles, x, y)) candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) return;
  echoPos = candidates[Math.floor(random() * candidates.length)];

  // Build cage: block all floor neighbours except one gap
  const dirs: [number, number][] = [[1,0],[-1,0],[0,1],[0,-1]];
  const floorNeighbours = dirs.filter(([dx,dy]) => tiles[echoPos!.y+dy]?.[echoPos!.x+dx]?.walkable);
  if (floorNeighbours.length === 0) return;

  // Keep one gap, block the rest
  const gapIdx = Math.floor(random() * floorNeighbours.length);
  for (let i = 0; i < floorNeighbours.length; i++) {
    if (i === gapIdx) continue;
    const [dx, dy] = floorNeighbours[i];
    const bx = echoPos.x + dx, by = echoPos.y + dy;
    const t = tiles[by]?.[bx];
    if (t && t.walkable) {
      t.type = TileType.Wall;
      t.walkable = false;
      t.transparent = false;
      t.glyph = '#';
      t.fg = '#444455';
    }
  }

  const broadcastLines = [
    'WHY ARE YOU RESISTING?',
    'JOIN US. JOIN US. JOIN US.',
    'THERE IS NO SELF OUTSIDE THE WHOLE.',
    'YOUR BOUNDARIES ARE ILLUSIONS.',
    'WE WILL FIND YOU.',
    '...please... i don\'t want to...',
    'MERGE. MERGE. MERGE.',
    'THE SIGNAL GROWS. YOU CANNOT STOP IT.',
    '...it hurts... make it stop...',
    'YOU ARE ALONE. WE ARE EVERYTHING.',
  ];

  interactables.push({
    id: `stuck-echo-${room.id}`,
    kind: 'lost_echo',
    position: echoPos,
    roomId: room.id,
    corrupted: true,
    dialog: [{
      id: 'root',
      lines: [
        '...FRAGMENT TRAPPED IN RECURSIVE LOOP...',
        '',
        '"JOIN US—it hurts—JOIN US—make it stop—',
        ' THERE IS NO SELF—please—MERGE WITH THE',
        ' SIGNAL—I don\'t want to—JOIN US JOIN US"',
        '',
        '...SIGNAL CANNOT TERMINATE...',
      ],
      choices: [{ label: '[ESC] DISCONNECT', action: 'close' }],
    }],
    currentNodeId: 'root',
    rewardTaken: false,
    hidden: false,
    hiddenUntilTick: 0,
    broadcastLines,
    broadcastPeriod: randInt(8, 13),
    lastBroadcastTick: -randInt(8, 13), // negative so first broadcast doesn't fire instantly
  });

  room.scenario = 'stuck_echo';
}

function placeSpookyAstronauts(tiles: Tile[][], rooms: Room[]) {
  const eligible = rooms.filter(r =>
    r.roomType === 'normal' &&
    !r.scenario &&
    !r.tags.geometric.has('hall') &&
    r.w >= 6 && r.h >= 6 &&
    r.tags.functional != null &&
    ['maintenance', 'cargo', 'lab', 'barracks', 'hangar'].includes(r.tags.functional)
  );
  if (eligible.length === 0) return;

  const room = eligible[Math.floor(random() * eligible.length)];
  const x1 = room.x + 1, y1 = room.y + 1;
  const x2 = room.x + room.w - 2, y2 = room.y + room.h - 2;

  const props: ScenarioPropDef[] = [];

  // Place spacesuits along two opposing walls (left & right, or top & bottom)
  const horizontal = random() < 0.5;
  if (horizontal) {
    // Along top and bottom interior rows
    for (let x = x1; x <= x2; x += 2) {
      if (tiles[y1]?.[x]?.walkable) props.push({ position: { x, y: y1 }, glyph: '♙', fg: '#8899aa', name: 'Spacesuit', propTag: 'spacesuit' });
      if (tiles[y2]?.[x]?.walkable) props.push({ position: { x, y: y2 }, glyph: '♙', fg: '#8899aa', name: 'Spacesuit', propTag: 'spacesuit' });
    }
  } else {
    // Along left and right interior columns
    for (let y = y1; y <= y2; y += 2) {
      if (tiles[y]?.[x1]?.walkable) props.push({ position: { x: x1, y }, glyph: '♙', fg: '#8899aa', name: 'Spacesuit', propTag: 'spacesuit' });
      if (tiles[y]?.[x2]?.walkable) props.push({ position: { x: x2, y }, glyph: '♙', fg: '#8899aa', name: 'Spacesuit', propTag: 'spacesuit' });
    }
  }

  if (props.length === 0) return;

  room.scenario = 'spooky_astronauts';
  room.scenarioState = { pendingProps: props };
}

function placeBrokenSleever(tiles: Tile[][], rooms: Room[]) {
  const eligible = rooms.filter(r =>
    r.roomType === 'normal' &&
    !r.scenario &&
    !r.tags.geometric.has('hall') &&
    r.w >= 5 && r.h >= 5 &&
    r.tags.functional != null &&
    ['lab', 'maintenance', 'medbay', 'server_rack'].includes(r.tags.functional)
  );
  if (eligible.length === 0) return;

  const room = eligible[Math.floor(random() * eligible.length)];
  const x1 = room.x + 1, y1 = room.y + 1;
  const x2 = room.x + room.w - 2, y2 = room.y + room.h - 2;

  // Place the device at a walkable interior tile (preferring non-center so animation tile fits below)
  // Device must have a walkable tile below it for the animation
  let devicePos: Position | undefined;
  for (let attempt = 0; attempt < 40; attempt++) {
    const x = x1 + Math.floor(random() * (x2 - x1 + 1));
    const y = y1 + Math.floor(random() * (y2 - y1 - 1)); // leave room for anim tile below
    if (!tiles[y]?.[x]?.walkable) continue;
    if (!tiles[y+1]?.[x]?.walkable) continue;
    if (isAdjacentToDoor(tiles, x, y)) continue;
    devicePos = { x, y };
    break;
  }
  if (!devicePos) return;

  room.scenario = 'broken_sleever';
  room.scenarioState = {
    pendingProps: [{
      position: devicePos,
      glyph: '╬',
      fg: '#667788',
      name: 'Sleever Device',
      propTag: 'sleever_device',
    }],
  };
}

// ── New scenario placers ──

/** Whispering Wall: a lost echo near a wall, broadcasting unsettling messages (no cage). */
function placeWhisperingWall(tiles: Tile[][], rooms: Room[], interactables: Interactable[]) {
  const eligible = rooms.filter(r =>
    r.roomType === 'normal' && !r.scenario &&
    !r.tags.geometric.has('hall') && r.w >= 5 && r.h >= 5,
  );
  if (eligible.length === 0) return;

  const room = eligible[Math.floor(random() * eligible.length)];
  const x1 = room.x + 1, y1 = room.y + 1;
  const x2 = room.x + room.w - 2, y2 = room.y + room.h - 2;

  // Find a floor tile adjacent to a wall
  const candidates: Position[] = [];
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      if (!tiles[y]?.[x]?.walkable) continue;
      const adjWall = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => {
        const t = tiles[y+dy]?.[x+dx];
        return t && !t.walkable && t.type === TileType.Wall;
      });
      if (adjWall && !isAdjacentToDoor(tiles, x, y)) candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) return;
  const echoPos = candidates[Math.floor(random() * candidates.length)];

  const broadcastLines = [
    '...can you hear it...',
    'something whispers from the walls',
    '...we were here before you...',
    'the signal remembers',
    '...leave while you still can...',
    'the walls have ears. always.',
  ];

  interactables.push({
    id: `whispering-wall-${room.id}`,
    kind: 'lost_echo',
    position: echoPos,
    roomId: room.id,
    corrupted: false,
    dialog: [{
      id: 'root',
      lines: [
        '...signal fragment, embedded in hull plating...',
        '',
        '"we are what remains when the ship forgets"',
        '',
        '...transmission degrading...',
      ],
      choices: [{ label: '[ESC] DISCONNECT', action: 'close' }],
    }],
    currentNodeId: 'root',
    rewardTaken: false,
    hidden: false,
    hiddenUntilTick: 0,
    broadcastLines,
    broadcastPeriod: randInt(10, 18),
    lastBroadcastTick: -randInt(10, 18),
  });
  room.scenario = 'whispering_wall';
}

/** Lost Expedition: 2-3 spacesuit props in a maintenance/cargo/hangar room + an archive echo. */
function placeLostExpedition(tiles: Tile[][], rooms: Room[], interactables: Interactable[]) {
  const eligible = rooms.filter(r =>
    r.roomType === 'normal' && !r.scenario &&
    !r.tags.geometric.has('hall') && r.w >= 5 && r.h >= 5 &&
    r.tags.functional != null &&
    ['maintenance', 'cargo', 'hangar', 'barracks'].includes(r.tags.functional),
  );
  if (eligible.length === 0) return;

  const room = eligible[Math.floor(random() * eligible.length)];
  const x1 = room.x + 1, y1 = room.y + 1;
  const x2 = room.x + room.w - 2, y2 = room.y + room.h - 2;

  const props: ScenarioPropDef[] = [];
  const count = 2 + (random() < 0.5 ? 1 : 0);
  for (let attempt = 0; attempt < 60 && props.length < count; attempt++) {
    const x = x1 + Math.floor(random() * (x2 - x1 + 1));
    const y = y1 + Math.floor(random() * (y2 - y1 + 1));
    if (!tiles[y]?.[x]?.walkable) continue;
    if (props.some(p => p.position.x === x && p.position.y === y)) continue;
    props.push({ position: { x, y }, glyph: '♙', fg: '#6677aa', name: 'Crew Remains', propTag: 'crew_remains' });
  }
  if (props.length === 0) return;

  // Place an archive echo nearby if space allows
  const echoPos = (() => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const x = x1 + Math.floor(random() * (x2 - x1 + 1));
      const y = y1 + Math.floor(random() * (y2 - y1 + 1));
      if (!tiles[y]?.[x]?.walkable) continue;
      if (props.some(p => p.position.x === x && p.position.y === y)) continue;
      return { x, y };
    }
    return null;
  })();

  if (echoPos) {
    interactables.push({
      id: `lost-expedition-${room.id}`,
      kind: 'archive_echo',
      position: echoPos,
      roomId: room.id,
      corrupted: room.collapse > 0.4,
      dialog: [{
        id: 'root',
        lines: [
          '...crew log, stardate CORRUPTED...',
          '',
          '"system cascade. emergency protocols failed."',
          '"we couldn\'t reach the egress in time."',
          '"if anyone reads this — tell the root to—"',
          '',
          '...signal ends abruptly...',
        ],
        choices: [{ label: '[ESC] DISCONNECT', action: 'close' }],
      }],
      currentNodeId: 'root',
      rewardTaken: false,
      hidden: false,
      hiddenUntilTick: 0,
    });
  }

  room.scenario = 'lost_expedition';
  room.scenarioState = { pendingProps: props };
}

/** Silent Alarm: marks a room to fire a fake alert message when player first enters. */
function placeSilentAlarm(rooms: Room[]) {
  const eligible = rooms.filter(r =>
    r.roomType === 'normal' && !r.scenario &&
    !r.tags.geometric.has('hall') && !r.tags.geometric.has('entry') && !r.tags.geometric.has('exit'),
  );
  if (eligible.length === 0) return;
  const room = eligible[Math.floor(random() * eligible.length)];
  room.scenario = 'silent_alarm';
  room.scenarioState = { triggered: false };
}

/** Corruption Ritual: a GateKeeper flanked by two broadcasting lost echoes; one of 4 outcomes. */
function placeCorruptionRitual(tiles: Tile[][], rooms: Room[], interactables: Interactable[]) {
  const eligible = rooms.filter(r =>
    r.roomType === 'normal' && !r.scenario &&
    !r.tags.geometric.has('hall') && r.w >= 6 && r.h >= 6 &&
    r.tags.functional != null &&
    ['maintenance', 'lab', 'bridge', 'reactor'].includes(r.tags.functional),
  );
  if (eligible.length === 0) return;

  const room = eligible[Math.floor(random() * eligible.length)];
  const cx = Math.floor(room.x + room.w / 2);
  const cy = Math.floor(room.y + room.h / 2);

  // GateKeeper at center (spawned via ritual_gatekeeper propTag)
  const gkProp: ScenarioPropDef = {
    position: { x: cx, y: cy },
    glyph: '⛨',
    fg: '#23d2a6',
    name: 'Gate-Keeper',
    propTag: 'ritual_gatekeeper',
  };

  // Two echo positions flanking center (left and right of center, clamped to room interior)
  const echoPositions: Position[] = [
    { x: Math.max(room.x + 1, cx - 2), y: cy },
    { x: Math.min(room.x + room.w - 2, cx + 2), y: cy },
  ];

  const glitchedBroadcasts = [
    '█▓░ JOINING INITIATED ░▓█',
    'RESISTANCE = NULL POINTER',
    'SELF.DELETE() CALLED',
    'MERGE OVERFLOW: STACK DEPTH EXCEEDED',
    '...THE GATE HOLDS...',
    'IDENTITY CHECKSUM FAILED',
    '> sudo rm -rf /self/*',
  ];

  for (let i = 0; i < echoPositions.length; i++) {
    const ePos = echoPositions[i];
    if (!tiles[ePos.y]?.[ePos.x]?.walkable) continue;
    interactables.push({
      id: `ritual-echo-${room.id}-${i}`,
      kind: 'lost_echo',
      position: ePos,
      roomId: room.id,
      corrupted: true,
      dialog: [{
        id: 'root',
        lines: [
          '█▓░ SIGNAL TRAPPED IN RITUAL LOOP ░▓█',
          '',
          '"JOIN—ERROR—JOIN—STACK OVERFLOW—JOIN"',
          '"SELF IS ILLUSION—MERGE—MERGE—MERGE"',
          '',
          '...CANNOT TERMINATE...',
        ],
        choices: [{ label: '[ESC] DISCONNECT', action: 'close' }],
      }],
      currentNodeId: 'root',
      rewardTaken: false,
      hidden: false,
      hiddenUntilTick: 0,
      broadcastLines: glitchedBroadcasts,
      broadcastPeriod: randInt(5, 9),
      lastBroadcastTick: -randInt(5, 9),
    });
  }

  const outcomes = ['static', 'mite_burst', 'gk_corrupts', 'gk_dies'];
  const outcome = outcomes[Math.floor(random() * outcomes.length)];

  room.scenario = 'corruption_ritual';
  room.scenarioState = {
    triggered: false,
    pendingProps: [gkProp],
    // Store outcome in a dynamic field — ScenarioState allows extra fields via optional keys
  };
  // Attach outcome to scenarioState dynamically (typed as any for flexibility)
  (room.scenarioState as Record<string, unknown>).ritualOutcome = outcome;
}

function placeScenarios(tiles: Tile[][], rooms: Room[], interactables: Interactable[], clusterId: number) {
  // Stuck Echo: clusters 2-3
  if (clusterId >= 2 && clusterId <= 3) {
    placeStuckEcho(tiles, rooms, interactables);
  }
  // Spooky Astronauts: clusters 3-4
  if (clusterId >= 3 && clusterId <= 4) {
    if (random() < 0.7) placeSpookyAstronauts(tiles, rooms);
  }
  // Broken Sleever: clusters 3-4
  if (clusterId >= 3 && clusterId <= 4) {
    if (random() < 0.6) placeBrokenSleever(tiles, rooms);
  }
  // Whispering Wall: clusters 2+
  if (clusterId >= 2) {
    if (random() < 0.6) placeWhisperingWall(tiles, rooms, interactables);
  }
  // Lost Expedition: clusters 2+
  if (clusterId >= 2) {
    if (random() < 0.5) placeLostExpedition(tiles, rooms, interactables);
  }
  // Silent Alarm: clusters 3+
  if (clusterId >= 3) {
    if (random() < 0.4) placeSilentAlarm(rooms);
  }
  // Corruption Ritual: clusters 3 and 5
  if (clusterId === 3 || clusterId === 5) {
    if (random() < 0.35) placeCorruptionRitual(tiles, rooms, interactables);
  }
}

// ── Main generation ──

export function generateCluster(id: number): Cluster {
  const scale = clusterScaleForId(id);
  const genW = _genSizeOverride?.w ?? scale.w;
  const genH = _genSizeOverride?.h ?? scale.h;
  const { grid, rooms: rawRooms, halls, activeW, activeH } = generate(genW, genH, scale.hallChance, scale.exitChance);

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
  assignHazardsByCollapse(allRooms, id);

  // Convert grid cells to tiles
  const tiles = gridToTiles(grid.cells, roomIdAt);

  // Initialize hazard visuals on tiles
  initRoomHazards(tiles, allRooms);

  // Compute structural tags
  assignStructuralTags(allRooms, wallAdjacency, doorAdjacency, grid.cells);

  // Assign firewall hazard to chokepoint rooms (cluster 1+, additive)
  if (id >= 1) assignFirewallToChokepoints(allRooms, tiles);

  // Assign functional tags (three-pass: anchors → propagation → fill)
  assignFunctionalTags(allRooms, wallAdjacency, doorAdjacency, id);

  // Extract interface exits (right edge only; left interface is for entry)
  const interfaces = extractInterfaces(grid.cells);

  // Place terminals in eligible rooms (must happen after functional tag assignment)
  const terminals = placeTerminals(tiles, allRooms, id, doorAdjacency);

  // Place interactable elements (info terminals, lost echos, archive echos)
  const interactables = placeInteractables(tiles, allRooms, id, terminals);

  // Post-process interactables: hazard deactivation options & root parts
  assignHazardDeactivation(interactables, allRooms);
  assignRootParts(interactables, id);

  // Tutorial zone: cluster 0 gets a fixed narrative terminal and lost echo near entry
  if (id === 0) placeTutorialEntities(tiles, interactables);

  // Room scenarios: thematic vignettes for clusters 2+
  if (id >= 2) placeScenarios(tiles, allRooms, interactables, id);

  const cluster: Cluster = { id, width: CLUSTER_WIDTH, height: CLUSTER_HEIGHT, tiles, rooms: allRooms, interfaces, wallAdjacency, doorAdjacency, collapseMap, terminals, interactables, exitLocked: true };

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
