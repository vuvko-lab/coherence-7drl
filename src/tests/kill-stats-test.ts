/**
 * Kill stats tests — verify that killedEntities tracks byPlayer correctly.
 *
 * The old code counted ALL entity deaths (including entity-on-entity kills)
 * in the stats. The fix: track who dealt the killing blow via byPlayer flag.
 *
 * Usage:  npx tsx src/tests/kill-stats-test.ts
 */

import { createGame, processAction } from '../game';
import { resolveIntents } from '../intent-resolver';
import { seed as seedRng } from '../rng';
import { makeEntity } from '../entity-defs';
import type { GameState, PlayerAction, Entity } from '../types';
import type { Intent } from '../intents';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
    passed++;
  } else {
    console.log(`  \x1b[31m✗\x1b[0m ${label}`);
    failed++;
  }
}

// ── Test: killedEntities has byPlayer field ──

console.log('\x1b[1m── Kill stats: byPlayer field ──\x1b[0m');

seedRng(42);
const state = createGame();

// Verify killedEntities starts empty
assert(state.killedEntities.length === 0, 'killedEntities starts empty');

// Spawn two test entities — one for player to kill, one for entity-on-entity kill
const cluster = state.clusters.get(state.currentClusterId)!;
const enemyA = makeEntity('bit_mite', { x: 5, y: 5 }, cluster.id, { id: 9001, coherence: 1, maxCoherence: 1 });
const enemyB = makeEntity('sentry', { x: 10, y: 10 }, cluster.id, { id: 9002, coherence: 1, maxCoherence: 1 });
state.entities.push(enemyA, enemyB);

// Simulate player killing enemyA via melee attack + remove_entity
const playerKillIntents: Intent[] = [
  { kind: 'melee_attack', attackerId: state.player.id, targetId: 9001, damage: 10 },
  { kind: 'remove_entity', entityId: 9001, cause: 'killed', killerId: state.player.id },
];
resolveIntents(state, playerKillIntents);

assert(state.killedEntities.length === 1, 'One entity recorded after player kill');
assert(state.killedEntities[0].byPlayer === true, 'Player kill has byPlayer=true');
assert(state.killedEntities[0].kind === 'bit_mite', 'Recorded correct entity kind');

// Simulate entity-on-entity kill: some other entity (id=9999) kills enemyB
const entityKillIntents: Intent[] = [
  { kind: 'melee_attack', attackerId: 9999, targetId: 9002, damage: 10 },
  { kind: 'remove_entity', entityId: 9002, cause: 'killed', killerId: 9999 },
];
resolveIntents(state, entityKillIntents);

assert(state.killedEntities.length === 2, 'Two entities recorded total');
assert(state.killedEntities[1].byPlayer === false, 'Entity-on-entity kill has byPlayer=false');

// Verify filtering: only player kills should appear in stats
const playerKills = state.killedEntities.filter(k => k.byPlayer);
const allKills = state.killedEntities;
assert(playerKills.length === 1, 'Filtered player kills = 1');
assert(allKills.length === 2, 'Total kills (all sources) = 2');

// ── Test: Phase 5 cleanup uses _lastDamagedBy ──

console.log('\x1b[1m── Kill stats: Phase 5 cleanup tracking ──\x1b[0m');

seedRng(99);
const state2 = createGame();
const cluster2 = state2.clusters.get(state2.currentClusterId)!;

// Spawn entity that will be reduced to 0 HP by player damage (Phase 5 catches it)
const victim = makeEntity('bit_mite', { x: 3, y: 3 }, cluster2.id, { id: 8001, coherence: 5, maxCoherence: 5 });
state2.entities.push(victim);

// Player deals damage via ranged_attack (doesn't emit remove_entity — Phase 5 catches 0 HP)
resolveIntents(state2, [
  { kind: 'ranged_attack', attackerId: state2.player.id, targetId: 8001, damage: 10, style: 'beam' },
]);

// Verify entity is at 0 HP with _lastDamagedBy set
const damagedVictim = state2.entities.find(e => e.id === 8001)!;
assert(damagedVictim.coherence === 0, 'Entity at 0 coherence after player ranged attack');
assert(damagedVictim._lastDamagedBy === state2.player.id, '_lastDamagedBy set to player id');

// Spawn another entity damaged by a non-player entity
const victim2 = makeEntity('sentry', { x: 6, y: 6 }, cluster2.id, { id: 8002, coherence: 5, maxCoherence: 5 });
state2.entities.push(victim2);

resolveIntents(state2, [
  { kind: 'melee_attack', attackerId: 7777, targetId: 8002, damage: 10 },
]);

const damagedVictim2 = state2.entities.find(e => e.id === 8002)!;
assert(damagedVictim2.coherence === 0, 'Entity at 0 coherence after entity melee attack');
assert(damagedVictim2._lastDamagedBy === 7777, '_lastDamagedBy set to attacker entity id');

// Now run a game tick — Phase 5 cleanup should catch both 0-HP entities
// Place player somewhere safe first
state2.player.position = { x: 1, y: 1 };
const wait: PlayerAction = { kind: 'wait' };
processAction(state2, wait);

// Check that both are recorded with correct byPlayer flag
const playerKills2 = state2.killedEntities.filter(k => k.byPlayer);
const entityKills2 = state2.killedEntities.filter(k => !k.byPlayer);
assert(playerKills2.length === 1, 'Phase 5: one player kill recorded');
assert(playerKills2[0].kind === 'bit_mite', 'Phase 5: player kill is the bit_mite');
assert(entityKills2.length === 1, 'Phase 5: one entity-on-entity kill recorded');
assert(entityKills2[0].kind === 'sentry', 'Phase 5: entity kill is the sentry');

// ── Test: remove_entity without killerId defaults to byPlayer=false ──

console.log('\x1b[1m── Kill stats: missing killerId defaults ──\x1b[0m');

seedRng(77);
const state3 = createGame();
const cluster3 = state3.clusters.get(state3.currentClusterId)!;
const victim3 = makeEntity('bit_mite', { x: 4, y: 4 }, cluster3.id, { id: 7001, coherence: 1, maxCoherence: 1 });
state3.entities.push(victim3);

// remove_entity with no killerId (e.g. hazard or environmental kill)
resolveIntents(state3, [
  { kind: 'remove_entity', entityId: 7001, cause: 'killed' },
]);

assert(state3.killedEntities.length === 1, 'Entity recorded from remove_entity without killerId');
assert(state3.killedEntities[0].byPlayer === false, 'No killerId defaults to byPlayer=false');

// ── Summary ──

console.log(`\n\x1b[1m${passed + failed} tests: \x1b[32m${passed} passed\x1b[0m, \x1b[${failed > 0 ? '31' : '32'}m${failed} failed\x1b[0m`);
process.exit(failed > 0 ? 1 : 0);
