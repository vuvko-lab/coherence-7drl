import {
  Cluster, Tile, TileType, Room, Position, InterfaceExit,
  RoomType, CorruptionStage, HazardOverlayType,
  CLUSTER_WIDTH, CLUSTER_HEIGHT, COLORS,
  createRoomTags,
} from './types';
import { generate, CellType, RoomDef, Hall } from './gen-halls';
import { random, randInt } from './rng';

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

const HAZARD_WEIGHTS: { type: RoomType; weight: number }[] = [
  { type: 'corrupted', weight: 3 },
  { type: 'trigger_trap', weight: 2 },
  { type: 'memory_leak', weight: 2 },
  { type: 'firewall', weight: 1 },
  { type: 'unstable', weight: 3 },
  { type: 'quarantine', weight: 2 },
  { type: 'echo_chamber', weight: 1 },
  { type: 'gravity_well', weight: 2 },
];

function weightedPick(pool: { type: RoomType; weight: number }[]): RoomType {
  const total = pool.reduce((s, e) => s + e.weight, 0);
  let r = random() * total;
  for (const entry of pool) {
    r -= entry.weight;
    if (r <= 0) return entry.type;
  }
  return pool[pool.length - 1].type;
}

function assignRoomTypes(
  rooms: Room[],
  _clusterId: number,
  _roomAdjacency: Map<number, number[]>,
) {
  // Find entry/exit rooms (leftmost/rightmost) — never make special
  const sortedByX = [...rooms].sort((a, b) => a.x - b.x);
  const entryRoom = sortedByX[0];
  const exitRoom = sortedByX[sortedByX.length - 1];
  const excludeIds = new Set([entryRoom.id, exitRoom.id]);

  // Filter candidates: min 3x3 interior (w>=5, h>=5 since walls take 2)
  const candidates = rooms.filter(r =>
    !excludeIds.has(r.id) &&
    (r.w - 2) >= 3 && (r.h - 2) >= 3
  );

  if (candidates.length === 0) return;

  // 1-3 special rooms per cluster
  const numSpecial = Math.min(candidates.length, randInt(1, 3));
  const usedTypes = new Set<RoomType>();
  const shuffled = candidates.sort(() => random() - 0.5);

  for (let i = 0; i < numSpecial && i < shuffled.length; i++) {
    const available = HAZARD_WEIGHTS.filter(e => !usedTypes.has(e.type));
    if (available.length === 0) break;

    const type = weightedPick(available);
    usedTypes.add(type);
    shuffled[i].roomType = type;
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
    containedHazards: new Set<HazardOverlayType>(),
  }));

  const allRooms = [...rooms, ...hallRooms];

  // Build room ID map (assigns tiles to room/hall IDs)
  const roomIdAt = buildRoomIdMap(rawRooms, halls, hallIdOffset);

  // Build adjacency graphs
  const wallAdjacency = buildWallAdjacency(allRooms, roomIdAt);
  const doorAdjacency = buildDoorAdjacency(allRooms, grid.cells, roomIdAt);

  // Assign special room types (only non-hall rooms)
  assignRoomTypes(rooms, id, doorAdjacency);

  // Convert grid cells to tiles
  const tiles = gridToTiles(grid.cells, roomIdAt);

  // Initialize hazard visuals on tiles
  initRoomHazards(tiles, rooms);

  // Compute structural tags
  assignStructuralTags(allRooms, wallAdjacency, doorAdjacency, grid.cells);

  // Extract interface exits (right edge only; left interface is for entry)
  const interfaces = extractInterfaces(grid.cells);

  const cluster = { id, width: CLUSTER_WIDTH, height: CLUSTER_HEIGHT, tiles, rooms: allRooms, interfaces, wallAdjacency, doorAdjacency };

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
