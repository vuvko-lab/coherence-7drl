/**
 * Data-driven hazard type definitions.
 *
 * Each HazardDef declares the static properties of a hazard type:
 * what overlay it uses, its collapse tier for generation,
 * and its generation weight.
 *
 * The actual per-tick update logic remains in hazards.ts for now;
 * these definitions centralize the metadata that was previously
 * scattered across cluster.ts and hazards.ts.
 *
 * IMPORTANT: Entry order within each collapseTier must match the original
 * tier arrays in cluster.ts, because weightedPick iterates in order and
 * the seeded RNG makes ordering deterministic. Changing order = different maps.
 */

import type { HazardOverlayType, RoomType } from './types';

/** Collapse-intensity tier: determines which rooms can host this hazard. */
export type CollapseTier = 'low' | 'mid' | 'high' | 'extreme';

export interface HazardDef {
  /** Room type key (matches RoomType union) */
  roomType: Exclude<RoomType, 'normal' | 'cascade'>;

  /** Human-readable name for UI/debug */
  label: string;

  /** One-line description */
  description: string;

  /** Primary hazard overlay type, if any */
  overlay?: HazardOverlayType;

  /** Collapse tier — which collapse intensity band this hazard appears in */
  collapseTier: CollapseTier;

  /** Base generation weight (higher = more likely to be picked) */
  weight: number;

  /** Whether this hazard seals room doors on init */
  sealsDoors: boolean;

  /** Whether the hazard has a deactivation switch placed in another room */
  hasDeactivationSwitch: boolean;
}

// Entry order within each tier is load-bearing for seeded RNG determinism.
// See comment at top of file.
export const HAZARD_DEFS: Record<string, HazardDef> = {
  // ── LOW tier (collapse < 0.3) ──
  echo_chamber: {
    roomType: 'echo_chamber',
    label: 'Echo Chamber',
    description: 'Tracks player movement; wall glitches flicker around the room.',
    overlay: undefined,
    collapseTier: 'low',
    weight: 2,
    sealsDoors: false,
    hasDeactivationSwitch: false,
  },
  quarantine: {
    roomType: 'quarantine',
    label: 'Quarantine',
    description: 'All doors sealed shut; requires external deactivation switch.',
    overlay: undefined,
    collapseTier: 'low',
    weight: 1,
    sealsDoors: true,
    hasDeactivationSwitch: true,
  },
  // ── MID tier (collapse 0.3–0.5) ──
  unstable: {
    roomType: 'unstable',
    label: 'Unstable Process',
    description: 'Sparks discharge randomly from a core; damages on contact.',
    overlay: 'spark',
    collapseTier: 'mid',
    weight: 2,
    sealsDoors: false,
    hasDeactivationSwitch: false,
  },
  firewall: {
    roomType: 'firewall',
    label: 'Firewall Checkpoint',
    description: 'Scanning beams detect intruders; spawns sentry after enough detections.',
    overlay: 'beam',
    collapseTier: 'mid',
    weight: 2,
    sealsDoors: false,
    hasDeactivationSwitch: false,
  },
  // ── HIGH tier (collapse 0.5–0.6) ──
  trigger_trap: {
    roomType: 'trigger_trap',
    label: 'Trigger Trap',
    description: 'Detonates after a fuse countdown when the player enters.',
    overlay: 'scorch',
    collapseTier: 'high',
    weight: 2,
    sealsDoors: false,
    hasDeactivationSwitch: false,
  },
  memory_leak: {
    roomType: 'memory_leak',
    label: 'Memory Leak',
    description: 'Data flood rises from below, breaching doors under pressure.',
    overlay: 'flood',
    collapseTier: 'high',
    weight: 2,
    sealsDoors: false,
    hasDeactivationSwitch: false,
  },
  // ── EXTREME tier (collapse ≥ 0.6) ──
  gravity_well: {
    roomType: 'gravity_well',
    label: 'Gravity Well',
    description: 'Singularity pulls player toward center; contact deals damage.',
    overlay: 'gravity',
    collapseTier: 'extreme',
    weight: 1,
    sealsDoors: false,
    hasDeactivationSwitch: false,
  },
  corrupted: {
    roomType: 'corrupted',
    label: 'Corrupted Zone',
    description: 'Spreads corruption across tiles, degrading walls and floors.',
    overlay: 'corruption',
    collapseTier: 'extreme',
    weight: 2,
    sealsDoors: false,
    hasDeactivationSwitch: false,
  },
} as const;

/** Look up a hazard def by room type. Returns undefined for 'normal'. */
export function getHazardDef(roomType: string): HazardDef | undefined {
  return HAZARD_DEFS[roomType];
}

/** Get all hazard defs for a given collapse tier, preserving registry order. */
export function getHazardsByTier(tier: CollapseTier): { type: RoomType; weight: number }[] {
  return Object.values(HAZARD_DEFS)
    .filter(def => def.collapseTier === tier)
    .map(def => ({ type: def.roomType, weight: def.weight }));
}
