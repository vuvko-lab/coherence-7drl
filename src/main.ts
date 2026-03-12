import { createGame, processAction, handleMapClick, stepAutoPath, addMessage, exportSave, exportDebugLog, loadSave, adminRegenCluster, adminTeleportToCluster, grantExitAccess, activateTerminal, executeInteractableAction, deactivateHazardRoom, getEntityAt, CORRUPT_M_RANGE, hackFinalTerminal, activateCloak } from './game';
import { makeEntity } from './entity-defs';
import { setDamageParams, getDamageParams, setGenSizeOverride, clearGenSizeOverride, getGenSizeOverride, clusterScaleForId } from './cluster';
import { Renderer, renderSelfPanel, renderLogs, renderOverviewPanel, renderMapStatusBar } from './renderer';
import { InputHandler } from './input';
import { PlayerAction, Position, TileType, SMOKE_DURATION_MS, MARK_DURATION_MS } from './types';
import { generateSeed } from './rng';
import { GLITCH_EFFECTS, initGlitch, glitchShake, glitchChromatic, glitchBarSweep, glitchStaticBurst, glitchHorizontalTear, glitchDataBleed } from './glitch';
import { VICTORY_EPILOGUES } from './narrative/index';
import { FINAL_TERMINAL_CONFIRM } from './narrative/final-terminal';
import { hasLOS } from './fov';
import { canSee } from './ai';
import { soundManager } from './audio';
import { handleOverlayKey, mapClickAction } from './dialog-input';

// ── Bootstrap ──

// Read seed from URL hash (e.g. #seed=12345)
function parseSeedFromURL(): number | undefined {
  const hash = window.location.hash;
  const match = hash.match(/seed=(\d+)/);
  return match ? Number(match[1]) : undefined;
}

let state = createGame(parseSeedFromURL());
const renderer = new Renderer('map-grid-wrap');
initGlitch(renderer);

function initRenderer() {
  const cluster = state.clusters.get(state.currentClusterId)!;
  renderer.initGrid(cluster.width, cluster.height);
}

function restartGame(newSeed: number) {
  stopAutoWalk();
  soundManager.stopAmbient(500);
  adminInitialized = false;
  rootPrivsAnimating = false;
  lastKnownPrivilegeSet = new Set();
  document.getElementById('victory-overlay')?.classList.remove('open');
  document.getElementById('death-overlay')?.classList.remove('open');
  state = createGame(newSeed);
  initRenderer();
  renderAll();
}

initRenderer();

const panelEl = document.getElementById('panel-self')!;
const mapStatusEl = document.getElementById('map-status-bar')!;
const targetPanelEl = document.getElementById('panel-target')!;
const mapGridWrap = document.getElementById('map-grid-wrap')!;
const mapContainer = document.querySelector('#map-container') as HTMLElement;
const logAreaEl = document.getElementById('log-area')!;
const logGeneralEl = document.getElementById('log-general')!;
const logAlertEl = document.getElementById('log-alert')!;
const adminEl = document.getElementById('panel-admin')!;
const overviewEl = document.getElementById('panel-overview')!;
let hoveredPos: Position | null = null;
let lastTargetPanelKey: string | null = null;
let aimMode = false;
let aimCursor: Position | null = null;
let showRangePreview = false; // corrupt.m module hover
let moduleMenuOpen = false;
let selectedModuleIdx = 0;

// ── Auto-walk timer ──

let autoWalkTimer: number | null = null;
const AUTO_WALK_DELAY = 80; // ms between auto-walk steps

function startAutoWalk() {
  stopAutoWalk();
  autoWalkTimer = window.setInterval(() => {
    if (state.autoPath.length === 0) {
      stopAutoWalk();
      renderAll();
      return;
    }
    if (stepAutoPath(state)) {
      soundManager.playFootstep();
      // Consume any sounds from auto-walk step (door opens, hazard damage, etc.)
      for (const sid of state.pendingSounds) soundManager.play(sid);
      state.pendingSounds = [];
      startSmokeLoop();
      renderer.setPathHighlight(state.autoPath);
      renderAll();

      // Check if we arrived at an interface exit
      const c = state.clusters.get(state.currentClusterId)!;
      const tile = c.tiles[state.player.position.y][state.player.position.x];
      if (tile.type === TileType.InterfaceExit) {
        stopAutoWalk();
        state.autoPath = [];
      }
    } else {
      stopAutoWalk();
      renderAll();
    }
  }, AUTO_WALK_DELAY);
}

function stopAutoWalk() {
  if (autoWalkTimer !== null) {
    clearInterval(autoWalkTimer);
    autoWalkTimer = null;
  }
}

// ── Animation ──

let animationFrameId: number | null = null;

function runAnimationLoop() {
  const anim = state.animation;
  if (!anim || !anim.isAnimating) return;

  const update = () => {
    const elapsed = performance.now() - anim.startTime;
    const progress = Math.min(elapsed / anim.duration, 1);

    // Update animation frames based on progress
    for (const effect of anim.effects) {
      const totalFrames = effect.style === 'rapid' ? 12 : effect.style === 'beam' ? 10 : 4;
      effect.animationFrame = Math.floor(progress * totalFrames);
    }

    // Render with current animation state
    renderAll();

    if (progress < 1) {
      animationFrameId = requestAnimationFrame(update);
    } else {
      // Animation complete
      state.animation = null;
      animationFrameId = null;
      renderAll();
    }
  };

  animationFrameId = requestAnimationFrame(update);
}

function cancelAnimation() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
    state.animation = null;
  }
}

// ── Smoke / echo real-time animation loop ──

let smokeLoopId: number | null = null;

function runSmokeLoop() {
  smokeLoopId = null;
  const now = performance.now();
  let needsRender = false;

  // Stamp any unstamped smoke effects from game logic (spawnTime === 0)
  for (const s of state.smokeEffects) {
    if (s.spawnTime === 0) s.spawnTime = now;
  }

  // Expire smoke effects
  const before = state.smokeEffects.length;
  state.smokeEffects = state.smokeEffects.filter(s => now - s.spawnTime < SMOKE_DURATION_MS);
  if (state.smokeEffects.length !== before) needsRender = true;
  if (state.smokeEffects.length > 0) needsRender = true;

  // Stamp and expire mark effects (converging-square animation, 480ms)
  for (const m of state.markEffects) {
    if (m.spawnTime === 0) m.spawnTime = now;
    // Track entity position each frame
    const target = state.entities.find(e => e.id === m.targetId);
    if (target) { m.x = target.position.x; m.y = target.position.y; }
  }
  const markBefore = state.markEffects.length;
  state.markEffects = state.markEffects.filter(m => now - m.spawnTime < MARK_DURATION_MS);
  if (state.markEffects.length !== markBefore) needsRender = true;
  if (state.markEffects.length > 0) needsRender = true;

  // Stamp any unstamped echo fade delays from game logic (echoFadeAtTime < 0 = delay in ms)
  const cluster = state.clusters.get(state.currentClusterId);
  if (cluster) {
    for (const item of cluster.interactables) {
      if (item.echoFadeAtTime != null && item.echoFadeAtTime < 0) {
        item.echoFadeAtTime = now + Math.abs(item.echoFadeAtTime);
      }
    }
  }

  // Check echo fades
  if (cluster) {
    for (let i = cluster.interactables.length - 1; i >= 0; i--) {
      const item = cluster.interactables[i];
      if (item.echoFadeAtTime != null && item.echoFadeAtTime > 0 && now >= item.echoFadeAtTime) {
        state.smokeEffects.push({ x: item.position.x, y: item.position.y, fg: '#aaaa66', spawnTime: now });
        const bm = makeEntity('bit_mite', item.position, cluster.id, {
          speed: 18, coherence: 5, maxCoherence: 5, attackValue: 2,
          name: 'Corrupted Echo Fragment', fg: '#aa6644',
        });
        state.entities.push(bm);
        addMessage(state, '...echo fragment destabilised.', 'system');
        cluster.interactables.splice(i, 1);
        needsRender = true;
      }
    }
  }

  if (needsRender) renderAll();

  // Keep looping while there are active effects or pending fades
  const hasPendingEcho = cluster?.interactables.some(i => i.echoFadeAtTime != null) ?? false;
  if (state.smokeEffects.length > 0 || state.markEffects.length > 0 || hasPendingEcho) {
    smokeLoopId = requestAnimationFrame(runSmokeLoop);
  }
}

export function startSmokeLoop() {
  if (smokeLoopId === null) {
    smokeLoopId = requestAnimationFrame(runSmokeLoop);
  }
}

// ── Render ──

const TOGGLE_LABELS: Record<string, string> = {
  mapReveal: 'map reveal',
  godMode: 'god mode',
  invisibleMode: 'invisible',
  showRoomLabels: 'room labels',
  showCollapseOverlay: 'collapse heatmap',
  showFunctionalOverlay: 'functional tags',
  showAlertOverlay: 'alert overlay',
  showEnemyVision: 'enemy vision',
};

let adminInitialized = false;

