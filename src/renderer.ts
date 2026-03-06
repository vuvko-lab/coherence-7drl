import * as ROT from 'rot-js';
import { Cluster, Entity, Position, COLORS, Room, TileType, HazardOverlayType, RevealEffect } from './types';
import type { FunctionalTag } from './types';

const HAZARD_FOG_COLORS: Partial<Record<HazardOverlayType, string>> = {
  corruption: '#441111',
  flood: '#112233',
  spark:  '#333300',
  scorch: '#332211',
  beam:   '#332200',
  gravity: '#221133',
};

const FUNC_TAG_ABBREV: Record<FunctionalTag, string> = {
  engine_room: 'ENG',
  server_rack: 'SRV', reactor: 'RCT', medbay: 'MED', bridge: 'BRG',
  cargo: 'CRG', barracks: 'BRK', lab: 'LAB', armory: 'ARM',
  comms: 'COM', maintenance: 'MNT', hangar: 'HNG', archive: 'ARC',
  sensor_matrix: 'SEN',
};

const FUNC_TAG_COLOR: Record<string, string> = {
  // Infrastructure — cyan
  engine_room: '#44cccc', server_rack: '#44cccc', maintenance: '#44cccc', reactor: '#44cccc',
  // Military — red
  armory: '#cc4444', bridge: '#cc4444',
  // Science — purple
  lab: '#aa44cc', sensor_matrix: '#aa44cc', archive: '#aa44cc',
  // Living — green
  barracks: '#44cc66', medbay: '#44cc66',
  // Logistics — yellow
  cargo: '#ccaa44', hangar: '#ccaa44', comms: '#ccaa44',
};

const ROOM_TYPE_SHORT: Record<string, string> = {
  normal: 'N', corrupted: 'C', trigger_trap: 'T', memory_leak: 'M',
  firewall: 'F', unstable: 'U', quarantine: 'Q', echo_chamber: 'E',
  gravity_well: 'G',
};

const HAZARD_OVERLAY_SHORT: Record<string, string> = {
  corruption: 'c', flood: 'f', spark: 's', scorch: 't',
  beam: 'b', gravity: 'g',
};

const ROOM_TYPE_COLOR: Record<string, string> = {
  normal: '#446644', corrupted: '#ff4444', trigger_trap: '#ff8844',
  memory_leak: '#4488ff', firewall: '#ffcc00', unstable: '#ffff44',
  quarantine: '#cc44cc', echo_chamber: '#557744', gravity_well: '#aa44ff',
};

function debugRoomLabel(room: Room): string {
  const typeChar = ROOM_TYPE_SHORT[room.roomType] ?? '?';
  let label = `${room.id}${typeChar}`;
  if (room.containedHazards.size > 0) {
    const spread = [...room.containedHazards].map(h => HAZARD_OVERLAY_SHORT[h] ?? '?').join('');
    label += `+${spread}`;
  }
  return label;
}

function debugRoomColor(room: Room): string {
  if (room.containedHazards.size > 0 && room.roomType === 'normal') return '#ff8844';
  return ROOM_TYPE_COLOR[room.roomType] ?? '#666666';
}

export class Renderer {
  private container: HTMLElement;
  private display: ROT.Display | null = null;
  private width = 0;
  private height = 0;
  private hoveredCell: Position | null = null;
  private pathHighlight: Position[] = [];
  // Cache computed bg per cell so entity/player draws preserve it
  private bgCache: string[][] = [];
  private fontFamily = '"Courier New", Courier, monospace';
  private fontSize = 16;

  onCellClick: ((pos: Position) => void) | null = null;
  onCellRightClick: ((pos: Position) => void) | null = null;
  onCellHover: ((pos: Position | null) => void) | null = null;

  get displayWidth() { return this.width; }
  get displayHeight() { return this.height; }

  constructor(wrapId: string) {
    this.container = document.getElementById(wrapId)!;
  }

  setFont(family: string, size: number) {
    this.fontFamily = family;
    this.fontSize = size;
    if (this.display) {
      this.display.setOptions({ fontFamily: family, fontSize: size });
    }
  }

