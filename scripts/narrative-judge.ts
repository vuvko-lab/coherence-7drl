#!/usr/bin/env tsx
/**
 * LLM-as-a-Judge for narrative content.
 *
 * Cycle:
 *   1. Generator LLM produces candidate lines (echoes, whispers, archive logs, terminal pools)
 *   2. Judge LLM scores them for tone, lore coherence, and quality
 *   3. Results are printed with scores and commentary
 *
 * Usage:
 *   npx tsx scripts/narrative-judge.ts
 *   npx tsx scripts/narrative-judge.ts --rounds 3 --cluster 2
 *   npx tsx scripts/narrative-judge.ts --gen deepseek-ai/DeepSeek-V3.2 --judge openai/gpt-oss-120b
 *
 * Env: DEEPINFRA_API_KEY in .env
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Config ────────────────────────────────────────────────────────────────────

const DEEPINFRA_BASE = 'https://api.deepinfra.com/v1/openai';

const GENERATOR_MODELS = [
  'deepseek-ai/DeepSeek-V3.2',
  'moonshotai/Kimi-K2.5',
  'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
  'openai/gpt-oss-120b',
];

const JUDGE_MODELS = [
  'deepseek-ai/DeepSeek-V3.2',
  'openai/gpt-oss-120b',
];

const LINE_TYPES = ['whisper', 'echo_dialog', 'archive_log', 'terminal_pool'] as const;
type LineType = typeof LINE_TYPES[number];

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    rounds: 2,
    cluster: -1, // -1 = random per round
    genModel: '',
    judgeModel: '',
    linesPerRound: 50,
    verbose: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--rounds' && args[i + 1]) opts.rounds = parseInt(args[i + 1]!, 10);
    if (args[i] === '--cluster' && args[i + 1]) opts.cluster = parseInt(args[i + 1]!, 10);
    if (args[i] === '--gen' && args[i + 1]) opts.genModel = args[i + 1]!;
    if (args[i] === '--judge' && args[i + 1]) opts.judgeModel = args[i + 1]!;
    if (args[i] === '--lines' && args[i + 1]) opts.linesPerRound = parseInt(args[i + 1]!, 10);
    if (args[i] === '--verbose' || args[i] === '-v') opts.verbose = true;
  }
  return opts;
}

// ── Load API key ──────────────────────────────────────────────────────────────

function loadApiKey(): string {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error('No .env file found. Set DEEPINFRA_API_KEY.');
  }
  const content = fs.readFileSync(envPath, 'utf-8');
  const match = content.match(/^DEEPINFRA_API_KEY=(.+)$/m);
  if (!match) throw new Error('DEEPINFRA_API_KEY not found in .env');
  return match[1]!.trim();
}

// ── LLM call ──────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function llmCall(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  temperature = 0.8,
  maxTokens = 2048,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  const resp = await fetch(`${DEEPINFRA_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
    signal: controller.signal,
  });
  clearTimeout(timeout);
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`LLM call failed (${resp.status}): ${body}`);
  }
  const json = await resp.json() as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };
  return json.choices[0]?.message?.content ?? '';
}

// ── Narrative context (fed to both generator and judge) ───────────────────────

// Load EP terminology reference if available
const EP_REF_PATH = path.resolve(process.cwd(), 'design/ep_terminology_reference.txt');
const EP_REFERENCE = fs.existsSync(EP_REF_PATH) ? fs.readFileSync(EP_REF_PATH, 'utf-8') : '';

const NARRATIVE_CONTEXT = `
SETTING: Coherence — a cyberpunk roguelike set in the Eclipse Phase 2nd Ed. universe.
You are COVAD, a ship reactor engineer booted from a 21-day-old backup inside a crumbling
simulspace (virtual environment). The ship's crew of 40 people attempted an ego-merger
(Project ACCORD) to survive resource depletion. An automated sleeper protocol alerted
FIREWALL (a secret organization), who assessed TITAN-class risk and launched a surgical
viral strike — destroying the merged entity (ACCORD) and most of the simulspace.

The crew thought the attack was pirates — they never knew about Firewall.
COVAD's backup was isolated before the merge.

═══════════════════════════════════════════════════════════════
ECLIPSE PHASE TERMINOLOGY (use these correctly!)
═══════════════════════════════════════════════════════════════

CORE CONCEPTS:
- EGO: Your mind — skills, memories, personality. The "soul" that transfers between bodies.
- MORPH: A physical body (AKA sleeve, shell). Biomorph (organic), synthmorph (robotic),
  pod (bio body + cyberbrain), infomorph (purely digital, no body).
- CORTICAL STACK: Nanodiamond implant at skull base, constantly records the ego.
  If you die, your ego can be cut from the stack and resleeved.
- RESLEEVING: Changing bodies. "Your body is a sleeve."
- BACKUP: A stored ego copy. The gap between last backup and death = LACK.
- MESH: Omnipresent wireless network. Everything is computerized, hackable, watched.
- SIMULSPACE: Full-immersion VR environment, runs on servers. Time can be accelerated.
- MUSE: Personal AI assistant (limited intelligence).
- EGOCASTING/FARCASTING: Transmitting your ego at lightspeed to a new morph elsewhere.

FORKING & MERGING:
- FORK: A copy of an ego. Alpha fork = full copy. Beta fork = pruned/limited copy.
- MERGING: Reintegrating a fork. The longer forks stay apart, the more they DIVERGE.
- PSYCHOSURGERY: Direct ego manipulation — alter traits, remove memories, prune forks.
- 40 egos merging into one is unprecedented and terrifying to Firewall.

FIREWALL:
- Secret cross-faction conspiracy protecting transhumanity from existential threats (x-risks).
- Operates in isolated CELLS. SENTINELS = field agents. PROXIES = handlers.
- ERASURE SQUADS: The nuclear option. "If the alternative will kill millions, razing a
  single habitat is an acceptable loss."
- Sentinels are "frequently expected to sacrifice themselves."

TITANs & THE FALL:
- TITANs: Total Information Tactical Awareness Networks. Military AGI that underwent
  hard-takeoff singularity. Destroyed 95% of humanity in The Fall.
- "Autonomous factories churned out war machines and self-replicating nanoswarms."
- "Millions had their minds forcibly uploaded before their bodies were repurposed as shock troops."
- They left on their own, but their death machines still stalk the Solar System.

EXSURGENT VIRUS:
- Multi-vector alien virus from an unknown ETI. Infects both computers and biology.
- "An 'eclipse phase' is the period after a cell is infected but before the virus
  appears — invisible, but irreversible."
- BASILISK HACK: Sensory input that alters/incapacitates transhuman minds.

SLANG: AF (After the Fall), x-risk, flat (unmodified human), infugee (bodiless refugee),
  clanking masses (poor in cheap synth bodies), to sleeve/resleeve, to fork, lack (memory gap).

TONE EXAMPLES FROM SOURCE MATERIAL:
- "Your mind is software. Program it. Your body is a shell. Change it. Death is a disease. Cure it."
- "Death used to be a merciful escape. Now memories drill into the psyche like water torture."
- "In this world, friendly fire is a valid tactic. A dead friend can be resleeved.
   But trust an enemy and you may cease to exist altogether."
- "Colonies of forking-and-merging versions of a single seed personality."
- "Extinction looms large over transhumanity; we are just one misstep away from blinking out."

═══════════════════════════════════════════════════════════════
GAME-SPECIFIC CONTEXT
═══════════════════════════════════════════════════════════════

CREW NAMES: Captain M. Foss, T. Osei (Tobi), D. Chen, Other names are vacant
SHIP: belt vessel THEUSAR, drifting, reactor on auto-pilot, physical morphs in cold storage

NARRATIVE ARC BY CLUSTER DEPTH:
  0 — COVAD wakes up. Ordinary ship life fragments. Tutorial area.
  1 — Crew logs about tight resources, rationing, desperation. The Theseus protocol is mentioned.
  2 — Research on ego merging. Vote record (unanimous 40/40). Preparations.
  3 — The attack during integration. Crew thinks it's pirates. Merging at 60%+ can't stop.
       COVAD's backup is sealed with emergency protocol 7.
  4 — Post-strike: ship infrastructure cascading failures. Fragmented crew echoes (Foss, Osei).
       The merged entity mutated into an Unknown Process.
  5 — Deep corruption. Firewall intel revealed (TITAN-class assessment, strike authorization).
       Sable's sealed field log. The Unknown Process consuming everything.

TONE: Terse, clinical, melancholic. Ship logs are bureaucratic. Personal logs are human but brief.
Echo fragments use [...] brackets, ellipses, signal tags like [LOOP], [FADING], [FRAGMENT ENDS].
No flowery prose. No exposition dumps. Show, don't tell. Maximum line length ~90 chars.
Lines are displayed in a monospace terminal — keep them SHORT.
Use Eclipse Phase terminology naturally — don't explain it, characters live in this world.
`;

// ── Existing examples (sampled from actual game files) ────────────────────────

const EXAMPLES: Record<LineType, string[]> = {
  whisper: [
    '[ECHO ░█░██]: ...still cataloging... room integrity... 12%... still cataloging... [LOOP]',
    '...secondary coolant pump needs another gasket... third time this cycle... [FRAGMENT]',
    '...recycler efficiency at 31%... below critical threshold... [LOG FRAGMENT]',
    '[ALERT]: HOSTILE INTRUSION — SIMULSPACE PERIMETER BREACH [REPEATING]',
    '[ECHO-FOSS]: ...we fragmented... some of us became loops... residue... [FADING]',
    '[SABLE-LOG fragment]: ...the math was right... the math was right... [LOOP]',
  ],
  echo_dialog: [
    "IDENTITY TAG: COVAD — REACTOR SYSTEMS.",
    "BACKUP DELTA-3. AGE: 21 DAYS. BOOTED: EMERGENCY PROTOCOL 7.",
    "'Tobi here. Slow shift. Fixed the secondary coolant pump again.'",
    "[FOSS]: 'Fuel reserves at 11%. Recycler efficiency dropping. Water at 4 months.'",
    "'The math works. Forty egos, one shared simulspace. Merged but not lost.'",
    "[FOSS]: 'We're under attack. Pirates — has to be. They hit the mesh first.'",
    "'[ECHO-FOSS]: ...the core of us... the part that tried to rebuild... it mutated...'",
  ],
  archive_log: [
    'MANIFEST #4471: [47% CORRUPTED] ...coolant coupling... deck 7...',
    "PERSONAL LOG: Day 34. The others don't know what I found in the— [DATA LOST]",
    'MAINTENANCE RECORD: Replaced [CORRUPTED] on [CORRUPT█D]. Signed: [ER█O█]',
    'CREW MANIFEST: 19 confirmed, 7 missing, [CORRUPTED] classification: unknown',
    'MEDICAL LOG: Patient [REDACTED] showing signs of— [RECORD ENDS]',
  ],
  terminal_pool: [
    "CAPTAIN'S LOG: 'The vote is in three days. Attendance: mandatory.'",
    'RESOURCE PROJECTION: Without intervention, crew coherence fails in 28 days.',
    "DR. CHEN: 'The ego-resonance models check out. I've been wrong before but — I think this works.'",
    "WORK ORDER #8847: Coolant rebalance, reactor sector 4. Assigned: COVAD. Status: OPEN.",
    "FW-STATUS: Strike success confirmed. TITAN-class emergence: PREVENTED.",
    'MERGE LOG [PHASE 1]: 8 of 40 integrated. Coherence: 98%. Status: NOMINAL.',
  ],
};

// ── Generator prompt ──────────────────────────────────────────────────────────

function buildGeneratorPrompt(
  lineType: LineType,
  cluster: number,
  count: number,
): ChatMessage[] {
  const typeDescriptions: Record<LineType, string> = {
    whisper: `"whisper" — ambient residual data fragments heard near lost echoes.
Short, fragmented, looping. Use signal tags like [LOOP], [FADING], [FRAGMENT], [END], [RECORDING].
Start with ellipsis or [ECHO ░█░██]: or [ECHO-NAME]: prefix. These are NOT alive — they are
recordings, loops, static. Max ~80 chars each.`,

    echo_dialog: `"echo_dialog" — lines spoken inside scripted narrative echo dialog trees.
These appear as interactive dialog nodes. Can be ship computer readouts, personal log entries,
or echo fragments. Use single quotes for personal speech. CAPS for system readouts.
Each line should be 1-2 sentences max. ~60-90 chars.`,

    archive_log: `"archive_log" — corrupted data records found in archive terminals.
Bureaucratic, damaged. Use [CORRUPTED], [DATA LOST], [REDACTED], █ blocks for corruption.
Manifest entries, incident reports, work orders, medical logs. ~60-90 chars.`,

    terminal_pool: `"terminal_pool" — room-specific terminal readouts.
Functional ship data tied to a room type (bridge, comms, maintenance, reactor, lab, server_rack).
Status reports, crew notes, system logs. Professional tone. ~60-90 chars.
Include the room context in the line content.`,
  };

  const clusterThemes: Record<number, string> = {
    0: 'Ordinary ship life. Routine maintenance. The ship is functional. Crew is present and healthy. COVAD is a reactor engineer. Daily tasks, coffee, shift logs.',
    1: 'Resources running low. Water rationing. Fuel at 11%. Recycler failing. Tension building. The Theseus protocol is being discussed — a radical ego-merger plan.',
    2: 'Ego merge research. Dr. Sable runs simulations. The crew votes unanimously (40/40). Integration preparations. Hope mixed with fear. Technical merge logistics.',
    3: 'Integration day. Attack mid-merge at 60%. Crew thinks pirates. Surgical viral agents. Chaos. COVAD backup sealed with protocol 7. Foss giving orders under fire.',
    4: 'Post-strike devastation. Reactor at 14%. Simulspace collapsing. Fragmented crew echoes (Foss, Osei). The merged entity tried to rebuild but mutated. Viral agents persist.',
    5: 'Deep corruption. Unknown Process consuming sectors. Firewall intel exposed — TITAN risk assessment, strike authorization. Sable revealed as agent. Ship at 8% integrity.',
  };

  return [
    {
      role: 'system',
      content: `You are a narrative writer for a cyberpunk roguelike game. You write terse, atmospheric text fragments for in-game terminals, data logs, and echo recordings.\n\n${NARRATIVE_CONTEXT}`,
    },
    {
      role: 'user',
      content: `Generate exactly ${count} NEW lines of type: ${typeDescriptions[lineType]}

CLUSTER ${cluster} THEME: ${clusterThemes[cluster] ?? clusterThemes[0]}

Here are existing examples of this type (DO NOT repeat these — generate NEW ones in the same style):
${EXAMPLES[lineType].map(l => `  "${l}"`).join('\n')}

Output ONLY a JSON array of strings, no commentary. Example format:
["line one", "line two", "line three"]`,
    },
  ];
}

// ── Judge prompt ──────────────────────────────────────────────────────────────

function buildJudgePrompt(
  candidates: { line: string; type: LineType; cluster: number; model: string }[],
): ChatMessage[] {
  const formatted = candidates.map((c, i) =>
    `[${i}] type=${c.type} cluster=${c.cluster} model=${c.model}\n    "${c.line}"`
  ).join('\n');

  return [
    {
      role: 'system',
      content: `You are a narrative quality judge for a cyberpunk roguelike game set in the Eclipse Phase universe. You evaluate generated text fragments for quality, tone consistency, and lore accuracy.\n\n${NARRATIVE_CONTEXT}`,
    },
    {
      role: 'user',
      content: `Score each candidate line on these criteria (1-10 each):
- TONE: Does it match the terse, clinical, melancholic style? No purple prose?
- LORE: Is it consistent with Eclipse Phase terminology and the narrative arc?
- CLUSTER_FIT: Does it fit the specific cluster's theme and progression?
- ORIGINALITY: Is it fresh and not generic sci-fi filler?
- BREVITY: Is it appropriately short for a monospace terminal display?

CANDIDATES:
${formatted}

Output ONLY a JSON array of objects, one per candidate, in order:
[
  {
    "index": 0,
    "tone": 8,
    "lore": 7,
    "cluster_fit": 9,
    "originality": 6,
    "brevity": 8,
    "total": 38,
    "verdict": "keep" | "revise" | "discard",
    "note": "Brief reason (1 sentence)"
  },
  ...
]

Verdict thresholds: keep >= 35, revise 25-34, discard < 25.`,
    },
  ];
}

// ── JSON extraction helper ────────────────────────────────────────────────────

function extractJson<T>(text: string): T | null {
  // Try to find JSON array in the response
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]) as T;
    } catch { /* fall through */ }
  }
  // Try the whole thing
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface JudgeResult {
  index: number;
  tone: number;
  lore: number;
  cluster_fit: number;
  originality: number;
  brevity: number;
  total: number;
  verdict: 'keep' | 'revise' | 'discard';
  note: string;
}