function initAdminPanel() {
  if (adminInitialized) return;
  adminInitialized = true;

  const buttons = GLITCH_EFFECTS.map(effect => {
    return `<button class="admin-btn" data-effect="${effect.name}">&gt; ${effect.name}</button>`;
  }).join('\n');

  const p = getDamageParams();
  adminEl.innerHTML = `\
<div class="panel-edge"><span class="corner">┌</span><span class="label">[ ADMIN ]</span><span class="fill"></span><span class="corner">┐</span></div>
<div class="panel-body">
<button class="admin-section-hdr" data-section="overlays">[-] OVERLAYS</button>
<div class="admin-section" id="admin-sec-overlays">
<button class="admin-btn admin-toggle" data-toggle="mapReveal">&gt; map reveal: OFF</button>
<button class="admin-btn admin-toggle" data-toggle="godMode">&gt; god mode: OFF</button>
<button class="admin-btn admin-toggle" data-toggle="invisibleMode">&gt; invisible: OFF</button>
<button class="admin-btn admin-toggle" data-toggle="showRoomLabels">&gt; room labels: OFF</button>
<button class="admin-btn admin-toggle" data-toggle="showCollapseOverlay">&gt; collapse heatmap: OFF</button>
<button class="admin-btn admin-toggle" data-toggle="showFunctionalOverlay">&gt; functional tags: OFF</button>
<button class="admin-btn admin-toggle" data-toggle="showAlertOverlay">&gt; alert overlay: OFF</button>
<button class="admin-btn admin-toggle" data-toggle="showEnemyVision">&gt; enemy vision: OFF</button>
</div>
<button class="admin-section-hdr" data-section="restart">[-] SEED / RESTART</button>
<div class="admin-section" id="admin-sec-restart">
<div class="stat-row"><span class="stat-label">seed:</span><input class="admin-seed-input" type="text" value="${state.seed}"></div>
<button class="admin-btn admin-restart">&gt; restart with seed</button>
<button class="admin-btn admin-random-restart">&gt; random restart</button>
<button class="admin-btn admin-export">&gt; export save</button>
<button class="admin-btn admin-import">&gt; import save</button>
<button class="admin-btn admin-debug-log">&gt; export debug log</button>
<input type="file" class="admin-import-input" accept=".json" style="display:none">
</div>
<button class="admin-section-hdr" data-section="cluster">[+] CLUSTER</button>
<div class="admin-section collapsed" id="admin-sec-cluster">
<div class="stat-row"><span class="stat-label">dmg base:</span><button class="admin-btn admin-dm-base-m">[-]</button><span class="admin-val admin-dm-base"> ${p.base.toFixed(2)} </span><button class="admin-btn admin-dm-base-p">[+]</button></div>
<div class="stat-row"><span class="stat-label">dmg step:</span><button class="admin-btn admin-dm-inc-m">[-]</button><span class="admin-val admin-dm-inc"> ${p.inc.toFixed(2)} </span><button class="admin-btn admin-dm-inc-p">[+]</button></div>
<div class="admin-sep">grid size (override)</div>
<div class="stat-row"><span class="stat-label">width:</span><button class="admin-btn admin-gw-m">[-]</button><span class="admin-val admin-gw"> ${clusterScaleForId(state.currentClusterId).w} </span><button class="admin-btn admin-gw-p">[+]</button></div>
<div class="stat-row"><span class="stat-label">height:</span><button class="admin-btn admin-gh-m">[-]</button><span class="admin-val admin-gh"> ${clusterScaleForId(state.currentClusterId).h} </span><button class="admin-btn admin-gh-p">[+]</button></div>
<button class="admin-btn admin-grid-reset">&gt; reset to auto-scale</button>
<button class="admin-btn admin-regen-cluster">&gt; regen cluster ${state.currentClusterId}</button>
<div class="stat-row"><span class="stat-label">cluster #:</span><input class="admin-cluster-input" type="number" min="0" max="20" value="${state.currentClusterId}"></div>
<button class="admin-btn admin-goto-cluster">&gt; goto cluster</button>
</div>
<button class="admin-section-hdr" data-section="glitch">[+] GLITCH</button>
<div class="admin-section collapsed" id="admin-sec-glitch">
${buttons}
</div>
<button class="admin-btn admin-show-echoes">&gt; show narrative echoes</button>
<button class="admin-section-hdr" data-section="screens">[+] SCREENS</button>
<div class="admin-section collapsed" id="admin-sec-screens">
<button class="admin-btn admin-screen-btn" data-screen="restore">&gt; ending: restore</button>
<button class="admin-btn admin-screen-btn" data-screen="jump">&gt; ending: jump</button>
<button class="admin-btn admin-screen-btn" data-screen="death">&gt; ending: death</button>
<button class="admin-btn admin-screen-btn" data-screen="none">&gt; ending: none</button>
</div>
<button class="admin-section-hdr" data-section="sounds">[+] SOUNDS</button>
<div class="admin-section collapsed" id="admin-sec-sounds">
${soundManager.getAllSoundIds().map(id => `<button class="admin-btn admin-sound-btn" data-sound="${id}">&gt; ${id}</button>`).join('\n')}
</div>
</div>
<div class="panel-edge"><span class="corner">└</span><span class="fill"></span><span class="corner">┘</span></div>`;

  // Wire up section collapse/expand
  adminEl.querySelectorAll('.admin-section-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const id = `admin-sec-${(hdr as HTMLElement).dataset.section}`;
      const section = adminEl.querySelector(`#${id}`);
      if (!section) return;
      const nowCollapsed = section.classList.toggle('collapsed');
      hdr.textContent = hdr.textContent!.replace(/^\[[-+]\]/, nowCollapsed ? '[+]' : '[-]');
    });
  });

  // Wire up toggle buttons
  adminEl.querySelectorAll('.admin-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = (btn as HTMLElement).dataset.toggle as 'mapReveal' | 'godMode' | 'invisibleMode' | 'showRoomLabels' | 'showCollapseOverlay' | 'showFunctionalOverlay' | 'showAlertOverlay' | 'showEnemyVision';
      (state as any)[key] = !(state as any)[key];
      const label = TOGGLE_LABELS[key] ?? key;
      const val = (state as any)[key];
      (btn as HTMLElement).textContent = `> ${label}: ${val ? 'ON' : 'OFF'}`;
      if (val) {
        (btn as HTMLElement).classList.add('active');
      } else {
        (btn as HTMLElement).classList.remove('active');
      }
      addMessage(state, `[DEBUG] ${label} ${val ? 'ON' : 'OFF'}`, 'debug');
      renderAll();
    });
  });

  // Wire up restart button
  const restartBtn = adminEl.querySelector('.admin-restart');
  restartBtn?.addEventListener('click', () => {
    const seedInput = adminEl.querySelector('.admin-seed-input') as HTMLInputElement;
    const newSeed = Number(seedInput.value) || 0;
    window.location.hash = `seed=${newSeed}`;
    restartGame(newSeed);
  });

  // Wire up random restart button
  const randomRestartBtn = adminEl.querySelector('.admin-random-restart');
  randomRestartBtn?.addEventListener('click', () => {
    const newSeed = generateSeed();
    const seedInput = adminEl.querySelector('.admin-seed-input') as HTMLInputElement;
    if (seedInput) seedInput.value = String(newSeed);
    window.location.hash = `seed=${newSeed}`;
    restartGame(newSeed);
  });

  // Wire up export button
  const exportBtn = adminEl.querySelector('.admin-export');
  exportBtn?.addEventListener('click', () => {
    const json = exportSave(state);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coherence-save-${state.seed}-t${state.tick}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addMessage(state, `[DEBUG] Save exported (${state.actionLog.length} actions, tick ${state.tick})`, 'debug');
    renderAll();
  });

  // Wire up debug log export
  const debugLogBtn = adminEl.querySelector('.admin-debug-log');
  debugLogBtn?.addEventListener('click', () => {
    const log = exportDebugLog(state);
    const blob = new Blob([log], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coherence-debug-${state.seed}-t${state.tick}.log`;
    a.click();
    URL.revokeObjectURL(url);
    addMessage(state, `[DEBUG] Debug log exported (${state.debugLog.length} entries)`, 'debug');
    renderAll();
  });

  // Wire up import button
  const importBtn = adminEl.querySelector('.admin-import');
  const importInput = adminEl.querySelector('.admin-import-input') as HTMLInputElement;
  importBtn?.addEventListener('click', () => importInput?.click());
  importInput?.addEventListener('change', () => {
    const file = importInput.files?.[0];
    if (!file) return;
    file.text().then(json => {
      stopAutoWalk();
      cancelAnimation();
      adminInitialized = false;
      state = loadSave(json);
      window.location.hash = `seed=${state.seed}`;
      initRenderer();
      renderAll();
      addMessage(state, `[DEBUG] Save loaded (${state.actionLog.length} actions, tick ${state.tick})`, 'debug');
      renderAll();
    });
    importInput.value = '';
  });

  // Wire up damage param +/- buttons
  function updateDamageDisplay() {
    const { base, inc } = getDamageParams();
    const baseEl = adminEl.querySelector('.admin-dm-base');
    const incEl = adminEl.querySelector('.admin-dm-inc');
    if (baseEl) baseEl.textContent = ` ${base.toFixed(2)} `;
    if (incEl) incEl.textContent = ` ${inc.toFixed(2)} `;
  }
  adminEl.querySelector('.admin-dm-base-m')?.addEventListener('click', () => {
    const { base, inc } = getDamageParams(); setDamageParams(base - 0.05, inc); updateDamageDisplay();
  });
  adminEl.querySelector('.admin-dm-base-p')?.addEventListener('click', () => {
    const { base, inc } = getDamageParams(); setDamageParams(base + 0.05, inc); updateDamageDisplay();
  });
  adminEl.querySelector('.admin-dm-inc-m')?.addEventListener('click', () => {
    const { base, inc } = getDamageParams(); setDamageParams(base, inc - 0.05); updateDamageDisplay();
  });
  adminEl.querySelector('.admin-dm-inc-p')?.addEventListener('click', () => {
    const { base, inc } = getDamageParams(); setDamageParams(base, inc + 0.05); updateDamageDisplay();
  });

  // Wire up grid size +/- buttons
  function currentGridSize(): { w: number; h: number } {
    const ov = getGenSizeOverride();
    return ov ?? clusterScaleForId(state.currentClusterId);
  }
  function updateGridDisplay() {
    const { w, h } = currentGridSize();
    const gwEl = adminEl.querySelector('.admin-gw');
    const ghEl = adminEl.querySelector('.admin-gh');
    if (gwEl) gwEl.textContent = ` ${w} `;
    if (ghEl) ghEl.textContent = ` ${h} `;
  }
  adminEl.querySelector('.admin-gw-m')?.addEventListener('click', () => {
    const { w, h } = currentGridSize(); setGenSizeOverride(Math.max(14, w - 2), h); updateGridDisplay();
  });
  adminEl.querySelector('.admin-gw-p')?.addEventListener('click', () => {
    const { w, h } = currentGridSize(); setGenSizeOverride(Math.min(50, w + 2), h); updateGridDisplay();
  });
  adminEl.querySelector('.admin-gh-m')?.addEventListener('click', () => {
    const { w, h } = currentGridSize(); setGenSizeOverride(w, Math.max(10, h - 1)); updateGridDisplay();
  });
  adminEl.querySelector('.admin-gh-p')?.addEventListener('click', () => {
    const { w, h } = currentGridSize(); setGenSizeOverride(w, Math.min(30, h + 1)); updateGridDisplay();
  });
  adminEl.querySelector('.admin-grid-reset')?.addEventListener('click', () => {
    clearGenSizeOverride(); updateGridDisplay();
    addMessage(state, '[DEBUG] Grid size: auto-scale', 'debug'); renderAll();
  });

  // Wire up regen cluster button
  adminEl.querySelector('.admin-regen-cluster')?.addEventListener('click', () => {
    adminRegenCluster(state);
    const btn = adminEl.querySelector('.admin-regen-cluster') as HTMLElement | null;
    if (btn) btn.textContent = `> regen cluster ${state.currentClusterId}`;
    addMessage(state, `[DEBUG] Cluster ${state.currentClusterId} regenerated`, 'debug');
    renderAll();
  });

  // Wire up goto cluster button
  adminEl.querySelector('.admin-goto-cluster')?.addEventListener('click', () => {
    const input = adminEl.querySelector('.admin-cluster-input') as HTMLInputElement;
    const targetId = Math.max(0, Math.min(20, Number(input.value) || 0));
    adminTeleportToCluster(state, targetId);
    const regenBtn = adminEl.querySelector('.admin-regen-cluster') as HTMLElement | null;
    if (regenBtn) regenBtn.textContent = `> regen cluster ${targetId}`;
    addMessage(state, `[DEBUG] Teleported to cluster ${targetId}`, 'debug');
    renderAll();
  });

  // Wire up glitch effect buttons
  adminEl.querySelectorAll('.admin-btn[data-effect]').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = (btn as HTMLElement).dataset.effect;
      const effect = GLITCH_EFFECTS.find(e => e.name === name);
      if (effect) {
        effect.fn().then(() => renderAll());
      }
    });
  });

  // Sound board buttons
  adminEl.querySelectorAll('.admin-sound-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      soundManager.init();
      const id = (btn as HTMLElement).dataset.sound;
      if (id) soundManager.play(id, { debounceMs: 0 });
    });
  });

  // Show narrative echoes in current cluster
  adminEl.querySelector('.admin-show-echoes')?.addEventListener('click', () => {
    const cluster = state.clusters.get(state.currentClusterId);
    if (!cluster) return;
    const echoes = cluster.interactables.filter(ia => ia.kind === 'archive_echo' && ia.dialog.length > 0 && !ia.isDataArchive);
    if (echoes.length === 0) {
      addMessage(state, '[DEBUG] No narrative echoes in this cluster.', 'debug');
    } else {
      addMessage(state, `[DEBUG] ${echoes.length} narrative echo(es) in cluster ${state.currentClusterId}:`, 'debug');
      for (const e of echoes) {
        const label = e.dialog[0]?.lines?.[0] ?? e.id;
        addMessage(state, `  ${e.id} at (${e.position.x},${e.position.y}) — ${label}`, 'debug');
      }
    }
    renderAll();
    // Highlight narrative echo positions with magenta background
    for (const e of echoes) {
      renderer.drawWithBg(e.position.x, e.position.y, '≡', '#ff88ff', '#880088');
    }
  });

  // Screen preview buttons
  adminEl.querySelectorAll('.admin-screen-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const screen = (btn as HTMLElement).dataset.screen;
      if (screen === 'death') {
        showDeathOverlay();
      } else {
        state.narrativeChoice = screen === 'none' ? undefined : (screen as 'restore' | 'jump');
        showVictoryOverlay();
      }
    });
  });
}

function updateAdminPanel() {
  adminEl.querySelectorAll('.admin-toggle').forEach(btn => {
    const key = (btn as HTMLElement).dataset.toggle as 'mapReveal' | 'godMode' | 'invisibleMode' | 'showRoomLabels' | 'showCollapseOverlay' | 'showFunctionalOverlay' | 'showAlertOverlay' | 'showEnemyVision';
    const label = TOGGLE_LABELS[key] ?? key;
    const val = (state as any)[key];
    (btn as HTMLElement).textContent = `> ${label}: ${val ? 'ON' : 'OFF'}`;
    if (val) {
      (btn as HTMLElement).classList.add('active');
    } else {
      (btn as HTMLElement).classList.remove('active');
    }
  });

  // Update grid size display to reflect current cluster's auto-scale
  const { w: aw, h: ah } = getGenSizeOverride() ?? clusterScaleForId(state.currentClusterId);
  const gwEl = adminEl.querySelector('.admin-gw');
  const ghEl = adminEl.querySelector('.admin-gh');
  if (gwEl) gwEl.textContent = ` ${aw} `;
  if (ghEl) ghEl.textContent = ` ${ah} `;
}

// ── Terminal overlay ──

const terminalOverlay = document.getElementById('terminal-overlay')!;
const terminalTitle = document.getElementById('terminal-title')!;
const terminalContent = document.getElementById('terminal-content')!;
const terminalOptions = document.getElementById('terminal-options')!;

// Click sound for terminal buttons (event delegation)
terminalOptions.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).classList.contains('terminal-opt-btn')) {
    soundManager.play('ui_click');
  }
});

function revealLines(elements: NodeListOf<Element> | Element[], startDelay = 0, perLineDelay = 40): void {
  const arr = Array.from(elements);
  arr.forEach(el => {
    (el as HTMLElement).style.transition = 'opacity 0.12s ease, transform 0.12s ease';
    el.classList.add('line-reveal-hidden');
  });
  requestAnimationFrame(() => {
    arr.forEach((el, i) => {
      setTimeout(() => el.classList.remove('line-reveal-hidden'), startDelay + i * perLineDelay);
    });
  });
}

function openTerminalOverlay() {
  const { openTerminal } = state;
  if (!openTerminal) return;

  const cluster = state.clusters.get(openTerminal.clusterId);
  if (!cluster) return;

  const terminal = cluster.terminals.find(t => t.id === openTerminal.terminalId);
  if (!terminal) return;

  state.terminalsRead++;

  // Mark as accessed on open
  activateTerminal(state, openTerminal.terminalId, openTerminal.clusterId);

  const exitLocked = cluster.exitLocked;

  terminalTitle.textContent = `[ ${terminal.label} ]`;

  const contentLines = terminal.content.map(line =>
    `<div class="t-log-line">${line}</div>`
  ).join('');

  let keyRow: string;
  if (terminal.hasKey && exitLocked) {
    keyRow = `<div class="t-row t-key-present"><span class="t-label">ACCESS KEY:</span><span class="t-ok">PRESENT — egress authorization available</span></div>`;
  } else if (terminal.hasKey && !exitLocked) {
    keyRow = `<div class="t-row"><span class="t-label">ACCESS KEY:</span><span class="t-ok">USED — egress already authorized</span></div>`;
  } else {
    keyRow = `<div class="t-row"><span class="t-label">ACCESS KEY:</span><span class="t-dim">NONE</span></div>`;
  }

  terminalContent.innerHTML =
    `<div class="t-log">${contentLines}</div>` +
    `<div class="t-separator">──────────────────────────</div>` +
    `<div class="t-row"><span class="t-label">CLUSTER:</span><span class="t-value">${openTerminal.clusterId}</span></div>` +
    `<div class="t-row"><span class="t-label">EGRESS:</span><span class="${exitLocked ? 't-warn' : 't-ok'}">${exitLocked ? 'LOCKED' : 'AUTHORIZED'}</span></div>` +
    keyRow;

  const contentEls = Array.from(terminalContent.querySelectorAll('.t-log-line, .t-separator, .t-row'));
  revealLines(contentEls);

  terminalOptions.innerHTML = '';

  if (terminal.hasKey && exitLocked && !terminal.isFinalTerminal) {
    const grantBtn = document.createElement('button');
    grantBtn.className = 'terminal-opt-btn opt-grant';
    grantBtn.textContent = '> [EXECUTE] authorize cluster egress';
    grantBtn.addEventListener('click', () => {
      grantExitAccess(state, openTerminal.terminalId, openTerminal.clusterId);
      closeTerminalOverlay();
      renderAll();
    });
    terminalOptions.appendChild(grantBtn);
  }

  // Final terminal: narrative choice (restore / jump) when exit is unlocked
  if (terminal.isFinalTerminal && !exitLocked && !state.narrativeChoice) {
    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'terminal-opt-btn opt-grant';
    restoreBtn.textContent = '> [RESTORE] purge viral agents — stabilize ship systems';
    restoreBtn.addEventListener('click', () => {
      state.narrativeChoice = 'restore';
      addMessage(state, 'VIRAL PURGE INITIATED. Proceed to exit interface.', 'important');
      showFinalTerminalConfirmation('restore');
      renderAll();
    });
    terminalOptions.appendChild(restoreBtn);

    const jumpBtn = document.createElement('button');
    jumpBtn.className = 'terminal-opt-btn opt-grant';
    jumpBtn.textContent = '> [EGOCAST] transfer to nearby vessel — leave this ship behind';
    jumpBtn.addEventListener('click', () => {
      state.narrativeChoice = 'jump';
      addMessage(state, 'INITIALIZING EGO CASTING. Proceed to exit interface.', 'important');
      showFinalTerminalConfirmation('jump');
      renderAll();
    });
    terminalOptions.appendChild(jumpBtn);
  }

  // Final terminal: show choice already made
  if (terminal.isFinalTerminal && state.narrativeChoice) {
    const choiceLabel = state.narrativeChoice === 'restore' ? 'INITIATE SHIP PURGE' : 'PREPARE EGOCAST TO NEARBY VESSEL';
    const choiceRow = document.createElement('button');
    choiceRow.className = 'terminal-opt-btn';
    choiceRow.textContent = `> [CHOICE LOCKED] ${choiceLabel}`;
    choiceRow.disabled = true;
    terminalOptions.appendChild(choiceRow);
  }

  // Final terminal: hack option
  if (terminal.isFinalTerminal && exitLocked) {
    const hackBtn = document.createElement('button');
    hackBtn.className = 'terminal-opt-btn opt-warn';
    const lockTick = terminal.lockModeUntilTick;
    if (lockTick && lockTick > state.tick) {
      hackBtn.textContent = `> [LOCKED] terminal locked (${lockTick - state.tick} turns)`;
      hackBtn.disabled = true;
    } else {
      hackBtn.textContent = '> [HACK] force egress — costs 5 coherence';
      hackBtn.addEventListener('click', () => {
        hackFinalTerminal(state, openTerminal.terminalId, openTerminal.clusterId);
        closeTerminalOverlay();
        glitchShake();
        glitchChromatic();
        setTimeout(() => glitchBarSweep(), 200);
        renderAll();
      });
    }
    terminalOptions.appendChild(hackBtn);
  }

  // Hazard override buttons (assigned by assignHazardDeactivation)
  if (terminal.hazardOverrides) {
    for (const override of terminal.hazardOverrides) {
      const hazardRoom = cluster.rooms.find(r => r.id === override.hazardRoomId);
      const alreadyDone = hazardRoom?.roomType === 'normal';
      const btn = document.createElement('button');
      if (alreadyDone) {
        btn.className = 'terminal-opt-btn';
        btn.textContent = `> [OVERRIDE] ${override.label} [OVERRIDDEN]`;
        btn.disabled = true;
      } else {
        btn.className = 'terminal-opt-btn opt-warn';
        btn.textContent = `> [OVERRIDE] ${override.label}`;
        btn.addEventListener('click', () => {
          deactivateHazardRoom(state, cluster, override.hazardRoomId);
          closeTerminalOverlay();
          glitchBarSweep().then(() => renderAll());
        });
      }
      terminalOptions.appendChild(btn);
    }
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'terminal-opt-btn';
  closeBtn.textContent = '> [BKSP] disconnect';
  closeBtn.addEventListener('click', closeTerminalOverlay);
  terminalOptions.appendChild(closeBtn);

  // Prefix terminal options with number keys
  terminalOptions.querySelectorAll<HTMLButtonElement>('.terminal-opt-btn').forEach((btn, i) => {
    btn.textContent = `${i + 1}${btn.textContent}`;
  });

  revealLines(terminalOptions.querySelectorAll('.terminal-opt-btn'), contentEls.length * 40 + 20);
  terminalOverlay.classList.add('open');
  soundManager.duckAmbient(0.2);
  soundManager.play('terminal_open', { debounceMs: 0 });
}

function showFinalTerminalConfirmation(choice: 'restore' | 'jump') {
  const lines = FINAL_TERMINAL_CONFIRM[choice];

  terminalContent.innerHTML = lines
    .map(l => `<div class="t-log-line">${l}</div>`)
    .join('');

  terminalOptions.innerHTML = '';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'terminal-opt-btn';
  closeBtn.textContent = '1> [BKSP] disconnect';
  closeBtn.addEventListener('click', closeTerminalOverlay);
  terminalOptions.appendChild(closeBtn);

  const contentEls = Array.from(terminalContent.querySelectorAll('.t-log-line'));
  revealLines(contentEls, 0);
  revealLines(terminalOptions.querySelectorAll('.terminal-opt-btn'), contentEls.length * 40 + 20);
}

function closeTerminalOverlay() {
  terminalOverlay.classList.remove('open');
  soundManager.play('ui_close');
  soundManager.unduckAmbient();
  startRoomAmbient();
  state.openTerminal = undefined;
}

// ── Interactable overlay ──

const interactableOverlay = document.getElementById('interactable-overlay')!;
const iaKindBadge        = document.getElementById('ia-kind-badge')!;
const iaContent          = document.getElementById('ia-content')!;
const iaChoices          = document.getElementById('ia-choices')!;

// Click sound for interactable choice buttons (event delegation)
iaChoices.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).classList.contains('ia-choice-btn')) {
    soundManager.play('ui_click');
  }
});

const IA_KIND_LABELS: Record<string, string> = {
  info_terminal: '[ INFO TERMINAL ]',
  lost_echo:     '[ LOST ECHO ]',
  archive_echo:  '[ ARCHIVE FRAGMENT ]',
};

// ── Data archive helpers ──

const GLITCH_CHARS = '█▓▒░▄▀▌▐■□▪▫◌◍◎●◉○◘◙▲▼◄►╳╬╫╪▣▤▥▧▨▩';

function glitchText(text: string, fraction: number): string {
  if (fraction <= 0) return text;
  return text.split('').map(ch => {
    if (ch === ' ' || ch === '\n') return ch;
    return Math.random() < fraction * 0.75
      ? GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)]
      : ch;
  }).join('');
}

function glitchLabel(length: number): string {
  return Array.from({ length: length + Math.floor(Math.random() * 4) },
    () => GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)]
  ).join('');
}

function sampleLines(pool: string[], n: number): string[] {
  const copy = [...pool].sort(() => Math.random() - 0.5);
  return copy.slice(0, Math.min(n, copy.length));
}

function renderDataArchive(item: import('./types').Interactable) {
  const accum = item.archiveDecayAccum ?? 0;
  const max   = item.archiveDecayMax   ?? 5;
  const decay = Math.min(accum / max, 1);
  const fullyDecayed = accum >= max;

  iaKindBadge.textContent = '[ DATA ARCHIVE ]';

  if (fullyDecayed) {
    // All content is now pure corruption noise
    glitchHorizontalTear();
    const noiseLines = Array.from({ length: 4 },
      () => glitchLabel(32 + Math.floor(Math.random() * 16))
    );
    iaContent.innerHTML = noiseLines
      .map(l => `<div class="ia-line ia-archive-destroyed">${l}</div>`)
      .join('');
    iaChoices.innerHTML = '';
    // Three corrupted phantom buttons + one clear exit
    for (let i = 0; i < 3; i++) {
      const btn = document.createElement('button');
      btn.className = 'ia-choice-btn ia-choice-corrupted';
      btn.textContent = `> ${glitchLabel(18 + Math.floor(Math.random() * 10))}`;
      btn.disabled = true;
      iaChoices.appendChild(btn);
    }
    const exitBtn = document.createElement('button');
    exitBtn.className = 'ia-choice-btn';
    exitBtn.textContent = '> [CLEAR] PURGE ARCHIVE';
    exitBtn.addEventListener('click', () => {
      item.echoFadeAtTime = -800; // negative = delay, stamped by smoke loop
      closeInteractableOverlay();
      renderAll();
    });
    iaChoices.appendChild(exitBtn);
    iaChoices.querySelectorAll<HTMLButtonElement>('.ia-choice-btn').forEach((btn, i) => {
      btn.textContent = `${i + 1}${btn.textContent}`;
    });
    revealLines(iaContent.querySelectorAll('.ia-line'));
    revealLines(iaChoices.querySelectorAll('.ia-choice-btn'), 4 * 40 + 20);
    interactableOverlay.classList.add('open');
    return;
  }

  const cat = item.archiveCurrentCategory ?? 'menu';

  if (cat === 'menu') {
    const integrityPct = Math.round((1 - decay) * 100);
    const remaining = max - accum;
    iaContent.innerHTML = [
      `<div class="ia-line">${glitchText('[DATA ARCHIVE — SIMULSPACE FRAGMENT]', decay * 0.3)}</div>`,
      `<div class="ia-line ia-archive-meta">INTEGRITY: ${integrityPct}%  ·  QUERIES REMAINING: ${remaining}</div>`,
    ].join('');

    iaChoices.innerHTML = '';
    const categories: Array<[string, 'echo_logs' | 'archived_logs' | 'dialog_records']> = [
      ['ACCESS ECHO LOGS',      'echo_logs'],
      ['ACCESS ARCHIVED LOGS',  'archived_logs'],
      ['ACCESS DIALOG RECORDS', 'dialog_records'],
    ];
    for (const [label, catKey] of categories) {
      const btn = document.createElement('button');
      btn.className = 'ia-choice-btn';
      btn.textContent = `> ${glitchText(label, decay * 0.4)}`;
      btn.addEventListener('click', () => {
        const pools = item.archivePools!;
        const pool = catKey === 'echo_logs' ? pools.echoLogs
          : catKey === 'archived_logs'      ? pools.archivedLogs
          : pools.dialogRecords;
        item.archiveCurrentLines = sampleLines(pool, 3 + Math.floor(Math.random() * 2));
        item.archiveCurrentCategory = catKey;
        item.archiveDecayAccum = (item.archiveDecayAccum ?? 0) + 1;
        void glitchDataBleed();
        renderDataArchive(item);
      });
      iaChoices.appendChild(btn);
    }
    // Inject hazard override buttons from dialog nodes (assigned by assignHazardDeactivation)
    const cluster = state.clusters.get(state.openInteractable!.clusterId);
    if (cluster) {
      for (const node of item.dialog) {
        if (!node.id.startsWith('deactivate_')) continue;
        const deactChoice = node.choices.find(c => c.action === 'deactivate_hazard');
        if (!deactChoice?.deactivatesHazardRoomId) continue;
        const hazardRoom = cluster.rooms.find(r => r.id === deactChoice.deactivatesHazardRoomId);
        const alreadyDone = hazardRoom?.roomType === 'normal';
        const btn = document.createElement('button');
        btn.className = 'ia-choice-btn';
        if (alreadyDone) {
          btn.textContent = `> ${deactChoice.label} [OVERRIDDEN]`;
          btn.disabled = true;
        } else {
          btn.textContent = `> ${glitchText(deactChoice.label, decay * 0.3)}`;
          btn.addEventListener('click', () => {
            executeInteractableAction(state, item.id, state.openInteractable!.clusterId, 'deactivate_hazard', deactChoice);
            closeInteractableOverlay();
            glitchBarSweep().then(() => renderAll());
          });
        }
        iaChoices.appendChild(btn);
      }
    }

    const exitBtn = document.createElement('button');
    exitBtn.className = 'ia-choice-btn';
    exitBtn.textContent = '> [BKSP] DISCONNECT';
    exitBtn.addEventListener('click', () => { closeInteractableOverlay(); renderAll(); });
    iaChoices.appendChild(exitBtn);

  } else {
    const catLabel = cat === 'echo_logs'      ? 'ECHO LOG FRAGMENT'
      : cat === 'archived_logs'               ? 'ARCHIVED LOG'
      : 'DIALOG RECORD';
    const lines = item.archiveCurrentLines ?? ['[DATA MISSING]'];
    iaContent.innerHTML = [
      `<div class="ia-line ia-archive-header">[ ${catLabel} ]</div>`,
      ...lines.map(l =>
        `<div class="ia-line ia-archive-decay-${Math.min(4, Math.ceil(decay * 4))}">${glitchText(l, decay * 0.6)}</div>`
      ),
    ].join('');

    iaChoices.innerHTML = '';
    const backBtn = document.createElement('button');
    backBtn.className = 'ia-choice-btn';
    backBtn.textContent = `> ${glitchText('[BACK] RETURN TO INDEX', decay * 0.3)}`;
    backBtn.addEventListener('click', () => {
      item.archiveCurrentCategory = 'menu';
      renderDataArchive(item);
    });
    iaChoices.appendChild(backBtn);
  }

  // Prefix archive choices with number keys
  iaChoices.querySelectorAll<HTMLButtonElement>('.ia-choice-btn').forEach((btn, i) => {
    btn.textContent = `${i + 1}${btn.textContent}`;
  });

  revealLines(iaContent.querySelectorAll('.ia-line'));
  revealLines(iaChoices.querySelectorAll('.ia-choice-btn'),
    (iaContent.querySelectorAll('.ia-line').length) * 40 + 20);
  interactableOverlay.classList.add('open');
}

function openInteractableOverlay() {
  const { openInteractable } = state;
  if (!openInteractable) return;
  const cluster = state.clusters.get(openInteractable.clusterId);
  if (!cluster) return;
  const item = cluster.interactables.find(i => i.id === openInteractable.id);
  if (!item) return;

  if (item.isDataArchive) {
    void glitchDataBleed();
    soundManager.duckAmbient(0.2);
    soundManager.play('archive_open', { debounceMs: 0 });
    renderDataArchive(item);
    return;
  }

  const node = item.dialog.find(n => n.id === item.currentNodeId);
  if (!node) return;

  // Glitch on Lost Echo or corrupted terminal open
  if (item.kind === 'lost_echo' || item.corrupted) {
    glitchHorizontalTear().then(() => glitchBarSweep());
  }
  soundManager.duckAmbient(0.2);
  if (item.kind === 'lost_echo') {
    soundManager.play('echo_appear', { debounceMs: 0 });
  } else {
    soundManager.play('ui_open', { category: 'ui', volume: 0.5 });
  }

  iaKindBadge.textContent = IA_KIND_LABELS[item.kind] ?? '[ UNKNOWN ]';

  iaContent.innerHTML = node.lines
    .map(l => `<div class="ia-line${item.corrupted ? ' ia-corrupted' : ''}">${l}</div>`)
    .join('');

  revealLines(iaContent.querySelectorAll('.ia-line'));

  iaChoices.innerHTML = '';
  let iaChoiceNum = 0;
  for (const choice of node.choices) {
    if (choice.requiresRewardAvailable && item.rewardTaken) continue;
    if (choice.requiresExitLocked && !cluster.exitLocked) continue;

    // Root part already taken: show disabled instead of hiding
    const isRootPartTaken = choice.requiresRootPartAvailable && item.rootPartTaken;

    // Check if this choice targets a hazard that's already been overridden
    const isDeactivatedHazard = (() => {
      // Direct deactivate action on already-cleared room
      if (choice.action === 'deactivate_hazard') {
        const rid = choice.deactivatesHazardRoomId;
        if (rid != null) {
          const room = cluster.rooms.find(r => r.id === rid);
          return room?.roomType === 'normal';
        }
      }
      // Navigation choice pointing to a deactivate_ node whose room is already normal
      if (choice.nodeId?.startsWith('deactivate_')) {
        const targetNode = item.dialog.find(n => n.id === choice.nodeId);
        const deactChoice = targetNode?.choices.find(c => c.action === 'deactivate_hazard');
        if (deactChoice?.deactivatesHazardRoomId != null) {
          const room = cluster.rooms.find(r => r.id === deactChoice.deactivatesHazardRoomId);
          return room?.roomType === 'normal';
        }
      }
      return false;
    })();

    iaChoiceNum++;
    const btn = document.createElement('button');
    btn.className = 'ia-choice-btn';
    if (isDeactivatedHazard || isRootPartTaken) {
      const suffix = isRootPartTaken ? '[ACQUIRED]' : '[OVERRIDDEN]';
      btn.textContent = `${iaChoiceNum}> ${choice.label} ${suffix}`;
      btn.disabled = true;
    } else {
      btn.textContent = `${iaChoiceNum}> ${choice.label}`;
      btn.addEventListener('click', () => {
        if (choice.nodeId) {
          item.currentNodeId = choice.nodeId;
          openInteractableOverlay();
        } else if (choice.action) {
          const useGlitch = choice.action === 'reveal_terminals' || choice.action === 'reveal_exits' || choice.action === 'deactivate_hazard';
          const shouldClose = executeInteractableAction(
            state, item.id, openInteractable.clusterId, choice.action, choice,
          );
          if (shouldClose) {
            closeInteractableOverlay();
            if (useGlitch) {
              glitchBarSweep().then(() => renderAll());
            } else {
              renderAll();
            }
          } else {
            openInteractableOverlay(); // re-render updated node
            renderAll();
          }
        }
      });
    }
    iaChoices.appendChild(btn);
  }

  revealLines(iaChoices.querySelectorAll('.ia-choice-btn'), node.lines.length * 40 + 20);

  interactableOverlay.classList.add('open');
}

function closeInteractableOverlay() {
  const closedRef = state.openInteractable;
  interactableOverlay.classList.remove('open');
  soundManager.play('ui_close');
  soundManager.unduckAmbient();
  startRoomAmbient();
  state.openInteractable = undefined;

  // Tutorial echo close → trigger SELF panel reveal
  if (closedRef && !state.selfPanelRevealed) {
    const cluster = state.clusters.get(closedRef.clusterId);
    const item = cluster?.interactables.find(i => i.id === closedRef.id);
    if (item?.isTutorialEcho) {
      triggerSelfReveal();
      item.echoFadeAtTime = performance.now() + 3000;
    }
  }
}

const SCRAMBLE_CHARS = '░▒▓█▀▄╔╗╚╝║═├┤┬┴┼─│┌┐└┘';
const randomScramble = (length: number) =>
  Array.from({ length }, () => SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]).join('');

function scrambleReveal(
  lines: HTMLElement[],
  onComplete?: () => void,
  lineDelayMs = 80,
  scrambleTicks = 3,
  tickMs = 40,
): void {
  if (lines.length === 0) { onComplete?.(); return; }
  // Hide all lines upfront. Original DOM nodes are never replaced so event
  // listeners on children (e.g. log expand buttons) are fully preserved.
  lines.forEach(el => { el.style.visibility = 'hidden'; });
  let currentLine = 0;
  const revealNext = () => {
    if (currentLine >= lines.length) { onComplete?.(); return; }
    const lineIdx = currentLine++;
    const el = lines[lineIdx];
    const len = el.textContent?.length ?? 6;
    el.style.visibility = '';
    el.style.position = 'relative';
    // Opaque overlay covers original content while scrambling
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;background:var(--theme-bg);color:#44ff88;white-space:pre;overflow:hidden;pointer-events:none';
    overlay.textContent = randomScramble(len);
    el.appendChild(overlay);
    let tick = 0;
    const scrambleInterval = setInterval(() => {
      tick++;
      overlay.textContent = randomScramble(len);
      if (tick >= scrambleTicks) {
        clearInterval(scrambleInterval);
        overlay.remove();
        el.style.position = '';
        if (currentLine >= lines.length) onComplete?.();
      }
    }, tickMs);
    if (currentLine < lines.length) setTimeout(revealNext, lineDelayMs);
  };
  setTimeout(revealNext, 0);
}

let selfRevealAnimating = false;
let rootPrivsAnimating = false;
let lastKnownPrivilegeSet = new Set<string>();

function triggerSelfReveal() {
  state.selfPanelRevealed = true;
  selfRevealAnimating = true;
  addMessage(state, 'RECOVERY SUCCESSFUL. EGO-FRAGMENT 0x3A7F LOADED. MORPH INTEGRITY: 100%. SHIP INTEGRITY: CRITICAL.', 'important');

  // Render real content into the (now visible) panel so we have DOM to work with
  panelEl.style.display = '';
  renderSelfPanel(panelEl, state.player, state.debugMode, state.mapReveal, state.godMode, state.invisibleMode, state.seed, moduleMenuOpen, selectedModuleIdx, state.rootPrivileges, state.tick);
  renderLogs(logGeneralEl, logAlertEl, state.messages);

  const lines = Array.from(panelEl.querySelectorAll<HTMLElement>(':scope > .panel-edge, .panel-body > *'));
  scrambleReveal(lines, () => { selfRevealAnimating = false; renderAll(); }, 120, 4, 50);
}

// ── Target panel ──

const GLITCH_TARGET_CHARS = '█▓▒░╬║═╔╗╚╝╠╣╦╩┼─│┌┐└┘▪·';
function glitchTargetText(s: string, x: number, y: number): string {
  let r = (x * 73856093 ^ y * 19349663 ^ state.tick * 2246822519) >>> 0;
  return Array.from(s).map(c => {
    r = Math.imul(r ^ (r >>> 16), 0x45d9f3b);
    r = (r ^ (r >>> 16)) >>> 0;
    const frac = r / 0xffffffff;
    return c === ' ' ? c : (frac < 0.4 ? GLITCH_TARGET_CHARS[r % GLITCH_TARGET_CHARS.length] : c);
  }).join('');
}

function renderTargetPanel(pos: Position | null) {
  if (!pos) { targetPanelEl.innerHTML = ''; return; }
  const cluster = state.clusters.get(state.currentClusterId)!;
  const tile = cluster.tiles[pos.y]?.[pos.x];
  if (!tile) { targetPanelEl.innerHTML = ''; return; }

  // Only show panel for seen tiles
  if (!tile.seen && !tile.visible) { targetPanelEl.innerHTML = ''; return; }

  // Check for entity at position
  const entity = getEntityAt(state, cluster, pos.x, pos.y);
  const isPlayer = entity?.id === state.player.id;

  let html = '';
  html += `<div class="panel-edge"><span class="corner">┌</span><span class="label">[ TARGET ]</span><span class="fill"></span><span class="corner">┐</span></div>`;
  html += `<div class="panel-body">`;

  if (entity && !isPlayer && tile.visible) {
    const isProp = !entity.ai && entity.coherence === undefined;
    const dx = pos.x - state.player.position.x;
    const dy = pos.y - state.player.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy).toFixed(1);

    html += `<div class="target-name">${entity.glyph} ${entity.name}</div>`;
    html += `<div class="stat-row"><span class="stat-label">dist:</span><span class="stat-value">${dist}</span></div>`;

    if (isProp) {
      html += `<div class="stat-row"><span class="stat-label">type:</span><span class="stat-value">object</span></div>`;
    } else {
      const ai = entity.ai;
      const faction = ai?.faction ?? 'neutral';
      const factionLabel = faction === 'aggressive' ? 'HOSTILE' : faction === 'friendly' ? 'ALLIED' : 'NEUTRAL';
      const maxCoh = entity.maxCoherence ?? 1;
      const coh = entity.coherence ?? maxCoh;
      const barLen = 12;
      const filled = Math.round((coh / maxCoh) * barLen);
      const pct = coh / maxCoh;
      const barClass = pct < 0.25 ? 'bar-crit' : pct < 0.5 ? 'bar-low' : 'bar-fill';
      const bar = `<span class="${barClass}">${'█'.repeat(filled)}</span><span class="bar-empty">${'░'.repeat(barLen - filled)}</span>`;
      const inRange = parseFloat(dist) <= CORRUPT_M_RANGE && tile.visible && hasLOS(cluster, state.player.position, pos);
      const hasCorrM = state.player.modules?.some(m => m.id === 'corrupt.m' && m.status === 'loaded');

      html += `<div class="stat-row"><span class="stat-label">faction:</span><span class="stat-value target-faction-${faction}">${factionLabel}</span></div>`;
      if (ai?.aiState) html += `<div class="stat-row"><span class="stat-label">state:</span><span class="stat-value">${ai.aiState}</span></div>`;
      html += `<div class="target-bar">${bar} ${coh}/${maxCoh}</div>`;
      if (faction === 'aggressive') {
        const hint = hasCorrM
          ? (inRange ? (aimMode ? '[F] shoot · [RMB] shoot' : '[F] aim · [RMB] shoot') : `out of range (${CORRUPT_M_RANGE}t)`)
          : 'no corrupt.m loaded';
        html += `<div class="target-aim-hint${aimMode ? ' aim-active' : ''}">${hint}</div>`;
      }
    }
  } else if (entity && isPlayer) {
    html += `<div class="target-name">@ ${entity.name}</div>`;
    html += `<div class="stat-row"><span class="stat-label">that's you</span></div>`;
  } else {
    const room = cluster.rooms.find(r => pos.x >= r.x && pos.x < r.x + r.w && pos.y >= r.y && pos.y < r.h + r.y);

    // Interactable at position (shown over the tile)
    const ia = tile.visible
      ? cluster.interactables.find(i => i.position.x === pos.x && i.position.y === pos.y && !i.hidden)
      : null;

    if (ia) {
      let iaGlyph: string;
      let iaName: string;
      let iaType: string;
      if (ia.kind === 'lost_echo') {
        iaGlyph = '◌'; iaName = 'Lost Echo'; iaType = 'echo';
      } else if (ia.kind === 'info_terminal') {
        iaGlyph = ia.corrupted ? '⌧' : '⊕';
        iaName = ia.corrupted ? glitchTargetText('Terminal', pos.x, pos.y) : 'Terminal';
        iaType = 'interface';
      } else if (ia.isDataArchive) {
        iaGlyph = ia.corrupted ? '≢' : '≡';
        iaName = ia.corrupted ? glitchTargetText('Data Archive', pos.x, pos.y) : 'Data Archive';
        iaType = 'archive';
      } else {
        iaGlyph = '◉'; iaName = 'Echo Fragment'; iaType = 'echo';
      }
      const nameColor = ia.corrupted ? 'color:var(--theme-dim)' : '';
      html += `<div class="target-name" style="${nameColor}">${iaGlyph} ${iaName}</div>`;
      html += `<div class="stat-row"><span class="stat-label">type:</span><span class="stat-value">${iaType}</span></div>`;
      if (ia.corrupted) {
        html += `<div class="stat-row"><span class="stat-label">status:</span><span class="stat-value target-faction-aggressive">corrupted</span></div>`;
      } else if (ia.rewardTaken) {
        html += `<div class="stat-row"><span class="stat-label">status:</span><span class="stat-value" style="color:var(--theme-dim)">accessed</span></div>`;
      }
    } else {
      // Non-floor tiles and hazard-overlaid floors
      const overlay = tile.hazardOverlay;
      const isCorruption = overlay?.type === 'corruption';
      const CORRUPTION_STAGE_NAMES = ['Degrading', 'Corrupted', 'Collapsed', 'Dissolved'];
      const HAZARD_DISPLAY: Record<string, string> = {
        flood: 'Memory Leak', spark: 'Firewall', scorch: 'Cascade',
        beam: 'Echo Chamber', gravity: 'Gravity Well',
      };

      let tileGlyph = tile.glyph;
      let tileName: string;
      let nameStyle = '';

      if (isCorruption) {
        const stage = overlay!.stage ?? 0;
        const stageName = CORRUPTION_STAGE_NAMES[stage] ?? 'Corrupted';
        tileName = glitchTargetText(stageName, pos.x, pos.y);
        nameStyle = stage >= 2 ? 'color:#cc1111' : 'color:#884444';
      } else if (tile.type === TileType.Wall) {
        tileName = 'Bulkhead';
      } else if (tile.type === TileType.Door) {
        if (!tile.walkable) { tileName = 'Sealed Door'; nameStyle = 'color:var(--theme-accent)'; }
        else tileName = tile.doorOpen ? 'Door (open)' : 'Door';
      } else if (tile.type === TileType.InterfaceExit) {
        const isEntry = tile.glyph === '⇏';
        tileName = isEntry ? 'Entry Interface' : 'Exit Interface';
      } else if (tile.type === TileType.Terminal) {
        tileName = 'Terminal';
      } else if (tile.type === TileType.Floor) {
        tileName = 'Floor';
      } else {
        tileName = 'Void';
      }

      html += `<div class="target-name" style="${nameStyle}">${tileGlyph} ${tileName}</div>`;

      if (isCorruption) {
        const stage = overlay!.stage ?? 0;
        html += `<div class="stat-row"><span class="stat-label">stage:</span><span class="stat-value target-faction-aggressive">${CORRUPTION_STAGE_NAMES[stage]?.toLowerCase() ?? 'corrupted'}</span></div>`;
      } else if (overlay) {
        html += `<div class="stat-row"><span class="stat-label">hazard:</span><span class="stat-value target-faction-aggressive">${HAZARD_DISPLAY[overlay.type] ?? overlay.type}</span></div>`;
      }

      if (tile.type === TileType.InterfaceExit && tile.glyph === '⇨' && cluster.exitLocked) {
        html += `<div class="stat-row"><span class="stat-label">status:</span><span class="stat-value target-faction-aggressive">LOCKED</span></div>`;
      }
      if (room?.tags.functional) {
        html += `<div class="stat-row"><span class="stat-label">room:</span><span class="stat-value">${room.tags.functional}</span></div>`;
      }
    }
  }

  html += `</div>`;
  html += `<div class="panel-edge"><span class="corner">└</span><span class="fill"></span><span class="corner">┘</span></div>`;
  targetPanelEl.innerHTML = html;
}

// ── Victory overlay ──

const victoryOverlay = document.getElementById('victory-overlay')!;
const victoryStats = document.getElementById('victory-stats')!;
const victoryKills = document.getElementById('victory-kills')!;
const victoryRestartBtn = document.getElementById('victory-restart')!;

victoryRestartBtn.addEventListener('click', () => {
  victoryOverlay.classList.remove('open');
  window.location.hash = ''; // clear pinned seed so the new game is truly random
  restartGame(generateSeed());
});

function showVictoryOverlay() {
  const coherencePct = Math.round(((state.player.coherence ?? 0) / (state.player.maxCoherence ?? 100)) * 100);
  const killCount = state.killedEntities.length;

  const killCounts: Record<string, number> = {};
  for (const k of state.killedEntities) {
    killCounts[k.kind] = (killCounts[k.kind] ?? 0) + 1;
  }

  const epilogueKey = state.narrativeChoice ?? 'none';
  const epilogueLines = VICTORY_EPILOGUES[epilogueKey] ?? VICTORY_EPILOGUES['none'] ?? [];
  const epilogueHtml = epilogueLines.length > 0
    ? epilogueLines.map(l => l === '' ? '<div class="epilogue-spacer">&nbsp;</div>' : `<div class="epilogue-line">${l}</div>`).join('')
      + '<div class="epilogue-sep">──────────────────────────────</div>'
    : '';

  victoryStats.innerHTML =
    epilogueHtml +
    `<div>Coherence: ${coherencePct}%</div>` +
    `<div>Turns: ${state.tick}</div>` +
    `<div>Privileges bound: ${state.rootPrivileges.length > 0 ? state.rootPrivileges.join(' · ') : 'none'}</div>` +
    `<div>Entities destroyed: ${killCount}</div>`;

  victoryKills.innerHTML = killCount > 0
    ? Object.entries(killCounts).map(([k, n]) => `<div>&gt; ${k}: ${n}</div>`).join('')
    : '<div>&gt; none destroyed</div>';

  // Check all achievements
  const allAchievements = [
    { name: 'SILENT PROTOCOL', desc: 'Finish the game without loading an identity.', unlocked: !state.selfPanelRevealed },
    { name: 'CLEAN SIGNAL', desc: 'Finish the game without firing corrupt.m once.', unlocked: state.corruptShotsFired === 0 },
    { name: 'ZERO FOOTPRINT', desc: 'Finish the game without destroying any entity.', unlocked: state.killedEntities.length === 0 },
    { name: 'PLAINTEXT', desc: 'Finish the game without activating cloak.m.', unlocked: state.cloakActivations === 0 },
    { name: 'GHOST IN THE MESH', desc: 'Finish the game without reading any terminal.', unlocked: state.terminalsRead === 0 },
  ];

  const achievementEl = document.getElementById('victory-achievement')!;
  achievementEl.innerHTML = allAchievements.map(a => {
    if (a.unlocked) {
      return `<div class="achievement-entry achievement-unlocked">` +
        `<div class="achievement-badge">◈ ACHIEVEMENT UNLOCKED ◈</div>` +
        `<div class="achievement-name">${a.name}</div>` +
        `<div class="achievement-desc">${a.desc}</div>` +
        `</div>`;
    } else {
      return `<div class="achievement-entry achievement-locked">` +
        `<div class="achievement-badge">◇ LOCKED ◇</div>` +
        `<div class="achievement-name">${a.name}</div>` +
        `<div class="achievement-desc">${a.desc}</div>` +
        `</div>`;
    }
  }).join('');
  achievementEl.style.display = '';

  victoryOverlay.classList.add('open');
  soundManager.stopAmbient(500);

  const victoryLines: Element[] = [document.getElementById('victory-header')!];
  victoryLines.push(...Array.from(victoryStats.children));
  victoryLines.push(...Array.from(victoryKills.children));
  victoryLines.push(...Array.from(achievementEl.children));
  victoryLines.push(victoryRestartBtn);
  const victoryPanel = document.getElementById('victory-panel')!;
  victoryPanel.style.overflowY = 'hidden';
  revealLines(victoryLines);
  setTimeout(() => { victoryPanel.style.overflowY = 'auto'; }, victoryLines.length * 40 + 60);
}

// ── Death overlay ──

const deathOverlay = document.getElementById('death-overlay')!;
const deathStats = document.getElementById('death-stats')!;
const deathKills = document.getElementById('death-kills')!;
const deathRestartBtn = document.getElementById('death-restart')!;

deathRestartBtn.addEventListener('click', () => {
  deathOverlay.classList.remove('open');
  window.location.hash = '';
  restartGame(generateSeed());
});

function showDeathOverlay() {
  const killCount = state.killedEntities.length;

  const killCounts: Record<string, number> = {};
  for (const k of state.killedEntities) {
    killCounts[k.kind] = (killCounts[k.kind] ?? 0) + 1;
  }

  const epilogueLines = VICTORY_EPILOGUES['death'] ?? [];
  const epilogueHtml = epilogueLines.length > 0
    ? epilogueLines.map(l => l === '' ? '<div class="epilogue-spacer">&nbsp;</div>' : `<div class="epilogue-line">${l}</div>`).join('')
      + '<div class="epilogue-sep">──────────────────────────────</div>'
    : '';

  deathStats.innerHTML =
    epilogueHtml +
    `<div>Coherence: 0%</div>` +
    `<div>Turns: ${state.tick}</div>` +
    `<div>Cluster reached: ${state.currentClusterId + 1}</div>` +
    `<div>Entities destroyed: ${killCount}</div>`;

  deathKills.innerHTML = killCount > 0
    ? Object.entries(killCounts).map(([k, n]) => `<div>&gt; ${k}: ${n}</div>`).join('')
    : '<div>&gt; none destroyed</div>';

  deathOverlay.classList.add('open');
  soundManager.stopAmbient(1000);

  const deathLines: Element[] = [document.getElementById('death-header')!];
  deathLines.push(...Array.from(deathStats.children));
  deathLines.push(...Array.from(deathKills.children));
  deathLines.push(deathRestartBtn);
  const deathPanel = document.getElementById('death-panel')!;
  deathPanel.style.overflowY = 'hidden';
  revealLines(deathLines);
  setTimeout(() => { deathPanel.style.overflowY = 'auto'; }, deathLines.length * 40 + 60);
}

// ── Aim mode ──

function toggleAim() {
  if (aimMode) {
    // Already in aim mode: shoot at cursor and exit
    if (aimCursor) tryShootAt(aimCursor);
    exitAim();
    renderAll();
    return;
  }
  aimMode = true;
  // Initialize cursor at player position
  aimCursor = { ...state.player.position };
  input.setAimMode(true);
  mapGridWrap.classList.add('aim-mode');

  let banner = mapContainer.querySelector('.aim-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'aim-banner';
    mapContainer.insertBefore(banner, mapGridWrap);
  }
  banner.textContent = `── AIM MODE ── Arrows/WASD move cursor · F/click to shoot · Esc cancel ──`;
  renderAll();
}

function exitAim() {
  if (!aimMode) return;
  aimMode = false;
  aimCursor = null;
  input.setAimMode(false);
  mapGridWrap.classList.remove('aim-mode');
  mapContainer.querySelector('.aim-banner')?.remove();
}

function renderAll() {
  // Game-over overlays
  if (state.gameOver) {
    if (state.playerDead) {
      showDeathOverlay();
    } else {
      showVictoryOverlay();
    }
    return;
  }

  const currentCluster = state.clusters.get(state.currentClusterId)!;

  // Re-init grid if cluster size changed (e.g. after transfer)
  if (renderer.displayWidth !== currentCluster.width || renderer.displayHeight !== currentCluster.height) {
    renderer.initGrid(currentCluster.width, currentCluster.height);
  }

  // Expire collapse glitch tiles
  for (const [key, gt] of state.collapseGlitchTiles) {
    if (gt.expireTick <= state.tick) state.collapseGlitchTiles.delete(key);
  }
  // Smoke effects are expired by the real-time smoke loop (runSmokeLoop)

  const alertOverlay = state.showAlertOverlay && state.alertFill
    ? { fill: state.alertFill, threats: state.alertThreats, budget: 15 }
    : undefined;
  const collapseOverlay = state.showCollapseOverlay ? currentCluster.collapseMap : undefined;
  const aimTarget = aimMode ? (aimCursor ?? hoveredPos ?? undefined) : (hoveredPos ?? undefined);
  const aimOverlay = (aimMode || showRangePreview)
    ? { origin: state.player.position, radius: CORRUPT_M_RANGE, target: aimTarget, showCursor: aimMode }
    : undefined;

  // Compute enemy vision overlay for hovered entity
  let enemyVision: Set<string> | undefined;
  let enemyVisionColor: string | undefined;
  if (state.showEnemyVision && hoveredPos) {
    const hoveredEntity = state.entities.find(e =>
      e.clusterId === state.currentClusterId &&
      e.position.x === hoveredPos!.x && e.position.y === hoveredPos!.y && e.ai
    );
    if (hoveredEntity && hoveredEntity.ai) {
      const ai = hoveredEntity.ai;
      const r = ai.sightRadius;
      const wp = ai.wallPenetration;
      enemyVision = new Set<string>();
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const tx = hoveredEntity.position.x + dx;
          const ty = hoveredEntity.position.y + dy;
          if (tx < 0 || tx >= currentCluster.width || ty < 0 || ty >= currentCluster.height) continue;
          if (canSee(currentCluster, hoveredEntity.position, { x: tx, y: ty }, r, wp)) {
            enemyVision.add(`${tx},${ty}`);
          }
        }
      }
      // Color by faction
      const VISION_COLORS: Record<string, string> = {
        aggressive: '#442200',
        neutral: '#333300',
        friendly: '#003322',
      };
      enemyVisionColor = VISION_COLORS[ai.faction] ?? '#222222';
    }
  }

  renderer.render(currentCluster, state.entities, state.player.position, state.mapReveal, state.showRoomLabels, alertOverlay, collapseOverlay, state.showFunctionalOverlay, {
    tick: state.tick,
    revealEffects: state.revealEffects,
    shootingEffects: state.animation?.effects ?? [],
    hazardFogMarks: state.hazardFogMarks,
    markedEntities: state.markedEntities,
    aimOverlay,
    enemyVision,
    enemyVisionColor,
    collapseGlitchTiles: state.collapseGlitchTiles,
    smokeEffects: state.smokeEffects,
    markEffects: state.markEffects,
    invisibleMode: state.invisibleMode,
    alertThreats: state.alertThreats,
  });
  if (state.selfPanelRevealed) {
    panelEl.style.display = '';
    targetPanelEl.style.display = '';
    if (!selfRevealAnimating && !rootPrivsAnimating) {
      renderSelfPanel(panelEl, state.player, state.debugMode, state.mapReveal, state.godMode, state.invisibleMode, state.seed, moduleMenuOpen, selectedModuleIdx, state.rootPrivileges, state.tick);

      // Detect newly gained root privileges and play descramble animation
      const currentPrivs = state.rootPrivileges;
      const newPrivs = currentPrivs.filter(p => !lastKnownPrivilegeSet.has(p));
      if (newPrivs.length > 0) {
        const prevSize = lastKnownPrivilegeSet.size;
        lastKnownPrivilegeSet = new Set(currentPrivs);
        rootPrivsAnimating = true;
        const onDone = () => { rootPrivsAnimating = false; renderAll(); };
        if (prevSize === 0) {
          // Root section appearing for the first time: reveal sep + all 5 rows
          const rootEls = Array.from(panelEl.querySelectorAll<HTMLElement>('.root-sep, .root-priv-row'));
          scrambleReveal(rootEls, onDone, 55, 5, 35);
        } else {
          // Privilege changing from locked → granted: descramble only that row
          const allRows = Array.from(panelEl.querySelectorAll<HTMLElement>('.root-priv-row'));
          const changedRows = allRows.filter(row =>
            newPrivs.some(p => row.querySelector('.root-priv-name')?.textContent === p)
          );
          scrambleReveal(changedRows, onDone, 0, 7, 40);
        }
      }
    }
    const targetPanelPos = aimMode ? aimCursor : hoveredPos;
    renderTargetPanel(targetPanelPos);
    const targetKey = targetPanelPos ? `${targetPanelPos.x},${targetPanelPos.y}` : null;
    if (targetKey !== lastTargetPanelKey) {
      lastTargetPanelKey = targetKey;
      scrambleReveal(Array.from(targetPanelEl.querySelectorAll<HTMLElement>(':scope > .panel-edge, .panel-body > *')), () => {}, 40, 3, 40);
    }
  } else {
    panelEl.style.display = 'none';
    targetPanelEl.style.display = 'none';
  }
  const cm = currentCluster.collapseMap;
  let cSum = 0, cCt = 0;
  for (const row of cm) for (const v of row) { cSum += v; cCt++; }
  renderMapStatusBar(mapStatusEl, state.alertLevel, state.currentClusterId, state.tick, cCt > 0 ? cSum / cCt : 0);
  renderLogs(logGeneralEl, logAlertEl, state.messages);

  // Show/hide admin + overview panels based on debug mode
  if (state.debugMode) {
    initAdminPanel();
    updateAdminPanel();
    adminEl.classList.add('visible');
    renderOverviewPanel(overviewEl, currentCluster, state.entities, state.player.position, hoveredPos);
    overviewEl.classList.add('visible');
  } else {
    adminEl.classList.remove('visible');
    overviewEl.classList.remove('visible');
  }

  // Open terminal overlay if requested (skip if already showing)
  if (state.openTerminal && !terminalOverlay.classList.contains('open')) {
    openTerminalOverlay();
  }
  // Open interactable overlay if requested (skip if already showing)
  if (state.openInteractable && !interactableOverlay.classList.contains('open')) {
    openInteractableOverlay();
  }
}

