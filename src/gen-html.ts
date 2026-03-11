/**
 * Generates self-contained animated HTML map files for visual inspection.
 *
 * Usage:
 *   npx tsx src/gen-html.ts                        # seeds 1-5, cluster 3, 100 ticks
 *   npx tsx src/gen-html.ts --seeds 1,3,7          # specific seeds
 *   npx tsx src/gen-html.ts --cluster 5 --ticks 60 # deeper cluster, shorter sim
 *
 * Output: maps/seed-N-clN.html  (open in browser, no server required)
 */

import { mkdirSync, writeFileSync } from 'fs';
import { processAction } from './game';
import { generateCluster, placeEntryPoint } from './cluster';
import { computeFOV } from './fov';
import { seed as seedRng } from './rng';
import { makeEntity } from './entity-defs';
import { TileType, COLORS } from './types';
import type { GameState, Entity, Cluster, Position } from './types';

// ── CLI args ──

const args = process.argv.slice(2);
const getStr = (flag: string, def: string) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};
const getNum = (flag: string, def: number) => parseInt(getStr(flag, String(def)), 10);

const SEEDS: number[] = getStr('--seeds', '1,2,3,4,5')
  .split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n));
const CLUSTER_DEPTH = getNum('--cluster', 3);
const TICKS = getNum('--ticks', 100);
const SNAPSHOT_INTERVAL = 10;
const OUTPUT_DIR = 'maps';

// ── Build GameState for an arbitrary cluster depth ──

function spawnEntities(state: GameState, cluster: Cluster) {
  const id = cluster.id;
  const rooms = cluster.rooms.filter(r => !r.tags.geometric.has('hall'));
  if (rooms.length === 0) return;

  const depth = id + 1;
  const numBitMites   = Math.min(3, Math.floor(depth * 0.8));
  const numLogicLeech = Math.min(2, Math.floor(depth * 0.5));
  const numChronicler = Math.min(2, Math.floor(depth * 0.4));
  const numWhiteHat   = Math.min(2, Math.floor(depth * 0.3));

  function pickWalkable(room: typeof rooms[number]): Position | null {
    for (let attempt = 0; attempt < 30; attempt++) {
      const x = room.x + 1 + Math.floor(Math.random() * Math.max(1, room.w - 2));
      const y = room.y + 1 + Math.floor(Math.random() * Math.max(1, room.h - 2));
      if (cluster.tiles[y]?.[x]?.walkable) return { x, y };
    }
    return null;
  }

  function pickRoom(exclude?: Set<number>) {
    const pool = exclude ? rooms.filter(r => !exclude.has(r.id)) : rooms;
    return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : undefined;
  }

  const spawned: Entity[] = [];
  const exitRooms = rooms.filter(r => r.tags.geometric.has('exit_interface'));

  for (let i = 0; i < numBitMites; i++) {
    const room = exitRooms.length > 0 ? exitRooms[Math.floor(Math.random() * exitRooms.length)] : pickRoom();
    if (!room) continue;
    const pos = pickWalkable(room);
    if (pos) spawned.push(makeEntity('bit_mite', pos, id));
  }

  const peripheral = rooms.filter(r => r.tags.geometric.has('peripheral') || r.tags.geometric.has('dead_end'));
  for (let i = 0; i < numLogicLeech; i++) {
    const pool = peripheral.length > 0 ? peripheral : rooms;
    const room = pool[Math.floor(Math.random() * pool.length)];
    const pos = pickWalkable(room);
    if (pos) spawned.push(makeEntity('logic_leech', pos, id));
  }

  for (let i = 0; i < numChronicler; i++) {
    const room = pickRoom();
    if (!room) continue;
    const pos = pickWalkable(room);
    if (pos) spawned.push(makeEntity('chronicler', pos, id));
  }

  const safe = rooms.filter(r => r.roomType === 'normal');
  for (let i = 0; i < numWhiteHat; i++) {
    const pool = safe.length > 0 ? safe : rooms;
    const room = pool[Math.floor(Math.random() * pool.length)];
    const pos = pickWalkable(room);
    if (pos) spawned.push(makeEntity('sentry', pos, id));
  }

  const ppKey = `${state.player.position.x},${state.player.position.y}`;
  for (const e of spawned) {
    if (`${e.position.x},${e.position.y}` !== ppKey) state.entities.push(e);
  }
}

