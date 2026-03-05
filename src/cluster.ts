import {
  Cluster, Tile, TileType, Room, Position, InterfaceExit,
  RoomType, CorruptionStage, HazardOverlayType, FunctionalTag,
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

// ── Wall glyph selection ──

function isOuterPos(y: number, x: number): boolean {
  return y === 0 || y === CLUSTER_HEIGHT - 1 || x === 0 || x === CLUSTER_WIDTH - 1;
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

  // Right-edge interfaces are forward exits
  for (let y = 0; y < CLUSTER_HEIGHT; y++) {
    if (cells[y][CLUSTER_WIDTH - 1] === 'interface') {
      exits.push({
        position: { x: CLUSTER_WIDTH - 1, y },
        targetClusterId: -1,
        targetPosition: null,
      });
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

function generateCollapseMap(clusterId: number): number[][] {
  initNoise();
  const offsetX = clusterId * CLUSTER_WIDTH;
  const map: number[][] = [];
  for (let y = 0; y < CLUSTER_HEIGHT; y++) {
    map[y] = [];
    for (let x = 0; x < CLUSTER_WIDTH; x++) {
      map[y][x] = collapseNoise(x + offsetX, y, 0.08, 2, 0.5);
    }
  }
  return map;
}

function sampleRoomCollapse(room: Room, collapseMap: number[][]): number {
  const cx = Math.floor(room.x + room.w / 2);
  const cy = Math.floor(room.y + room.h / 2);
  const safeX = Math.max(0, Math.min(CLUSTER_WIDTH - 1, cx));
  const safeY = Math.max(0, Math.min(CLUSTER_HEIGHT - 1, cy));
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

const ANCHOR_POOL: FunctionalTag[] = ['reactor', 'bridge', 'armory', 'lab', 'medbay', 'server_rack'];

const PROPAGATION_RULES: Record<FunctionalTag, { tag: FunctionalTag; weight: number }[]> = {
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
) {
  const claimed = new Set<number>(); // rooms that can't be picked as anchors

  function claimWithNeighbors(roomId: number) {
    claimed.add(roomId);
    for (const nb of (doorAdjacency.get(roomId) ?? [])) {
      claimed.add(nb);
    }
  }

  // ── Pass 1: Anchor rooms ──
  const anchorIds = new Set<number>();

  // Entry room → hangar or comms
  const entryRoom = allRooms.find(r => r.tags.geometric.has('entry'));
  if (entryRoom) {
    entryRoom.tags.functional = random() < 0.5 ? 'hangar' : 'comms';
    anchorIds.add(entryRoom.id);
    claimWithNeighbors(entryRoom.id);
  }

  // Exit room → hangar
  const exitRoom = allRooms.find(r => r.tags.geometric.has('exit'));
  if (exitRoom && exitRoom !== entryRoom) {
    exitRoom.tags.functional = 'hangar';
    anchorIds.add(exitRoom.id);
    claimWithNeighbors(exitRoom.id);
  }

  // Pick 2-4 additional anchors, farthest from existing anchors
  const numExtra = randInt(2, 4);
  const shuffledPool = [...ANCHOR_POOL].sort(() => random() - 0.5);
  let poolIdx = 0;

  for (let i = 0; i < numExtra && poolIdx < shuffledPool.length; i++) {
    const dist = bfsDistances(anchorIds, doorAdjacency);
    // Find unclaimed non-hall room farthest from existing anchors
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
  // Find entry room id for BFS start
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

    // Hall rooms: special pool
    if (isHall) {
      const result = pickWeighted(HALL_POOL);
      room.tags.functional = result;
      continue;
    }

    // Collect influence from tagged neighbors
    const influences: { tag: FunctionalTag; weight: number }[] = [];

    for (const nbId of (doorAdjacency.get(roomId) ?? [])) {
      const nb = allRooms.find(r => r.id === nbId);
      if (!nb || nb.tags.functional === null) continue;
      const rules = PROPAGATION_RULES[nb.tags.functional];
      if (rules) influences.push(...rules);
    }

    // Add geometric preferences
    for (const geoTag of room.tags.geometric) {
      const prefs = GEO_PREFERENCES[geoTag];
      if (prefs) influences.push(...prefs);
    }

    if (influences.length > 0) {
      room.tags.functional = pickWeighted(influences);
    }
  }

  // ── Pass 3: Fill remaining (~30% stay null for pacing) ──
  const ALL_TAGS: FunctionalTag[] = [
    'server_rack', 'reactor', 'medbay', 'bridge', 'cargo',
    'barracks', 'lab', 'armory', 'comms', 'maintenance',
    'hangar', 'archive', 'sensor_matrix',
  ];

  for (const room of allRooms) {
    if (room.tags.functional !== null) continue;
    // ~30% chance to stay null (generic room)
    if (random() < 0.3) continue;
    room.tags.functional = pick(ALL_TAGS);
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
        const wallSide = randInt(0, 3);
        let lx: number, ly: number;
        switch (wallSide) {
          case 0: lx = randInt(innerX1, innerX2); ly = room.y; break;
          case 1: lx = randInt(innerX1, innerX2); ly = room.y + room.h - 1; break;
          case 2: lx = room.x; ly = randInt(innerY1, innerY2); break;
          default: lx = room.x + room.w - 1; ly = randInt(innerY1, innerY2); break;
        }
        if (tiles[ly]?.[lx]) {
          tiles[ly][lx].glyph = '◎';
          tiles[ly][lx].fg = '#4488cc';
        }
        break;
      }

      case 'firewall': {
        const beamCount = randInt(1, 2);
        const beams = [];
        for (let b = 0; b < beamCount; b++) {
          const axis = random() < 0.5 ? 'horizontal' as const : 'vertical' as const;
          if (axis === 'horizontal') {
            const pos = randInt(innerY1, innerY2);
            beams.push({ axis, position: pos, direction: 1 as const, min: innerX1, max: innerX2 });
          } else {
            const pos = randInt(innerX1, innerX2);
            beams.push({ axis, position: pos, direction: 1 as const, min: innerY1, max: innerY2 });
          }
        }
        room.hazardState = { beams, alarmTriggered: false };
        const tx = room.x + room.w - 1;
        const ty = Math.floor(room.y + room.h / 2);
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
  for (let y = 0; y < CLUSTER_HEIGHT; y++) {
    if (cells[y][CLUSTER_WIDTH - 1] === 'interface') {
      const nonHall = allRooms.filter(r => !r.tags.geometric.has('hall'));
      exitRoom = nonHall.reduce((best, r) => (r.x + r.w > best.x + best.w ? r : best), nonHall[0]);
      break;
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

  // Interface tags — tag rooms/halls that contain interface tiles
  for (let y = 0; y < CLUSTER_HEIGHT; y++) {
    if (cells[y][0] === 'interface') {
      const adjRoom = allRooms.find(r =>
        1 >= r.x && 1 < r.x + r.w && y >= r.y && y < r.y + r.h
      );
      if (adjRoom) adjRoom.tags.geometric.add('entry_interface');
    }
    if (cells[y][CLUSTER_WIDTH - 1] === 'interface') {
      const adjRoom = allRooms.find(r =>
        (CLUSTER_WIDTH - 2) >= r.x && (CLUSTER_WIDTH - 2) < r.x + r.w && y >= r.y && y < r.y + r.h
      );
      if (adjRoom) adjRoom.tags.geometric.add('exit_interface');
    }
  }
}

// ── Main generation ──

export function generateCluster(id: number): Cluster {
  const { grid, rooms: rawRooms, halls } = generate();

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
  assignFunctionalTags(allRooms, wallAdjacency, doorAdjacency);

  // Extract interface exits (right edge only; left interface is for entry)
  const interfaces = extractInterfaces(grid.cells);

  const cluster: Cluster = { id, width: CLUSTER_WIDTH, height: CLUSTER_HEIGHT, tiles, rooms: allRooms, interfaces, wallAdjacency, doorAdjacency, collapseMap };

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