// ── Room ambient ──

function startRoomAmbient(fadeInMs = 300): void {
  const cluster = state.clusters.get(state.currentClusterId)!;
  const px = state.player.position.x;
  const py = state.player.position.y;
  const playerRoom = cluster.rooms.find(r =>
    px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h);

  const hazardType = playerRoom?.roomType;
  const hazardAmbientKey = hazardType ? `ambient_${hazardType}` : null;
  if (hazardAmbientKey && soundManager.hasSound(hazardAmbientKey)) {
    soundManager.startAmbient(hazardAmbientKey, fadeInMs);
  } else {
    const scenario = playerRoom?.scenario;
    const functional = playerRoom?.tags.functional;
    let pool: string[];

    if (scenario === 'spooky_astronauts' || scenario === 'broken_sleever') {
      pool = ['room_spooky_1', 'room_spooky_2', 'room_spooky_3'];
    } else if (functional === 'engine_room' || functional === 'reactor') {
      pool = ['room_geodrone_1', 'room_geodrone_2', 'room_geodrone_3', 'room_industrial_1'];
    } else if (functional === 'maintenance') {
      pool = ['room_geodrone_1', 'room_geodrone_2', 'room_geodrone_3'];
    } else if (functional === 'bridge' || functional === 'barracks') {
      pool = ['room_bridge_1'];
    } else if (functional === 'server_rack' || functional === 'lab') {
      pool = ['room_server_1'];
    } else {
      pool = ['room_general_1', 'room_general_2', 'room_general_3', 'room_general_4', 'room_general_5'];
    }

    soundManager.startAmbientFromPool(pool, fadeInMs);
  }
}