  initGrid(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.container.innerHTML = '';
    this.bgCache = Array.from({ length: height }, () => Array(width).fill(COLORS.bg));

    this.display = new ROT.Display({
      width,
      height,
      fontSize: this.fontSize,
      fontFamily: this.fontFamily,
      bg: COLORS.bg,
      fg: '#33aa66',
      layout: 'rect',
      forceSquareRatio: true,
    });

    const canvas = this.display.getContainer() as HTMLCanvasElement;
    canvas.style.display = 'block';
    this.container.appendChild(canvas);

    canvas.addEventListener('click', (e) => {
      if (!this.display) return;
      const [cx, cy] = this.display.eventToPosition(e);
      if (cx >= 0 && cx < this.width && cy >= 0 && cy < this.height) {
        this.onCellClick?.({ x: cx, y: cy });
      }
    });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!this.display) return;
      const [cx, cy] = this.display.eventToPosition(e);
      if (cx >= 0 && cx < this.width && cy >= 0 && cy < this.height) {
        this.onCellRightClick?.({ x: cx, y: cy });
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!this.display) return;
      const [cx, cy] = this.display.eventToPosition(e);
      if (cx >= 0 && cx < this.width && cy >= 0 && cy < this.height) {
        if (!this.hoveredCell || this.hoveredCell.x !== cx || this.hoveredCell.y !== cy) {
          this.hoveredCell = { x: cx, y: cy };
          this.onCellHover?.({ x: cx, y: cy });
        }
      } else if (this.hoveredCell) {
        this.hoveredCell = null;
        this.onCellHover?.(null);
      }
    });

    canvas.addEventListener('mouseleave', () => {
      this.hoveredCell = null;
      this.onCellHover?.(null);
    });
  }

  /** Draw a character on top of the canvas, preserving the tile's background. */
  drawOver(x: number, y: number, ch: string, fg: string) {
    if (!this.display) return;
    const bg = this.bgCache[y]?.[x] ?? COLORS.bg;
    this.display.draw(x, y, ch, fg, bg);
  }

  setPathHighlight(path: Position[]) {
    this.pathHighlight = path;
  }

  render(
    cluster: Cluster,
    entities: Entity[],
    playerPos: Position,
    mapReveal = false,
    showRoomLabels = false,
    alertOverlay?: { fill?: Map<string, number>; threats?: { x: number; y: number }[]; budget: number },
    collapseOverlay?: number[][],
    showFunctionalOverlay = false,
    extras?: {
      tick?: number;
      revealEffects?: RevealEffect[];
      hazardFogMarks?: Map<string, HazardOverlayType>;
      markedEntities?: Set<number>;
      aimOverlay?: { origin: Position; radius: number; target?: Position };
      enemyVision?: Set<string>; // "x,y" keys of tiles visible to hovered entity
      enemyVisionColor?: string; // tint color for the vision overlay
    },
  ) {
    if (!this.display) return;

    const tick = extras?.tick ?? 0;
    const hazardFogMarks = extras?.hazardFogMarks;

    // Pre-compute revealed tile keys from active reveal effects
    const revealedKeys = new Set<string>();
    for (const effect of (extras?.revealEffects ?? [])) {
      for (const k of effect.positions) revealedKeys.add(k);
    }

    const pathSet = new Set(this.pathHighlight.map(p => `${p.x},${p.y}`));
    const threatSet = alertOverlay?.threats
      ? new Set(alertOverlay.threats.map(t => `${t.x},${t.y}`))
      : undefined;

    // Tile pass — compute colors and draw, cache bg for overlay passes
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const tile = cluster.tiles[y][x];
        const tileKey = `${x},${y}`;
        const isRevealed = revealedKeys.has(tileKey);
        const isVisible = tile.visible || mapReveal || isRevealed;

        let glyph = tile.glyph;
        let fg = tile.fg;
        let bg: string = COLORS.bg;

        // Hazard overlay (only when visible)
        if (isVisible && tile.hazardOverlay) {
          const ho = tile.hazardOverlay;
          switch (ho.type) {
            case 'corruption':
              if (ho.stage === 0) { glyph = '░'; fg = '#cc2222'; }
              else if (ho.stage === 1) { glyph = '▒'; fg = '#ff4444'; }
              else { glyph = '█'; fg = '#881111'; }
              break;
            case 'flood':
              if (ho.stage === 0) { glyph = '~'; fg = '#2266aa'; bg = '#0a1a3a'; }
              else { glyph = '≈'; fg = '#1144cc'; bg = '#0a1a3a'; }
              break;
            case 'spark':
              glyph = '*'; fg = '#ffff00'; bg = '#332200';
              break;
            case 'beam':
              fg = '#ffcc00'; bg = '#1a1a00';
              break;
            case 'scorch':
              if (ho.stage === 1) { fg = '#ff8800'; }
              else if (ho.stage === 2) { fg = '#ff4400'; }
              else { glyph = '▓'; fg = '#664422'; }
              break;
            case 'gravity':
              if (ho.stage === 2) { glyph = '●'; fg = '#aa44ff'; bg = '#1a0a2a'; }
              else if (ho.stage === 1) { glyph = '◉'; fg = '#8833cc'; bg = '#140a1a'; }
              else { fg = '#6622aa'; bg = '#0a0a14'; }
              break;
          }
        }

        if (!tile.seen && !isVisible) {
          // Check alert-module hazard fog mark
          const fogMark = hazardFogMarks?.get(tileKey);
          if (fogMark) {
            glyph = '?';
            fg = HAZARD_FOG_COLORS[fogMark] ?? '#333333';
            bg = COLORS.bg;
          } else {
            glyph = ' ';
            fg = COLORS.unexplored;
            bg = COLORS.unexplored;
          }
        } else if (tile.seen && !isVisible) {
          fg = COLORS.rememberedFg;
          bg = COLORS.bg;
          // Tint remembered hazard tiles when alert module has marked them
          const fogMark = hazardFogMarks?.get(tileKey);
          if (fogMark) {
            fg = HAZARD_FOG_COLORS[fogMark] ?? COLORS.rememberedFg;
          }
        }

        // Aim range overlay
        if (extras?.aimOverlay && isVisible) {
          const ao = extras.aimOverlay;
          const adx = x - ao.origin.x;
          const ady = y - ao.origin.y;
          const dist = Math.sqrt(adx * adx + ady * ady);
          if (dist <= ao.radius) {
            // Inside range: very subtle yellow tint
            bg = '#151500';
            // Ring edge: brighter
            if (dist > ao.radius - 1.2) bg = '#252500';
          }
          // Aimed target cell: bright highlight
          if (ao.target && ao.target.x === x && ao.target.y === y) {
            bg = '#3a2a00';
            fg = '#ffcc00';
          }
        }

        // Hover highlight
        if (this.hoveredCell?.x === x && this.hoveredCell?.y === y && isVisible) {
          bg = extras?.aimOverlay ? '#3a2a00' : '#1a3a1a';
        }

        // Path highlight
        if (pathSet.has(`${x},${y}`) && isVisible) {
          bg = '#2a3a1a';
        }

        // Alert flood-fill overlay
        if (alertOverlay?.fill) {
          const tileKey = `${x},${y}`;
          const cost = alertOverlay.fill.get(tileKey);
          if (cost !== undefined) {
            if (threatSet?.has(tileKey)) {
              bg = '#3a1010';
              fg = '#ff4444';
            } else {
              const intensity = Math.max(0, 1 - cost / alertOverlay.budget);
              const g = Math.round(20 + intensity * 30);
              bg = `rgb(10,${g},15)`;
            }
          }
        }

        // Collapse heatmap overlay
        if (collapseOverlay) {
          const c = collapseOverlay[y]?.[x] ?? 0;
          if (c < 0.3) {
            const i = c / 0.3;
            bg = `rgb(${Math.round(10 + i * 5)},${Math.round(15 + i * 5)},${Math.round(30 + i * 20)})`;
          } else if (c < 0.6) {
            const i = (c - 0.3) / 0.3;
            bg = `rgb(${Math.round(30 + i * 20)},${Math.round(25 + i * 15)},10)`;
          } else {
            const i = (c - 0.6) / 0.4;
            bg = `rgb(${Math.round(30 + i * 40)},10,10)`;
          }
        }

        // Enemy vision overlay
        if (extras?.enemyVision?.has(tileKey)) {
          const vc = extras.enemyVisionColor ?? '#442200';
          // Parse hex and blend
          const vn = parseInt(vc.replace('#', ''), 16);
          const vr = (vn >> 16) & 0xff, vg = (vn >> 8) & 0xff, vb = vn & 0xff;
          // Parse current bg (may be rgb(...) or #hex)
          let br = 10, bgc = 10, bb = 10;
          if (bg.startsWith('#')) {
            const bn = parseInt(bg.replace('#', ''), 16);
            br = (bn >> 16) & 0xff; bgc = (bn >> 8) & 0xff; bb = bn & 0xff;
          } else {
            const m = bg.match(/(\d+)/g);
            if (m) { br = +m[0]; bgc = +m[1]; bb = +m[2]; }
          }
          const a = 0.45;
          bg = `rgb(${Math.round(br * (1 - a) + vr * a)},${Math.round(bgc * (1 - a) + vg * a)},${Math.round(bb * (1 - a) + vb * a)})`;
        }

        this.bgCache[y][x] = bg;
        this.display.draw(x, y, glyph, fg, bg);
      }
    }

    // Entity pass — reuse cached bg so only the glyph changes
    const markedEntities = extras?.markedEntities;
    for (const entity of entities) {
      if (entity.clusterId !== cluster.id) continue;
      const { x, y } = entity.position;
      if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;
      const tile = cluster.tiles[y][x];
      if (!tile.visible && !mapReveal) continue;
      // Logic Leech invisible during stalk — only show if debug/mapReveal
      if (entity.ai?.invisible && !mapReveal) continue;
      const isMarked = markedEntities?.has(entity.id) ?? false;
      let fg = entity.fg;
      // Marked entities get a yellow-tinted glyph (faction color kept, just desaturate/tint)
      if (isMarked) fg = '#ffee44';
      this.display.draw(x, y, entity.glyph, fg, this.bgCache[y][x]);
      // Overlay a small ◈ marker one cell above if marked and room permits
      if (isMarked && y > 0 && (cluster.tiles[y - 1]?.[x]?.visible || mapReveal)) {
        this.display.draw(x, y - 1, '▲', '#ffee44', this.bgCache[y - 1]?.[x] ?? '#0a0a0a');
      }
    }

    // Interactable pass — drawn on top of tiles/entities
    for (const item of cluster.interactables) {
      if (item.hidden) continue;
      const { x, y } = item.position;
      if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;
      const tile = cluster.tiles[y][x];
      const itemVisible = tile.visible || mapReveal || revealedKeys.has(`${x},${y}`);
      if (!itemVisible && !tile.seen) continue;

      let glyph: string;
      let fg: string;

      if (!itemVisible) {
        // Seen but not in current FOV: remembered ghost (dim but readable)
        switch (item.kind) {
          case 'info_terminal': glyph = 'ⓘ'; fg = '#2a5580'; break;
          case 'lost_echo':     glyph = '◌'; fg = '#2a6650'; break;
          case 'archive_echo':  glyph = '≡'; fg = '#7a5530'; break;
          default: glyph = '?'; fg = '#445555';
        }
      } else {
        switch (item.kind) {
          case 'info_terminal':
            glyph = item.corrupted && (tick % 5 === 0) ? '⌧' : 'ⓘ';
            fg = item.corrupted ? '#aaaa44' : '#44aaff';
            break;
          case 'lost_echo': {
            const phase = tick % 5;
            glyph = phase === 0 ? '◍' : phase === 3 ? '●' : '◌';
            const brightness = 35 + (tick % 4) * 8;
            fg = `hsl(165,55%,${brightness}%)`;
            break;
          }
          case 'archive_echo':
            glyph = item.corrupted && (tick % 7 === 0) ? '≢' : '≡';
            fg = item.corrupted ? '#cc8844' : '#cccc44';
            break;
          default: glyph = '?'; fg = '#888888';
        }
      }
      this.drawOver(x, y, glyph, fg);
    }

    // Player on top
    const { x: px, y: py } = playerPos;
    if (px >= 0 && px < this.width && py >= 0 && py < this.height) {
      this.display.draw(px, py, '@', COLORS.player, this.bgCache[py][px]);
    }

    // Room label overlay
    if (showRoomLabels) {
      for (const room of cluster.rooms) {
        const cx = Math.floor(room.x + room.w / 2);
        const cy = Math.floor(room.y + room.h / 2);
        const label = debugRoomLabel(room);
        const startX = cx - Math.floor(label.length / 2);
        for (let i = 0; i < label.length; i++) {
          const lx = startX + i;
          if (lx >= 0 && lx < this.width && cy >= 0 && cy < this.height) {
            if (lx === px && cy === py) continue;
            this.display.draw(lx, cy, label[i], debugRoomColor(room), '#0a0a0a');
          }
        }
      }
    }

    // Functional tag overlay
    if (showFunctionalOverlay) {
      for (const room of cluster.rooms) {
        const tag = room.tags.functional;
        if (!tag) continue;
        const abbrev = FUNC_TAG_ABBREV[tag] ?? '???';
        const color = FUNC_TAG_COLOR[tag] ?? '#888888';
        const cx = Math.floor(room.x + room.w / 2);
        const cy = Math.floor(room.y + room.h / 2);
        const startX = cx - Math.floor(abbrev.length / 2);
        for (let i = 0; i < abbrev.length; i++) {
          const lx = startX + i;
          if (lx >= 0 && lx < this.width && cy >= 0 && cy < this.height) {
            if (lx === px && cy === py) continue;
            this.display.draw(lx, cy, abbrev[i], color, '#0a0a0a');
          }
        }
      }
    }
  }
}

