/**
 * Data-driven hazard type definitions.
 *
 * Each HazardDef declares the static properties of a hazard type:
 * what overlay it uses, what RoomHazardState fields it needs,
 * which clusters it can appear in, and its generation weight.
 *
 * The actual per-tick update logic remains in hazards.ts for now;
 * these definitions centralize the metadata that was previously
 * scattered across cluster.ts and hazards.ts.
 */

import type { HazardOverlayType, RoomType } from './types';

export interface HazardDef {
  /** Room type key (matches RoomType union) */
  roomType: Exclude<RoomType, 'normal' | 'cascade'>;

  /** Human-readable name for UI/debug */
  label: string;

  /** One-line description */
  description: string;

  /** Primary hazard overlay type, if any */
  overlay?: HazardOverlayType;

  /** Minimum cluster depth where this hazard can appear (inclusive) */
  minCluster: number;

  /** Maximum cluster depth where this hazard can appear (inclusive, -1 = no limit) */
  maxCluster: number;

  /** Base generation weight (higher = more likely to be picked) */
  weight: number;

  /** Whether this hazard seals room doors on init */
  sealsDoors: boolean;

  /** Whether the hazard has a deactivation switch placed in another room */
  hasDeactivationSwitch: boolean;

  /** Whether the hazard deals direct damage to the player */
  dealsDamage: boolean;

  /** Whether the hazard modifies tile walkability over time */
  modifiesTerrain: boolean;
}

export const HAZARD_DEFS: Record<string, HazardDef> = {
  corrupted: {
    roomType: 'corrupted',
    label: 'Corrupted Zone',
    description: 'Spreads corruption across tiles, degrading walls and floors.',
    overlay: 'corruption',
    minCluster: 1,
    maxCluster: -1,
    weight: 2,
    sealsDoors: false,
    hasDeactivationSwitch: false,
    dealsDamage: true,
    modifiesTerrain: true,
  },
  trigger_trap: {
    roomType: 'trigger_trap',
    label: 'Trigger Trap',
    description: 'Detonates after a fuse countdown when the player enters.',
    overlay: 'scorch',
    minCluster: 2,
    maxCluster: -1,
    weight: 2,
    sealsDoors: false,
    hasDeactivationSwitch: false,
    dealsDamage: true,
    modifiesTerrain: false,
  },
  memory_leak: {
    roomType: 'memory_leak',
    label: 'Memory Leak',
    description: 'Data flood rises from below, breaching doors under pressure.',
    overlay: 'flood',
    minCluster: 2,
    maxCluster: -1,
    weight: 1,
    sealsDoors: false,
    hasDeactivationSwitch: false,
    dealsDamage: true,
    modifiesTerrain: false,
  },
  firewall: {
    roomType: 'firewall',
    label: 'Firewall Checkpoint',
    description: 'Scanning beams detect intruders; spawns sentry after enough detections.',
    overlay: 'beam',
    minCluster: 1,
    maxCluster: -1,
    weight: 2,
    sealsDoors: false,
    hasDeactivationSwitch: false,
    dealsDamage: false,
    modifiesTerrain: false,
  },
  unstable: {
    roomType: 'unstable',
    label: 'Unstable Process',
    description: 'Sparks discharge randomly from a core; damages on contact.',
    overlay: 'spark',
    minCluster: 2,
    maxCluster: -1,
    weight: 2,
    sealsDoors: false,
    hasDeactivationSwitch: false,
    dealsDamage: true,
    modifiesTerrain: false,
  },
  quarantine: {
    roomType: 'quarantine',
    label: 'Quarantine',
    description: 'All doors sealed shut; requires external deactivation switch.',
    overlay: undefined,
    minCluster: 1,
    maxCluster: -1,
    weight: 1,
    sealsDoors: true,
    hasDeactivationSwitch: true,
    dealsDamage: false,
    modifiesTerrain: false,
  },
  echo_chamber: {
    roomType: 'echo_chamber',
    label: 'Echo Chamber',
    description: 'Tracks player movement; wall glitches flicker around the room.',
    overlay: undefined,
    minCluster: 0,
    maxCluster: -1,
    weight: 2,
    sealsDoors: false,
    hasDeactivationSwitch: false,
    dealsDamage: false,
    modifiesTerrain: false,
  },
  gravity_well: {
    roomType: 'gravity_well',
    label: 'Gravity Well',
    description: 'Singularity pulls player toward center; contact deals damage.',
    overlay: 'gravity',
    minCluster: 3,
    maxCluster: -1,
    weight: 1,
    sealsDoors: false,
    hasDeactivationSwitch: false,
    dealsDamage: true,
    modifiesTerrain: false,
  },
} as const;

/** Look up a hazard def by room type. Returns undefined for 'normal'. */
export function getHazardDef(roomType: string): HazardDef | undefined {
  return HAZARD_DEFS[roomType];
}

/** Get all hazard defs valid for a given cluster depth. */
export function getHazardDefsForCluster(clusterId: number): HazardDef[] {
  return Object.values(HAZARD_DEFS).filter(def =>
    clusterId >= def.minCluster &&
    (def.maxCluster === -1 || clusterId <= def.maxCluster)
  );
}