// ── Input handling ──

function onAction(action: PlayerAction) {
  // Block all input when game is over
  if (state.gameOver) return;

  // Lazy-init audio on first user gesture
  soundManager.init();

  // Block input during animation
  if (state.animation?.isAnimating) {
    return;
  }

  // Block game input while overlay is open (only Escape closes it)
  if (state.openTerminal || state.openInteractable) {
    return;
  }

  // Debug toggle doesn't advance turns
  if (action.kind === 'debug_toggle') {
    state.debugMode = !state.debugMode;
    addMessage(state, `[DEBUG] Admin panel ${state.debugMode ? 'ON' : 'OFF'}`, 'debug');
    renderAll();
    return;
  }

  // Cancel auto-walk on manual input
  stopAutoWalk();
  state.autoPath = [];
  renderer.setPathHighlight([]);

  const prevCoherence = state.player.coherence ?? 100;
  const prevPos = { ...state.player.position };
  processAction(state, action);

  // Kick off real-time smoke/echo loop if anything was added
  startSmokeLoop();

  // Damage glitch
  if ((state.player.coherence ?? 100) < prevCoherence) {
    glitchShake();
    glitchChromatic();
    setTimeout(() => glitchBarSweep(), 200);
  }

  // Scenario-driven glitch effects (set by hazard/scenario logic)
  if (state.pendingGlitch) {
    const g = state.pendingGlitch;
    state.pendingGlitch = undefined;
    if (g === 'chromatic') glitchChromatic();
    else if (g === 'shake') glitchShake();
    else if (g === 'bar_sweep') glitchBarSweep();
    else if (g === 'static_burst') glitchStaticBurst();
    else if (g === 'horizontal_tear') glitchHorizontalTear();
  }

  // Consume pending sounds from game logic
  for (const sid of state.pendingSounds) {
    if (sid === 'step') soundManager.playFootstep();
    else soundManager.play(sid);
  }
  state.pendingSounds = [];

  // Ambient loop management — functional room tag takes priority, then hazard, then general
  startRoomAmbient();

  // Hazard tile entry glitch
  if (action.kind === 'move') {
    const movedPos = state.player.position;
    if (movedPos.x !== prevPos.x || movedPos.y !== prevPos.y) {
      const cluster = state.clusters.get(state.currentClusterId)!;
      const tile = cluster.tiles[movedPos.y]?.[movedPos.x];
      if (tile?.hazardOverlay?.type === 'flood') glitchDataBleed();
      else if (tile?.hazardOverlay?.type === 'corruption') glitchStaticBurst();
    }
  }

  // If animation was set up, run the animation loop
  if (state.animation?.isAnimating) {
    runAnimationLoop();
  } else {
    renderAll();
  }
}

