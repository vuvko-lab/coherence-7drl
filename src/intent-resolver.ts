/**
 * Intent Resolver — the single mutation point for all game state changes.
 *
 * Every intent emitted by player actions, entity AI, hazards, or room events
 * is resolved here. No other code should directly mutate GameState during
 * the game tick.
 */

import type {
  GameState, Entity, Cluster, Position, Tile,
} from './types';
import type {
  Intent, MoveIntent, OpenDoorIntent, PushEntityIntent,
  MeleeAttackIntent, RangedAttackIntent, AoeAttackIntent, PullIntent,
  RemoveEntityIntent,
  ChangeAIStateIntent, SetInvisibleIntent, SetTargetIntent, SetCooldownIntent,
  CatalogIntent, MarkEntityIntent,
  MessageIntent, SoundIntent, GlitchIntent, SmokeIntent, RevealIntent, ShootAnimationIntent,
  DamageTileIntent, SealDoorIntent, UnsealDoorIntent,
  DamagePlayerIntent, AlertDeltaIntent,
} from './intents';

// ── Helpers ──

function getCluster(state: GameState): Cluster {
  return state.clusters.get(state.currentClusterId)!;
}

function getTile(cluster: Cluster, pos: Position): Tile | undefined {
  return cluster.tiles[pos.y]?.[pos.x];
}

function findEntity(state: GameState, id: number): Entity | undefined {
  if (state.player.id === id) return state.player;
  return state.entities.find(e => e.id === id);
}

function isOccupied(state: GameState, cluster: Cluster, pos: Position): boolean {
  if (state.player.clusterId === cluster.id &&
      state.player.position.x === pos.x && state.player.position.y === pos.y) {
    return true;
  }
  return state.entities.some(
    e => e.clusterId === cluster.id && e.position.x === pos.x && e.position.y === pos.y,
  );
}

// ── Individual resolvers ──

function resolveMove(state: GameState, intent: MoveIntent): void {
  const entity = findEntity(state, intent.entityId);
  if (!entity) return;
  const cluster = getCluster(state);
  const tile = getTile(cluster, intent.to);
  if (!tile?.walkable) return;
  // Don't move into occupied tiles (except player can overlap with self)
  if (isOccupied(state, cluster, intent.to) && !(entity.id === state.player.id)) return;
  entity.position = { x: intent.to.x, y: intent.to.y };
}

function resolveOpenDoor(state: GameState, intent: OpenDoorIntent): void {
  const cluster = getCluster(state);
  const tile = getTile(cluster, intent.at);
  if (!tile || tile.sealed) return;
  tile.doorOpen = true;
  tile.walkable = true;
  tile.transparent = true;
  tile.glyph = '▯';
  tile.doorCloseTick = undefined;
}

function resolvePushEntity(state: GameState, intent: PushEntityIntent): void {
  const target = findEntity(state, intent.targetId);
  if (!target) return;
  const cluster = getCluster(state);
  const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
  for (const d of dirs) {
    const nx = target.position.x + d.x;
    const ny = target.position.y + d.y;
    if (nx === intent.awayFrom.x && ny === intent.awayFrom.y) continue;
    if (nx < 0 || nx >= cluster.width || ny < 0 || ny >= cluster.height) continue;
    const tile = getTile(cluster, { x: nx, y: ny });
    if (!tile?.walkable) continue;
    if (isOccupied(state, cluster, { x: nx, y: ny })) continue;
    target.position = { x: nx, y: ny };
    return;
  }
}

function resolveMeleeAttack(state: GameState, intent: MeleeAttackIntent): void {
  const target = findEntity(state, intent.targetId);
  if (!target || target.coherence == null) return;
  target.coherence = Math.max(0, target.coherence - intent.damage);
}

function resolveRangedAttack(state: GameState, intent: RangedAttackIntent): void {
  const target = findEntity(state, intent.targetId);
  if (!target || target.coherence == null) return;
  target.coherence = Math.max(0, target.coherence - intent.damage);
}

function resolveAoeAttack(state: GameState, intent: AoeAttackIntent): void {
  for (const targetId of intent.targetIds) {
    const target = findEntity(state, targetId);
    if (!target || target.coherence == null) continue;
    target.coherence = Math.max(0, target.coherence - intent.damage);
  }
}

