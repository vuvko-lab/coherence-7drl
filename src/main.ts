import { createGame, processAction, handleMapClick, stepAutoPath, addMessage, exportSave, loadSave, adminRegenCluster, adminTeleportToCluster, grantExitAccess, activateTerminal, executeInteractableAction, getEntityAt, CORRUPT_M_RANGE, hackFinalTerminal } from './game';
import { setDamageParams, getDamageParams, setGenSizeOverride, clearGenSizeOverride, getGenSizeOverride, clusterScaleForId } from './cluster';
import { Renderer, renderSelfPanel, renderLogs, renderOverviewPanel, renderMapStatusBar } from './renderer';
import { InputHandler } from './input';
import { PlayerAction, Position, TileType } from './types';
import { generateSeed } from './rng';
import { GLITCH_EFFECTS, initGlitch, glitchShake, glitchChromatic, glitchBarSweep, glitchStaticBurst, glitchHorizontalTear, glitchDataBleed } from './glitch';
import { hasLOS } from './fov';
import { canSee } from './ai';

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
  adminInitialized = false;
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
let aimMode = false;
let showRangePreview = false; // corrupt.m module hover

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
      const totalFrames = effect.style === 'rapid' ? 12 : 4;
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
  adminEl.querySelectorAll('.admin-btn:not(.admin-toggle)').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = (btn as HTMLElement).dataset.effect;
      const effect = GLITCH_EFFECTS.find(e => e.name === name);
      if (effect) {
        effect.fn().then(() => renderAll());
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

function openTerminalOverlay() {
  const { openTerminal } = state;
  if (!openTerminal) return;

  const cluster = state.clusters.get(openTerminal.clusterId);
  if (!cluster) return;

  const terminal = cluster.terminals.find(t => t.id === openTerminal.terminalId);
  if (!terminal) return;

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

  terminalOptions.innerHTML = '';

  if (terminal.hasKey && exitLocked) {
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

  const closeBtn = document.createElement('button');
  closeBtn.className = 'terminal-opt-btn opt-close';
  closeBtn.textContent = '> [ESC] disconnect';
  closeBtn.addEventListener('click', closeTerminalOverlay);
  terminalOptions.appendChild(closeBtn);

  terminalOverlay.classList.add('open');
}

function closeTerminalOverlay() {
  terminalOverlay.classList.remove('open');
  state.openTerminal = undefined;
}

// ── Interactable overlay ──

const interactableOverlay = document.getElementById('interactable-overlay')!;
const iaKindBadge        = document.getElementById('ia-kind-badge')!;
const iaContent          = document.getElementById('ia-content')!;
const iaChoices          = document.getElementById('ia-choices')!;

const IA_KIND_LABELS: Record<string, string> = {
  info_terminal: '[ INFO TERMINAL ]',
  lost_echo:     '[ LOST ECHO ]',
  archive_echo:  '[ ARCHIVE FRAGMENT ]',
};

function openInteractableOverlay() {
  const { openInteractable } = state;
  if (!openInteractable) return;
  const cluster = state.clusters.get(openInteractable.clusterId);
  if (!cluster) return;
  const item = cluster.interactables.find(i => i.id === openInteractable.id);
  if (!item) return;

  const node = item.dialog.find(n => n.id === item.currentNodeId);
  if (!node) return;

  // Glitch on Lost Echo or corrupted terminal open
  if (item.kind === 'lost_echo' || item.corrupted) {
    glitchHorizontalTear().then(() => glitchBarSweep());
  }

  iaKindBadge.textContent = IA_KIND_LABELS[item.kind] ?? '[ UNKNOWN ]';

  iaContent.innerHTML = node.lines
    .map(l => `<div class="ia-line${item.corrupted ? ' ia-corrupted' : ''}">${l}</div>`)
    .join('');

  iaChoices.innerHTML = '';
  for (const choice of node.choices) {
    if (choice.requiresRewardAvailable && item.rewardTaken) continue;
    if (choice.requiresExitLocked && !cluster.exitLocked) continue;
    if (choice.requiresRootPartAvailable && item.rootPartTaken) continue;

    const btn = document.createElement('button');
    btn.className = 'ia-choice-btn';
    btn.textContent = `> ${choice.label}`;
    btn.addEventListener('click', () => {
      if (choice.nodeId) {
        item.currentNodeId = choice.nodeId;
        openInteractableOverlay();
      } else if (choice.action) {
        const isScanAction = choice.action === 'reveal_terminals' || choice.action === 'reveal_exits';
        const shouldClose = executeInteractableAction(
          state, item.id, openInteractable.clusterId, choice.action,
        );
        if (shouldClose) {
          closeInteractableOverlay();
          if (isScanAction) {
            glitchBarSweep().then(() => glitchChromatic()).then(() => renderAll());
          } else {
            renderAll();
          }
        } else {
          openInteractableOverlay(); // re-render updated node
          renderAll();
        }
      }
    });
    iaChoices.appendChild(btn);
  }

  interactableOverlay.classList.add('open');
}

function closeInteractableOverlay() {
  interactableOverlay.classList.remove('open');
  state.openInteractable = undefined;
}

// ── Target panel ──

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

    const dx = pos.x - state.player.position.x;
    const dy = pos.y - state.player.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy).toFixed(1);
    const inRange = parseFloat(dist) <= CORRUPT_M_RANGE && tile.visible && hasLOS(cluster, state.player.position, pos);
    const hasCorrM = state.player.modules?.some(m => m.id === 'corrupt.m' && m.status === 'loaded');

    html += `<div class="target-name">${entity.glyph} ${entity.name}</div>`;
    html += `<div class="stat-row"><span class="stat-label">faction:</span><span class="stat-value target-faction-${faction}">${factionLabel}</span></div>`;
    html += `<div class="stat-row"><span class="stat-label">dist:</span><span class="stat-value">${dist}</span></div>`;
    if (ai?.aiState) html += `<div class="stat-row"><span class="stat-label">state:</span><span class="stat-value">${ai.aiState}</span></div>`;
    html += `<div class="target-bar">${bar} ${coh}/${maxCoh}</div>`;
    if (faction === 'aggressive') {
      const hint = hasCorrM
        ? (inRange ? (aimMode ? '[F] shoot · [RMB] shoot' : '[F] aim · [RMB] shoot') : `out of range (${CORRUPT_M_RANGE}t)`)
        : 'no corrupt.m loaded';
      html += `<div class="target-aim-hint${aimMode ? ' aim-active' : ''}">${hint}</div>`;
    }
  } else if (entity && isPlayer) {
    html += `<div class="target-name">@ ${entity.name}</div>`;
    html += `<div class="stat-row"><span class="stat-label">that's you</span></div>`;
  } else {
    // Tile info
    const tileLabel = tile.type === TileType.Door ? (tile.doorOpen ? 'Door (open)' : 'Door')
      : tile.type === TileType.Wall ? 'Wall'
      : tile.type === TileType.Floor ? 'Floor'
      : tile.type === TileType.InterfaceExit ? 'Interface Exit'
      : tile.type === TileType.Terminal ? 'Terminal'
      : 'Void';
    html += `<div class="target-name">${tileLabel}</div>`;
    if (tile.hazardOverlay) {
      html += `<div class="stat-row"><span class="stat-label">hazard:</span><span class="stat-value target-faction-aggressive">${tile.hazardOverlay.type}</span></div>`;
    }
    const room = cluster.rooms.find(r => pos.x >= r.x && pos.x < r.x + r.w && pos.y >= r.y && pos.y < r.y + r.h);
    if (room?.tags.functional) {
      html += `<div class="stat-row"><span class="stat-label">room:</span><span class="stat-value">${room.tags.functional}</span></div>`;
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

victoryRestartBtn.addEventListener('click', () => location.reload());

function showVictoryOverlay() {
  const coherencePct = Math.round(((state.player.coherence ?? 0) / (state.player.maxCoherence ?? 100)) * 100);
  const killCount = state.killedEntities.length;

  const killCounts: Record<string, number> = {};
  for (const k of state.killedEntities) {
    killCounts[k.kind] = (killCounts[k.kind] ?? 0) + 1;
  }

  victoryStats.innerHTML =
    `<div>Coherence: ${coherencePct}%</div>` +
    `<div>Turns: ${state.tick}</div>` +
    `<div>Root parts collected: ${state.rootPartsCollected}</div>` +
    `<div>Entities destroyed: ${killCount}</div>`;

  victoryKills.innerHTML = killCount > 0
    ? Object.entries(killCounts).map(([k, n]) => `<div>&gt; ${k}: ${n}</div>`).join('')
    : '<div>&gt; none destroyed</div>';

  victoryOverlay.classList.add('open');
}

// ── Aim mode ──

function toggleAim() {
  aimMode = !aimMode;
  mapGridWrap.classList.toggle('aim-mode', aimMode);

  // Show/hide aim banner
  let banner = mapContainer.querySelector('.aim-banner');
  if (aimMode) {
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'aim-banner';
      // Insert before the grid wrap
      mapContainer.insertBefore(banner, mapGridWrap);
    }
    banner.textContent = `── AIM MODE ── F/RMB to shoot · Esc to cancel ──`;
  } else {
    banner?.remove();
  }
  renderAll();
}

function exitAim() {
  if (!aimMode) return;
  aimMode = false;
  mapGridWrap.classList.remove('aim-mode');
  mapContainer.querySelector('.aim-banner')?.remove();
}

function renderAll() {
  // Victory overlay
  if (state.gameOver) {
    showVictoryOverlay();
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

  const alertOverlay = state.showAlertOverlay && state.alertFill
    ? { fill: state.alertFill, threats: state.alertThreats, budget: 15 }
    : undefined;
  const collapseOverlay = state.showCollapseOverlay ? currentCluster.collapseMap : undefined;
  const aimOverlay = (aimMode || showRangePreview)
    ? { origin: state.player.position, radius: CORRUPT_M_RANGE, target: hoveredPos ?? undefined }
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
  });
  renderSelfPanel(panelEl, state.player, state.debugMode, state.mapReveal, state.godMode, state.invisibleMode, state.seed);
  const cm = currentCluster.collapseMap;
  let cSum = 0, cCt = 0;
  for (const row of cm) for (const v of row) { cSum += v; cCt++; }
  renderMapStatusBar(mapStatusEl, state.alertLevel, state.currentClusterId, state.tick, cCt > 0 ? cSum / cCt : 0);
  renderTargetPanel(hoveredPos);
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

  // Open terminal overlay if requested
  if (state.openTerminal) {
    openTerminalOverlay();
  }
  // Open interactable overlay if requested
  if (state.openInteractable) {
    openInteractableOverlay();
  }
}

