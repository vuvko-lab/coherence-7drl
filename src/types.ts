// ── Tile ──

export enum TileType {
  Void,
  Floor,
  Wall,
  Door,
  InterfaceExit,
}

export type HazardOverlayType = 'corruption' | 'flood' | 'spark' | 'scorch' | 'beam' | 'gravity';

export interface HazardOverlay {
  type: HazardOverlayType;
  stage?: number; // corruption 0-3, flood depth, etc.
}

export interface Tile {
  type: TileType;
  glyph: string;
  fg: string;
  bg: string;
  walkable: boolean;
  transparent: boolean;
  roomId: number; // -1 for walls / void
  visible: boolean;
  seen: boolean;
  hazardOverlay?: HazardOverlay;
  integrity?: number; // wall=3, door=2; corruption degrades to 0 → floor
  doorOpen?: boolean; // true = open, undefined/false = closed
  doorCloseTick?: number; // tick when door was last vacated (for auto-close)
}

// ── Geometry ──

export interface Position {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ── Room & Cluster ──

export type RoomType =
  | 'normal'
  | 'corrupted'
  | 'trigger_trap'
  | 'memory_leak'
  | 'firewall'
  | 'unstable'
  | 'quarantine'
  | 'echo_chamber'
  | 'gravity_well';

export type CorruptionStage = 'degrading' | 'corrupted' | 'collapsed';

export interface ScannerBeam {
  axis: 'horizontal' | 'vertical';
  position: number;
  direction: 1 | -1;
  min: number;
  max: number;
}

export interface RoomHazardState {
  // Corrupted zone
  corruptionTiles?: Map<string, CorruptionStage>; // key: "x,y"
  lastSpreadTick?: number;

  // Trigger trap
  fuseLength?: number;
  ticksRemaining?: number;
  activated?: boolean;
  detonated?: boolean;

  // Memory leak
  floodLevel?: number;

  // Firewall checkpoint
  beams?: ScannerBeam[];
  alarmTriggered?: boolean;

  // Unstable process
  corePos?: Position;
  coreDestroyed?: boolean;
  sparkedTiles?: Position[];

  // Quarantine
  locked?: boolean;

  // Gravity well
  singularityPos?: Position;
  pullInterval?: number;
  lastPullTick?: number;

}

export interface Room {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  roomType: RoomType;
  tags: Set<string>;
  hazardState?: RoomHazardState;
  containedHazards: Set<HazardOverlayType>;
}

export interface InterfaceExit {
  position: Position;
  targetClusterId: number; // -1 = not yet generated
  targetPosition: Position | null;
}

export interface Cluster {
  id: number;
  width: number;
  height: number;
  tiles: Tile[][];
  rooms: Room[];
  interfaces: InterfaceExit[];
  roomAdjacency: Map<number, number[]>; // room id -> adjacent room ids (via doors)
}

// ── Modules ──

export type ModuleStatus = 'loaded' | 'damaged' | 'offline';
export type ModuleId = 'alert.m' | 'overclock.m' | 'corrupt.m' | 'cloak.m' | 'spoof.m';

export interface PlayerModule {
  id: ModuleId;
  status: ModuleStatus;
  alertActive?: boolean; // alert.m only: currently detecting a threat?
  lastAlertTicks?: Map<string, number>; // alert.m: throttle per threat source
}

// ── Entity ──

export interface Entity {
  id: number;
  name: string;
  glyph: string;
  fg: string;
  position: Position;
  clusterId: number;
  speed: number; // lower = faster
  energy: number;
  coherence?: number;
  maxCoherence?: number;
  modules?: PlayerModule[];
}

// ── Game State ──

export interface GameState {
  clusters: Map<number, Cluster>;
  currentClusterId: number;
  player: Entity;
  entities: Entity[];
  nextClusterId: number;
  tick: number;
  messages: GameMessage[];
  autoPath: Position[];
  actionLog: PlayerAction[];
  seed: number;
  debugMode: boolean;
  mapReveal: boolean;
  godMode: boolean;
  invisibleMode: boolean;
  showAlertOverlay: boolean;
  alertFill?: Map<string, number>;
  alertThreats?: { x: number; y: number; desc: string }[];
}

export interface GameMessage {
  text: string;
  type: 'normal' | 'system' | 'important' | 'hazard' | 'alert' | 'debug';
  tick: number;
}

// ── Input ──

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface ActionMove {
  kind: 'move';
  dir: Direction;
}

export interface ActionTransfer {
  kind: 'transfer';
}

export interface ActionWait {
  kind: 'wait';
}

export interface ActionDebugToggle {
  kind: 'debug_toggle';
}

export type PlayerAction = ActionMove | ActionTransfer | ActionWait | ActionDebugToggle;

// ── Constants ──

export const DIR_DELTA: Record<Direction, Position> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export const CLUSTER_WIDTH = 50;
export const CLUSTER_HEIGHT = 30;

export const COLORS = {
  void: '#000000',
  floor: '#1a2a1a',
  floorFg: '#222e22',
  wall: '#4a6a4a',
  wallOuter: '#3a7a4a',
  door: '#88aa44',
  interfaceExit: '#ff8844',
  player: '#00ff88',
  unexplored: '#0a0a0a',
  remembered: '#1a2a1a',
  rememberedFg: '#223322',
  bg: '#0a0a0a',
} as const;
