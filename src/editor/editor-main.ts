import { generateCluster, placeEntryPoint } from '../cluster';
import { computeFOV } from '../fov';
import { processAction } from '../game';
import { seed as seedRng } from '../rng';
import { makeChronicler, makeBitMite, makeLogicLeech, makeWhiteHat } from '../ai';
import { TileType, COLORS, CLUSTER_WIDTH, CLUSTER_HEIGHT } from '../types';
import type {
  Cluster, Entity, GameState, Position, Room,
  RoomType, GeometricTag, FunctionalTag, ModifierTag,
  EntityKind, GameMessage,
} from '../types';
import { exportMapFile, importMapFile, serializeCluster, deserializeCluster } from './serialize';

// ── Constants ──

const ROOM_TYPES: RoomType[] = [
  'normal', 'corrupted', 'trigger_trap', 'memory_leak', 'firewall',
  'unstable', 'quarantine', 'echo_chamber', 'gravity_well',
];
const GEOMETRIC_TAGS: GeometricTag[] = [
  'hall', 'room', 'dead_end', 'hub', 'large', 'small',
  'entry', 'exit', 'entry_interface', 'exit_interface',
  'chokepoint', 'secondary_choke', 'peripheral',
];
const FUNCTIONAL_TAGS: (FunctionalTag | 'none')[] = [
  'none', 'engine_room', 'server_rack', 'reactor', 'medbay', 'bridge', 'cargo',
  'barracks', 'lab', 'armory', 'comms', 'maintenance', 'hangar', 'archive', 'sensor_matrix',
];
const MODIFIER_TAGS: ModifierTag[] = [
  'encrypted', 'orphaned', 'overclocked', 'hard_wired', 'degraded', 'fragmented', 'ghosted',
];
const SIM_SPEEDS = [2000, 1200, 800, 500, 350, 220, 150, 80, 30];

// ── Editor State ──

interface EditorState {
  cluster: Cluster;
  entities: Entity[];
  seed: number | null;

  selectedRoomId: number | null;
  selectedEntityId: number | null;
  hoveredCell: Position | null;

  // Simulation
  simState: GameState | null;
  simRunning: boolean;
  simTimer: number | null;
  simTick: number;
  simMessages: GameMessage[];
  preSimSnapshot: { cluster: ReturnType<typeof serializeCluster>; entities: Entity[] } | null;

  // Tools
  placingEntity: EntityKind | null;
}

let state: EditorState = null!;

// ── DOM refs ──

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('map-canvas');
const ctx = canvas.getContext('2d')!;

// ── Canvas sizing ──

const FONT = '13px "Courier New",Courier,monospace';
ctx.font = FONT;
const charW = Math.ceil(ctx.measureText('█').width);
const charH = charW;
canvas.width = CLUSTER_WIDTH * charW;
canvas.height = CLUSTER_HEIGHT * charH;

// ── Tile rendering (adapted from gen-html.ts) ──

interface Cell { glyph: string; fg: string; bg: string; }

function resolveCell(y: number, x: number): Cell {
  const cluster = state.cluster;
  const tile = cluster.tiles[y][x];

  if (tile.type === TileType.Void) return { glyph: ' ', fg: COLORS.bg, bg: COLORS.bg };

  let glyph = tile.glyph;
  let fg = tile.fg;
  let bg = tile.bg;

  // Hazard overlay
  if (tile.hazardOverlay) {
    const ho = tile.hazardOverlay;
    switch (ho.type) {
      case 'corruption':
        if (ho.stage === 0)      { glyph = '░'; fg = '#cc2222'; }
        else if (ho.stage === 1) { glyph = '▒'; fg = '#ff4444'; }
        else                     { glyph = '█'; fg = '#881111'; }
        break;
      case 'flood':
        if (ho.stage === 0) { glyph = '~'; fg = '#2266aa'; bg = '#0a1a3a'; }
        else                { glyph = '≈'; fg = '#1144cc'; bg = '#0a1a3a'; }
        break;
      case 'spark':  glyph = '*'; fg = '#ffff00'; bg = '#332200'; break;
      case 'beam':   fg = '#ffcc00'; bg = '#1a1a00'; break;
      case 'scorch':
        if (ho.stage === 1)      { fg = '#ff8800'; }
        else if (ho.stage === 2) { fg = '#ff4400'; }
        else                     { glyph = '▓'; fg = '#664422'; }
        break;
      case 'gravity':
        if (ho.stage === 2)      { glyph = '●'; fg = '#aa44ff'; bg = '#1a0a2a'; }
        else if (ho.stage === 1) { glyph = '◉'; fg = '#8833cc'; bg = '#140a1a'; }
        else                     { fg = '#6622aa'; bg = '#0a0a14'; }
        break;
    }
  }

  // Entities
  for (const e of state.entities) {
    if (e.position.x === x && e.position.y === y) {
      glyph = e.glyph; fg = e.fg; break;
    }
  }

  return { glyph, fg, bg };
}