function createStateForCluster(seed: number, clusterId: number): GameState {
  seedRng(seed);
  const cluster = generateCluster(clusterId);
  const entryPos = placeEntryPoint(cluster.tiles, cluster.rooms);

  const player: Entity = {
    id: 0x3A7F,
    name: 'ego-fragment',
    glyph: '@',
    fg: COLORS.player,
    position: { ...entryPos },
    clusterId,
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

  const state: GameState = {
    clusters: new Map([[clusterId, cluster]]),
    currentClusterId: clusterId,
    player,
    entities: [],
    nextClusterId: clusterId + 1,
    tick: 0,
    messages: [],
    autoPath: [],
    actionLog: [],
    seed,
    debugMode: false,
    debugLog: [],
    mapReveal: true,
    godMode: false,
    invisibleMode: false,
    showRoomLabels: false,
    showCollapseOverlay: false,
    showFunctionalOverlay: false,
    showAlertOverlay: false,
    showEnemyVision: false,
    revealEffects: [],
    shootingEffects: [],
    animation: null,
    hazardFogMarks: new Map(),
    alertLevel: 0,
    markedEntities: new Map(),
    rootPrivileges: [],
    killedEntities: [],
    finalClusterId: 5,
    collapseGlitchTiles: new Map(),
    selfPanelRevealed: true,
    smokeEffects: [],
    markEffects: [],
    pendingSounds: [],
    firedTriggerIds: new Set(),
    corruptShotsFired: 0,
    cloakActivations: 0,
    terminalsRead: 0,
  };

  computeFOV(cluster, entryPos);
  spawnEntities(state, cluster);
  return state;
}

// ── Tile appearance ──

interface Cell { glyph: string; fg: string; bg: string; }

function resolveCell(y: number, x: number, state: GameState, clusterId: number): Cell {
  const cluster = state.clusters.get(clusterId)!;
  const tile = cluster.tiles[y][x];

  if (tile.type === TileType.Void) return { glyph: ' ', fg: COLORS.bg, bg: COLORS.bg };

  let glyph = tile.glyph;
  let fg = tile.fg;
  let bg = tile.bg;

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

  for (const e of state.entities) {
    if (e.clusterId === clusterId && e.position.x === x && e.position.y === y) {
      glyph = e.glyph; fg = e.fg; break;
    }
  }

  if (state.player.clusterId === clusterId &&
      state.player.position.x === x && state.player.position.y === y) {
    glyph = '@'; fg = COLORS.player;
  }

  return { glyph, fg, bg };
}

function captureFrame(state: GameState, clusterId: number): Cell[] {
  const cluster = state.clusters.get(clusterId)!;
  const cells: Cell[] = [];
  for (let y = 0; y < cluster.height; y++) {
    for (let x = 0; x < cluster.width; x++) {
      cells.push(resolveCell(y, x, state, clusterId));
    }
  }
  return cells;
}

// ── Palette compression ──

interface CompressedData {
  glyphs: string[];
  colors: string[];
  frames: number[][];
  W: number; H: number;
  ticksAt: number[];
}

function compress(allFrames: Cell[][], W: number, H: number, ticksAt: number[]): CompressedData {
  const gSet = new Set<string>(), cSet = new Set<string>();
  for (const f of allFrames) for (const c of f) { gSet.add(c.glyph); cSet.add(c.fg); cSet.add(c.bg); }
  const glyphs = [...gSet], colors = [...cSet];
  const gI = new Map(glyphs.map((g, i) => [g, i]));
  const cI = new Map(colors.map((c, i) => [c, i]));
  const frames = allFrames.map(f => f.flatMap(c => [gI.get(c.glyph)!, cI.get(c.fg)!, cI.get(c.bg)!]));
  return { glyphs, colors, frames, W, H, ticksAt };
}

// ── HTML generation ──

function buildHTML(seed: number, clusterId: number, meta: string, d: CompressedData): string {
  const { glyphs, colors, frames, W, H, ticksAt } = d;
  const maxTick = ticksAt[ticksAt.length - 1];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Coherence — Seed ${seed} Cluster ${clusterId}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0a;color:#33aa66;font-family:"Courier New",Courier,monospace;font-size:13px;padding:12px;user-select:none}
h1{color:#44cc88;margin-bottom:6px;font-size:13px;letter-spacing:1px}
#meta{color:#446644;font-size:11px;margin-bottom:8px}
#controls{display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
button{background:#0f1f0f;color:#33aa66;border:1px solid #224422;padding:3px 10px;cursor:pointer;font-family:inherit;font-size:12px}
button:hover{background:#1a3a1a;border-color:#33aa66}
input[type=range]{accent-color:#33aa66}
label{color:#446644;font-size:11px}
#info{color:#44cc88;font-size:12px;min-width:130px}
canvas{display:block;border:1px solid #1a3a1a;background:#0a0a0a}
#legend{margin-top:8px;color:#446644;font-size:11px;display:flex;gap:10px;flex-wrap:wrap}
.li{display:inline-flex;align-items:center;gap:3px}
</style>
</head>
<body>
<h1>COHERENCE // CLUSTER ${clusterId} MAP // SEED ${seed}</h1>
<div id="meta">${meta}</div>
<div id="controls">
  <button id="bPlay">&#9654; Play</button>
  <button id="bPrev">&#9664;</button>
  <button id="bNext">&#9654;</button>
  <span id="info">Tick 0 / ${maxTick}</span>
  <input type="range" id="scrub" min="0" max="${frames.length - 1}" value="0" style="width:180px">
  <label>Speed <input type="range" id="spd" min="1" max="9" value="5" style="width:80px"></label>
</div>
<canvas id="map"></canvas>
<div id="legend">
  <span class="li"><span style="color:#00ff88">@</span>Player</span>
  <span class="li"><span style="color:#aaaa66">&#937;</span>Chronicler</span>
  <span class="li"><span style="color:#cc4444">&#8277;</span>Bit-Mite</span>
  <span class="li"><span style="color:#9933cc">&#8960;</span>Logic Leech</span>
  <span class="li"><span style="color:#44ccaa">&#8866;</span>White-Hat</span>
  <span class="li"><span style="color:#cc2222">&#9617;&#9618;&#9619;</span>Corruption</span>
  <span class="li"><span style="color:#2266aa">~&#8776;</span>Flood</span>
  <span class="li"><span style="color:#ffff00">*</span>Spark</span>
  <span class="li"><span style="color:#aa44ff">&#9679;</span>Gravity</span>
  <span class="li"><span style="color:#ffcc00">&#9135;</span>Firewall beam</span>
  <span class="li"><span style="color:#ff8844">&#8651;</span>Interface exit</span>
</div>
<script>
const W=${W},H=${H};
const G=${JSON.stringify(glyphs)};
const C=${JSON.stringify(colors)};
const FRAMES=${JSON.stringify(frames)};
const TICKS=${JSON.stringify(ticksAt)};
const SPD=[2000,1200,800,500,350,220,150,80,30];
let cur=0,tmr=null;
const canvas=document.getElementById('map'),infoEl=document.getElementById('info');
const scrub=document.getElementById('scrub'),spdEl=document.getElementById('spd');
const bPlay=document.getElementById('bPlay');
const ctx=canvas.getContext('2d');
const FONT='13px "Courier New",Courier,monospace';
ctx.font=FONT;
const charW=Math.ceil(ctx.measureText('█').width);
const charH=charW;
canvas.width=W*charW;
canvas.height=H*charH;
function render(i){
  const f=FRAMES[i];
  ctx.font=FONT;
  for(let y=0;y<H;y++){
    for(let x=0;x<W;x++){
      const b=(y*W+x)*3,fg=C[f[b+1]],bg=C[f[b+2]],ch=G[f[b]];
      ctx.fillStyle=bg;
      ctx.fillRect(x*charW,y*charH,charW,charH);
      ctx.fillStyle=fg;
      ctx.fillText(ch,x*charW,y*charH+charH*0.82);
    }
  }
  infoEl.textContent='Tick '+TICKS[i]+' / '+TICKS[TICKS.length-1];
  scrub.value=i;
}
function advance(){cur=(cur+1)%FRAMES.length;render(cur);}
function interval(){return SPD[parseInt(spdEl.value)-1];}
function play(){if(tmr)return;tmr=setInterval(advance,interval());bPlay.innerHTML='&#9646;&#9646; Pause';}
function pause(){clearInterval(tmr);tmr=null;bPlay.innerHTML='&#9654; Play';}
bPlay.addEventListener('click',()=>tmr?pause():play());
document.getElementById('bPrev').addEventListener('click',()=>{pause();cur=(cur-1+FRAMES.length)%FRAMES.length;render(cur);});
document.getElementById('bNext').addEventListener('click',()=>{pause();cur=(cur+1)%FRAMES.length;render(cur);});
scrub.addEventListener('input',()=>{pause();cur=parseInt(scrub.value);render(cur);});
spdEl.addEventListener('input',()=>{if(tmr){pause();play();}});
document.addEventListener('keydown',e=>{
  if(e.key===' '){e.preventDefault();tmr?pause():play();}
  else if(e.key==='ArrowLeft'){pause();cur=(cur-1+FRAMES.length)%FRAMES.length;render(cur);}
  else if(e.key==='ArrowRight'){pause();cur=(cur+1)%FRAMES.length;render(cur);}
});
render(0);
</script>
</body>
</html>`;
}

// ── Main ──

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`Generating maps: seeds [${SEEDS.join(',')}], cluster ${CLUSTER_DEPTH}, ${TICKS} ticks`);

  const generated: { seed: number; clusterId: number; file: string }[] = [];

  for (const seed of SEEDS) {
    process.stdout.write(`  Seed ${seed} cluster ${CLUSTER_DEPTH}...`);

    const state = createStateForCluster(seed, CLUSTER_DEPTH);
    const cluster = state.clusters.get(CLUSTER_DEPTH)!;
    const W = cluster.width, H = cluster.height;

    const hazardRooms = cluster.rooms.filter(r => r.roomType !== 'normal' && r.roomType !== 'echo_chamber');
    const entityCount = state.entities.length;
    const meta = `${cluster.rooms.length} rooms | ${hazardRooms.length} hazard rooms | ${entityCount} entities | ${cluster.interfaces.length} exits`;

    const allFrames: Cell[][] = [];
    const ticksAt: number[] = [];
    allFrames.push(captureFrame(state, CLUSTER_DEPTH));
    ticksAt.push(0);

    for (let t = 0; t < TICKS; t++) {
      processAction(state, { kind: 'wait' });
      if ((t + 1) % SNAPSHOT_INTERVAL === 0) {
        allFrames.push(captureFrame(state, CLUSTER_DEPTH));
        ticksAt.push(t + 1);
      }
    }

    const cf = compress(allFrames, W, H, ticksAt);
    const html = buildHTML(seed, CLUSTER_DEPTH, meta, cf);
    const outFile = `seed-${seed}-cl${CLUSTER_DEPTH}.html`;
    writeFileSync(`${OUTPUT_DIR}/${outFile}`, html, 'utf8');
    generated.push({ seed, clusterId: CLUSTER_DEPTH, file: outFile });

    const kb = Math.round(html.length / 1024);
    console.log(` ${allFrames.length} frames, ${hazardRooms.length} hazard rooms, ${kb}KB → ${outFile}`);
  }

  // Index
  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><title>Coherence — Maps</title>
<style>
body{background:#0a0a0a;color:#33aa66;font-family:"Courier New",monospace;padding:24px}
h1{color:#44cc88;margin-bottom:12px}
ul{list-style:none}li{margin:4px 0}
a{color:#44cc88;text-decoration:none}a:hover{text-decoration:underline}
</style>
</head>
<body>
<h1>COHERENCE // MAP VISUALIZATIONS</h1>
<ul>
${generated.map(g => `<li><a href="${g.file}">Seed ${g.seed} — Cluster ${g.clusterId}</a></li>`).join('\n')}
</ul>
</body>
</html>`;

  writeFileSync(`${OUTPUT_DIR}/index.html`, indexHtml, 'utf8');
  console.log(`\nIndex → ${OUTPUT_DIR}/index.html`);
}

main().catch(err => { console.error(err); process.exit(1); });