function resolvePull(state: GameState, intent: PullIntent): void {
  const target = findEntity(state, intent.targetId);
  if (!target) return;
  const cluster = getCluster(state);
  // Move target one step toward the puller
  const dx = Math.sign(intent.toward.x - target.position.x);
  const dy = Math.sign(intent.toward.y - target.position.y);
  const nx = target.position.x + dx;
  const ny = target.position.y + dy;
  const tile = getTile(cluster, { x: nx, y: ny });
  if (!tile?.walkable) return;
  if (isOccupied(state, cluster, { x: nx, y: ny })) return;
  target.position = { x: nx, y: ny };
}

function resolveRemoveEntity(state: GameState, intent: RemoveEntityIntent): void {
  const entity = findEntity(state, intent.entityId);
  if (!entity || entity.id === state.player.id) return;
  entity._pendingRemoval = true;
  if (intent.cause === 'killed') {
    state.killedEntities.push({ name: entity.name, kind: entity.ai!.kind });
    state.markedEntities.delete(entity.id);
  }
}

function resolveChangeAIState(state: GameState, intent: ChangeAIStateIntent): void {
  const entity = findEntity(state, intent.entityId);
  if (!entity?.ai) return;
  entity.ai.aiState = intent.newState as any;
}

function resolveSetInvisible(state: GameState, intent: SetInvisibleIntent): void {
  const entity = findEntity(state, intent.entityId);
  if (!entity?.ai) return;
  entity.ai.invisible = intent.invisible;
}

function resolveSetTarget(state: GameState, intent: SetTargetIntent): void {
  const entity = findEntity(state, intent.entityId);
  if (!entity?.ai) return;
  entity.ai.targetId = intent.targetId;
  if (intent.lastTargetPos !== undefined) {
    entity.ai.lastTargetPos = intent.lastTargetPos;
  }
}

function resolveSetCooldown(state: GameState, intent: SetCooldownIntent): void {
  const entity = findEntity(state, intent.entityId);
  if (!entity?.ai) return;
  entity.ai.actionCooldown = intent.ticks;
}

function resolveCatalog(state: GameState, intent: CatalogIntent): void {
  const target = findEntity(state, intent.targetId);
  if (!target) return;
  state.markedEntities.add(intent.targetId);
  // Reveal tiles around the cataloged entity
  const cluster = getCluster(state);
  for (const posKey of intent.positions) {
    const [sx, sy] = posKey.split(',').map(Number);
    const tile = getTile(cluster, { x: sx, y: sy });
    if (tile) {
      tile.seen = true;
    }
  }
}

function resolveMarkEntity(state: GameState, intent: MarkEntityIntent): void {
  state.markedEntities.add(intent.entityId);
}

function resolveMessage(state: GameState, intent: MessageIntent): void {
  state.messages.push({
    text: intent.text,
    type: intent.style ?? 'normal',
    tick: state.tick,
  });
}

function resolveSound(state: GameState, intent: SoundIntent): void {
  state.pendingSounds.push(intent.id);
}

function resolveGlitch(state: GameState, intent: GlitchIntent): void {
  state.pendingGlitch = intent.effect;
}

function resolveSmoke(state: GameState, intent: SmokeIntent): void {
  state.smokeEffects.push({
    x: intent.position.x,
    y: intent.position.y,
    fg: intent.color,
    spawnTime: 0, // stamped by presentation layer
  });
}

function resolveReveal(state: GameState, intent: RevealIntent): void {
  state.revealEffects.push({
    positions: intent.positions,
    expireTick: state.tick + intent.durationTicks,
  });
}

function resolveShootAnimation(state: GameState, intent: ShootAnimationIntent): void {
  state.shootingEffects.push({
    from: intent.from,
    to: intent.to,
    style: intent.style,
    animationFrame: 0,
  });
}

function resolveDamageTile(state: GameState, intent: DamageTileIntent): void {
  const cluster = getCluster(state);
  const tile = getTile(cluster, intent.position);
  if (!tile) return;
  tile.hazardOverlay = { type: intent.hazardType as any, stage: intent.stage };
}

function resolveSealDoor(state: GameState, intent: SealDoorIntent): void {
  const cluster = getCluster(state);
  const tile = getTile(cluster, intent.position);
  if (!tile) return;
  tile.sealed = true;
  tile.doorOpen = false;
  tile.walkable = false;
  tile.transparent = false;
  tile.glyph = '▪';
  tile.fg = '#ff2222';
  tile.doorCloseTick = undefined;
}

