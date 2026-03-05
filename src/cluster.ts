import {
  Cluster, Tile, TileType, Room, Position, InterfaceExit,
  RoomType, CorruptionStage, HazardOverlayType,
  CLUSTER_WIDTH, CLUSTER_HEIGHT, COLORS,
} from './types';
import { generate, CellType, RoomDef } from './gen-halls';
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

function interfaceTile(): Tile {
  return makeTile(TileType.InterfaceExit, '⇋', COLORS.interfaceExit);
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

function buildRoomIdMap(rawRooms: RoomDef[]): number[][] {
  const map: number[][] = [];
  for (let y = 0; y < CLUSTER_HEIGHT; y++) {
    map[y] = new Array(CLUSTER_WIDTH).fill(-1);
  }
  for (const rd of rawRooms) {
    const r = rd.rect;
    for (let ry = r.y; ry < r.y + r.h; ry++) {
      for (let rx = r.x; rx < r.x + r.w; rx++) {
        if (ry >= 0 && ry < CLUSTER_HEIGHT && rx >= 0 && rx < CLUSTER_WIDTH) {
          map[ry][rx] = rd.id;
        }
      }
    }
  }
  return map;
}

// ── Room adjacency ──

function buildRoomAdjacency(cells: CellType[][], rawRooms: RoomDef[]): Map<number, number[]> {
  const roomIdAt = buildRoomIdMap(rawRooms);
  const adj = new Map<number, number[]>();
  for (const r of rawRooms) adj.set(r.id, []);

  const addEdge = (a: number, b: number) => {
    if (a === b) return;
    if (!adj.get(a)!.includes(b)) adj.get(a)!.push(b);
    if (!adj.get(b)!.includes(a)) adj.get(b)!.push(a);
  };

  // Flood-fill through contiguous hall+door regions.
  // All rooms touching such a region are mutually adjacent.
  const visited = new Set<string>();

  for (let y = 0; y < CLUSTER_HEIGHT; y++) {
    for (let x = 0; x < CLUSTER_WIDTH; x++) {
      const c = cells[y][x];
      if (c !== 'hall' && c !== 'door') continue;
      const key = `${x},${y}`;
      if (visited.has(key)) continue;

      // BFS through this contiguous non-room walkable region
      const regionVisited = new Set<string>();
      const connectedRooms = new Set<number>();
      const q: [number, number][] = [[x, y]];
      regionVisited.add(key);

      while (q.length > 0) {
        const [cx, cy] = q.shift()!;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || nx >= CLUSTER_WIDTH || ny < 0 || ny >= CLUSTER_HEIGHT) continue;
          const nc = cells[ny][nx];
          const nk = `${nx},${ny}`;

          if (nc === 'floor') {
            const rid = roomIdAt[ny][nx];
            if (rid >= 0) connectedRooms.add(rid);
            // Don't continue BFS through room floor
            continue;
          }

          if (regionVisited.has(nk)) continue;
          if (nc === 'hall' || nc === 'door') {
            regionVisited.add(nk);
            q.push([nx, ny]);
          }
        }
      }

      for (const k of regionVisited) visited.add(k);

      // All rooms connected to this region are mutually adjacent
      const rids = [...connectedRooms];
      for (let i = 0; i < rids.length; i++) {
        for (let j = i + 1; j < rids.length; j++) {
          addEdge(rids[i], rids[j]);
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
          tiles[y][x] = floorTile(-1);
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
          tiles[y][x] = interfaceTile();
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

// ── Main generation ──

export function generateCluster(id: number): Cluster {
  const { grid, rooms: rawRooms } = generate();

  // Convert RoomDef → Room (expand rect to include walls)
  const rooms: Room[] = rawRooms.map(r => ({
    id: r.id,
    x: r.rect.x - 1,
    y: r.rect.y - 1,
    w: r.rect.w + 2,
    h: r.rect.h + 2,
    roomType: 'normal' as RoomType,
    containedHazards: new Set<HazardOverlayType>(),
  }));

  // Build room adjacency from hall/door connectivity
  const roomAdjacency = buildRoomAdjacency(grid.cells, rawRooms);

  // Assign special room types
  assignRoomTypes(rooms, id, roomAdjacency);

  // Convert grid cells to tiles
  const roomIdAt = buildRoomIdMap(rawRooms);
  const tiles = gridToTiles(grid.cells, roomIdAt);

  // Initialize hazard visuals on tiles
  initRoomHazards(tiles, rooms);

  // Extract interface exits (right edge only; left interface is for entry)
  const interfaces = extractInterfaces(grid.cells);

  const cluster = { id, width: CLUSTER_WIDTH, height: CLUSTER_HEIGHT, tiles, rooms, interfaces, roomAdjacency };

  // Debug output
  const hazardRooms = rooms.filter(r => r.roomType !== 'normal');
  const hazardSummary = hazardRooms.map(r => `  room ${r.id}: ${r.roomType} (${r.w - 2}x${r.h - 2})`).join('\n');
  const degrees = rooms.map(r => (roomAdjacency.get(r.id) ?? []).length);
  const avgDegree = degrees.length > 0 ? (degrees.reduce((a, b) => a + b, 0) / degrees.length).toFixed(1) : '0';
  const deadEnds = degrees.filter(d => d <= 1).length;
  console.log(
    `[Cluster ${id}] ${rooms.length} rooms, ${hazardRooms.length} hazards, ` +
    `${interfaces.length} exits, avg degree ${avgDegree}, ${deadEnds} dead-ends\n` +
    (hazardSummary || '  (no hazards)')
  );

  return cluster;
}
