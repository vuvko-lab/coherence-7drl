import { Cluster, Entity, Position, COLORS, Room } from './types';

const ROOM_TYPE_SHORT: Record<string, string> = {
  normal: 'N', corrupted: 'C', trigger_trap: 'T', memory_leak: 'M',
  firewall: 'F', unstable: 'U', quarantine: 'Q', echo_chamber: 'E',
  gravity_well: 'G',
};

const ROOM_TYPE_COLOR: Record<string, string> = {
  normal: '#446644', corrupted: '#ff4444', trigger_trap: '#ff8844',
  memory_leak: '#4488ff', firewall: '#ffcc00', unstable: '#ffff44',
  quarantine: '#cc44cc', echo_chamber: '#557744', gravity_well: '#aa44ff',
};

function debugRoomLabel(room: Room): string {
  const typeChar = ROOM_TYPE_SHORT[room.roomType] ?? '?';
  return `${room.id}${typeChar}`;
}

function debugRoomColor(room: Room): string {
  return ROOM_TYPE_COLOR[room.roomType] ?? '#666666';
}

export class Renderer {
  private container: HTMLElement;
  private grid: HTMLElement;
  private cells: HTMLSpanElement[][] = [];
  private width = 0;
  private height = 0;
  private hoveredCell: Position | null = null;
  private pathHighlight: Position[] = [];

  onCellClick: ((pos: Position) => void) | null = null;
  onCellHover: ((pos: Position | null) => void) | null = null;

  constructor(wrapId: string) {
    this.container = document.getElementById(wrapId)!;
    this.grid = document.createElement('div');
    this.grid.id = 'map-grid';
    this.container.appendChild(this.grid);

    this.container.addEventListener('mouseleave', () => {
      this.hoveredCell = null;
      this.onCellHover?.(null);
    });
  }

  initGrid(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.grid.innerHTML = '';
    this.cells = [];

    for (let y = 0; y < height; y++) {
      const row: HTMLSpanElement[] = [];
      for (let x = 0; x < width; x++) {
        const span = document.createElement('span');
        span.className = 'cell';
        span.dataset.x = String(x);
        span.dataset.y = String(y);
        span.textContent = ' ';

        span.addEventListener('click', () => {
          this.onCellClick?.({ x, y });
        });

        span.addEventListener('mouseenter', () => {
          this.hoveredCell = { x, y };
          this.onCellHover?.({ x, y });
        });

        row.push(span);
        this.grid.appendChild(span);
      }
      // Line break after each row
      this.grid.appendChild(document.createTextNode('\n'));
      this.cells.push(row);
    }
  }

  setPathHighlight(path: Position[]) {
    this.pathHighlight = path;
  }

  render(cluster: Cluster, entities: Entity[], playerPos: Position, mapReveal = false) {
    const pathSet = new Set(this.pathHighlight.map(p => `${p.x},${p.y}`));

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const tile = cluster.tiles[y][x];
        const cell = this.cells[y][x];
        const isVisible = tile.visible || mapReveal;

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
              if (ho.stage === 1) { fg = '#ff8800'; } // trigger trap pulse (mild)
              else if (ho.stage === 2) { fg = '#ff4400'; } // trigger trap pulse (urgent)
              else { glyph = '▓'; fg = '#664422'; } // detonated
              break;
            case 'gravity':
              if (ho.stage === 2) { glyph = '●'; fg = '#aa44ff'; bg = '#1a0a2a'; }
              else if (ho.stage === 1) { glyph = '◉'; fg = '#8833cc'; bg = '#140a1a'; }
              else { fg = '#6622aa'; bg = '#0a0a14'; }
              break;
          }
        }

        if (!tile.seen && !isVisible) {
          // Unexplored
          glyph = ' ';
          fg = COLORS.unexplored;
          bg = COLORS.unexplored;
        } else if (tile.seen && !isVisible) {
          // Remembered but not visible
          fg = COLORS.rememberedFg;
          bg = COLORS.bg;
        }
        // else: visible — use tile colors as-is

        // Hover highlight
        const isHovered = this.hoveredCell?.x === x && this.hoveredCell?.y === y;
        if (isHovered && isVisible) {
          bg = '#1a3a1a';
        }

        // Path highlight
        if (pathSet.has(`${x},${y}`) && isVisible) {
          bg = '#2a3a1a';
        }

        cell.textContent = glyph;
        cell.style.color = fg;
        cell.style.backgroundColor = bg;
        cell.classList.toggle('highlight', isHovered && isVisible);
        cell.classList.toggle('path', pathSet.has(`${x},${y}`) && isVisible);
      }
    }

    // Overlay entities
    for (const entity of entities) {
      if (entity.clusterId !== cluster.id) continue;
      const { x, y } = entity.position;
      if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
        const tile = cluster.tiles[y][x];
        if (tile.visible || mapReveal) {
          this.cells[y][x].textContent = entity.glyph;
          this.cells[y][x].style.color = entity.fg;
        }
      }
    }

    // Player on top
    const { x: px, y: py } = playerPos;
    if (px >= 0 && px < this.width && py >= 0 && py < this.height) {
      this.cells[py][px].textContent = '@';
      this.cells[py][px].style.color = COLORS.player;
    }

    // Debug overlay: room IDs and types
    if (mapReveal) {
      for (const room of cluster.rooms) {
        const cx = Math.floor(room.x + room.w / 2);
        const cy = Math.floor(room.y + room.h / 2);
        const label = debugRoomLabel(room);
        // Place label chars centered in the room
        const startX = cx - Math.floor(label.length / 2);
        for (let i = 0; i < label.length; i++) {
          const lx = startX + i;
          if (lx >= 0 && lx < this.width && cy >= 0 && cy < this.height) {
            // Don't overwrite player
            if (lx === px && cy === py) continue;
            this.cells[cy][lx].textContent = label[i];
            this.cells[cy][lx].style.color = debugRoomColor(room);
            this.cells[cy][lx].style.backgroundColor = '#0a0a0a';
          }
        }
      }
    }
  }
}

// ── SELF panel renderer ──

export function renderSelfPanel(el: HTMLElement, player: Entity, clusterId: number, tick: number, debugMode = false, mapReveal = false, godMode = false, invisibleMode = false, gameSeed = 0) {
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
    return `<div class="module-row${activeClass}">` +
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
<div class="stat-row"><span class="stat-label">Cluster:</span><span class="stat-value">${clusterId}</span></div>
<div class="stat-row"><span class="stat-label">Position:</span><span class="stat-value">(${player.position.x}, ${player.position.y})</span></div>
<div class="stat-row"><span class="stat-label">Tick:</span><span class="stat-value">${tick}</span></div>
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

// ── Message log renderer ──

const MSG_CLASS: Record<string, string> = {
  debug: 'msg msg-debug',
  system: 'msg msg-system',
  important: 'msg msg-important',
  hazard: 'msg msg-hazard',
  alert: 'msg msg-alert',
};

function renderLogBody(el: HTMLElement, messages: { text: string; type: string }[]) {
  const body = el.querySelector('.log-body');
  if (!body) return;
  const recent = messages.slice(-20).reverse();
  body.innerHTML = recent.map(m =>
    `<div class="${MSG_CLASS[m.type] ?? 'msg'}">${m.text}</div>`
  ).join('');
}

export function renderLogs(
  generalEl: HTMLElement,
  alertEl: HTMLElement,
  messages: { text: string; type: string }[],
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