function resolveUnsealDoor(state: GameState, intent: UnsealDoorIntent): void {
  const cluster = getCluster(state);
  const tile = getTile(cluster, intent.position);
  if (!tile) return;
  tile.sealed = false;
  tile.glyph = '+';
}

function resolveDamagePlayer(state: GameState, intent: DamagePlayerIntent): void {
  if (state.godMode) return;
  const coh = state.player.coherence ?? 100;
  state.player.coherence = Math.max(0, coh - intent.amount);
  if (state.player.coherence <= 0) {
    state.playerDead = true;
    state.gameOver = true;
  }
}

function resolveAlertDelta(state: GameState, intent: AlertDeltaIntent): void {
  state.alertLevel = Math.max(0, state.alertLevel + intent.amount);
}

function resolveSetAIField(state: GameState, intent: { kind: 'set_ai_field'; entityId: number; field: string; value: any }): void {
  const entity = findEntity(state, intent.entityId);
  if (!entity?.ai) return;
  (entity.ai as any)[intent.field] = intent.value;
}

function resolveRepairInteractable(state: GameState, intent: { kind: 'repair_interactable'; position: Position }): void {
  const cluster = getCluster(state);
  const ia = cluster.interactables.find(
    i => i.position.x === intent.position.x && i.position.y === intent.position.y,
  );
  if (ia) {
    ia.corrupted = false;
  }
}

// ── Main entry point ──

/**
 * Resolve a batch of intents against the game state.
 * This is the single mutation point — all state changes flow through here.
 *
 * Intents are processed in order. After all intents are resolved,
 * entities marked with _pendingRemoval are cleaned up.
 */
export function resolveIntents(state: GameState, intents: Intent[]): void {
  for (const intent of intents) {
    switch (intent.kind) {
      // Movement
      case 'move':             resolveMove(state, intent); break;
      case 'open_door':        resolveOpenDoor(state, intent); break;
      case 'push_entity':      resolvePushEntity(state, intent); break;
      // Combat
      case 'melee_attack':     resolveMeleeAttack(state, intent); break;
      case 'ranged_attack':    resolveRangedAttack(state, intent); break;
      case 'aoe_attack':       resolveAoeAttack(state, intent); break;
      case 'pull':             resolvePull(state, intent); break;
      // Entity lifecycle
      case 'spawn_entity':     /* Phase 2: wire to entity factory */ break;
      case 'remove_entity':    resolveRemoveEntity(state, intent); break;
      // AI state
      case 'change_ai_state':  resolveChangeAIState(state, intent); break;
      case 'set_invisible':    resolveSetInvisible(state, intent); break;
      case 'set_target':       resolveSetTarget(state, intent); break;
      case 'set_cooldown':     resolveSetCooldown(state, intent); break;
      case 'catalog':          resolveCatalog(state, intent); break;
      case 'mark_entity':      resolveMarkEntity(state, intent); break;
      case 'set_ai_field':     resolveSetAIField(state, intent); break;
      // Interactable
      case 'repair_interactable': resolveRepairInteractable(state, intent); break;
      // Presentation
      case 'message':          resolveMessage(state, intent); break;
      case 'sound':            resolveSound(state, intent); break;
      case 'glitch':           resolveGlitch(state, intent); break;
      case 'smoke':            resolveSmoke(state, intent); break;
      case 'reveal':           resolveReveal(state, intent); break;
      case 'shoot_animation':  resolveShootAnimation(state, intent); break;
      // Hazard / room
      case 'damage_tile':      resolveDamageTile(state, intent); break;
      case 'spread_hazard':    /* Phase 2: wire to hazard system */ break;
      case 'seal_door':        resolveSealDoor(state, intent); break;
      case 'unseal_door':      resolveUnsealDoor(state, intent); break;
      case 'damage_player':    resolveDamagePlayer(state, intent); break;
      case 'alert_delta':      resolveAlertDelta(state, intent); break;
      // Interaction
      case 'transfer':         /* Phase 3: wire to transfer logic */ break;
      case 'activate_terminal': /* Phase 3: wire to terminal logic */ break;
      // No-op
      case 'wait':             break;
    }
  }

  // Deferred cleanup: remove entities marked for removal
  const hadRemovals = state.entities.some(e => e._pendingRemoval);
  if (hadRemovals) {
    state.entities = state.entities.filter(e => !e._pendingRemoval);
  }
}
