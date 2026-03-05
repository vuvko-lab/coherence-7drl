import { createGame, processAction, handleMapClick, stepAutoPath, addMessage, exportSave, loadSave, adminRegenCluster, adminTeleportToCluster } from './game';
import { setDamageParams, getDamageParams } from './cluster';
import { Renderer, renderSelfPanel, renderLogs, renderOverviewPanel } from './renderer';
import { InputHandler } from './input';
import { PlayerAction, Position, TileType } from './types';
import { generateSeed } from './rng';
import { GLITCH_EFFECTS, initGlitch } from './glitch';

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
const logAreaEl = document.getElementById('log-area')!;
const logGeneralEl = document.getElementById('log-general')!;
const logAlertEl = document.getElementById('log-alert')!;
const adminEl = document.getElementById('panel-admin')!;
const overviewEl = document.getElementById('panel-overview')!;
let hoveredPos: Position | null = null;

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

const TOGGLE_LABELS: Record<string, string> = {
  mapReveal: 'map reveal',
  godMode: 'god mode',
  invisibleMode: 'invisible',
  showRoomLabels: 'room labels',
  showCollapseOverlay: 'collapse heatmap',
  showFunctionalOverlay: 'functional tags',
  showAlertOverlay: 'alert overlay',
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
      const key = (btn as HTMLElement).dataset.toggle as 'mapReveal' | 'godMode' | 'invisibleMode' | 'showRoomLabels' | 'showCollapseOverlay' | 'showFunctionalOverlay' | 'showAlertOverlay';
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
    const key = (btn as HTMLElement).dataset.toggle as 'mapReveal' | 'godMode' | 'invisibleMode' | 'showRoomLabels' | 'showCollapseOverlay' | 'showFunctionalOverlay' | 'showAlertOverlay';
    const label = TOGGLE_LABELS[key] ?? key;
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
  if (renderer.displayWidth !== currentCluster.width || renderer.displayHeight !== currentCluster.height) {
    renderer.initGrid(currentCluster.width, currentCluster.height);
  }

  const alertOverlay = state.showAlertOverlay && state.alertFill
    ? { fill: state.alertFill, threats: state.alertThreats, budget: 15 }
    : undefined;
  const collapseOverlay = state.showCollapseOverlay ? currentCluster.collapseMap : undefined;
  renderer.render(currentCluster, state.entities, state.player.position, state.mapReveal, state.showRoomLabels, alertOverlay, collapseOverlay, state.showFunctionalOverlay);
  renderSelfPanel(panelEl, state.player, state.currentClusterId, state.tick, state.debugMode, state.mapReveal, state.godMode, state.invisibleMode, state.seed);
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

// Close buttons [X]
document.querySelectorAll('.overlay-close').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = (btn as HTMLElement).dataset.close;
    if (targetId) document.getElementById(targetId)?.classList.remove('open');
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
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