function render() {
  const cluster = state.cluster;
  ctx.font = FONT;

  for (let y = 0; y < cluster.height; y++) {
    for (let x = 0; x < cluster.width; x++) {
      const cell = resolveCell(y, x);
      let bg = cell.bg;

      // Room highlight for selected room
      if (state.selectedRoomId !== null && cluster.tiles[y][x].roomId === state.selectedRoomId) {
        bg = blendColor(bg, '#224422', 0.5);
      }

      // Hover highlight
      if (state.hoveredCell && state.hoveredCell.x === x && state.hoveredCell.y === y) {
        bg = blendColor(bg, '#336633', 0.6);
      }

      ctx.fillStyle = bg;
      ctx.fillRect(x * charW, y * charH, charW, charH);
      ctx.fillStyle = cell.fg;
      ctx.fillText(cell.glyph, x * charW, y * charH + charH * 0.82);
    }
  }

  // Draw room labels
  ctx.font = '10px "Courier New",monospace';
  for (const r of cluster.rooms) {
    const cx = (r.x + r.w / 2) * charW;
    const cy = (r.y + 1) * charH + charH * 0.82;
    ctx.fillStyle = 'rgba(68, 204, 136, 0.4)';
    ctx.fillText(`#${r.id}`, cx - 6, cy);
  }
}

