import { createGame, processAction, handleMapClick, stepAutoPath, addMessage } from './game';
import { Renderer, renderSelfPanel, renderMessageLog } from './renderer';
import { InputHandler } from './input';
import { PlayerAction, Position, TileType } from './types';
import { GLITCH_EFFECTS } from './glitch';

// ── Bootstrap ──

const state = createGame();
const renderer = new Renderer('map-grid-wrap');
const cluster = state.clusters.get(state.currentClusterId)!;

renderer.initGrid(cluster.width, cluster.height);

const panelEl = document.getElementById('panel-self')!;
const logEl = document.getElementById('message-log')!;
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
${buttons}
</div>
<div class="panel-edge"><span class="corner">└</span><span class="fill"></span><span class="corner">┘</span></div>`;

  // Wire up buttons
  adminEl.querySelectorAll('.admin-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = (btn as HTMLElement).dataset.effect;
      const effect = GLITCH_EFFECTS.find(e => e.name === name);
      if (effect) {
        effect.fn().then(() => renderAll());
      }
    });
  });
}

function renderAll() {
  const currentCluster = state.clusters.get(state.currentClusterId)!;

  // Re-init grid if cluster size changed (e.g. after transfer)
  if (renderer['width'] !== currentCluster.width || renderer['height'] !== currentCluster.height) {
    renderer.initGrid(currentCluster.width, currentCluster.height);
  }

  renderer.render(currentCluster, state.entities, state.player.position, state.debugMode);
  renderSelfPanel(panelEl, state.player, state.currentClusterId, state.tick, state.debugMode);
  renderMessageLog(logEl, state.messages);

  // Show/hide admin panel based on debug mode
  if (state.debugMode) {
    initAdminPanel();
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
    addMessage(state, `[DEBUG] Map reveal ${state.debugMode ? 'ON' : 'OFF'}`, 'debug');
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

const logExpandBtn = document.getElementById('log-expand-btn')!;

logExpandBtn.addEventListener('click', () => {
  const expanded = logEl.classList.toggle('log-expanded');
  logExpandBtn.textContent = expanded ? '[ - ]' : '[ + ]';
});

// ── Initial render ──

loadSettings();
renderAll();
addMessage(state, 'Ready.', 'system');
renderAll();