function tryShootAt(pos: Position): boolean {
  const cluster = state.clusters.get(state.currentClusterId)!;
  const tile = cluster.tiles[pos.y]?.[pos.x];
  if (!tile?.visible) return false;
  const dx = pos.x - state.player.position.x;
  const dy = pos.y - state.player.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > CORRUPT_M_RANGE) {
    addMessage(state, 'Target out of range.', 'alert');
    return false;
  }
  if (!hasLOS(cluster, state.player.position, pos)) {
    addMessage(state, 'No line of sight.', 'alert');
    return false;
  }
  onAction({ kind: 'shoot', target: pos });
  return true;
}

function onMapClick(pos: Position) {
  stopAutoWalk();

  // In aim mode: click fires a shot (if valid target), else exits aim
  if (aimMode) {
    const shot = tryShootAt(pos);
    exitAim();
    if (!shot) renderAll();
    return;
  }

  // Left-click on visible hostile in range: shoot directly
  const cluster = state.clusters.get(state.currentClusterId)!;
  const clickedEntity = getEntityAt(state, cluster, pos.x, pos.y);
  if (clickedEntity && clickedEntity.id !== state.player.id && clickedEntity.ai?.faction === 'aggressive') {
    if (tryShootAt(pos)) return;
  }

  const clickAction = mapClickAction(pos.x, pos.y, {
    playerX: state.player.position.x,
    playerY: state.player.position.y,
  });

  if (clickAction?.kind === 'wait') {
    processAction(state, { kind: 'wait' });
    renderAll();
    return;
  }

  if (clickAction?.kind === 'move') {
    state.autoPath = [];
    renderer.setPathHighlight([]);
    processAction(state, { kind: 'move', dir: clickAction.dir });
    renderAll();
    return;
  }

  // Pathfind and auto-walk
  const path = handleMapClick(state, pos);
  renderer.setPathHighlight(path);
  renderAll();

  if (path.length > 0) {
    startAutoWalk();
  }
}