// ── SELF panel renderer ──

export function renderSelfPanel(el: HTMLElement, player: Entity, debugMode = false, mapReveal = false, godMode = false, invisibleMode = false, gameSeed = 0) {
  const hexId = '0x' + player.id.toString(16).toUpperCase().padStart(4, '0');
  const coherence = player.coherence ?? 100;
  const maxCoherence = player.maxCoherence ?? 100;
  const coherencePct = Math.round((coherence / maxCoherence) * 100);
  const barLen = 12;
  const filled = Math.round((coherence / maxCoherence) * barLen);
  const barClass = coherencePct <= 25 ? 'coherence-critical' : coherencePct <= 50 ? 'coherence-low' : '';
  const barFill = '█'.repeat(filled);
  const barEmpty = '─'.repeat(barLen - filled);

  const modules = player.modules ?? [];
  const moduleRows = modules.map(mod => {
    const isAlertActive = mod.id === 'alert.m' && mod.alertActive;
    const activeClass = isAlertActive ? ' module-alert-active' : '';
    const indicator = isAlertActive ? '<span class="module-indicator"> ▲ </span>' : '';
    const statusClass = mod.status === 'damaged' ? ' status-damaged' : mod.status === 'offline' ? ' status-offline' : '';
    return `<div class="module-row${activeClass}" data-module="${mod.id}">` +
      `<span class="module-name stat-label">&gt; ${mod.id}</span>` +
      `${indicator}` +
      `<span class="module-status stat-value${statusClass}">[${mod.status}]</span>` +
      `</div>`;
  }).join('\n');

  el.innerHTML = `\
<div class="panel-edge"><span class="corner">┌</span><span class="label">[ SELF ]</span><span class="fill"></span><span class="corner">┐</span></div>
<div class="panel-body">
<div class="stat-row"><span class="stat-value">${player.name}</span><span class="stat-label">${hexId}</span></div>
<div class="stat-row"><span class="stat-label">State:</span><span class="stat-value">running</span></div>
<div class="stat-row"><span class="stat-label">Coherence:</span><span class="stat-value">${coherencePct}%</span></div>
<div class="coherence-bar ${barClass}"><span class="bar-fill">${barFill}</span><span class="bar-empty">${barEmpty}</span></div>
<div class="stat-row"><span class="stat-label">Position:</span><span class="stat-value">(${player.position.x}, ${player.position.y})</span></div>
<div class="panel-sep"><span class="fill"></span><span class="label">modules</span><span class="fill"></span></div>
${moduleRows}
<div class="panel-sep"><span class="fill"></span><span class="label">perms</span><span class="fill"></span></div>
<div class="stat-row"><span class="stat-label">engineer / r+w+x</span></div>
${debugMode ? `<div class="panel-sep"><span class="fill"></span></div>
<div class="stat-row"><span class="stat-value debug-indicator">[DEBUG MODE]</span></div>
<div class="stat-row"><span class="stat-label">Seed:</span><span class="stat-value debug-indicator">${gameSeed}</span></div>
${mapReveal ? '<div class="stat-row"><span class="stat-value debug-indicator">[MAP REVEAL]</span></div>' : ''}
${godMode ? '<div class="stat-row"><span class="stat-value debug-indicator">[GOD MODE]</span></div>' : ''}
${invisibleMode ? '<div class="stat-row"><span class="stat-value debug-indicator">[INVISIBLE]</span></div>' : ''}` : ''}
</div>
<div class="panel-edge"><span class="corner">└</span><span class="fill"></span><span class="corner">┘</span></div>`;
}