// ── Input handling ──

function onAction(action: PlayerAction) {
  // Block input during animation
  if (state.animation?.isAnimating) {
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

  // Damage glitch
  if ((state.player.coherence ?? 100) < prevCoherence) {
    glitchShake();
    glitchChromatic();
    setTimeout(() => glitchBarSweep(), 200);
  }

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
  const entity = getEntityAt(state, cluster, pos.x, pos.y);
  if (!entity || entity.id === state.player.id) return false;
  if (entity.ai?.faction !== 'aggressive') return false;
  const dx = pos.x - state.player.position.x;
  const dy = pos.y - state.player.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > CORRUPT_M_RANGE) return false;
  const tile = cluster.tiles[pos.y]?.[pos.x];
  if (!tile?.visible) return false;
  if (!hasLOS(cluster, state.player.position, pos)) return false;
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
  if (tryShootAt(pos)) return;

  // Check if clicking adjacent tile — single step
  const dx = Math.abs(pos.x - state.player.position.x);
  const dy = Math.abs(pos.y - state.player.position.y);

  if (dx + dy === 1) {
    const dir = pos.x > state.player.position.x ? 'right'
      : pos.x < state.player.position.x ? 'left'
      : pos.y > state.player.position.y ? 'down'
      : 'up';
    state.autoPath = [];
    renderer.setPathHighlight([]);
    processAction(state, { kind: 'move', dir });
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

const input = new InputHandler(onAction, onMapClick, toggleAim);
input.bind();

// Wire up renderer click events
renderer.onCellClick = (pos) => {
  input.handleMapClick(pos);
};

renderer.onCellRightClick = (pos) => {
  // Right-click: enter aim and attempt shot, or cancel aim
  if (aimMode) {
    const shot = tryShootAt(pos);
    exitAim();
    if (!shot) renderAll();
  } else {
    aimMode = true;
    mapGridWrap.classList.add('aim-mode');
    let banner = mapContainer.querySelector('.aim-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'aim-banner';
      mapContainer.insertBefore(banner, mapGridWrap);
    }
    banner.textContent = `── AIM MODE ── click/RMB to shoot · Esc to cancel ──`;
    // Attempt immediate shot at right-clicked position
    const shot = tryShootAt(pos);
    if (shot) exitAim();
    else renderAll();
  }
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

const aboutBtn = document.getElementById('about-btn')!;
const aboutOverlay = document.getElementById('about-overlay')!;

settingsBtn.addEventListener('click', () => {
  settingsOverlay.classList.toggle('open');
});

aboutBtn.addEventListener('click', () => {
  aboutOverlay.classList.toggle('open');
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

// Wire corrupt.m module hover for range preview
panelEl.addEventListener('mouseover', (e) => {
  const row = (e.target as HTMLElement).closest('.module-row') as HTMLElement | null;
  if (row?.dataset.module === 'corrupt.m') {
    showRangePreview = true;
    renderAll();
  }
});
panelEl.addEventListener('mouseout', (e) => {
  const row = (e.target as HTMLElement).closest('.module-row') as HTMLElement | null;
  if (row?.dataset.module === 'corrupt.m') {
    showRangePreview = false;
    renderAll();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (aimMode) {
      exitAim();
      renderAll();
      e.stopPropagation();
      return;
    }
    if (interactableOverlay.classList.contains('open')) {
      closeInteractableOverlay();
      renderAll();
      e.stopPropagation();
      return;
    }
    if (terminalOverlay.classList.contains('open')) {
      closeTerminalOverlay();
      e.stopPropagation();
      return;
    }
    if (aboutOverlay.classList.contains('open')) {
      aboutOverlay.classList.remove('open');
      e.stopPropagation();
      return;
    }
    if (settingsOverlay.classList.contains('open')) {
      settingsOverlay.classList.remove('open');
      e.stopPropagation();
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

// ── Initial render ──

loadSettings();
renderAll();
addMessage(state, 'Ready.', 'system');
renderAll();
