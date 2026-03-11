/**
 * Data-driven entity type definitions and factory.
 *
 * Each EntityDef declares the static properties of an entity type.
 * `makeEntity()` creates entities from the registry — adding a new
 * entity type is just adding a registry entry.
 */

import type { EntityKind, Faction, Entity, Position, AIState } from './types';
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
    speed: 40,
    coherence: 30,
    attackValue: 0,
    attackDistance: 0,
    sightRadius: 6,
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
    speed: 12,
    coherence: 15,
    attackValue: 4,
    attackDistance: 1,
    sightRadius: 8,
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
    speed: 20,
    coherence: 25,
    attackValue: 12,
    attackDistance: 1,
    sightRadius: 15,
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
    speed: 20,
    coherence: 15,
    attackValue: 4,
    attackDistance: 5,
    sightRadius: 10,
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
    speed: 15,
    coherence: 40,
    attackValue: 12,
    attackDistance: 6,
    sightRadius: 6,
    wallPenetration: 0,
    startEnergy: 0,
    states: ['lockdown', 'patrol', 'chase', 'attack'],
    description: 'Friendly heavy. Pulls targets to itself and fires beams.',
  },

  repair_scrapper: {
    kind: 'repair_scrapper',
    name: 'Repair Scrapper',
    glyph: '⚙',
    fg: '#aaaa66',
    faction: 'neutral',
    startState: 'patrol',
    speed: 25,
    coherence: 35,
    attackValue: 0,
    attackDistance: 0,
    sightRadius: 5,
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
    speed: 15,
    coherence: 60,
    attackValue: 20,
    attackDistance: 4,
    sightRadius: 12,
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

// ── Entity factory ──

let _nextEntityId = 1000;

/** Get the next entity ID (shared counter for all entity creation). */
export function nextEntityId(): number {
  return _nextEntityId++;
}

/** Create an entity from the data-driven registry. Overrides apply on top of defaults. */
export function makeEntity(kind: EntityKind, pos: Position, clusterId: number, overrides?: Partial<Entity>): Entity {
  const def = ENTITY_DEFS[kind];
  return {
    id: _nextEntityId++,
    name: def.name,
    glyph: def.glyph,
    fg: def.fg,
    position: { ...pos },
    clusterId,
    speed: def.speed,
    energy: def.startEnergy,
    coherence: def.coherence,
    maxCoherence: def.coherence,
    attackDistance: def.attackDistance,
    attackValue: def.attackValue,
    ai: {
      kind,
      faction: def.faction,
      aiState: def.startState as AIState,
      sightRadius: def.sightRadius,
      wallPenetration: def.wallPenetration,
      ...(kind === 'logic_leech' ? { invisible: false } : {}),
    },
    ...overrides,
  };
}