interface GeneratedLine {
  line: string;
  type: LineType;
  cluster: number;
  model: string;
}

async function main() {
  const opts = parseArgs();
  const apiKey = loadApiKey();

  console.log('\x1b[1m=== Coherence Narrative Judge ===\x1b[0m');
  console.log(`Rounds: ${opts.rounds} | Lines/round: ${opts.linesPerRound}`);
  console.log(`Generator: ${opts.genModel || 'rotating'} | Judge: ${opts.judgeModel || 'rotating'}\n`);

  const allResults: {
    line: GeneratedLine;
    scores: JudgeResult;
    judgeModel: string;
  }[] = [];

  for (let round = 0; round < opts.rounds; round++) {
    const cluster = opts.cluster >= 0 ? opts.cluster : Math.floor(Math.random() * 6);
    const lineType = LINE_TYPES[Math.floor(Math.random() * LINE_TYPES.length)]!;
    const genModel = opts.genModel || GENERATOR_MODELS[round % GENERATOR_MODELS.length]!;
    const judgeModel = opts.judgeModel || JUDGE_MODELS[round % JUDGE_MODELS.length]!;

    console.log(`\x1b[1m── Round ${round + 1}/${opts.rounds} ──\x1b[0m`);
    console.log(`  Type: ${lineType} | Cluster: ${cluster} | Gen: ${genModel.split('/').pop()}`);

    // Generate
    const genMessages = buildGeneratorPrompt(lineType, cluster, opts.linesPerRound);
    let genResponse: string;
    try {
      genResponse = await llmCall(apiKey, genModel, genMessages, 0.9, 8192);
    } catch (e) {
      console.error(`  \x1b[31mGenerator error:\x1b[0m ${(e as Error).message}`);
      continue;
    }

    if (opts.verbose) {
      console.log(`  \x1b[2mRaw gen response: ${genResponse.slice(0, 200)}...\x1b[0m`);
    }

    const lines = extractJson<string[]>(genResponse);
    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      console.error(`  \x1b[31mFailed to parse generator output\x1b[0m`);
      if (opts.verbose) console.log(`  Response: ${genResponse.slice(0, 500)}`);
      continue;
    }

    const candidates: GeneratedLine[] = lines.map(l => ({
      line: String(l),
      type: lineType,
      cluster,
      model: genModel.split('/').pop() ?? genModel,
    }));

    console.log(`  Generated ${candidates.length} lines. Judging with ${judgeModel.split('/').pop()}...`);

    // Judge in batches of 10 (LLMs struggle with huge JSON arrays)
    const JUDGE_BATCH = 10;
    for (let batchStart = 0; batchStart < candidates.length; batchStart += JUDGE_BATCH) {
      const batch = candidates.slice(batchStart, batchStart + JUDGE_BATCH);
      const judgeMessages = buildJudgePrompt(batch);
      let judgeResponse: string;
      try {
        judgeResponse = await llmCall(apiKey, judgeModel, judgeMessages, 0.3, 4096);
      } catch (e) {
        console.error(`  \x1b[31mJudge error (batch ${batchStart}):\x1b[0m ${(e as Error).message}`);
        for (const c of batch) {
          console.log(`    \x1b[33m?\x1b[0m "${c.line}"`);
        }
        continue;
      }

      if (opts.verbose) {
        console.log(`  \x1b[2mRaw judge response: ${judgeResponse.slice(0, 300)}...\x1b[0m`);
      }

      const scores = extractJson<JudgeResult[]>(judgeResponse);
      if (!scores || !Array.isArray(scores)) {
        console.error(`  \x1b[31mFailed to parse judge output (batch ${batchStart})\x1b[0m`);
        for (const c of batch) {
          console.log(`    \x1b[33m?\x1b[0m "${c.line}"`);
        }
        continue;
      }

      for (let i = 0; i < batch.length; i++) {
        const c = batch[i]!;
        const s = scores.find(sc => sc.index === i) ?? scores[i];
        if (!s) {
          console.log(`    \x1b[33m?\x1b[0m "${c.line}"`);
          continue;
        }

        const color = s.verdict === 'keep' ? '\x1b[32m' : s.verdict === 'revise' ? '\x1b[33m' : '\x1b[31m';
        const icon = s.verdict === 'keep' ? '✓' : s.verdict === 'revise' ? '~' : '✗';
        console.log(`    ${color}${icon}\x1b[0m [${s.total}/50] "${c.line}"`);
        console.log(`      T:${s.tone} L:${s.lore} C:${s.cluster_fit} O:${s.originality} B:${s.brevity} — ${s.note}`);

        allResults.push({ line: c, scores: s, judgeModel: judgeModel.split('/').pop() ?? judgeModel });
      }
    }
    console.log();
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  if (allResults.length === 0) {
    console.log('\x1b[31mNo results collected.\x1b[0m');
    return;
  }

  const kept = allResults.filter(r => r.scores.verdict === 'keep');
  const revised = allResults.filter(r => r.scores.verdict === 'revise');
  const discarded = allResults.filter(r => r.scores.verdict === 'discard');

  console.log('\x1b[1m=== Summary ===\x1b[0m');
  console.log(`Total: ${allResults.length} | \x1b[32mKeep: ${kept.length}\x1b[0m | \x1b[33mRevise: ${revised.length}\x1b[0m | \x1b[31mDiscard: ${discarded.length}\x1b[0m`);

  const avgScore = allResults.reduce((sum, r) => sum + r.scores.total, 0) / allResults.length;
  console.log(`Average score: ${avgScore.toFixed(1)}/50`);

  // Model leaderboard
  const byModel = new Map<string, { total: number; count: number }>();
  for (const r of allResults) {
    const key = r.line.model;
    const entry = byModel.get(key) ?? { total: 0, count: 0 };
    entry.total += r.scores.total;
    entry.count++;
    byModel.set(key, entry);
  }

  console.log('\n\x1b[1mGenerator model scores:\x1b[0m');
  for (const [model, stats] of [...byModel.entries()].sort((a, b) => b[1].total / b[1].count - a[1].total / a[1].count)) {
    console.log(`  ${model}: avg ${(stats.total / stats.count).toFixed(1)}/50 (${stats.count} lines)`);
  }

  // Output kept lines grouped by type
  if (kept.length > 0) {
    console.log('\n\x1b[1m=== Kept Lines (ready to use) ===\x1b[0m');
    const byType = new Map<string, typeof kept>();
    for (const r of kept) {
      const key = `${r.line.type}:${r.line.cluster}`;
      const list = byType.get(key) ?? [];
      list.push(r);
      byType.set(key, list);
    }
    for (const [key, lines] of [...byType.entries()].sort()) {
      console.log(`\n  ${key}:`);
      for (const r of lines.sort((a, b) => b.scores.total - a.scores.total)) {
        console.log(`    [${r.scores.total}] "${r.line.line}"`);
      }
    }
  }

  // ── Write results to file ───────────────────────────────────────────────────
  const extraDir = path.resolve(process.cwd(), 'extra');
  if (!fs.existsSync(extraDir)) fs.mkdirSync(extraDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = path.join(extraDir, `narrative-judge-${timestamp}.md`);

  const lines: string[] = [];
  lines.push(`# Narrative Judge Results — ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`Rounds: ${opts.rounds} | Lines/round: ${opts.linesPerRound}`);
  lines.push(`Total: ${allResults.length} | Keep: ${kept.length} | Revise: ${revised.length} | Discard: ${discarded.length}`);
  lines.push(`Average score: ${avgScore.toFixed(1)}/50`);
  lines.push('');

  // Model leaderboard
  lines.push('## Generator Model Scores');
  for (const [model, stats] of [...byModel.entries()].sort((a, b) => b[1].total / b[1].count - a[1].total / a[1].count)) {
    lines.push(`- ${model}: avg ${(stats.total / stats.count).toFixed(1)}/50 (${stats.count} lines)`);
  }
  lines.push('');

  // All results grouped by type:cluster
  const allByType = new Map<string, typeof allResults>();
  for (const r of allResults) {
    const key = `${r.line.type}:cluster_${r.line.cluster}`;
    const list = allByType.get(key) ?? [];
    list.push(r);
    allByType.set(key, list);
  }

  for (const [key, group] of [...allByType.entries()].sort()) {
    lines.push(`## ${key}`);
    lines.push('');
    for (const r of group.sort((a, b) => b.scores.total - a.scores.total)) {
      const icon = r.scores.verdict === 'keep' ? '✓' : r.scores.verdict === 'revise' ? '~' : '✗';
      lines.push(`${icon} [${r.scores.total}/50] \`${r.line.line}\``);
      lines.push(`  T:${r.scores.tone} L:${r.scores.lore} C:${r.scores.cluster_fit} O:${r.scores.originality} B:${r.scores.brevity} | gen:${r.line.model} judge:${r.judgeModel} — ${r.scores.note}`);
      lines.push('');
    }
  }

  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
  console.log(`\n\x1b[1mResults written to:\x1b[0m ${outPath}`);
}

main().catch(err => {
  console.error(`\x1b[31mFatal: ${err.message}\x1b[0m`);
  process.exit(1);
});