function blendColor(base: string, overlay: string, alpha: number): string {
  const parse = (c: string) => {
    const n = parseInt(c.replace('#', ''), 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  };
  const b = parse(base), o = parse(overlay);
  const r = Math.round(b[0] * (1 - alpha) + o[0] * alpha);
  const g = Math.round(b[1] * (1 - alpha) + o[1] * alpha);
  const bl = Math.round(b[2] * (1 - alpha) + o[2] * alpha);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
}

// ── Map generation ──

function generateMap(seed: number, clusterId: number) {
  seedRng(seed);
  const cluster = generateCluster(clusterId);

  // Make all tiles visible for editor
  for (let y = 0; y < cluster.height; y++) {
    for (let x = 0; x < cluster.width; x++) {
      cluster.tiles[y][x].visible = true;
      cluster.tiles[y][x].seen = true;
    }
  }

  state = {
    cluster,
    entities: [],
    seed,
    selectedRoomId: null,
    selectedEntityId: null,
    hoveredCell: null,
    simState: null,
    simRunning: false,
    simTimer: null,
    simTick: 0,
    simMessages: [],
    preSimSnapshot: null,
    placingEntity: null,
  };

  renderEntityList();
  clearRoomInspector();
  render();
}

// ── Room Inspector ──

function clearRoomInspector() {
  $('room-inspector').innerHTML = '<div class="inspector-empty">Click a room to inspect</div>';
}

function renderRoomInspector(room: Room) {
  const el = $('room-inspector');

  const geoTags = GEOMETRIC_TAGS.map(t =>
    `<span class="tag-chip ${room.tags.geometric.has(t) ? 'active' : ''}" data-geo="${t}">${t}</span>`
  ).join('');

  const modTags = MODIFIER_TAGS.map(t =>
    `<span class="tag-chip ${room.tags.modifiers.has(t) ? 'active' : ''}" data-mod="${t}">${t}</span>`
  ).join('');

  const roomTypeOpts = ROOM_TYPES.map(t =>
    `<option value="${t}" ${room.roomType === t ? 'selected' : ''}>${t}</option>`
  ).join('');

  const funcOpts = FUNCTIONAL_TAGS.map(t =>
    `<option value="${t}" ${(t === 'none' ? room.tags.functional === null : room.tags.functional === t) ? 'selected' : ''}>${t}</option>`
  ).join('');

  const hazards = [...room.containedHazards].join(', ') || 'none';

  el.innerHTML = `
    <div class="insp-row"><span class="insp-label">Room</span><span class="insp-value">#${room.id} (${room.w}x${room.h})</span></div>
    <div class="insp-row"><span class="insp-label">Position</span><span class="insp-value">${room.x}, ${room.y}</span></div>
    <div class="insp-row"><span class="insp-label">Collapse</span><span class="insp-value">${room.collapse.toFixed(2)}</span></div>
    <div class="insp-row"><span class="insp-label">Hazards</span><span class="insp-value">${hazards}</span></div>
    <div class="insp-row">
      <span class="insp-label">Type</span>
      <select id="insp-room-type">${roomTypeOpts}</select>
    </div>
    <div class="insp-row">
      <span class="insp-label">Function</span>
      <select id="insp-func-tag">${funcOpts}</select>
    </div>
    <div class="insp-row"><span class="insp-label">Geometric</span></div>
    <div class="tag-list" id="insp-geo-tags">${geoTags}</div>
    <div class="insp-row" style="margin-top:6px"><span class="insp-label">Modifiers</span></div>
    <div class="tag-list" id="insp-mod-tags">${modTags}</div>
    <div class="insp-row" style="margin-top:8px">
      <span class="insp-label">Door adj</span>
      <span class="insp-value">${(state.cluster.doorAdjacency.get(room.id) ?? []).join(', ') || 'none'}</span>
    </div>
  `;

  // Room type change
  $('insp-room-type').addEventListener('change', (e) => {
    room.roomType = (e.target as HTMLSelectElement).value as RoomType;
    render();
  });

  // Functional tag change
  $('insp-func-tag').addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    room.tags.functional = v === 'none' ? null : v as FunctionalTag;
  });

  // Geometric tag toggles
  $('insp-geo-tags').addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest('.tag-chip') as HTMLElement | null;
    if (!chip) return;
    const tag = chip.dataset.geo as GeometricTag;
    if (room.tags.geometric.has(tag)) {
      room.tags.geometric.delete(tag);
      chip.classList.remove('active');
    } else {
      room.tags.geometric.add(tag);
      chip.classList.add('active');
    }
    render();
  });

  // Modifier tag toggles
  $('insp-mod-tags').addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest('.tag-chip') as HTMLElement | null;
    if (!chip) return;
    const tag = chip.dataset.mod as ModifierTag;
    if (room.tags.modifiers.has(tag)) {
      room.tags.modifiers.delete(tag);
      chip.classList.remove('active');
    } else {
      room.tags.modifiers.add(tag);
      chip.classList.add('active');
    }
  });
}

// ── Entity List ──

function renderEntityList() {
  const el = $('entity-list');
  if (state.entities.length === 0) {
    el.innerHTML = '<div class="inspector-empty">No entities</div>';
    return;
  }
  el.innerHTML = state.entities.map(e =>
    `<div class="ent-item ${state.selectedEntityId === e.id ? 'selected' : ''}" data-eid="${e.id}">
      <span class="ent-glyph" style="color:${e.fg}">${e.glyph}</span>
      <span>${e.name} (${e.position.x},${e.position.y})</span>
      <span class="ent-delete" data-del="${e.id}">[x]</span>
    </div>`
  ).join('');

  // Click to select entity
  el.querySelectorAll('.ent-item').forEach(item => {
    item.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement;
      // Delete button
      if (target.classList.contains('ent-delete') || target.closest('.ent-delete')) {
        const id = Number(target.closest('.ent-delete')!.getAttribute('data-del'));
        state.entities = state.entities.filter(e => e.id !== id);
        if (state.selectedEntityId === id) state.selectedEntityId = null;
        renderEntityList();
        render();
        return;
      }
      const eid = Number((item as HTMLElement).dataset.eid);
      state.selectedEntityId = eid;
      renderEntityList();
      render();
    });
  });
}

