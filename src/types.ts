// ── Tile ──

export enum TileType {
  Void,
  Floor,
  Wall,
  Door,
  InterfaceExit,
  Terminal,
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
  terminalId?: string; // set when TileType.Terminal
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
  firewallPattern?: 'pingpong' | 'wipe' | 'inward' | 'cross' | 'spiral';
  firewallAxis?: 'horizontal' | 'vertical';  // wipe sweep direction
  firewallStep?: number;                      // generic tick counter
  firewallPath?: Position[];                  // pre-computed spiral path

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

// ── Room Tag Categories ──

export type GeometricTag =
  | 'hall' | 'room' | 'dead_end' | 'hub' | 'large' | 'small'
  | 'entry' | 'exit' | 'entry_interface' | 'exit_interface'
  | 'chokepoint' | 'secondary_choke' | 'peripheral';

export type FunctionalTag =
  | 'engine_room' | 'server_rack' | 'reactor' | 'medbay' | 'bridge' | 'cargo'
  | 'barracks' | 'lab' | 'armory' | 'comms' | 'maintenance'
  | 'hangar' | 'archive' | 'sensor_matrix';

export type ModifierTag =
  | 'encrypted' | 'orphaned' | 'overclocked'
  | 'hard_wired' | 'degraded' | 'fragmented' | 'ghosted';

export type CosmeticTag = string;

export interface RoomTags {
  geometric: Set<GeometricTag>;
  functional: FunctionalTag | null;
  modifiers: Set<ModifierTag>;
  cosmetic: CosmeticTag | null;
}

export function createRoomTags(geometric?: GeometricTag[]): RoomTags {
  return {
    geometric: new Set<GeometricTag>(geometric ?? []),
    functional: null,
    modifiers: new Set<ModifierTag>(),
    cosmetic: null,
  };
}

export interface Room {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  roomType: RoomType;
  tags: RoomTags;
  collapse: number; // infrastructure collapse intensity [0, 1]
  hazardState?: RoomHazardState;
  containedHazards: Set<HazardOverlayType>;
}

export interface InterfaceExit {
  position: Position;
  targetClusterId: number; // -1 = not yet generated
  targetPosition: Position | null;
}

export interface TerminalDef {
  id: string;
  roomId: number;
  label: string;         // e.g. "BRIDGE ACCESS TERMINAL"
  position: Position;
  activated: boolean;    // has the player used it?
  content: string[];     // narrative/lore lines displayed in the overlay
  hasKey: boolean;       // true for the one terminal per cluster that holds the exit key
}

// ── Interactables ──

export type InteractableKind = 'info_terminal' | 'lost_echo' | 'archive_echo';

export interface DialogChoice {
  label: string;
  nodeId?: string;                   // navigate to node; undefined = close
  action?: 'close' | 'extract_reward' | 'reveal_terminals' | 'reveal_exits';
  requiresRewardAvailable?: boolean; // hide choice if rewardTaken
  requiresExitLocked?: boolean;      // show choice only if cluster.exitLocked
}

export interface DialogNode {
  id: string;
  lines: string[];
  choices: DialogChoice[];
}

export interface Interactable {
  id: string;
  kind: InteractableKind;
  position: Position;
  roomId: number;
  corrupted: boolean;
  dialog: DialogNode[];
  currentNodeId: string;
  rewardTaken: boolean;
  hidden: boolean;           // lost_echo: currently invisible
  hiddenUntilTick: number;   // lost_echo: tick when it reappears
  // Reward flags
  revealTerminals?: boolean;
  revealExits?: boolean;
  hasExitCode?: boolean;
  alertCost?: number;
  spawnHazardOnExtract?: boolean;
}

export interface RevealEffect {
  positions: string[];  // "x,y" keys
  expireTick: number;
}

// ── Entity AI ──

export type EntityKind = 
  | 'chronicler'
  | 'bit_mite'
  | 'logic_leech'
  | 'white_hat'
  | 'gate_keeper'
  ;
export type Faction = 'neutral' | 'aggressive' | 'friendly';
export type AIState =
  | 'wander'     // random movement
  | 'patrol'     // follow waypoints (white_hat)
  | 'catalog'    // chronicler: observing a target
  | 'broadcast'  // chronicler: emitting reveal
  | 'chase'      // bit_mite: BFS toward target
  | 'attack'     // basic target's attack
  | 'wall_walk'  // logic_leech: hug walls
  | 'stalk'      // logic_leech: invisible, locked on
  | 'charge'     // logic_leech: straight-line dash
  | 'rest'       // logic_leech: cooldown after charge
  | 'lockdown'   // gatekeeper: stay in place, and pull enemies
  ;

export interface EntityAI {
  kind: EntityKind;
  faction: Faction;
  aiState: AIState;
  sightRadius: number;
  wallPenetration: number;    // 0 = stopped by walls, 1+ = can see through N walls
  targetId?: number;          // id of entity being targeted
  lastTargetPos?: Position;   // last known position
  actionCooldown?: number;    // ticks until next action
  catalogTicks?: number;      // chronicler: ticks spent cataloging
  chargeDir?: Position;       // logic_leech: charge direction
  chargeSteps?: number;       // logic_leech: steps remaining in charge
  patrolWaypoint?: Position;  // white_hat: current patrol target
  invisible?: boolean;        // logic_leech during stalk
}

export interface Cluster {
  id: number;
  width: number;
  height: number;
  tiles: Tile[][];
  rooms: Room[];
  interfaces: InterfaceExit[];
  wallAdjacency: Map<number, number[]>;  // rooms sharing a wall
  doorAdjacency: Map<number, number[]>;  // rooms connected through doors
  collapseMap: number[][];               // per-tile collapse intensity [0, 1]
  terminals: TerminalDef[];
  interactables: Interactable[];
  exitLocked: boolean;                   // true until player grants access
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
  attackDistance: number;
  attackValue: number;
  coherence?: number;
  maxCoherence?: number;
  modules?: PlayerModule[];
  ai?: EntityAI;
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
  showRoomLabels: boolean;
  showCollapseOverlay: boolean;
  showFunctionalOverlay: boolean;
  showAlertOverlay: boolean;
  showEnemyVision: boolean;
  alertFill?: Map<string, number>;
  alertThreats?: { x: number; y: number; desc: string }[];
  openTerminal?: { terminalId: string; clusterId: number };
  openInteractable?: { id: string; clusterId: number };
  revealEffects: RevealEffect[];
  hazardFogMarks: Map<string, HazardOverlayType>;
  alertLevel: number;  // 0–300+ antivirus threat level: 0–99 friendly, 100–199 suspicious, 200+ enemy
  markedEntities: Set<number>;  // entity ids marked by Chronicler/White-Hat
}

export interface GameMessage {
  text: string;
  type: 'normal' | 'system' | 'important' | 'hazard' | 'alert' | 'debug' | 'combat';
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

export interface ActionInteract {
  kind: 'interact';
}

export interface ActionShoot {
  kind: 'shoot';
  target: Position;
}

export type PlayerAction = ActionMove | ActionTransfer | ActionWait | ActionDebugToggle | ActionInteract | ActionShoot;

// ── Constants ──

export const DIR_DELTA: Record<Direction, Position> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export const CLUSTER_WIDTH = 50;
export const CLUSTER_HEIGHT = 30;

// Alert tier thresholds
export const ALERT_SUSPICIOUS = 100;  // firewall triggers, antivirus can pursue player
export const ALERT_ENEMY = 200;       // player is primary threat target

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
