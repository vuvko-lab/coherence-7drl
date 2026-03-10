/**
 * Data-driven room scenario definitions.
 *
 * Each ScenarioDef declares the static properties of a room scenario:
 * what conditions trigger it, what props it spawns, and its behavioral category.
 *
 * The actual per-tick update logic remains in hazards.ts for now;
 * these definitions centralize the metadata that was previously
 * implicit in the scenario assignment and update code.
 */

import type { RoomScenario } from './types';

export type ScenarioCategory = 'ambient' | 'encounter' | 'ritual' | 'alarm';

export interface ScenarioDef {
  /** Scenario key (matches RoomScenario union) */
  id: RoomScenario;

  /** Human-readable label */
  label: string;

  /** One-line description */
  description: string;

  /** Behavioral category */
  category: ScenarioCategory;

  /** Whether scenario requires player presence to activate */
  requiresPlayerPresence: boolean;

  /** Whether scenario fires only once (triggered flag) */
  oneShot: boolean;

  /** Whether scenario broadcasts messages periodically */
  broadcasts: boolean;

  /** Prop tags that this scenario may spawn (e.g. 'spacesuit', 'sleever_device') */
  propTags: string[];

  /** Minimum cluster depth (inclusive) */
  minCluster: number;

  /** Room types this scenario can appear in (empty = any normal room) */
  validRoomTypes: string[];
}

export const SCENARIO_DEFS: Record<RoomScenario, ScenarioDef> = {
  stuck_echo: {
    id: 'stuck_echo',
    label: 'Stuck Echo',
    description: 'A lost echo broadcasts fragments on a loop.',
    category: 'ambient',
    requiresPlayerPresence: false,
    oneShot: false,
    broadcasts: true,
    propTags: [],
    minCluster: 1,
    validRoomTypes: ['normal'],
  },
  spooky_astronauts: {
    id: 'spooky_astronauts',
    label: 'Spooky Astronauts',
    description: 'Spacesuit prop entities glitch when the player enters.',
    category: 'encounter',
    requiresPlayerPresence: true,
    oneShot: true,
    broadcasts: false,
    propTags: ['spacesuit'],
    minCluster: 2,
    validRoomTypes: ['normal'],
  },
  broken_sleever: {
    id: 'broken_sleever',
    label: 'Broken Sleever',
    description: 'A malfunctioning sleever device cycles endlessly.',
    category: 'ambient',
    requiresPlayerPresence: true,
    oneShot: false,
    broadcasts: true,
    propTags: ['sleever_device'],
    minCluster: 2,
    validRoomTypes: ['normal'],
  },
  whispering_wall: {
    id: 'whispering_wall',
    label: 'Whispering Wall',
    description: 'Echoes whisper fragments when the player is nearby.',
    category: 'ambient',
    requiresPlayerPresence: true,
    oneShot: false,
    broadcasts: true,
    propTags: [],
    minCluster: 1,
    validRoomTypes: ['normal'],
  },
  lost_expedition: {
    id: 'lost_expedition',
    label: 'Lost Expedition',
    description: 'Remnants of a previous expedition broadcast distress signals.',
    category: 'ambient',
    requiresPlayerPresence: true,
    oneShot: false,
    broadcasts: true,
    propTags: [],
    minCluster: 1,
    validRoomTypes: ['normal'],
  },
  silent_alarm: {
    id: 'silent_alarm',
    label: 'Silent Alarm',
    description: 'Triggers an alert when the player first enters.',
    category: 'alarm',
    requiresPlayerPresence: true,
    oneShot: true,
    broadcasts: false,
    propTags: [],
    minCluster: 1,
    validRoomTypes: ['normal'],
  },
  corruption_ritual: {
    id: 'corruption_ritual',
    label: 'Corruption Ritual',
    description: 'Echoes perform a ritual that can corrupt or destroy entities.',
    category: 'ritual',
    requiresPlayerPresence: false,
    oneShot: true,
    broadcasts: true,
    propTags: [],
    minCluster: 3,
    validRoomTypes: ['normal'],
  },
};

/** Look up a scenario def by id. */
export function getScenarioDef(id: RoomScenario): ScenarioDef {
  return SCENARIO_DEFS[id];
}

/** Get all scenario defs valid for a given cluster depth. */
export function getScenarioDefsForCluster(clusterId: number): ScenarioDef[] {
  return Object.values(SCENARIO_DEFS).filter(def => clusterId >= def.minCluster);
}