// ── Entity Placement ──

const entityFactories: Record<EntityKind, (pos: Position, clusterId: number) => Entity> = {
  chronicler: makeChronicler,
  bit_mite: makeBitMite,
  logic_leech: makeLogicLeech,
  white_hat: makeWhiteHat,
};

function placeEntity(kind: EntityKind, pos: Position) {
  const entity = entityFactories[kind](pos, state.cluster.id);
  state.entities.push(entity);
  renderEntityList();
  render();
}

// ── Simulation ──

function buildSimState(): GameState {
  // Deep clone cluster via serialize round-trip
  const clusterClone = deserializeCluster(serializeCluster(state.cluster));
  const entryPos = placeEntryPoint(clusterClone.tiles, clusterClone.rooms);

  // Make all tiles visible
  for (let y = 0; y < clusterClone.height; y++) {
    for (let x = 0; x < clusterClone.width; x++) {
      clusterClone.tiles[y][x].visible = true;
      clusterClone.tiles[y][x].seen = true;
    }
  }

  const player: Entity = {
    id: 0x3A7F,
    name: 'ego-fragment',
    glyph: '@',
    fg: COLORS.player,
    position: { ...entryPos },
    clusterId: clusterClone.id,
    speed: 10,
    energy: 0,
    coherence: 100,
    maxCoherence: 100,
    modules: [
      { id: 'alert.m', status: 'loaded' },
      { id: 'overclock.m', status: 'loaded' },
      { id: 'corrupt.m', status: 'loaded' },
    ],
  };

  // Clone entities
  const entityClones: Entity[] = state.entities.map(e => ({
    ...e,
    position: { ...e.position },
    ai: e.ai ? { ...e.ai } : undefined,
  }));

  const gs: GameState = {
    clusters: new Map([[clusterClone.id, clusterClone]]),
    currentClusterId: clusterClone.id,
    player,
    entities: entityClones,
    nextClusterId: clusterClone.id + 1,
    tick: 0,
    messages: [],
    autoPath: [],
    actionLog: [],
    seed: state.seed ?? 0,
    debugMode: false,
    mapReveal: true,
    godMode: false,
    invisibleMode: true,
    showRoomLabels: false,
    showCollapseOverlay: false,
    showFunctionalOverlay: false,
    showAlertOverlay: false,
    showEnemyVision: false,
    revealEffects: [],
    hazardFogMarks: new Map(),
    alertLevel: 0,
    markedEntities: new Set(),
  };

  computeFOV(clusterClone, entryPos);
  return gs;
}

function simStep() {
  if (!state.simState) return;
  processAction(state.simState, { kind: 'wait' });
  state.simTick = state.simState.tick;

  // Sync entities and cluster back to editor view
  const simCluster = state.simState.clusters.get(state.cluster.id)!;
  state.cluster = simCluster;
  state.entities = state.simState.entities;

  // Collect new messages
  const newMsgs = state.simState.messages.slice(state.simMessages.length);
  state.simMessages = [...state.simState.messages];

  $('sim-tick').textContent = `Tick: ${state.simTick}`;

  // Add messages to log
  const logEl = $('sim-log');
  for (const m of newMsgs) {
    const div = document.createElement('div');
    div.className = `sim-msg ${m.type}`;
    div.textContent = `[${m.tick}] ${m.text}`;
    logEl.appendChild(div);
  }
  logEl.scrollTop = logEl.scrollHeight;

  renderEntityList();
  render();
}