// ── Map status bar ──

export function renderMapStatusBar(
  el: HTMLElement,
  alertLevel: number,
  clusterId: number,
  tick: number,
  meanCollapse: number,
) {
  const tierClass = alertLevel >= 200 ? 'alert-enemy' : alertLevel >= 100 ? 'alert-suspicious' : 'alert-friendly';
  const tierSymbol = alertLevel >= 200 ? '⬘' : alertLevel >= 100 ? '⬗' : '⬙';
  const tickStr = String(tick).padStart(4, '0');
  const collapseStr = Math.round(meanCollapse * 100) + '%';

  el.innerHTML =
    `<span class="msb-item">Cluster:<span class="msb-val">${clusterId}</span></span>` +
    `<span class="msb-sep">│</span>` +
    `<span class="msb-item">Turn:<span class="msb-val">${tickStr}</span></span>` +
    `<span class="msb-sep">│</span>` +
    `<span class="msb-item">σ:<span class="msb-val">${collapseStr}</span></span>` +
    `<span class="msb-sep">│</span>` +
    `<span class="msb-alert ${tierClass}">${tierSymbol} ${alertLevel}</span>`;
}

// ── Message log renderer ──

const MSG_CLASS: Record<string, string> = {
  debug: 'msg msg-debug',
  system: 'msg msg-system',
  important: 'msg msg-important',
  hazard: 'msg msg-hazard',
  alert: 'msg msg-alert',
};

