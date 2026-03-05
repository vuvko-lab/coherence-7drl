import type { Cluster, Room, RoomTags, RoomHazardState, Entity, GeometricTag, ModifierTag, HazardOverlayType } from '../types';
import { createRoomTags } from '../types';

// ── Export envelope ──

export interface MapFile {
  version: 1;
  seed: number | null;
  clusterId: number;
  cluster: SerializedCluster;
  entities: Entity[];
}

// ── Serialized shapes (Sets → arrays, Maps → objects) ──

interface SerializedRoomTags {
  geometric: GeometricTag[];
  functional: RoomTags['functional'];
  modifiers: ModifierTag[];
  cosmetic: RoomTags['cosmetic'];
}

interface SerializedRoom {
  id: number; x: number; y: number; w: number; h: number;
  roomType: Room['roomType'];
  tags: SerializedRoomTags;
  collapse: number;
  hazardState?: SerializedHazardState;
  containedHazards: HazardOverlayType[];
}

interface SerializedHazardState extends Omit<RoomHazardState, 'corruptionTiles'> {
  corruptionTiles?: Record<string, string>;
}

interface SerializedCluster {
  id: number; width: number; height: number;
  tiles: Cluster['tiles'];
  rooms: SerializedRoom[];
  interfaces: Cluster['interfaces'];
  wallAdjacency: Record<string, number[]>;
  doorAdjacency: Record<string, number[]>;
  collapseMap: number[][];
  terminals: Cluster['terminals'];
  interactables: Cluster['interactables'];
  exitLocked: boolean;
}

// ── Serialize ──

function serializeRoomTags(tags: RoomTags): SerializedRoomTags {
  return {
    geometric: [...tags.geometric],
    functional: tags.functional,
    modifiers: [...tags.modifiers],
    cosmetic: tags.cosmetic,
  };
}

function serializeHazardState(hs: RoomHazardState): SerializedHazardState {
  const { corruptionTiles, ...rest } = hs;
  const out: SerializedHazardState = { ...rest };
  if (corruptionTiles) {
    const obj: Record<string, string> = {};
    for (const [k, v] of corruptionTiles) obj[k] = v;
    out.corruptionTiles = obj;
  }
  return out;
}

function serializeRoom(r: Room): SerializedRoom {
  return {
    id: r.id, x: r.x, y: r.y, w: r.w, h: r.h,
    roomType: r.roomType,
    tags: serializeRoomTags(r.tags),
    collapse: r.collapse,
    hazardState: r.hazardState ? serializeHazardState(r.hazardState) : undefined,
    containedHazards: [...r.containedHazards],
  };
}

function serializeMap(m: Map<number, number[]>): Record<string, number[]> {
  const obj: Record<string, number[]> = {};
  for (const [k, v] of m) obj[String(k)] = v;
  return obj;
}

export function serializeCluster(c: Cluster): SerializedCluster {
  return {
    id: c.id, width: c.width, height: c.height,
    tiles: c.tiles,
    rooms: c.rooms.map(serializeRoom),
    interfaces: c.interfaces,
    wallAdjacency: serializeMap(c.wallAdjacency),
    doorAdjacency: serializeMap(c.doorAdjacency),
    collapseMap: c.collapseMap,
    terminals: c.terminals,
    interactables: c.interactables,
    exitLocked: c.exitLocked,
  };
}

// ── Deserialize ──

function deserializeRoomTags(st: SerializedRoomTags): RoomTags {
  const tags = createRoomTags(st.geometric);
  tags.functional = st.functional;
  tags.modifiers = new Set(st.modifiers);
  tags.cosmetic = st.cosmetic;
  return tags;
}

function deserializeHazardState(sh: SerializedHazardState): RoomHazardState {
  const { corruptionTiles, ...rest } = sh;
  const out: RoomHazardState = { ...rest };
  if (corruptionTiles) {
    const m = new Map<string, import('../types').CorruptionStage>();
    for (const [k, v] of Object.entries(corruptionTiles)) {
      m.set(k, v as import('../types').CorruptionStage);
    }
    out.corruptionTiles = m;
  }
  return out;
}

function deserializeRoom(sr: SerializedRoom): Room {
  return {
    id: sr.id, x: sr.x, y: sr.y, w: sr.w, h: sr.h,
    roomType: sr.roomType,
    tags: deserializeRoomTags(sr.tags),
    collapse: sr.collapse,
    hazardState: sr.hazardState ? deserializeHazardState(sr.hazardState) : undefined,
    containedHazards: new Set(sr.containedHazards),
  };
}

function deserializeAdj(obj: Record<string, number[]>): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (const [k, v] of Object.entries(obj)) m.set(Number(k), v);
  return m;
}

export function deserializeCluster(sc: SerializedCluster): Cluster {
  return {
    id: sc.id, width: sc.width, height: sc.height,
    tiles: sc.tiles,
    rooms: sc.rooms.map(deserializeRoom),
    interfaces: sc.interfaces,
    wallAdjacency: deserializeAdj(sc.wallAdjacency),
    doorAdjacency: deserializeAdj(sc.doorAdjacency),
    collapseMap: sc.collapseMap,
    terminals: sc.terminals,
    interactables: sc.interactables,
    exitLocked: sc.exitLocked,
  };
}

export function exportMapFile(cluster: Cluster, entities: Entity[], seed: number | null): MapFile {
  return {
    version: 1,
    seed,
    clusterId: cluster.id,
    cluster: serializeCluster(cluster),
    entities,
  };
}

export function importMapFile(json: string): { cluster: Cluster; entities: Entity[]; seed: number | null; clusterId: number } {
  const data: MapFile = JSON.parse(json);
  if (data.version !== 1) throw new Error(`Unsupported map file version: ${data.version}`);
  return {
    cluster: deserializeCluster(data.cluster),
    entities: data.entities,
    seed: data.seed,
    clusterId: data.clusterId,
  };
}