function simPlay() {
  if (state.simRunning) return;
  if (!state.simState) {
    // Save snapshot for reset
    state.preSimSnapshot = {
      cluster: serializeCluster(state.cluster),
      entities: state.entities.map(e => ({ ...e, position: { ...e.position }, ai: e.ai ? { ...e.ai } : undefined })),
    };
    state.simState = buildSimState();
    state.simTick = 0;
    state.simMessages = [];
    $('sim-log').innerHTML = '';
  }
  state.simRunning = true;
  const speedIdx = parseInt(($<HTMLInputElement>('sim-speed')).value) - 1;
  state.simTimer = window.setInterval(simStep, SIM_SPEEDS[speedIdx]);
  $('sim-play').innerHTML = '&#9646;&#9646; Pause';
}

function simPause() {
  if (!state.simRunning) return;
  state.simRunning = false;
  if (state.simTimer !== null) {
    clearInterval(state.simTimer);
    state.simTimer = null;
  }
  $('sim-play').innerHTML = '&#9654; Play';
}

function simReset() {
  simPause();
  if (state.preSimSnapshot) {
    state.cluster = deserializeCluster(state.preSimSnapshot.cluster);
    state.entities = state.preSimSnapshot.entities;
    state.preSimSnapshot = null;
  }
  state.simState = null;
  state.simTick = 0;
  state.simMessages = [];
  $('sim-tick').textContent = 'Tick: 0';
  $('sim-log').innerHTML = '';
  renderEntityList();
  render();
}

// ── Import / Export ──

function doExport() {
  const data = exportMapFile(state.cluster, state.entities, state.seed);
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `map-cl${state.cluster.id}${state.seed !== null ? '-s' + state.seed : ''}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function doImport(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const result = importMapFile(reader.result as string);
      state = {
        cluster: result.cluster,
        entities: result.entities,
        seed: result.seed,
        selectedRoomId: null,
        selectedEntityId: null,
        hoveredCell: null,
        simState: null,
        simRunning: false,
        simTimer: null,
        simTick: 0,
        simMessages: [],
        preSimSnapshot: null,
        placingEntity: null,
      };
      // Make all tiles visible
      for (let y = 0; y < state.cluster.height; y++) {
        for (let x = 0; x < state.cluster.width; x++) {
          state.cluster.tiles[y][x].visible = true;
          state.cluster.tiles[y][x].seen = true;
        }
      }
      ($<HTMLInputElement>('tb-seed')).value = String(result.seed ?? 1);
      ($<HTMLInputElement>('tb-cluster')).value = String(result.clusterId);
      renderEntityList();
      clearRoomInspector();
      render();
    } catch (err) {
      console.error('Import failed:', err);
      alert('Failed to import map file: ' + (err as Error).message);
    }
  };
  reader.readAsText(file);
}

// ── Canvas interaction ──

function cellFromMouse(e: MouseEvent): Position | null {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / charW);
  const y = Math.floor((e.clientY - rect.top) / charH);
  if (x < 0 || x >= CLUSTER_WIDTH || y < 0 || y >= CLUSTER_HEIGHT) return null;
  return { x, y };
}

canvas.addEventListener('mousemove', (e) => {
  const cell = cellFromMouse(e);
  state.hoveredCell = cell;
  if (cell) {
    const tile = state.cluster.tiles[cell.y][cell.x];
    $('status-coords').textContent = `${cell.x}, ${cell.y}`;
    $('status-tile').textContent = tile.type === TileType.Void ? 'void' :
      `${TileType[tile.type]}${tile.hazardOverlay ? ' [' + tile.hazardOverlay.type + ']' : ''}`;
    const roomId = tile.roomId;
    if (roomId >= 0) {
      const room = state.cluster.rooms.find(r => r.id === roomId);
      $('status-room').textContent = room
        ? `Room #${room.id} ${room.roomType} [${[...room.tags.geometric].join(',')}]`
        : `Room #${roomId}`;
    } else {
      $('status-room').textContent = '-';
    }
  }
  render();
});