function formatTick(tick: number): string {
  const s = String(tick).padStart(6, '0');
  const firstNonZero = s.search(/[1-9]/);
  if (firstNonZero === -1) {
    // all zeros
    return `<span class="msg-tick"><span class="msg-tick-zero">000000</span></span>`;
  }
  const zeros = s.slice(0, firstNonZero);
  const nums = s.slice(firstNonZero);
  const zeroPart = zeros ? `<span class="msg-tick-zero">${zeros}</span>` : '';
  return `<span class="msg-tick">${zeroPart}<span class="msg-tick-num">${nums}</span></span>`;
}

function renderLogBody(el: HTMLElement, messages: { text: string; type: string; tick: number }[]) {
  const body = el.querySelector('.log-body');
  if (!body) return;
  const recent = messages.slice(-20).reverse();
  body.innerHTML = recent.map(m =>
    `<div class="${MSG_CLASS[m.type] ?? 'msg'}">${formatTick(m.tick)} ${m.text}</div>`
  ).join('');
}

export function renderLogs(
  generalEl: HTMLElement,
  alertEl: HTMLElement,
  messages: { text: string; type: string; tick: number }[],
) {
  const general: typeof messages = [];
  const alert: typeof messages = [];
  for (const m of messages) {
    if (m.type === 'hazard' || m.type === 'alert') {
      alert.push(m);
    } else {
      general.push(m);
    }
  }
  renderLogBody(generalEl, general);
  renderLogBody(alertEl, alert);
}

