/**
 * Centralized balance constants.
 *
 * Every gameplay-affecting number lives here so tuning is done in one place.
 * Presentation-only values (colors, glyph choices, animation durations) stay
 * in their respective modules.
 */

// ── Player ──

export const PLAYER_SPEED = 10;
export const PLAYER_MAX_COHERENCE = 100;
export const PLAYER_MELEE_DAMAGE = 3;
export const PLAYER_MELEE_RANGE = 1;

// ── Modules ──

export const CORRUPT_M_RANGE = 8;
export const CORRUPT_M_DAMAGE = 40;
export const CORRUPT_M_COOLDOWN = 10;       // ticks between shots
export const CORRUPT_M_FREE_SHOTS = 2;      // free shots per cluster
export const CORRUPT_M_DRAIN_PER_EXTRA = 3; // coherence cost per shot over quota

export const CLOAK_DURATION = 10;           // ticks of invisibility
export const CLOAK_COOLDOWN = 25;           // ticks before reactivation
export const CLOAK_FREE_USES = 2;           // free uses per cluster
export const CLOAK_DRAIN_PER_EXTRA = 5;     // coherence cost per use over quota

// ── Doors ──

export const DOOR_CLOSE_DELAY = 5;          // ticks before unoccupied door auto-closes

// ── Turn system ──

export const ENERGY_PER_TICK = 10;          // energy all entities gain each tick

// ── Entity AI behavior ──

export const LOGIC_LEECH_STALK_TICKS = 3;   // ticks spent invisible before charge
export const LOGIC_LEECH_CHARGE_STEPS = 3;  // tiles in a charge
export const LOGIC_LEECH_REST_HIT = 2;      // cooldown after hitting wall during charge
export const LOGIC_LEECH_REST_DONE = 6;     // cooldown after completed charge

export const SENTRY_ROOM_SWITCH_CHANCE = 0.1;  // 10% per tick to patrol to adjacent room
export const BEAM_ATTACK_COOLDOWN = 3;       // ticks between beam attacks (sentry, gate-keeper)

export const REPAIR_CHANCE = 0.4;           // chance per tick to repair adjacent interactable
export const TITAN_SPAWN_DORMANT_ENERGY = -400; // starts dormant, ~40 ticks to activate

// ── Hazard: Corruption ──

export const CORRUPTION_SPREAD_MIN = 20;
export const CORRUPTION_SPREAD_MAX = 30;
export const CORRUPTION_WALL_DEGRADE_CHANCE = 0.25;
export const CORRUPTION_DOOR_DEGRADE_CHANCE = 0.50;
export const CORRUPTION_WALL_INTEGRITY = 6;
export const CORRUPTION_DOOR_INTEGRITY = 3;
export const CORRUPTION_DMG_STAGE0 = 3;     // degrading
export const CORRUPTION_DMG_STAGE1 = 7;     // corrupted
export const CORRUPTION_DMG_STAGE2 = 12;    // collapsed

// ── Hazard: Trigger Trap ──

export const TRAP_FUSE_MIN = 15;
export const TRAP_FUSE_MAX = 25;
export const TRAP_DAMAGE_DIRECT_MIN = 40;
export const TRAP_DAMAGE_DIRECT_MAX = 60;
export const TRAP_DAMAGE_ADJACENT_MIN = 15;
export const TRAP_DAMAGE_ADJACENT_MAX = 25;
export const TRAP_WARNING_TICKS = 5;        // sound warning at N ticks remaining

// ── Hazard: Memory Leak ──

export const FLOOD_RISE_INTERVAL = 6;       // ticks between flood level increases
export const FLOOD_DOOR_BREACH_CHANCE = 0.30;
export const FLOOD_DMG_STAGE0 = 1;
export const FLOOD_DMG_STAGE2 = 5;

// ── Hazard: Firewall ──

export const FIREWALL_MAX_CHARGE = 3;       // detections to spawn sentry
export const FIREWALL_PINGPONG_INTERVAL = 2;
export const FIREWALL_WIPE_INTERVAL = 2;
export const FIREWALL_SPIRAL_INTERVAL = 2;
export const FIREWALL_INWARD_INTERVAL = 3;
export const FIREWALL_WIPE_GAP = 4;         // ticks of gap in wipe pattern

// ── Hazard: Unstable Process ──

export const UNSTABLE_SPARKS_MIN = 1;
export const UNSTABLE_SPARKS_MAX = 3;
export const UNSTABLE_SPARK_DMG_MIN = 5;
export const UNSTABLE_SPARK_DMG_MAX = 10;

// ── Hazard: Echo Chamber ──

export const ECHO_TRAIL_LENGTH = 4;         // recent player positions tracked
export const ECHO_WALL_GLITCH_CHANCE = 0.4;
export const ECHO_WALL_GLITCH_COUNT_MIN = 1;
export const ECHO_WALL_GLITCH_COUNT_MAX = 2;
export const ECHO_GLITCH_DURATION_MIN = 1;
export const ECHO_GLITCH_DURATION_MAX = 3;

// ── Hazard: Gravity Well ──

export const GRAVITY_PULL_INTERVAL = 3;     // ticks between pulls
export const GRAVITY_SINGULARITY_DMG_MIN = 8;
export const GRAVITY_SINGULARITY_DMG_MAX = 15;

// ── Collapse / spawning ──

export const COLLAPSE_GLITCH_FACTOR = 0.3;  // glitch chance = factor * room.collapse
export const COLLAPSE_WALL_GLITCH_CHANCE = 0.2;
export const COLLAPSE_WALL_GLITCH_MIN_COLLAPSE = 0.2;
export const ENTITY_CAP_BASE = 15;          // max entities = base + clusterId * scale
export const ENTITY_CAP_PER_CLUSTER = 5;
export const BITMITE_SPAWN_INTERVAL_HIGH = 60;   // ticks, collapse > 0.7
export const BITMITE_SPAWN_INTERVAL_LOW = 80;    // ticks, lower collapse
export const SENTRY_SPAWN_INTERVAL = 100;
export const GATEKEEPER_SPAWN_INTERVAL = 120;

// ── Scenarios ──

export const STUCK_ECHO_PERIOD_MIN = 8;
export const STUCK_ECHO_PERIOD_MAX = 13;
export const LOST_EXPEDITION_PERIOD_MIN = 10;
export const LOST_EXPEDITION_PERIOD_MAX = 18;
export const CORRUPTION_RITUAL_PERIOD_MIN = 5;
export const CORRUPTION_RITUAL_PERIOD_MAX = 9;

// ── Micro-events ──

export const MICRO_EVENT_CHANCE = 0.25;     // per room entry

// ── Alert system ──

export const ALERT_FILL_BUDGET = 15;        // BFS search distance for threats
export const ALERT_THROTTLE_TICKS = 10;     // cooldown between alert messages per threat

// ── Lost echo visibility ──

export const ECHO_HIDE_CHANCE = 0.004;      // chance per tick to hide
export const ECHO_HIDE_DURATION_MIN = 6;
export const ECHO_HIDE_DURATION_MAX = 22;

// ── Terminal hacking ──

export const FINAL_TERMINAL_HACK_COST = 5;  // coherence per hack attempt

// ── Progression ──

export const FINAL_CLUSTER_ID = 5;          // victory condition cluster
export const MAX_MESSAGES = 500;
export const MAX_DEBUG_LOG = 500;
export const MAX_ACTION_LOG = 500;
