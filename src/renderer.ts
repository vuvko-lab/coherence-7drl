import { Cluster, Entity, Position, COLORS, Room, TileType } from './types';

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

  render(
    cluster: Cluster,
    entities: Entity[],
    playerPos: Position,
    mapReveal = false,
    alertOverlay?: { fill?: Map<string, number>; threats?: { x: number; y: number }[]; budget: number },
  ) {
    const pathSet = new Set(this.pathHighlight.map(p => `${p.x},${p.y}`));
    const threatSet = alertOverlay?.threats
      ? new Set(alertOverlay.threats.map(t => `${t.x},${t.y}`))
      : undefined;

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

        // Alert flood-fill overlay
        if (alertOverlay?.fill) {
          const tileKey = `${x},${y}`;
          const cost = alertOverlay.fill.get(tileKey);
          if (cost !== undefined) {
            if (threatSet?.has(tileKey)) {
              // Threat tile — red highlight
              bg = '#3a1010';
              fg = '#ff4444';
            } else {
              // Filled tile — green tint fading with cost
              const intensity = Math.max(0, 1 - cost / alertOverlay.budget);
              const g = Math.round(20 + intensity * 30);
              bg = `rgb(10,${g},15)`;
            }
          }
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
    const isHall = detailRoom.tags.has('hall');
    const interior = isHall ? detailRoom.w * detailRoom.h : (detailRoom.w - 2) * (detailRoom.h - 2);
    const tags = detailRoom.tags.size > 0 ? [...detailRoom.tags].join(', ') : 'none';
    const adj = cluster.roomAdjacency.get(detailRoom.id) ?? [];
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

    // Adjacent rooms with types
    const adjStr = adj.length > 0
      ? adj.map(id => {
        const r = cluster.rooms.find(rm => rm.id === id);
        if (!r) return String(id);
        const tc = ROOM_TYPE_SHORT[r.roomType] ?? '?';
        return r.roomType !== 'normal' ? `${id}<span class="room-type">${tc}</span>` : String(id);
      }).join(', ')
      : 'none';

    // Entity list
    const entStr = ents.length > 0
      ? ents.map(e => `<span class="room-entities">${e.glyph} ${e.name}</span> (${e.position.x},${e.position.y})`).join('<br>')
      : 'none';

    body =
      `<div class="room-detail">` +
      `<div class="stat-row"><span class="stat-label">room</span><span class="stat-value">${detailRoom.id} ${isHall ? '(hall)' : ''}</span></div>` +
      `<div class="stat-row"><span class="stat-label">type</span><span class="room-type">${detailRoom.roomType}</span></div>` +
      `<div class="stat-row"><span class="stat-label">tags</span><span class="room-tags">${tags}</span></div>` +
      `<div class="panel-sep"><span class="fill"></span><span class="label">geometry</span><span class="fill"></span></div>` +
      `<div class="stat-row"><span class="stat-label">bounds</span>${detailRoom.w}x${detailRoom.h} at (${detailRoom.x},${detailRoom.y})</div>` +
      `<div class="stat-row"><span class="stat-label">interior</span>${interior} tiles</div>` +
      `<div class="stat-row"><span class="stat-label">doors</span>${doorDetail}</div>` +
      `<div class="panel-sep"><span class="fill"></span><span class="label">connections</span><span class="fill"></span></div>` +
      `<div class="stat-row"><span class="stat-label">adj</span>${adjStr}</div>` +
      `<div class="stat-row"><span class="stat-label">degree</span>${adj.length}</div>` +
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