// ── OVERVIEW panel renderer ──

function countRoomDoors(cluster: Cluster, room: Room): { total: number; open: number; closed: number; locked: number } {
  let total = 0, open = 0, closed = 0, locked = 0;
  // Scan room perimeter (walls layer) for doors
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      if (x < 0 || x >= cluster.width || y < 0 || y >= cluster.height) continue;
      const t = cluster.tiles[y][x];
      if (t.type === TileType.Door) {
        total++;
        if (t.glyph === '▪') locked++;
        else if (t.doorOpen) open++;
        else closed++;
      }
    }
  }
  return { total, open, closed, locked };
}

function countRoomHazardTiles(cluster: Cluster, room: Room): Map<string, number> {
  const counts = new Map<string, number>();
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      if (x < 0 || x >= cluster.width || y < 0 || y >= cluster.height) continue;
      const ho = cluster.tiles[y][x].hazardOverlay;
      if (ho) counts.set(ho.type, (counts.get(ho.type) ?? 0) + 1);
    }
  }
  return counts;
}

function ifaceRows(cluster: Cluster, room: Room): string {
  // Find interfaces whose position is inside or adjacent to this room
  const ifaces = cluster.interfaces.filter(iface => {
    const { x, y } = iface.position;
    // Interface is on the room's row range and adjacent to its x range
    return y >= room.y && y < room.y + room.h &&
      ((x >= room.x && x < room.x + room.w) || x === room.x - 1 || x === room.x + room.w);
  });
  if (ifaces.length === 0) return '';
  return ifaces.map(iface => {
    const dir = iface.position.x === 0 ? '⇏ entry' : '⇨ exit';
    const target = iface.targetClusterId === -1
      ? 'unexplored'
      : `cluster ${iface.targetClusterId}`;
    return `<div class="stat-row"><span class="room-iface">${dir}</span><span class="stat-label">${target}</span></div>`;
  }).join('');
}

