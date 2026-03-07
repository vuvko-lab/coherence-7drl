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
  firewallCharge?: number;                    // accumulated beam-detection charge
  firewallMaxCharge?: number;                 // charge needed to spawn sentry (default 3)
  firewallLastSpawnTick?: number;             // tick when last sentry was spawned

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

export type RoomScenario =
  | 'stuck_echo' | 'spooky_astronauts' | 'broken_sleever'
  | 'whispering_wall' | 'lost_expedition' | 'silent_alarm'
  | 'corruption_ritual';

export interface ScenarioPropDef {
  position: Position;
  glyph: string;
  fg: string;
  name: string;
  propTag: string;
}

export interface ScenarioState {
  playerEnteredAtTick?: number; // tick when player first entered this tick-session
  triggered?: boolean;          // one-shot event has fired
  lastMessageTick?: number;     // throttle log messages
  pendingProps?: ScenarioPropDef[]; // prop entities to spawn on first visit
  microEventFired?: boolean;    // micro-event already triggered for this room
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
  scenario?: RoomScenario;
  scenarioState?: ScenarioState;
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
  isFinalTerminal?: boolean;    // cluster-N narrative terminal requiring root parts
  lockModeUntilTick?: number;   // if > tick, terminal is temporarily locked after hack
  hackCount?: number;           // number of successful hacks (final terminal escalation)
}

// ── Interactables ──

export type InteractableKind = 'info_terminal' | 'lost_echo' | 'archive_echo';

export interface DialogChoice {
  label: string;
  nodeId?: string;                   // navigate to node; undefined = close
  action?: 'close' | 'extract_reward' | 'reveal_terminals' | 'reveal_exits'
         | 'extract_root_part' | 'deactivate_hazard' | 'hack_terminal'
         | 'set_narrative_choice';
  narrativeChoiceValue?: string;     // used with set_narrative_choice
  requiresRewardAvailable?: boolean; // hide choice if rewardTaken
  requiresExitLocked?: boolean;      // show choice only if cluster.exitLocked
  requiresRootPartAvailable?: boolean; // hide choice if root part already taken
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
  hasRootPart?: boolean;              // can extract a root part from this entity
  rootPartTaken?: boolean;            // root part already extracted
  deactivatesHazardRoomId?: number;   // hazard room this interactable can deactivate
  isTutorialEcho?: boolean;           // cluster-0 tutorial echo — triggers SELF panel reveal on close
  echoFadeAtTime?: number;            // performance.now() timestamp when echo dissolves (smoke + damaged mite spawn)
  broadcastLines?: string[];          // stuck_echo: messages to broadcast periodically
  broadcastPeriod?: number;           // stuck_echo: ticks between broadcasts
  lastBroadcastTick?: number;         // stuck_echo: last tick a broadcast fired
  // Data archive fields (procedural archive_echo only)
  isDataArchive?: boolean;
  archiveDecayAccum?: number;         // how many data queries fired so far
  archiveDecayMax?: number;           // total queries until disintegration
  archivePools?: {                    // content pools sampled per category
    echoLogs: string[];
    archivedLogs: string[];
    dialogRecords: string[];
  };
  archiveCurrentCategory?: 'menu' | 'echo_logs' | 'archived_logs' | 'dialog_records';
  archiveCurrentLines?: string[];     // lines shown in the current content view
}

export interface RevealEffect {
  positions: string[];  // "x,y" keys
  expireTick: number;
}

export const SMOKE_DURATION_MS = 480; // total smoke animation time in ms (3 phases × 160ms)

/** Ordered root privilege names granted by collecting root fragments */
export const ROOT_PRIVILEGES = ['ROOT READ', 'ROOT WRITE', 'ROOT EXEC', 'ROOT ID', 'ROOT PASS'] as const;

// ── Narrative Triggers ──

export type NarrativeTriggerEvent =
  | 'cluster_enter'     // player transitions to a new cluster
  | 'room_enter'        // player steps into a room
  | 'entity_killed'     // any entity is killed (check killedFaction)
  | 'alert_threshold'   // alert level crosses alertMin/alertMax
  | 'coherence_low'     // player coherence drops to/below coherencePct%
  | 'terminal_activate' // player activates any terminal
  | 'echo_interact'     // player interacts with any echo/interactable
  ;

