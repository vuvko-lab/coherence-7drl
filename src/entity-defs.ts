/**
 * Data-driven entity type definitions.
 *
 * Each EntityDef declares the static properties of an entity type.
 * Factory functions in ai.ts will be migrated to use these definitions
 * so that adding a new entity type is just adding a registry entry.
 */

import type { EntityKind, Faction } from './types';
import { ENTITY_STATS } from './balance';

export type AIStartState = string;

export interface EntityDef {
  /** Entity kind key */
  kind: EntityKind;

  /** Display name */
  name: string;

  /** Map glyph */
  glyph: string;

  /** Foreground color */
  fg: string;

  /** Faction */
  faction: Faction;

  /** Initial AI state */
  startState: AIStartState;

  /** Speed (lower = faster; entity acts when energy >= speed) */
  speed: number;

  /** Hit points (undefined = invulnerable/not applicable) */
  coherence: number | undefined;

  /** Melee/ranged damage */
  attackValue: number;

  /** Attack range (1 = melee only) */
  attackDistance: number;

  /** Vision radius */
  sightRadius: number;

  /** How many walls LOS can penetrate */
  wallPenetration: number;

  /** Starting energy (negative = dormant delay) */
  startEnergy: number;

  /** AI states this entity can be in (for documentation/validation) */
  states: string[];

  /** Description for debug/UI */
  description: string;
}

export const ENTITY_DEFS: Record<EntityKind, EntityDef> = {
  chronicler: {
    kind: 'chronicler',
    name: 'Chronicler',
    glyph: 'Ω',
    fg: '#aaaa66',
    faction: 'neutral',
    startState: 'wander',
    speed: ENTITY_STATS.chronicler.speed,
    coherence: 30,
    attackValue: ENTITY_STATS.chronicler.attackValue,
    attackDistance: ENTITY_STATS.chronicler.attackDistance,
    sightRadius: ENTITY_STATS.chronicler.sightRadius,
    wallPenetration: 0,
    startEnergy: 0,
    states: ['wander', 'catalog', 'broadcast'],
    description: 'Neutral observer. Wanders, catalogs entities, broadcasts reveals.',
  },

  bit_mite: {
    kind: 'bit_mite',
    name: 'Bit-Mite Swarm',
    glyph: '⁕',
    fg: '#cc4444',
    faction: 'aggressive',
    startState: 'wander',
    speed: ENTITY_STATS.bit_mite.speed,
    coherence: ENTITY_STATS.bit_mite.coherence,
    attackValue: ENTITY_STATS.bit_mite.attackValue,
    attackDistance: ENTITY_STATS.bit_mite.attackDistance,
    sightRadius: ENTITY_STATS.bit_mite.sightRadius,
    wallPenetration: 0,
    startEnergy: 0,
    states: ['wander', 'chase'],
    description: 'Fast aggressive swarm. Wanders with door-bashing, chases and bites.',
  },

  logic_leech: {
    kind: 'logic_leech',
    name: 'Logic Leech',
    glyph: '⌒',
    fg: '#cc4444',
    faction: 'aggressive',
    startState: 'wall_walk',
    speed: ENTITY_STATS.logic_leech.speed,
    coherence: ENTITY_STATS.logic_leech.coherence,
    attackValue: ENTITY_STATS.logic_leech.attackValue,
    attackDistance: ENTITY_STATS.logic_leech.attackDistance,
    sightRadius: ENTITY_STATS.logic_leech.sightRadius,
    wallPenetration: 2,
    startEnergy: 0,
    states: ['wall_walk', 'stalk', 'charge', 'rest'],
    description: 'Wall-hugging predator. Stalks invisibly, then charges in a cardinal line.',
  },

  sentry: {
    kind: 'sentry',
    name: 'Sentry',
    glyph: 'S',
    fg: '#23d2a6',
    faction: 'friendly',
    startState: 'patrol',
    speed: ENTITY_STATS.sentry.speed,
    coherence: ENTITY_STATS.sentry.coherence,
    attackValue: ENTITY_STATS.sentry.attackValue,
    attackDistance: ENTITY_STATS.sentry.attackDistance,
    sightRadius: ENTITY_STATS.sentry.sightRadius,
    wallPenetration: 1,
    startEnergy: 0,
    states: ['patrol', 'chase', 'attack'],
    description: 'Friendly ranged guard. Patrols rooms, shoots hostiles.',
  },

  gate_keeper: {
    kind: 'gate_keeper',
    name: 'Gate-Keeper',
    glyph: '⛨',
    fg: '#23d2a6',
    faction: 'friendly',
    startState: 'lockdown',
    speed: ENTITY_STATS.gate_keeper.speed,
    coherence: ENTITY_STATS.gate_keeper.coherence,
    attackValue: ENTITY_STATS.gate_keeper.attackValue,
    attackDistance: ENTITY_STATS.gate_keeper.attackDistance,
    sightRadius: ENTITY_STATS.gate_keeper.sightRadius,
    wallPenetration: 0,
    startEnergy: 0,
    states: ['lockdown'],
    description: 'Friendly heavy. Pulls targets to itself and fires beams.',
  },

  repair_scrapper: {
    kind: 'repair_scrapper',
    name: 'Repair Scrapper',
    glyph: '⚙',
    fg: '#aaaa66',
    faction: 'neutral',
    startState: 'patrol',
    speed: ENTITY_STATS.repair_scrapper.speed,
    coherence: ENTITY_STATS.repair_scrapper.coherence,
    attackValue: ENTITY_STATS.repair_scrapper.attackValue,
    attackDistance: ENTITY_STATS.repair_scrapper.attackDistance,
    sightRadius: ENTITY_STATS.repair_scrapper.sightRadius,
    wallPenetration: 0,
    startEnergy: 0,
    states: ['patrol', 'repair'],
    description: 'Neutral support. Patrols and repairs corrupted interactables.',
  },

  titan_spawn: {
    kind: 'titan_spawn',
    name: '[UNKNOWN PROCESS]',
    glyph: 'X',
    fg: '#ff44ff',
    faction: 'titan',
    startState: 'hunt',
    speed: ENTITY_STATS.titan_spawn.speed,
    coherence: ENTITY_STATS.titan_spawn.coherence,
    attackValue: ENTITY_STATS.titan_spawn.attackValue,
    attackDistance: ENTITY_STATS.titan_spawn.attackDistance,
    sightRadius: ENTITY_STATS.titan_spawn.sightRadius,
    wallPenetration: 1,
    startEnergy: -400,
    states: ['hunt'],
    description: 'Boss entity. Dormant for ~40 ticks, then hunts with AoE attacks.',
  },
};

/** Get entity def by kind. */
export function getEntityDef(kind: EntityKind): EntityDef {
  return ENTITY_DEFS[kind];
}

/** Faction color lookup for smoke effects. */
export function factionColor(faction: Faction): string {
  switch (faction) {
    case 'aggressive': return '#cc4444';
    case 'friendly': return '#23d2a6';
    case 'titan': return '#ff44ff';
    default: return '#aaaa66';
  }
}