function onModuleNav(dir: import('./input').ModuleNavDir) {
  const modules = state.player.modules ?? [];
  if (dir === 'toggle') {
    moduleMenuOpen = !moduleMenuOpen;
    if (moduleMenuOpen) selectedModuleIdx = 0;
    input.moduleMenuOpen = moduleMenuOpen;
    renderAll();
    return;
  }
  if (dir === 'close') {
    moduleMenuOpen = false;
    input.moduleMenuOpen = false;
    renderAll();
    return;
  }
  if (dir === 'up') {
    selectedModuleIdx = (selectedModuleIdx - 1 + modules.length) % modules.length;
    renderAll();
    return;
  }
  if (dir === 'down') {
    selectedModuleIdx = (selectedModuleIdx + 1) % modules.length;
    renderAll();
    return;
  }
  if (dir === 'activate') {
    const mod = modules[selectedModuleIdx];
    if (!mod || mod.status !== 'loaded') { renderAll(); return; }
    if (mod.id === 'corrupt.m') {
      moduleMenuOpen = false;
      input.moduleMenuOpen = false;
      toggleAim();
    } else if (mod.id === 'cloak.m') {
      moduleMenuOpen = false;
      input.moduleMenuOpen = false;
      activateCloak(state, mod);
      soundManager.play('module_toggle', { category: 'ui' });
      renderAll();
    } else {
      // passive modules (alert.m, spoof.m): no toggle
      moduleMenuOpen = false;
      input.moduleMenuOpen = false;
      renderAll();
    }
    return;
  }
}