export interface NarrativeTriggerCondition {
  event: NarrativeTriggerEvent;
  clusterId?: number;              // exact cluster; omit = any cluster
  clusterIdMin?: number;           // cluster >= this
  clusterIdMax?: number;           // cluster <= this
  functionalTag?: FunctionalTag;   // room_enter: room must have this functional tag
  collapseMin?: number;            // room_enter: room collapse intensity >= this (0–1)
  killedFaction?: Faction;         // entity_killed: only trigger for this faction
  alertMin?: number;               // alert_threshold: alertLevel must be >= this when event fires
  alertMax?: number;               // alert_threshold: alertLevel must be <= this when event fires
  coherencePct?: number;           // coherence_low: player.coherence / maxCoherence <= this
  once?: boolean;                  // default true — fire at most once per run per trigger id
}

export type NarrativeTriggerEffect =
  | { kind: 'message'; text: string; style?: GameMessage['type'] }
  | { kind: 'alert_delta'; amount: number }
  ;

export interface NarrativeTrigger {
  id: string;
  condition: NarrativeTriggerCondition;
  effects: NarrativeTriggerEffect[];
}

export interface SmokeEffect {
  x: number;
  y: number;
  fg: string;        // faction-based color
  spawnTime: number; // performance.now() when spawned; expires after SMOKE_DURATION_MS
}

export interface ShootingEffect {
  from: Position;
  to: Position;
  style: 'single' | 'rapid' | 'beam';
  animationFrame: number;  // 0 = just added, increments each render
}

export interface AnimationState {
  isAnimating: boolean;
  startTime: number;
  duration: number;  // ms
  effects: ShootingEffect[];
}

// ── Entity AI ──

export type EntityKind =
  | 'chronicler'
  | 'bit_mite'
  | 'logic_leech'
  | 'sentry'
  | 'gate_keeper'
  | 'repair_scrapper'
  | 'titan_spawn'
  ;

export type Faction = 'neutral' | 'aggressive' | 'friendly' | 'titan' | 'player';

export type FactionRelation = 'attack' | 'ignore';

/** Static faction relationship table. friendly→player is handled dynamically via alertLevel. */
export const FACTION_RELATIONS: Record<Faction, Partial<Record<Faction, FactionRelation>>> = {
  neutral:    {},
  aggressive: { neutral: 'attack', friendly: 'attack', titan: 'attack', player: 'attack' },
  friendly:   { aggressive: 'attack', titan: 'attack' }, // player: dynamic via alertLevel
  titan:      { neutral: 'attack', aggressive: 'attack', friendly: 'attack', player: 'attack' },
  player:     { aggressive: 'attack', titan: 'attack' },
};

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
  | 'repair'     // repair_scrapper: moving toward / fixing a corrupted interactable
  | 'hunt'       // titan_spawn: chase nearest entity of any faction
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
  active?: boolean;              // overclock.m, cloak.m: toggled on/off
  alertActive?: boolean;         // alert.m only: currently detecting a threat?
  lastAlertTicks?: Map<string, number>; // alert.m: throttle per threat source
  cooldownUntilTick?: number;    // corrupt.m: cannot fire until this tick
  clusterShotCount?: number;     // corrupt.m: shots fired this cluster (2 free, then drains coherence)
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
  propTag?: string; // identifies static prop entities (e.g. 'spacesuit', 'sleever_device')
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
  shootingEffects: ShootingEffect[];
  animation: AnimationState | null;
  hazardFogMarks: Map<string, HazardOverlayType>;
  alertLevel: number;  // 0–300+ antivirus threat level: 0–99 friendly, 100–199 suspicious, 200+ enemy
  markedEntities: Set<number>;  // entity ids marked by Chronicler/White-Hat
  // Narrative & progression
  rootPrivileges: string[];            // named privileges collected (ROOT READ, WRITE, EXEC, ID, PASS)
  killedEntities: { name: string; kind: EntityKind }[];  // for victory stats
  finalClusterId: number;              // cluster ID where victory condition is checked (default 5)
  gameOver?: boolean;                  // true when player exits the final cluster
  // Collapse ambient glitch tiles (temporary visual artifacts)
  collapseGlitchTiles: Map<string, { glyph: string; fg: string; expireTick: number }>;
  selfPanelRevealed: boolean;         // false until player interacts with tutorial echo (or skips cluster 0)
  smokeEffects: SmokeEffect[];        // transient death/dissolution smoke particles
  pendingGlitch?: string;             // set by game logic; consumed by main.ts to fire glitch effects
  narrativeChoice?: 'purge' | 'preserve' | 'eject'; // final-room choice; shapes victory epilogue
  firedTriggerIds: Set<string>;       // ids of once-only narrative triggers that have already fired
  // Achievement tracking
  corruptShotsFired: number;          // total corrupt.m shots fired across all clusters
  terminalsRead: number;              // total terminals interacted with
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