export function renderOverviewPanel(
  el: HTMLElement,
  cluster: Cluster,
  entities: Entity[],
  playerPos: Position,
  hoveredPos: Position | null,
) {
  const playerRoomId = cluster.tiles[playerPos.y]?.[playerPos.x]?.roomId ?? -1;
  const hoveredRoomId = hoveredPos
    ? (cluster.tiles[hoveredPos.y]?.[hoveredPos.x]?.roomId ?? -1)
    : -1;

  const detailRoom = hoveredRoomId >= 0
    ? cluster.rooms.find(r => r.id === hoveredRoomId)
    : null;

  let body = '';

  if (detailRoom) {
    const isHall = detailRoom.tags.geometric.has('hall');
    const interior = isHall ? detailRoom.w * detailRoom.h : (detailRoom.w - 2) * (detailRoom.h - 2);
    const geoTags = detailRoom.tags.geometric.size > 0 ? [...detailRoom.tags.geometric].join(', ') : 'none';
    const funcTag = detailRoom.tags.functional ?? 'none';
    const modTags = detailRoom.tags.modifiers.size > 0 ? [...detailRoom.tags.modifiers].join(', ') : 'none';
    const cosTag = detailRoom.tags.cosmetic ?? 'none';
    const wallAdj = cluster.wallAdjacency.get(detailRoom.id) ?? [];
    const doorAdj = cluster.doorAdjacency.get(detailRoom.id) ?? [];
    const doors = countRoomDoors(cluster, detailRoom);
    const hazardTiles = countRoomHazardTiles(cluster, detailRoom);
    const hasPlayer = detailRoom.id === playerRoomId;

    // Entities in this room
    const ents: Entity[] = [];
    for (const e of entities) {
      if (e.clusterId !== cluster.id) continue;
      const rid = cluster.tiles[e.position.y]?.[e.position.x]?.roomId ?? -1;
      if (rid === detailRoom.id) ents.push(e);
    }

    // Doors detail string
    let doorDetail = `${doors.total}`;
    const parts: string[] = [];
    if (doors.open > 0) parts.push(`${doors.open} open`);
    if (doors.closed > 0) parts.push(`${doors.closed} closed`);
    if (doors.locked > 0) parts.push(`<span class="room-hazards">${doors.locked} locked</span>`);
    if (parts.length > 0) doorDetail += ` (${parts.join(', ')})`;

    // Hazard tiles detail
    let hazardStr = 'none';
    if (hazardTiles.size > 0) {
      hazardStr = [...hazardTiles.entries()].map(([t, n]) => `${t}: ${n}`).join(', ');
    }

    // Format adjacency list
    const fmtAdj = (ids: number[]) => ids.length > 0
      ? ids.map(id => {
        const r = cluster.rooms.find(rm => rm.id === id);
        if (!r) return String(id);
        const tc = ROOM_TYPE_SHORT[r.roomType] ?? '?';
        return r.roomType !== 'normal' ? `${id}<span class="room-type">${tc}</span>` : String(id);
      }).join(', ')
      : 'none';
    const doorAdjStr = fmtAdj(doorAdj);
    const wallAdjStr = fmtAdj(wallAdj);

    // Entity list
    const entStr = ents.length > 0
      ? ents.map(e => `<span class="room-entities">${e.glyph} ${e.name}</span> (${e.position.x},${e.position.y})`).join('<br>')
      : 'none';

    body =
      `<div class="room-detail">` +
      `<div class="stat-row"><span class="stat-label">room</span><span class="stat-value">${detailRoom.id} ${isHall ? '(hall)' : ''}</span></div>` +
      `<div class="stat-row"><span class="stat-label">type</span><span class="room-type">${detailRoom.roomType}</span></div>` +
      `<div class="stat-row"><span class="stat-label">geo</span><span class="room-tags">${geoTags}</span></div>` +
      `<div class="stat-row"><span class="stat-label">func</span><span class="room-tags">${funcTag}</span></div>` +
      `<div class="stat-row"><span class="stat-label">mods</span><span class="room-tags">${modTags}</span></div>` +
      `<div class="stat-row"><span class="stat-label">cosmetic</span><span class="room-tags">${cosTag}</span></div>` +
      `<div class="panel-sep"><span class="fill"></span><span class="label">geometry</span><span class="fill"></span></div>` +
      `<div class="stat-row"><span class="stat-label">bounds</span>${detailRoom.w}x${detailRoom.h} at (${detailRoom.x},${detailRoom.y})</div>` +
      `<div class="stat-row"><span class="stat-label">collapse</span>${detailRoom.collapse.toFixed(2)}</div>` +
      `<div class="stat-row"><span class="stat-label">interior</span>${interior} tiles</div>` +
      `<div class="stat-row"><span class="stat-label">doors</span>${doorDetail}</div>` +
      `<div class="panel-sep"><span class="fill"></span><span class="label">connections</span><span class="fill"></span></div>` +
      `<div class="stat-row"><span class="stat-label">door adj</span>${doorAdjStr} (${doorAdj.length})</div>` +
      `<div class="stat-row"><span class="stat-label">wall adj</span>${wallAdjStr} (${wallAdj.length})</div>` +
      ifaceRows(cluster, detailRoom) +
      `<div class="panel-sep"><span class="fill"></span><span class="label">contents</span><span class="fill"></span></div>` +
      `<div class="stat-row"><span class="stat-label">hazard tiles</span><span class="room-hazards">${hazardStr}</span></div>` +
      `<div class="stat-row"><span class="stat-label">spread</span><span class="room-hazards">${detailRoom.containedHazards.size > 0 ? [...detailRoom.containedHazards].join(', ') : 'none'}</span></div>` +
      `<div><span class="stat-label">entities:</span> ${entStr}</div>` +
      (hasPlayer ? `<div><span class="room-entities">@ player here</span></div>` : '') +
      `</div>`;
  } else if (hoveredPos) {
    const tile = cluster.tiles[hoveredPos.y]?.[hoveredPos.x];
    if (tile) {
      body =
        `<div class="room-detail">` +
        `<div class="stat-row"><span class="stat-label">pos</span>(${hoveredPos.x},${hoveredPos.y})</div>` +
        `<div class="stat-row"><span class="stat-label">tile</span>${TileType[tile.type]}</div>` +
        `<div class="stat-row"><span class="stat-label">glyph</span>${tile.glyph}</div>` +
        `<div class="stat-row"><span class="stat-label">walkable</span>${tile.walkable}</div>` +
        `<div class="stat-row"><span class="stat-label">transparent</span>${tile.transparent}</div>` +
        `<div class="stat-row"><span class="stat-label">roomId</span>${tile.roomId}</div>` +
        (tile.integrity !== undefined ? `<div class="stat-row"><span class="stat-label">integrity</span>${tile.integrity}</div>` : '') +
        (tile.hazardOverlay ? `<div class="stat-row"><span class="stat-label">hazard</span><span class="room-hazards">${tile.hazardOverlay.type} (${tile.hazardOverlay.stage ?? 0})</span></div>` : '') +
        `</div>`;
    }
  } else {
    body = `<div class="room-detail"><span class="stat-label">hover over map</span></div>`;
  }

  el.innerHTML =
    `<div class="panel-edge"><span class="corner">┌</span><span class="label">[ OVERVIEW ]</span><span class="fill"></span><span class="corner">┐</span></div>` +
    `<div class="panel-body">${body}</div>` +
    `<div class="panel-edge"><span class="corner">└</span><span class="fill"></span><span class="corner">┘</span></div>`;
}