canvas.addEventListener('mouseleave', () => {
  state.hoveredCell = null;
  render();
});

canvas.addEventListener('click', (e) => {
  const cell = cellFromMouse(e);
  if (!cell) return;

  // Entity placement mode
  if (state.placingEntity) {
    const tile = state.cluster.tiles[cell.y][cell.x];
    if (tile.walkable) {
      placeEntity(state.placingEntity, cell);
    }
    return;
  }

  // Check if clicking on an entity
  const entity = state.entities.find(en => en.position.x === cell.x && en.position.y === cell.y);
  if (entity) {
    state.selectedEntityId = entity.id;
    renderEntityList();
    render();
    return;
  }

  // Room selection
  const tile = state.cluster.tiles[cell.y][cell.x];
  if (tile.roomId >= 0) {
    state.selectedRoomId = tile.roomId;
    state.selectedEntityId = null;
    const room = state.cluster.rooms.find(r => r.id === tile.roomId);
    if (room) renderRoomInspector(room);
  } else {
    state.selectedRoomId = null;
    state.selectedEntityId = null;
    clearRoomInspector();
  }
  render();
});

// Right-click to cancel placement
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (state.placingEntity) {
    state.placingEntity = null;
    document.querySelectorAll('.pal-btn').forEach(b => b.classList.remove('active'));
    canvas.style.cursor = 'crosshair';
  }
});

// ── Wire up toolbar ──

$('tb-generate').addEventListener('click', () => {
  const seed = parseInt(($<HTMLInputElement>('tb-seed')).value) || 1;
  const clusterId = parseInt(($<HTMLInputElement>('tb-cluster')).value) || 3;
  simReset();
  generateMap(seed, clusterId);
});

$('tb-export').addEventListener('click', doExport);

$('tb-import').addEventListener('click', () => {
  ($<HTMLInputElement>('tb-file-input')).click();
});
$('tb-file-input').addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) doImport(file);
});

// ── Entity palette ──

document.querySelectorAll('.pal-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const kind = (btn as HTMLElement).dataset.kind as EntityKind;
    if (state.placingEntity === kind) {
      state.placingEntity = null;
      btn.classList.remove('active');
      canvas.style.cursor = 'crosshair';
    } else {
      state.placingEntity = kind;
      document.querySelectorAll('.pal-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      canvas.style.cursor = 'cell';
    }
  });
});

// ── Simulation controls ──

$('sim-play').addEventListener('click', () => {
  state.simRunning ? simPause() : simPlay();
});
$('sim-step').addEventListener('click', () => {
  if (!state.simState) {
    state.preSimSnapshot = {
      cluster: serializeCluster(state.cluster),
      entities: state.entities.map(e => ({ ...e, position: { ...e.position }, ai: e.ai ? { ...e.ai } : undefined })),
    };
    state.simState = buildSimState();
    state.simTick = 0;
    state.simMessages = [];
    $('sim-log').innerHTML = '';
  }
  simPause();
  simStep();
});
$('sim-reset').addEventListener('click', simReset);

$('sim-speed').addEventListener('input', () => {
  if (state.simRunning) {
    simPause();
    simPlay();
  }
});

// ── Keyboard shortcuts ──

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (state.placingEntity) {
      state.placingEntity = null;
      document.querySelectorAll('.pal-btn').forEach(b => b.classList.remove('active'));
      canvas.style.cursor = 'crosshair';
    }
    state.selectedRoomId = null;
    state.selectedEntityId = null;
    clearRoomInspector();
    render();
  }
  if (e.key === ' ') {
    e.preventDefault();
    state.simRunning ? simPause() : simPlay();
  }
  if (e.key === '.') {
    // Step
    $('sim-step').click();
  }
  if (e.key === 'Delete' && state.selectedEntityId !== null) {
    state.entities = state.entities.filter(en => en.id !== state.selectedEntityId);
    state.selectedEntityId = null;
    renderEntityList();
    render();
  }
});

// ── Initial generation ──

generateMap(1, 3);