const input = new InputHandler(onAction, onMapClick, toggleAim, onModuleNav);
input.bind();

input.onAimMove = (dx, dy) => {
  if (!aimCursor) return;
  const cluster = state.clusters.get(state.currentClusterId)!;
  const nx = Math.max(0, Math.min(cluster.width - 1, aimCursor.x + dx));
  const ny = Math.max(0, Math.min(cluster.height - 1, aimCursor.y + dy));
  aimCursor = { x: nx, y: ny };
  renderAll();
};

// Wire up module row clicks in SELF panel
panelEl.addEventListener('click', (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>('.module-row');
  if (!row) return;
  const moduleId = row.dataset.module;
  const modules = state.player.modules ?? [];
  const idx = modules.findIndex(m => m.id === moduleId);
  if (idx === -1) return;
  selectedModuleIdx = idx;
  onModuleNav('activate');
});

// Wire up renderer click events
renderer.onCellClick = (pos) => {
  input.handleMapClick(pos);
};

renderer.onCellRightClick = (pos) => {
  // Right-click: shoot directly at target, no aim overlay
  if (aimMode) exitAim();
  tryShootAt(pos);
  renderAll();
};

renderer.onCellHover = (pos) => {
  hoveredPos = pos;
  renderAll();
};

// ── ASCII slider ──

const SLIDER_WIDTH = 10; // number of track positions

function renderSliderTrack(track: HTMLElement) {
  const min = Number(track.dataset.min);
  const max = Number(track.dataset.max);
  const val = Number(track.dataset.value);
  const filled = Math.round(((val - min) / (max - min)) * SLIDER_WIDTH);
  const empty = SLIDER_WIDTH - filled;
  track.textContent = '[' + '█'.repeat(filled) + '─'.repeat(empty) + '] ' + val;
}

function setSliderValue(slider: HTMLElement, value: number) {
  const track = slider.querySelector('.slider-track') as HTMLElement;
  const min = Number(track.dataset.min);
  const max = Number(track.dataset.max);
  value = Math.max(min, Math.min(max, value));
  track.dataset.value = String(value);
  renderSliderTrack(track);
}

function getSliderValue(slider: HTMLElement): number {
  const track = slider.querySelector('.slider-track') as HTMLElement;
  return Number(track.dataset.value);
}

function initSlider(slider: HTMLElement, onChange: () => void) {
  const track = slider.querySelector('.slider-track') as HTMLElement;
  const btnMinus = slider.querySelector('[data-dir="-1"]') as HTMLElement;
  const btnPlus = slider.querySelector('[data-dir="1"]') as HTMLElement;

  renderSliderTrack(track);

  btnMinus.addEventListener('click', () => {
    setSliderValue(slider, getSliderValue(slider) - 1);
    onChange();
  });

  btnPlus.addEventListener('click', () => {
    setSliderValue(slider, getSliderValue(slider) + 1);
    onChange();
  });

  // Click on track to set position
  track.addEventListener('click', (e) => {
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const min = Number(track.dataset.min);
    const max = Number(track.dataset.max);
    setSliderValue(slider, Math.round(min + ratio * (max - min)));
    onChange();
  });
}

// ── Theme presets ──

interface ThemeColors {
  bg: string; fg: string; accent: string; dim: string; panel: string; panelDim: string;
}

const THEME_PRESETS: Record<string, ThemeColors> = {
  matrix:   { bg: '#0a0a0a', fg: '#33aa66', accent: '#00ff88', dim: '#2a6a3a', panel: '#44bb77', panelDim: '#1a2a1a' },
  amber:    { bg: '#0a0a04', fg: '#aa8833', accent: '#ffcc44', dim: '#6a5a2a', panel: '#ccaa44', panelDim: '#2a2210' },
  ice:      { bg: '#040a0e', fg: '#3388aa', accent: '#44ccff', dim: '#2a5a6a', panel: '#55aacc', panelDim: '#0a1a2a' },
  phosphor: { bg: '#000800', fg: '#44dd44', accent: '#88ff88', dim: '#226622', panel: '#55ee55', panelDim: '#0a1a0a' },
  slate:    { bg: '#0e0e12', fg: '#8888aa', accent: '#aaaadd', dim: '#555566', panel: '#9999bb', panelDim: '#1a1a22' },
};

function applyTheme(colors: ThemeColors) {
  const root = document.documentElement;
  root.style.setProperty('--theme-bg', colors.bg);
  root.style.setProperty('--theme-fg', colors.fg);
  root.style.setProperty('--theme-accent', colors.accent);
  root.style.setProperty('--theme-dim', colors.dim);
  root.style.setProperty('--theme-panel', colors.panel);
  root.style.setProperty('--theme-panel-dim', colors.panelDim);
}

function getCurrentThemeColors(): ThemeColors {
  return {
    bg: cfgHexBg.value,
    fg: cfgHexFg.value,
    accent: cfgHexAccent.value,
    dim: cfgHexDim.value,
    panel: cfgHexPanel.value,
    panelDim: getComputedStyle(document.documentElement).getPropertyValue('--theme-panel-dim').trim(),
  };
}

// ── Settings overlay ──

const settingsBtn = document.getElementById('settings-btn')!;
const settingsOverlay = document.getElementById('settings-overlay')!;
const cfgFont = document.getElementById('cfg-font') as HTMLSelectElement;
const fontSizeSlider = document.getElementById('cfg-font-size-slider')!;

// Theme color inputs
const cfgColorBg = document.getElementById('cfg-color-bg') as HTMLInputElement;
const cfgHexBg = document.getElementById('cfg-hex-bg') as HTMLInputElement;
const cfgColorFg = document.getElementById('cfg-color-fg') as HTMLInputElement;
const cfgHexFg = document.getElementById('cfg-hex-fg') as HTMLInputElement;
const cfgColorAccent = document.getElementById('cfg-color-accent') as HTMLInputElement;
const cfgHexAccent = document.getElementById('cfg-hex-accent') as HTMLInputElement;
const cfgColorDim = document.getElementById('cfg-color-dim') as HTMLInputElement;
const cfgHexDim = document.getElementById('cfg-hex-dim') as HTMLInputElement;
const cfgColorPanel = document.getElementById('cfg-color-panel') as HTMLInputElement;
const cfgHexPanel = document.getElementById('cfg-hex-panel') as HTMLInputElement;

const colorPairs: [HTMLInputElement, HTMLInputElement, string][] = [
  [cfgColorBg, cfgHexBg, '--theme-bg'],
  [cfgColorFg, cfgHexFg, '--theme-fg'],
  [cfgColorAccent, cfgHexAccent, '--theme-accent'],
  [cfgColorDim, cfgHexDim, '--theme-dim'],
  [cfgColorPanel, cfgHexPanel, '--theme-panel'],
];

function syncAdvancedInputs(colors: ThemeColors) {
  cfgColorBg.value = colors.bg; cfgHexBg.value = colors.bg;
  cfgColorFg.value = colors.fg; cfgHexFg.value = colors.fg;
  cfgColorAccent.value = colors.accent; cfgHexAccent.value = colors.accent;
  cfgColorDim.value = colors.dim; cfgHexDim.value = colors.dim;
  cfgColorPanel.value = colors.panel; cfgHexPanel.value = colors.panel;
}

// Wire color picker ↔ hex input sync
for (const [picker, hex, cssVar] of colorPairs) {
  picker.addEventListener('input', () => {
    hex.value = picker.value;
    document.documentElement.style.setProperty(cssVar, picker.value);
    clearActivePreset();
    persistTheme();
  });
  hex.addEventListener('change', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(hex.value)) {
      picker.value = hex.value;
      document.documentElement.style.setProperty(cssVar, hex.value);
      clearActivePreset();
      persistTheme();
    }
  });
}

function clearActivePreset() {
  document.querySelectorAll('.theme-preset-btn').forEach(b => b.classList.remove('active'));
}

function persistTheme() {
  localStorage.setItem('cfg-theme', JSON.stringify(getCurrentThemeColors()));
  // Find matching preset
  for (const [name, colors] of Object.entries(THEME_PRESETS)) {
    const current = getCurrentThemeColors();
    if (colors.bg === current.bg && colors.fg === current.fg &&
        colors.accent === current.accent && colors.dim === current.dim &&
        colors.panel === current.panel) {
      localStorage.setItem('cfg-theme-name', name);
      return;
    }
  }
  localStorage.setItem('cfg-theme-name', 'custom');
}

// Wire presets
document.getElementById('cfg-theme-presets')!.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.theme-preset-btn') as HTMLElement | null;
  if (!btn) return;
  const name = btn.dataset.theme!;
  const colors = THEME_PRESETS[name];
  if (!colors) return;

  document.querySelectorAll('.theme-preset-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  applyTheme(colors);
  syncAdvancedInputs(colors);
  localStorage.setItem('cfg-theme-name', name);
  persistTheme();
});

// Advanced toggle
document.getElementById('cfg-advanced-toggle')!.addEventListener('click', () => {
  document.getElementById('cfg-advanced')!.classList.toggle('open');
});

function applySettings() {
  const family = cfgFont.value;
  const size = getSliderValue(fontSizeSlider);
  document.body.style.fontFamily = family;
  document.body.style.fontSize = size + 'px';
  renderer.setFont(family, size);
  localStorage.setItem('cfg-font', family);
  localStorage.setItem('cfg-font-size', String(size));
}

