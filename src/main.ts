import { createGame, processAction, handleMapClick, stepAutoPath, addMessage, exportSave, loadSave } from './game';
import { Renderer, renderSelfPanel, renderLogs } from './renderer';
import { InputHandler } from './input';
import { PlayerAction, Position, TileType } from './types';
import { GLITCH_EFFECTS } from './glitch';

// ── Bootstrap ──

// Read seed from URL hash (e.g. #seed=12345)
function parseSeedFromURL(): number | undefined {
  const hash = window.location.hash;
  const match = hash.match(/seed=(\d+)/);
  return match ? Number(match[1]) : undefined;
}

let state = createGame(parseSeedFromURL());
const renderer = new Renderer('map-grid-wrap');

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
const logAreaEl = document.getElementById('log-area')!;
const logGeneralEl = document.getElementById('log-general')!;
const logAlertEl = document.getElementById('log-alert')!;
const adminEl = document.getElementById('panel-admin')!;

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

// ── Render ──

let adminInitialized = false;

function initAdminPanel() {
  if (adminInitialized) return;
  adminInitialized = true;

  const buttons = GLITCH_EFFECTS.map(effect => {
    return `<button class="admin-btn" data-effect="${effect.name}">&gt; ${effect.name}</button>`;
  }).join('\n');

  adminEl.innerHTML = `\
<div class="panel-edge"><span class="corner">┌</span><span class="label">[ ADMIN ]</span><span class="fill"></span><span class="corner">┐</span></div>
<div class="panel-body">
<button class="admin-btn admin-toggle" data-toggle="mapReveal">&gt; map reveal: OFF</button>
<button class="admin-btn admin-toggle" data-toggle="godMode">&gt; god mode: OFF</button>
<button class="admin-btn admin-toggle" data-toggle="invisibleMode">&gt; invisible: OFF</button>
<div class="panel-sep"><span class="fill"></span></div>
<div class="stat-row"><span class="stat-label">seed:</span><input class="admin-seed-input" type="text" value="${state.seed}"></div>
<button class="admin-btn admin-restart">&gt; restart with seed</button>
<div class="panel-sep"><span class="fill"></span></div>
<button class="admin-btn admin-export">&gt; export save</button>
<button class="admin-btn admin-import">&gt; import save</button>
<input type="file" class="admin-import-input" accept=".json" style="display:none">
<div class="panel-sep"><span class="fill"></span></div>
${buttons}
</div>
<div class="panel-edge"><span class="corner">└</span><span class="fill"></span><span class="corner">┘</span></div>`;

  // Wire up toggle buttons
  adminEl.querySelectorAll('.admin-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = (btn as HTMLElement).dataset.toggle as 'mapReveal' | 'godMode' | 'invisibleMode';
      (state as any)[key] = !(state as any)[key];
      const label = key === 'godMode' ? 'god mode' : key === 'mapReveal' ? 'map reveal' : 'invisible';
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
    const key = (btn as HTMLElement).dataset.toggle as 'mapReveal' | 'godMode' | 'invisibleMode';
    const label = key === 'godMode' ? 'god mode' : key === 'mapReveal' ? 'map reveal' : 'invisible';
    const val = (state as any)[key];
    (btn as HTMLElement).textContent = `> ${label}: ${val ? 'ON' : 'OFF'}`;
    if (val) {
      (btn as HTMLElement).classList.add('active');
    } else {
      (btn as HTMLElement).classList.remove('active');
    }
  });
}

function renderAll() {
  const currentCluster = state.clusters.get(state.currentClusterId)!;

  // Re-init grid if cluster size changed (e.g. after transfer)
  if (renderer['width'] !== currentCluster.width || renderer['height'] !== currentCluster.height) {
    renderer.initGrid(currentCluster.width, currentCluster.height);
  }

  renderer.render(currentCluster, state.entities, state.player.position, state.mapReveal);
  renderSelfPanel(panelEl, state.player, state.currentClusterId, state.tick, state.debugMode, state.mapReveal, state.godMode, state.invisibleMode, state.seed);
  renderLogs(logGeneralEl, logAlertEl, state.messages);

  // Show/hide admin panel based on debug mode
  if (state.debugMode) {
    initAdminPanel();
    updateAdminPanel();
    adminEl.classList.add('visible');
  } else {
    adminEl.classList.remove('visible');
  }
}

// ── Input handling ──

function onAction(action: PlayerAction) {
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

  const acted = processAction(state, action);
  if (acted) {
    renderAll();
  }
}

function onMapClick(pos: Position) {
  stopAutoWalk();

  // Check if clicking adjacent tile — single step
  const dx = Math.abs(pos.x - state.player.position.x);
  const dy = Math.abs(pos.y - state.player.position.y);

  if (dx + dy === 1) {
    // Single step move
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

const input = new InputHandler(onAction, onMapClick);
input.bind();

// Wire up renderer click events
renderer.onCellClick = (pos) => {
  input.handleMapClick(pos);
};

renderer.onCellHover = (_pos) => {
  // Re-render to update hover highlight
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

// ── Settings overlay ──

const settingsBtn = document.getElementById('settings-btn')!;
const settingsOverlay = document.getElementById('settings-overlay')!;
const cfgFont = document.getElementById('cfg-font') as HTMLSelectElement;
const fontSizeSlider = document.getElementById('cfg-font-size-slider')!;

function applySettings() {
  document.body.style.fontFamily = cfgFont.value;
  document.body.style.fontSize = getSliderValue(fontSizeSlider) + 'px';
  // Persist
  localStorage.setItem('cfg-font', cfgFont.value);
  localStorage.setItem('cfg-font-size', String(getSliderValue(fontSizeSlider)));
}

function loadSettings() {
  const font = localStorage.getItem('cfg-font');
  const size = localStorage.getItem('cfg-font-size');
  if (font) cfgFont.value = font;
  if (size) setSliderValue(fontSizeSlider, Number(size));
  applySettings();
}

initSlider(fontSizeSlider, applySettings);

settingsBtn.addEventListener('click', () => {
  settingsOverlay.classList.toggle('open');
});

settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) settingsOverlay.classList.remove('open');
});

// Close buttons [X]
document.querySelectorAll('.overlay-close').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = (btn as HTMLElement).dataset.close;
    if (targetId) document.getElementById(targetId)?.classList.remove('open');
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && settingsOverlay.classList.contains('open')) {
    settingsOverlay.classList.remove('open');
    e.stopPropagation();
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