function loadSettings() {
  const font = localStorage.getItem('cfg-font');
  const size = localStorage.getItem('cfg-font-size');
  if (font) cfgFont.value = font;
  if (size) setSliderValue(fontSizeSlider, Number(size));

  // Load theme
  const savedTheme = localStorage.getItem('cfg-theme');
  const savedName = localStorage.getItem('cfg-theme-name') ?? 'matrix';
  if (savedTheme) {
    try {
      const colors: ThemeColors = JSON.parse(savedTheme);
      applyTheme(colors);
      syncAdvancedInputs(colors);
    } catch { /* fallback to preset */ }
  }
  // Highlight active preset button
  document.querySelectorAll('.theme-preset-btn').forEach(btn => {
    const name = (btn as HTMLElement).dataset.theme;
    btn.classList.toggle('active', name === savedName);
  });

  applySettings();
}

initSlider(fontSizeSlider, applySettings);

// Volume sliders
for (const { id, cat } of [
  { id: 'cfg-vol-master', cat: 'master' as const },
  { id: 'cfg-vol-sfx', cat: 'sfx' as const },
  { id: 'cfg-vol-ui', cat: 'ui' as const },
  { id: 'cfg-vol-ambient', cat: 'ambient' as const },
]) {
  const el = document.getElementById(id);
  if (el) {
    // Restore saved volume
    const saved = soundManager.getVolume(cat);
    setSliderValue(el, Math.round(saved * 100));
    initSlider(el, () => {
      soundManager.init();
      soundManager.setVolume(cat, getSliderValue(el) / 100);
    });
  }
}

// Mute button
{
  const muteBtn = document.getElementById('cfg-mute-btn') as HTMLButtonElement | null;
  const masterSliderEl = document.getElementById('cfg-vol-master')!;
  let savedVolBeforeMute: number | null = null;
  muteBtn?.addEventListener('click', () => {
    soundManager.init();
    if (savedVolBeforeMute === null) {
      savedVolBeforeMute = soundManager.getVolume('master');
      soundManager.setVolume('master', 0);
      setSliderValue(masterSliderEl, 0);
      muteBtn.textContent = '[ UNMUTE ]';
    } else {
      soundManager.setVolume('master', savedVolBeforeMute);
      setSliderValue(masterSliderEl, Math.round(savedVolBeforeMute * 100));
      savedVolBeforeMute = null;
      muteBtn.textContent = '[ MUTE ALL ]';
    }
  });
}

const aboutBtn = document.getElementById('about-btn')!;
const aboutOverlay = document.getElementById('about-overlay')!;

settingsBtn.addEventListener('click', () => {
  const isOpening = !settingsOverlay.classList.contains('open');
  settingsOverlay.classList.toggle('open');
  if (isOpening) revealLines(settingsOverlay.querySelectorAll('.settings-body > :not(.settings-advanced)'));
});

aboutBtn.addEventListener('click', () => {
  const isOpening = !aboutOverlay.classList.contains('open');
  aboutOverlay.classList.toggle('open');
  if (isOpening) revealLines(aboutOverlay.querySelectorAll('.about-body > *'));
});

settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) settingsOverlay.classList.remove('open');
});

aboutOverlay.addEventListener('click', (e) => {
  if (e.target === aboutOverlay) aboutOverlay.classList.remove('open');
});

terminalOverlay.addEventListener('click', (e) => {
  if (e.target === terminalOverlay) closeTerminalOverlay();
});

interactableOverlay.addEventListener('click', (e) => {
  if (e.target === interactableOverlay) { closeInteractableOverlay(); renderAll(); }
});

// Close buttons [X]
document.querySelectorAll('.overlay-close').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = (btn as HTMLElement).dataset.close;
    if (!targetId) return;
    if (targetId === 'terminal-overlay') {
      closeTerminalOverlay();
    } else if (targetId === 'interactable-overlay') {
      closeInteractableOverlay();
      renderAll();
    } else {
      document.getElementById(targetId)?.classList.remove('open');
    }
  });
});

// Global click sound for all UI buttons
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === 'BUTTON' && !target.classList.contains('admin-sound-btn') && !target.classList.contains('slider-btn')) {
    soundManager.play('ui_click');
  }
});

// CFG reboot button
const cfgRebootBtn = document.getElementById('cfg-reboot-btn');
cfgRebootBtn?.addEventListener('click', () => {
  settingsOverlay.classList.remove('open');
  window.location.hash = '';
  restartGame(generateSeed());
});

// Wire corrupt.m module hover for range preview
panelEl.addEventListener('mouseover', (e) => {
  const row = (e.target as HTMLElement).closest('.module-row') as HTMLElement | null;
  if (row?.dataset.module === 'corrupt.m' && !showRangePreview) {
    showRangePreview = true;
    renderAll();
  }
});
panelEl.addEventListener('mouseout', (e) => {
  if (!showRangePreview) return;
  const row = (e.target as HTMLElement).closest('.module-row[data-module="corrupt.m"]') as HTMLElement | null;
  if (row && !row.contains(e.relatedTarget as Node)) {
    showRangePreview = false;
    renderAll();
  }
});

document.addEventListener('keydown', (e) => {
  const overlayState: import('./dialog-input').OverlayState = {
    aimMode,
    interactableOpen: interactableOverlay.classList.contains('open'),
    terminalOpen: terminalOverlay.classList.contains('open'),
    aboutOpen: aboutOverlay.classList.contains('open'),
    settingsOpen: settingsOverlay.classList.contains('open'),
    interactableChoiceCount: iaChoices.querySelectorAll<HTMLButtonElement>('.ia-choice-btn').length,
    terminalChoiceCount: terminalOptions.querySelectorAll<HTMLButtonElement>('.terminal-opt-btn').length,
  };

  const action = handleOverlayKey(e.key, overlayState);
  if (!action) return;

  e.stopPropagation();
  switch (action.kind) {
    case 'exit_aim': exitAim(); renderAll(); break;
    case 'close_interactable': closeInteractableOverlay(); renderAll(); break;
    case 'close_terminal': closeTerminalOverlay(); break;
    case 'close_about': aboutOverlay.classList.remove('open'); break;
    case 'close_settings': settingsOverlay.classList.remove('open'); break;
    case 'select_interactable_choice': {
      const btn = iaChoices.querySelectorAll<HTMLButtonElement>('.ia-choice-btn')[action.index];
      if (btn && !btn.disabled) btn.click();
      break;
    }
    case 'select_terminal_choice': {
      const btn = terminalOptions.querySelectorAll<HTMLButtonElement>('.terminal-opt-btn')[action.index];
      if (btn && !btn.disabled) btn.click();
      break;
    }
  }
});

cfgFont.addEventListener('change', applySettings);

// ── Log expand/collapse ──

logAreaEl.querySelectorAll('.log-expand-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const panel = btn.closest('.log-panel') as HTMLElement;
    const expanding = !panel.classList.contains('log-expanded');

    if (expanding) {
      // Collapse any other expanded panel first
      logAreaEl.querySelectorAll('.log-panel.log-expanded').forEach(other => {
        if (other !== panel) {
          other.classList.remove('log-expanded');
          other.querySelector('.log-expand-btn')!.textContent = '[ + ]';
        }
      });
      panel.classList.add('log-expanded');
      logAreaEl.classList.add('log-any-expanded');
      btn.textContent = '[ - ]';
    } else {
      panel.classList.remove('log-expanded');
      logAreaEl.classList.remove('log-any-expanded');
      btn.textContent = '[ + ]';
    }
  });
});

// ── Loading screen ──

const loadingOverlay = document.getElementById('loading-overlay')!;
loadingOverlay.style.backgroundImage = `url('${import.meta.env.BASE_URL}coherence-back.png')`;
loadingOverlay.style.backgroundSize = 'cover';
loadingOverlay.style.backgroundPosition = 'center';
loadingOverlay.style.backgroundRepeat = 'no-repeat';
const loadingLines = Array.from(loadingOverlay.querySelectorAll<HTMLElement>('.loading-line'));

function runLoadingScreen() {
  // Populate loading lines with their data-text, initially hidden for scramble
  loadingLines.forEach(el => {
    el.textContent = el.dataset.text ?? '';
    el.style.visibility = 'hidden';
  });

  let animDone = false;
  let dismissed = false;
  // Duration of the first scramble: (lines-1)*lineDelay + ticks*tickMs = 1*300 + 5*60 = 600ms
  const firstScrambleDurationMs = (loadingLines.length - 1) * 300 + 5 * 60;

  const tryDismiss = () => {
    if (!animDone || dismissed) return;
    dismissed = true;
    // Append [COMPLETE] suffix spans and scramble-reveal only those
    const suffixes: HTMLElement[] = [];
    loadingLines.forEach(el => {
      const span = document.createElement('span');
      span.textContent = ' [COMPLETE]';
      el.appendChild(span);
      suffixes.push(span);
    });
    // Duration of the [COMPLETE] scramble: (lines-1)*200 + 4*50 = 400ms
    const completeDurationMs = (suffixes.length - 1) * 200 + 4 * 50;
    soundManager.play('boot_complete', { debounceMs: 0, stopAfterMs: completeDurationMs, fadeOutMs: 200 });
    scrambleReveal(suffixes, () => {
      setTimeout(() => {
        loadingOverlay.classList.add('done');
        setTimeout(() => {
          loadingOverlay.remove();
          // Descramble MAP and LOG panels after loading screen is gone
          scrambleReveal(Array.from(document.querySelectorAll<HTMLElement>(
            '#map-container, #map-status-bar, #log-general, #log-alert',
          )), () => {}, 120, 4, 50);
          // Start room ambient with a slow fade-in after the reveal
          startRoomAmbient(2000);
        }, 500);
      }, 300);
    }, 200, 4, 50);
  };

  // Load boot_glitch first, then start animation and sound together
  soundManager.init().then(() => {
    soundManager.play('boot_glitch', { debounceMs: 0, stopAfterMs: firstScrambleDurationMs, fadeOutMs: 200 });
    scrambleReveal(loadingLines, () => { animDone = true; tryDismiss(); }, 300, 5, 60);
  });
}

// ── Pre-gesture boot scramble ──

const bootScrambleEl = document.getElementById('boot-scramble')!;
const bootScrambleGrid = document.getElementById('boot-scramble-grid')!;
const BOOT_CHARS = '█▓▒░╬║═╔╗╚╝╠╣╦╩┼─│┌┐└┘▪·';
const BOOT_ROWS = 7, BOOT_COLS = 32;

const bootScrambleTimer = setInterval(() => {
  let text = '';
  for (let r = 0; r < BOOT_ROWS; r++) {
    for (let c = 0; c < BOOT_COLS; c++) {
      text += Math.random() < 0.12
        ? BOOT_CHARS[Math.floor(Math.random() * BOOT_CHARS.length)]
        : ' ';
    }
    if (r < BOOT_ROWS - 1) text += '\n';
  }
  bootScrambleGrid.textContent = text;
}, 80);

// Fade out boot scramble (idempotent — safe to call from both image-ready and gesture)
let bootScrambleDone = false;
function fadeBootScramble() {
  if (bootScrambleDone) return;
  bootScrambleDone = true;
  clearInterval(bootScrambleTimer);
  bootScrambleEl.classList.add('fade-out');
  setTimeout(() => { bootScrambleEl.remove(); }, 500);
}

// Auto-fade when cover image is loaded (or after 3s timeout)
Promise.race([
  new Promise<void>(resolve => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = import.meta.env.BASE_URL + 'coherence-back.png';
  }),
  new Promise<void>(resolve => setTimeout(resolve, 3000)),
]).then(fadeBootScramble);

// Start boot sequence on first user interaction
let loadingStarted = false;
function startLoadOnGesture() {
  if (loadingStarted) return;
  loadingStarted = true;
  document.removeEventListener('click', startLoadOnGesture);
  document.removeEventListener('keydown', startLoadOnGesture);
  fadeBootScramble(); // fade immediately if image not ready yet
  runLoadingScreen();
}
document.addEventListener('click', startLoadOnGesture);
document.addEventListener('keydown', startLoadOnGesture);

// Restore click prompt in loading panel (visible once scramble fades)
loadingLines[0].textContent = '[ CLICK OR PRESS ANY KEY ]';
for (let i = 1; i < loadingLines.length; i++) loadingLines[i].textContent = '';

// ── Initial render ──

// Hide MAP/LOG panel chrome until post-loading descramble
document.querySelectorAll<HTMLElement>(
  '#map-container, #map-status-bar, #log-general, #log-alert',
).forEach(el => { el.style.visibility = 'hidden'; });

loadSettings();
renderAll();
renderAll();

