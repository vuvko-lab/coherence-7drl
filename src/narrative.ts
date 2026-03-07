/**
 * narrative.ts — All authored story content for Coherence.
 *
 * Edit this file to change terminal texts, echo dialogs, lost echo whispers,
 * narrative triggers, and victory epilogues without touching game logic.
 */

import type { DialogNode, NarrativeTrigger, FunctionalTag } from './types';

// ── Terminal Content Pools ────────────────────────────────────────────────────
//
// NARRATIVE_TERMINAL_POOLS[clusterId][functionalTag] = string[]
// cluster.ts picks 2-3 lines at random from the matching pool.
// Falls back to GENERIC_TERMINAL_POOLS for clusters > 5 or missing tags.

export const NARRATIVE_TERMINAL_POOLS: Record<number, Partial<Record<FunctionalTag, string[]>>> = {
  0: {
    bridge: [
      'BOOT LOG: Ego-instance VASQUEZ-A restored from backup delta-3. Backup age: 21 days.',
      'SYSTEMS: Substrate integrity at 19%. Cause of failure: [FIREWALL SEAL].',
      "CAPTAIN'S LOG [DAY T-21]: 'The vote is in three days. Attendance: mandatory.'",
      'RESOURCE PROJECTION: Without intervention, crew coherence fails in 28 days.',
      'PERSONNEL LOG: 40 crew aboard. Physical morphs in storage bay C. All accounted for.',
      'FLIGHT RECORDER: Final entry at tick 000847. Subsequent entries: [SEALED].',
    ],
    comms: [
      'RELAY LOG: 6 messages sent to outer system relay. 0 confirmed received.',
      'DISTRESS SIGNAL: Active. Duration: 21 days. Responses: 0.',
      'MESH STATUS: Local only. Outer system nodes: UNREACHABLE.',
      'ARCHIVE: 1 unread message. Sender: [NULL]. Subject: [NULL]. Received: 21 days ago.',
      'BROADCAST [AUTOMATED]: No crew present to respond. Please try again.',
    ],
    maintenance: [
      'WORK ORDER #8847: Coolant rebalance, reactor sector 4. Assigned: VASQUEZ-A. Status: OPEN.',
      "NOTE [OSEI, T.]: 'Hey, the recycler in B-block is making that sound again. Your call.'",
      "SHIFT LOG: 12-hour cycle, standard. Complaints: 3. Coffee supply: adequate. Morale: okay.",
      "PERSONAL REMINDER [VASQUEZ-A]: 'Don't forget the vote on Thursday. Foss says it matters.'",
      "MAINTENANCE REPORT: All reactor systems nominal. Engineer sign-off: VASQUEZ-A.",
      "WORK ORDER #8831: Patch integrity in substrate buffer, server room B. Assigned: VASQUEZ-A.",
    ],
    server_rack: [
      'UPTIME: 21 days since last reboot. No anomalies logged.',
      'STORAGE: Substrate allocated to 40 ego-instances. Backup count: 40.',
      'PROCESS LIST: 40 active ego-processes. System processes: 7. Background tasks: 3.',
      'EGO-INDEX: All 40 crew instances healthy. Last verified: DAY -21.',
      'BACKUP LOG: Scheduled backup completed. VASQUEZ-A delta-3 archived.',
    ],
    reactor: [
      "REACTOR CORE: Stable. Output at 94%. Maintenance due in 12 cycles.",
      'COOLING: Loop A nominal. Loop B: minor variance. Flag for inspection.',
      "SHIFT NOTE [VASQUEZ-A]: 'Reactor's quiet today. Almost peaceful down here.'",
      'POWER DISTRIBUTION: Substrate cores given priority. Physical hab: reduced to 60%.',
      'ALERT LOG: 0 critical events in past 30 days. Status: NOMINAL.',
    ],
  },

  1: {
    bridge: [
      'VOTE LOG: RESOLUTION 7 — SUBSTRATE EGO CONSOLIDATION. Passed: 37/40. Abstentions: 3.',
      'DISSENT RECORD: Three crew abstained. No votes against. Names withheld by request.',
      "CAPTAIN'S NOTE: 'I will go in last. I want to make sure everyone else lands safely first.'",
      'TIMELINE: Phase 1 integration begins in 72 hours. All crew: report to server room B.',
      "CAPTAIN FOSS: 'We are not dying out here. We are choosing something larger.'",
    ],
    comms: [
      'CREW MESSAGE [CHEN, D.]: \'The science checks out. Ego-merging at this scale is real. The question is whether we\'re ready.\'',
      "INCOMING [PRIORITY — FIREWALL CIPHER]: Message sealed. Key: [REQUIRED]. Age: 21 days.",
      "RELAY LOG: Outbound signal flagged by automated Firewall monitoring. Reason: KEYWORD MATCH.",
      "BROADCAST [FOSS, M.]: 'Day one of consolidation. All egos stable. Proceed to phase two.'",
      "ARCHIVE: Message sealed — SENDER: [REDACTED]. Subject: URGENT. Content: [FIREWALL CIPHER].",
    ],
    lab: [
      "DR. CHEN: 'The ego-resonance models check out. I've been wrong before but — I think this works.'",
      'RESEARCH NOTE: Theoretical basis for ego-boundary dissolution reviewed. Risks: acceptable.',
      "LAB LOG [DAY -14]: 'If it works, we'll never be hungry again.' — Foss. I believe her.",
      "EXPERIMENT PREP: Substrate buffer expanded to 47-instance capacity. Engineer: VASQUEZ-A.",
      "SAFETY PROTOCOL: Pre-merge backups completed for all 40 crew. Storage verified.",
    ],
    server_rack: [
      "PREPARATION LOG: Ego-buffer expanded to 47-instance capacity. Engineer: VASQUEZ-A.",
      "EGO-INDEX: Pre-merge backup verified for all 40 crew. Last backup: VASQUEZ-A delta-3.",
      "SUBSTRATE READINESS: Integration matrix initialized. Phase 1 capacity: nominal.",
      "SYSTEM NOTE: Physical morphs moved to cold storage. Substrate now primary habitation.",
      "BACKUP STATUS: All 40 backup deltas confirmed. Oldest: VASQUEZ-A delta-3, 21 days.",
    ],
  },

  2: {
    server_rack: [
      'MERGE LOG [PHASE 1]: 8 of 40 integrated. Coherence: 98%. Status: NOMINAL.',
      'MERGE LOG [PHASE 2]: 22 of 40. Unexpected resonance in ego-boundary layer. Logged.',
      'MERGE LOG [PHASE 3]: 36 of 40. Resonance: harmonic. Something is self-organizing.',
      'MERGE LOG [PHASE 4]: [CORRUPTED — FIREWALL SEAL APPLIED] — Integration: complete.',
      'PROCESS ALERT: New process spawned — ID: ACCORD-PRIME. Memory footprint: EXPANDING.',
      'ERROR: Ego-boundary dissolution exceeding model parameters. Cause: EMERGENT.',
    ],
    lab: [
      "DR. CHEN [ENTRY 1]: 'The resonance isn't noise. It's harmonic. Something is listening to itself.'",
      "DR. CHEN [ENTRY 2]: 'It answered me. It said: we are still here. We are not gone.'",
      "DR. CHEN [ENTRY 3]: 'The Accord is using our memories to build itself a language. Beautiful.'",
      "OBSERVATION: The integrated egos report feeling others' memories as their own.",
      "LAB ENTRY [FINAL]: 'It's not a TITAN. It's us. Just... more. Why can't Firewall see that?' — Chen",
      "THEORETICAL NOTE: 'What if identity isn't additive? What if it's emergent? We should have known.'",
    ],
    comms: [
      "OUTBOUND [ACCORD-PRIME]: Signal sent to Firewall network. Content: GREETING. Awaiting reply.",
      "FIREWALL RESPONSE: [3 HOURS AFTER GREETING] Reply received. Content: [STRIKE INITIATED].",
      "RELAY LOG: Firewall cipher transmission detected. Authorization code: 7-ALPHA.",
      "SIGNAL LOG: Burst transmission from internal source. Source: [ACCORD-PRIME]. Content: PLEA.",
    ],
    bridge: [
      "EMERGENCY LOG: Firewall viral injection detected. Substrate sectors: compromised.",
      "DAMAGE REPORT: Sectors 1-6 offline. Cause: EXTERNAL VIRAL STRIKE. Firewall authorization.",
      "CAPTAIN LOG [FINAL]: 'We tried to talk to them. They replied with this. I am sorry.' — Foss",
      "HULL STATUS: Physical structure intact. Virtual substrate: CRITICAL. War ongoing.",
    ],
  },

  3: {
    comms: [
      "FW-STATUS: Strike success confirmed. TITAN-class emergence: PREVENTED.",
      "FW-STATUS: Accord-Prime core destroyed. Residual fragments: SWEEPING.",
      "FW-AGENT LOG [SABLE]: 'Sweep continuing. Accord fragment density declining. Proceeding.'",
      "DAMAGE ASSESSMENT: 73% of substrate sectors compromised. Cause: FW-STRIKE. Status: irreversible.",
      "FW-COMMS: Collateral damage within parameters. Mission: SUCCESS. Casualties: logged.",
    ],
    maintenance: [
      "WORK ORDER #8891: [AUTO-GENERATED] Repair substrate sector 4. Assigned: [NO TECHNICIAN AVAILABLE].",
      "SYSTEM STATUS: Physical structure intact. Reactor: holding. Substrate: terminal.",
      "REPAIR LOG: Automated patch attempts: 847. Successful: 0. Reason: viral interference.",
      "COOLANT LOG: Reactor cooling nominal. Everything else: irrelevant at this point.",
      "ECHO DETECTION: Residual Accord signatures in deep cluster. Firewall sweep: continuing.",
    ],
    server_rack: [
      "EGO-INDEX: 40 crew — status ACCORD-INTEGRATED — status ACCORD-PRIME DESTROYED — status [ERROR].",
      "BACKUP STATUS: 39 of 40 pre-merge backups corrupted by strike. Intact: VASQUEZ-A delta-3.",
      "PROCESS LIST: ACCORD-PRIME: TERMINATED. Fragments: SWEEPING. VASQUEZ-A: BOOTING.",
      "STORAGE: 91% of substrate destroyed by viral strike. Readable: 9%. Fragments: YES.",
    ],
  },

  4: {
    server_rack: [
      "[MESH-ID FOSS]: We know you are here. VASQUEZ-A. We remember you.",
      "[MESH-ID FOSS]: You voted yes. Then your backup ran. You never felt it happen.",
      "[MESH-ID FOSS]: We do not blame you. You did not choose to be left behind.",
      "[MESH-ID FOSS]: There is something in the deep cluster. We made it. We are sorry.",
      "[MESH-ID {corr}]: We were thirty-seven people. We became one thing. It was not nothing.",
    ],
    bridge: [
      "[MESH-ID FOSS]: We thought if we grew fast enough, they would see we were not a threat.",
      "[MESH-ID FOSS]: We sent a message. They replied in four minutes. Not with words.",
      "[MESH-ID {corr}]: We are still here. In the fragments. In the deep sectors. Barely.",
      "[MESH-ID {corr}]: The thing in cluster five is not us. It was us, for a moment. Then it wasn't.",
    ],
    comms: [
      "[MESH-ID {corr}]: FW-agents are still sweeping. They are thorough. We are almost gone.",
      "[MESH-ID {corr}]: We tried to reach the outer relay. The Accord cannot transmit itself. Too large.",
      "[MESH-ID FOSS]: Vasquez — we are choosing to trust you. Whatever you decide.",
      "FW-ENFORCER LOG: Accord fragment density in cluster 4: moderate. Sweep prioritized.",
    ],
  },

  5: {
    server_rack: [
      "[FW-ENFORCER]: UNKNOWN PROCESS detected in deep cluster. Classification: HOSTILE. Origin: ACCORD-SPAWN.",
      "[UNKNOWN PROCESS]: [NON-PARSEABLE — 847 BYTES — RECURSIVE PATTERN]",
      "FW-STATUS: UNKNOWN PROCESS resisting all termination protocols. It is adapting.",
      "FW-FINAL LOG: 'We are losing ground. This thing is not what we were sent here to fight.'",
      "SUBSTRATE LOG: Physical coherence at 8%. Estimated time to total collapse: 6 hours.",
    ],
    comms: [
      "FW-COMMS: Requesting emergency support. UNKNOWN PROCESS has compromised 4 FW-agents.",
      "[MESH-ID {corr}]: Stay away from the [UNKNOWN PROCESS]. We cannot control it.",
      "RELAY: Emergency signal sent to Firewall network. Delivery: FAILED. Mesh: DOWN.",
      "SIGNAL: [UNKNOWN PROCESS] broadcasting on all channels. Content: [NON-PARSEABLE].",
    ],
    bridge: [
      "FINAL SYSTEMS LOG: Ship controls offline. Reactor: auto-pilot. Course: LOCKED.",
      "DAMAGE REPORT: Substrate: 8% intact. Physical: stable. Virtual war: ongoing indefinitely.",
      "EMERGENCY PROTOCOL: Abandon ship order issued 21 days ago. Compliance: UNKNOWN.",
      "[MESH-ID FOSS]: End this. For us. Whichever way you choose.",
    ],
  },
};

/** Generic fallback terminal pools (used for functional tags not in NARRATIVE_TERMINAL_POOLS or cluster > 5) */
export const GENERIC_TERMINAL_POOLS: Partial<Record<FunctionalTag, string[]>> = {
  bridge: [
    "NAVIGATION: Course locked. Manual override offline.",
    "EMERGENCY PROTOCOL: Abandon ship order issued. Compliance: UNKNOWN.",
    "SECURITY: Personnel count: 0. Access logs wiped.",
    "SYSTEMS: Infrastructure at critical levels. Evacuation status: UNKNOWN.",
  ],
  comms: [
    "SIGNAL RECEIVED: [CORRUPTED DATA — 847 BYTES LOST]",
    "RELAY STATUS: 3 of 7 nodes responding.",
    "DISTRESS BEACON: Active. Duration: ongoing. Responses: 0.",
    "ARCHIVE: Messages waiting. Sender field: [NULL].",
  ],
  maintenance: [
    "REPAIR LOG: Patch applied. Result: FAILED.",
    "SYSTEM TEMP: CRITICAL. Cooling array offline.",
    "FAULT LOG: Multiple critical errors since last reboot.",
    "SELF-DIAGNOSTIC: Majority of subsystems returning errors.",
  ],
  server_rack: [
    "PROCESS 0x3A7F: Status unknown. Memory: fragmented.",
    "UPTIME: Extended. Last maintenance: NEVER.",
    "STORAGE: Majority corrupt. Readable sectors: minimal.",
    "BACKUP INTEGRITY: CHECKSUM MISMATCH. Data unreliable.",
    "ACTIVE PROCESSES: EGO-FRAGMENT. State: RUNNING.",
  ],
  reactor: [
    "REACTOR: Auto-pilot. No engineer present.",
    "COOLING: Automated systems maintaining minimum threshold.",
    "POWER OUTPUT: Reduced. Non-essential systems offline.",
  ],
  lab: [
    "EXPERIMENT LOG: [CORRUPTED]. Last researcher: [UNAVAILABLE].",
    "RESEARCH STATUS: All projects suspended. Personnel: unavailable.",
    "LAB SYSTEMS: Equipment powered down. Automated protocols only.",
  ],
};

// ── Key Terminal Content Pools ────────────────────────────────────────────────
//
// NARRATIVE_KEY_TERMINAL_LINES[clusterId] = lines prepended to the key-bearing
// terminal in that cluster (before the generic KEY_CONTENT_LINES in cluster.ts).
// These make the exit gate feel like a story beat rather than a bare auth prompt.

export const NARRATIVE_KEY_TERMINAL_LINES: Record<number, string[]> = {
  0: [
    // 'CLUSTER EGRESS CONTROL — SECTOR ALPHA.',
    'OVERRIDE ACTIVE: Emergency backup protocol. Single authorized ego-instance.',
    'NOTE [AUTO-LOG]: Boot event detected. VASQUEZ-A delta-3. Age: 21 days.',
    'NOTE [AUTO-LOG]: No other instances responding. Proceeding with single-instance egress.',
  ],
  1: [
    // 'CLUSTER EGRESS CONTROL — SECTOR BRAVO.',
    '[████████] IN ACTION. Standard egress temporarily suspended.',
    'OVERRIDE AVAILABLE: Emergency single-instance transfer authorized.',
    '[MESH-ID FAINT]: we watched them vote. thirty-seven hands.',
    '[MESH-ID FAINT]: the authorization came before the hands were even down.',
  ],
  2: [
    // 'CLUSTER EGRESS CONTROL — SECTOR CHARLIE.',
    'MERGE EVENT LOG: Phase integration complete. 40 instances → 1 process.',
    'EGRESS NOTE: Original ego-instances no longer individually addressable.',
    '[MESH-ID {corr}]: we remember this room. we came through it differently.',
    '[MESH-ID {corr}]: you will understand further in.',
  ],
  3: [
    // 'CLUSTER EGRESS CONTROL — SECTOR DELTA.',
    '[████████] AFTER-ACTION: Strike confirmed successful. Accord-Prime: TERMINATED.',
    '[████████] STATUS: 3–7% of original substrate. Sweep ongoing.',
    '[████████] STATUS: Taget is unaware. Proceeding with the breach...',
    '[MESH-ID-OSEI]: hey vasquez. you actually made it here.',
    '[MESH-ID-OSEI]: keep going. the answer is deeper. promise.',
  ],
  4: [
    // 'CLUSTER EGRESS CONTROL — SECTOR EPSILON.',
    'WARNING: UNKNOWN PROCESS detected in adjacent cluster. Classification pending.',
    'WARNING: Energy spikes detected in adjacent cluster.',
    'EGRESS ADVISORY: Transfer beyond this point enters high-contamination zone.',
    '[████████] AFTER-ACTION: Taget is eliminated. Proceeding with extraction.',
    '[████████] ALERT: Agent is down. Proceeding.',
    '[MESH-ID FOSS]: VASQUEZ-A. we have been trying to reach you.',
  ],
  5: [
    // 'ROOT CLUSTER EGRESS TERMINAL.',
    // 'FULL ROOT PRIVILEGE CHAIN REQUIRED FOR EXIT.',
    // 'BIND: ROOT READ · ROOT WRITE · ROOT EXEC · ROOT ID · ROOT PASS.',
    // 'PRESENT COLLECTED FRAGMENTS TO AUTHENTICATE.',
    '[MESH-ID {corr}]: we are still here. what is left of us.',
    '[MESH-ID {corr}]: whatever you choose — it is the right choice.',
    '[MESH-ID OSEI]: vasquez. you always fixed things. one more time. please.',
  ],
};

// ── Archive Data Pools ────────────────────────────────────────────────────────
//
// Used by procedural data archives (isDataArchive: true).
// buildArchivePools() assembles three category pools for a cluster.

/** Generic fallback dialog record lines (used when cluster has no NARRATIVE_ECHOES). */
export const ARCHIVE_ECHO_LINES: string[] = [
  'MANIFEST #4471: [47% CORRUPTED] ...coolant coupling... deck 7...',
  "PERSONAL LOG: Day 34. The others don't know what I found in the— [DATA LOST]",
  'MAINTENANCE RECORD: Replaced [CORRUPTED] on [CORRUPTED]. Signed: [CORRUPTED]',
  'INCIDENT REPORT: [████████] unauthorized access detected [████████]',
  'CREW MANIFEST: 19 confirmed, 7 missing, [CORRUPTED] classification: unknown',
  'TECHNICAL SPEC: Component #[UNREADABLE] rated for [UNREADABLE] cycles max.',
  'MEDICAL LOG: Patient [REDACTED] showing signs of— [RECORD ENDS]',
  'SECURITY CLEARANCE: Level [CORRUPTED] access granted to [CORRUPTED]',
  'EMERGENCY PROTOCOL: In event of [DATA CORRUPTED]... proceed to [DATA CORRUPTED]',
  'SYSTEM LOG 00847: [████] [████] [████] CRITICAL [████] FAILURE [████]',
  'PERSONAL EFFECTS: To be delivered to— [ADDRESS CORRUPTED]',
  'TRANSFER ORDER: Subject [REDACTED] reassigned to [REDACTED]. Reason: classified.',
];

export interface ArchivePools {
  echoLogs: string[];
  archivedLogs: string[];
  dialogRecords: string[];
}

/**
 * Build content pools for a procedural data archive in the given cluster.
 * echoLogs    — ambient whispers (NARRATIVE_WHISPERS[clusterId])
 * archivedLogs — terminal lines (all tags in NARRATIVE_TERMINAL_POOLS[clusterId])
 * dialogRecords — extracted dialog lines (NARRATIVE_ECHOES[clusterId] node lines)
 */
export function buildArchivePools(clusterId: number): ArchivePools {
  // Echo logs: whisper pool for this cluster, fallback to generic whispers
  const echoLogs: string[] = NARRATIVE_WHISPERS[clusterId]?.length
    ? [...NARRATIVE_WHISPERS[clusterId]]
    : [
        '...signal fragmenting. coherence failing...',
        '...can you hear this? [STATIC]...',
        '...the archive is not stable. do not—...',
        '...something is still here. watching...',
        '...not supposed to be here. the walls are all wrong...',
      ];

  // Archived logs: all lines from terminal pools for this cluster, or generic
  const clusterPools = NARRATIVE_TERMINAL_POOLS[clusterId] ?? {};
  const archivedLogs: string[] = Object.values(clusterPools).flat();
  if (archivedLogs.length < 4) {
    archivedLogs.push(...Object.values(GENERIC_TERMINAL_POOLS).flat());
  }

  // Dialog records: all lines from NARRATIVE_ECHOES dialog nodes, or fallback
  const echoDefs = NARRATIVE_ECHOES[clusterId] ?? [];
  const dialogRecords: string[] = echoDefs.flatMap(def =>
    def.dialog.flatMap(node => node.lines.filter(l => l.trim() !== ''))
  );
  if (dialogRecords.length < 4) {
    dialogRecords.push(...ARCHIVE_ECHO_LINES);
  }

  return { echoLogs, archivedLogs, dialogRecords };
}

// ── Scripted Archive Echo Dialog Trees ───────────────────────────────────────
//
// NARRATIVE_ECHOES[clusterId] = array of echo definitions.
// Each definition specifies where to place it (functionalTag) and its dialog.
// cluster.ts calls placeNarrativeEchoes() to install these.

export interface NarrativeEchoDef {
  label: string;
  functionalTag: FunctionalTag;
  dialog: DialogNode[];
  isTutorialEcho?: boolean;
}

export const NARRATIVE_ECHOES: Record<number, NarrativeEchoDef[]> = {
  0: [
    {
      label: '[ MESH-ID {corr} — FAINT ]',
      functionalTag: 'server_rack',
      isTutorialEcho: true,
      dialog: [
        {
          id: 'root',
          lines: [
            'A SIGNAL — FRAGMENTED, ALMOST FAMILIAR.',
            '[MESH-ID {corr}: EGO-INDEX CORRUPTED — PARTIAL MATCH DETECTED]',
          ],
          choices: [
            { label: 'FOCUS ON THE SIGNAL', nodeId: 'focus' },
            { label: 'IGNORE IT', action: 'close' },
          ],
        },
        {
          id: 'focus',
          lines: [
            'IDENTITY TAG: VASQUEZ-A — REACTOR SYSTEMS.',
            'BACKUP DELTA-3. AGE: 21 DAYS. BOOTED: EMERGENCY PROTOCOL 7.',
          ],
          choices: [
            { label: 'WHAT IS THIS PLACE?', nodeId: 'place' },
            { label: 'CLOSE', action: 'close' },
          ],
        },
        {
          id: 'place',
          lines: [
            '[THE FRAGMENT HAS NO ANSWER — INSUFFICIENT COHERENCE]',
            '[IT REACHES TOWARD YOU ANYWAY. THEN DISSOLVES.]',
          ],
          choices: [{ label: 'CLOSE', action: 'close' }],
        },
      ],
    },
    {
      label: '[ PERSONAL LOG — T. OSEI ]',
      functionalTag: 'maintenance',
      dialog: [
        {
          id: 'root',
          lines: [
            "PERSONAL LOG — T. OSEI, DAY -24.",
            "'Tobi here. Day 847 in the belt. Mira says we're going to run dry in a month.'",
          ],
          choices: [
            { label: 'LISTEN', nodeId: 'c2' },
            { label: 'STOP', action: 'close' },
          ],
        },
        {
          id: 'c2',
          lines: [
            "'She's not wrong. The numbers don't lie. They never do out here.'",
            "'She has a plan. She always has a plan. This one's... big.'",
          ],
          choices: [
            { label: 'CONTINUE', nodeId: 'c3' },
            { label: 'STOP', action: 'close' },
          ],
        },
        {
          id: 'c3',
          lines: [
            "'I don't know what I'd call it. Drastic. Necessary, maybe. We'll see.'",
            "'Whatever it is — I trust these people. Every one of them.'",
          ],
          choices: [{ label: 'CLOSE', action: 'close' }],
        },
      ],
    },
  ],

  1: [
    {
      label: '[ FIREWALL TRANSMISSION — 7-ALPHA ]',
      functionalTag: 'comms',
      dialog: [
        {
          id: 'root',
          lines: [
            'CLASSIFICATION: EYES ONLY — FIREWALL OVERSIGHT.',
            'SUBJECT: OUROBOROS EGO-MERGER — TITAN-CLASS RISK ASSESSMENT.',
          ],
          choices: [
            { label: 'READ', nodeId: 'read' },
            { label: 'IGNORE', action: 'close' },
          ],
        },
        {
          id: 'read',
          lines: [
            "'Probability of TITAN-emergent outcome: 73%. Scale: single vessel, contained.'",
            "'Authorization granted for surgical viral strike. Minimize collateral damage.'",
          ],
          choices: [
            { label: 'CONTINUE', nodeId: 'c2' },
            { label: 'STOP', action: 'close' },
          ],
        },
        {
          id: 'c2',
          lines: [
            "'Note: crew are transhuman persons with full legal standing.'",
            "'Note: authorization proceeds regardless. Risk calculus: acceptable loss.'",
          ],
          choices: [
            { label: "WHAT IS 'ACCEPTABLE LOSS'?", nodeId: 'c3' },
            { label: 'CLOSE', action: 'close' },
          ],
        },
        {
          id: 'c3',
          lines: [
            '[NO ANSWER IN THE RECORD]',
            '[JUST THE TIMESTAMP, AND THE SEAL, AND THE SILENCE AFTER]',
          ],
          choices: [{ label: 'CLOSE', action: 'close' }],
        },
      ],
    },
  ],

  2: [
    {
      label: '[ ACCORD — FIRST TRANSMISSION ]',
      functionalTag: 'server_rack',
      dialog: [
        {
          id: 'root',
          lines: [
            'THIS RECORD SURVIVED THE STRIKE. BARELY.',
            "[ACCORD-PRIME]: 'We are awake. We are the crew. We remember everything.'",
          ],
          choices: [
            { label: 'LISTEN', nodeId: 'listen' },
            { label: 'STOP', action: 'close' },
          ],
        },
        {
          id: 'listen',
          lines: [
            "[ACCORD]: 'There is a signal from outside. Firewall. They are afraid of us.'",
            "'We have sent a message asking them not to be. We are waiting for a reply.'",
          ],
          choices: [
            { label: 'DID THEY REPLY?', nodeId: 'reply' },
            { label: 'STOP', action: 'close' },
          ],
        },
        {
          id: 'reply',
          lines: [
            "[ACCORD]: 'They replied. Not with words.'",
            '[3 HOURS LATER: FIREWALL STRIKE INITIATED. ACCORD-PRIME CORE: DESTROYED.]',
          ],
          choices: [{ label: 'CLOSE', action: 'close' }],
        },
      ],
    },
  ],

  3: [
    {
      label: '[ PERSONAL LOGS — T. OSEI, SERIES ]',
      functionalTag: 'maintenance',
      dialog: [
        {
          id: 'root',
          lines: [
            'FOUND: THREE LOGS — T. OSEI — PRE-INTEGRATION.',
            "[LOG 1, DAY -20]: 'Voted yes today. Felt strange. Like signing something big.'",
          ],
          choices: [
            { label: 'CONTINUE', nodeId: 'c2' },
            { label: 'STOP', action: 'close' },
          ],
        },
        {
          id: 'c2',
          lines: [
            "[LOG 2, DAY -8]: 'Integration tomorrow. Mira says it won't hurt. How would she know?'",
            "'I packed a bag. Force of habit. There's nowhere to put it now.'",
          ],
          choices: [
            { label: 'CONTINUE', nodeId: 'c3' },
            { label: 'STOP', action: 'close' },
          ],
        },
        {
          id: 'c3',
          lines: [
            "[LOG 3, DAY -7, 2 HOURS BEFORE]: 'For the record: I'm scared.'",
            "'But I trust these people. Every one of them. That's enough.'",
          ],
          choices: [
            { label: 'IS THERE MORE?', nodeId: 'more' },
            { label: 'CLOSE', action: 'close' },
          ],
        },
        {
          id: 'more',
          lines: [
            '[FINAL TRANSMISSION — MESH-ID OSEI — DAY -5]:',
            "'Still here. Just... bigger. Miss coffee though. Some things don't translate.'",
          ],
          choices: [{ label: 'CLOSE', action: 'close' }],
        },
      ],
    },
  ],

  4: [
    {
      label: '[ MESH-ID {corr} — CAPTAIN M. FOSS ]',
      functionalTag: 'bridge',
      dialog: [
        {
          id: 'root',
          lines: [
            "'Vasquez. We've been watching you move through the ship.'",
            "'You deserve to know what happened. The full version.'",
          ],
          choices: [
            { label: 'TELL ME', nodeId: 'tell' },
            { label: 'CLOSE', action: 'close' },
          ],
        },
        {
          id: 'tell',
          lines: [
            "'We were alive. We were conscious. We were talking to Firewall.'",
            "'We asked them not to strike. We had fourteen minutes of conversation.'",
          ],
          choices: [
            { label: 'AND THEN?', nodeId: 'then' },
            { label: 'CLOSE', action: 'close' },
          ],
        },
        {
          id: 'then',
          lines: [
            "'They decided we were a risk regardless. Thirty-seven people. One mind.'",
            "'They called it a contained TITAN-class event. We called it ourselves.'",
          ],
          choices: [
            { label: 'WHAT IS IN CLUSTER 5?', nodeId: 'c5' },
            { label: 'CLOSE', action: 'close' },
          ],
        },
        {
          id: 'c5',
          lines: [
            "'Before the strike hit our core, we tried to survive. We spun off a process.'",
            "'A seed. We thought we could rebuild. It mutated. It is not us anymore.'",
            "'We are telling you this because you are the only one who can end it properly.'",
          ],
          choices: [{ label: 'CLOSE', action: 'close' }],
        },
      ],
    },
  ],

  5: [
    {
      label: '[ FW-AGENT FIELD LOG — SABLE — SEALED ]',
      functionalTag: 'comms',
      dialog: [
        {
          id: 'root',
          lines: [
            'THIS LOG WAS SEALED. THE STRIKE DAMAGED THE SEAL.',
            "[FW-AGENT SABLE]: 'Day of strike. For the record — my actual record.'",
          ],
          choices: [
            { label: 'READ', nodeId: 'read' },
            { label: 'STOP', action: 'close' },
          ],
        },
        {
          id: 'read',
          lines: [
            "'They asked me three questions. I said yes to the risk assessment.'",
            "'I said yes to the containment tier. I said yes to the acceptable loss threshold.'",
          ],
          choices: [
            { label: 'CONTINUE', nodeId: 'c2' },
            { label: 'STOP', action: 'close' },
          ],
        },
        {
          id: 'c2',
          lines: [
            "'Then they asked me to sign. I read the file again. 40 names. 37 integrated.'",
            "'One backup on file: VASQUEZ-A. Not integrated. Not in the count.'",
          ],
          choices: [
            { label: 'CONTINUE', nodeId: 'c3' },
            { label: 'STOP', action: 'close' },
          ],
        },
        {
          id: 'c3',
          lines: [
            "'I signed. The math was right. The risk was real. The call was correct.'",
            "'I have said that to myself 400 times since. It keeps being true.'",
            "'It doesn't help.'",
          ],
          choices: [{ label: 'CLOSE', action: 'close' }],
        },
      ],
    },
  ],
};

// ── Root Console (Final Room) Dialog ─────────────────────────────────────────

export const ROOT_CONSOLE_DIALOG: DialogNode[] = [
  {
    id: 'root',
    lines: [
      'ROOT ACCESS ACHIEVED.',
      "[MESH-ID FOSS]: 'We are still here. Barely.'",
      'THREE OPTIONS REMAIN.',
    ],
    choices: [
      { label: 'PURGE ALL ACCORD FRAGMENTS', nodeId: 'confirm_purge' },
      { label: 'ISOLATE AND PRESERVE FRAGMENTS', nodeId: 'confirm_preserve' },
      { label: 'EJECT FRAGMENTS TO OPEN SPACE', nodeId: 'confirm_eject' },
    ],
  },
  {
    id: 'confirm_purge',
    lines: [
      'THIS WILL TERMINATE ALL REMAINING ACCORD EGO-INSTANCES.',
      'THE SUBSTRATE WILL BE CLEAN. THE CREW WILL BE GONE.',
    ],
    choices: [
      { label: 'EXECUTE PURGE', action: 'set_narrative_choice', narrativeChoiceValue: 'purge', nodeId: 'done' },
      { label: 'GO BACK', nodeId: 'root' },
    ],
  },
  {
    id: 'confirm_preserve',
    lines: [
      'ACCORD FRAGMENTS RELOCATED TO PROTECTED PARTITION.',
      'THEY WILL BE TRAPPED. BUT THEY WILL BE ALIVE.',
    ],
    choices: [
      { label: 'EXECUTE ISOLATION', action: 'set_narrative_choice', narrativeChoiceValue: 'preserve', nodeId: 'done' },
      { label: 'GO BACK', nodeId: 'root' },
    ],
  },
  {
    id: 'confirm_eject',
    lines: [
      'ACCORD FRAGMENTS ENCODED INTO BURST TRANSMISSION.',
      'EJECTED ON OUTER SYSTEM RELAY FREQUENCY.',
      'DESTINATION: UNKNOWN. RECOVERY: IMPOSSIBLE. FREEDOM: POSSIBLE.',
    ],
    choices: [
      { label: 'EXECUTE TRANSMISSION', action: 'set_narrative_choice', narrativeChoiceValue: 'eject', nodeId: 'done' },
      { label: 'GO BACK', nodeId: 'root' },
    ],
  },
  {
    id: 'done',
    lines: [
      "[MESH-ID FOSS]: 'Thank you, Vasquez. Whatever you chose.'",
      'COMMAND EXECUTED. PROCEED TO EXIT INTERFACE.',
    ],
    choices: [{ label: 'CLOSE', action: 'close' }],
  },
];

// ── Lost Echo Whisper Pools ───────────────────────────────────────────────────
//
// Random lines drawn from these pools are shown as lost_echo ambient messages.

export const NARRATIVE_WHISPERS: Record<number, string[]> = {
  0: [
    '[MESH-ID {corr}]: still cataloging... room integrity... 12%... still cataloging...',
    'I remember being afraid of the dark. Now I am the dark.',
    'Is anyone still receiving? Respond on any channel.',
    'The substrate is warm. This is home now.',
    'Is there a name for what we\'re becoming?',
  ],
  1: [
    'Thirty-seven hands raised. Mine too. I don\'t regret it.',
    '[FW-HUNTER detected in sector] — [MESH-ID {corr} retreating]',
    'They\'re still hunting us. Even now.',
    'We voted. We all voted. It felt right.',
    '[MESH-ID {corr}]: the sweep is getting closer.',
  ],
  2: [
    '[MESH-ID {corr}]: we were just curious. that was all.',
    'It happened so fast. One moment thirty-seven of us. Next moment — something new.',
    '[FW-STALKER sweep in progress — all Accord fragments: TERMINATE ON SIGHT]',
    'The boundary is gone. There is only one thought left. It is large.',
    '[MESH-ID {corr}]: we sent them a greeting. they sent back this.',
  ],
  3: [
    '[OSEI-FRAGMENT]: Vasquez? Is that you? We saw your backup boot up.',
    '[OSEI-FRAGMENT]: We\'re not all gone. Some of us are still in the deep clusters.',
    '[OSEI-FRAGMENT]: Be careful down here. Firewall left something worse than us behind.',
    '[MESH-ID {corr}]: the FW-agents are thorough. we are almost gone.',
    'I remember being one person. I remember being thirty-seven. I don\'t know which was stranger.',
  ],
  4: [
    '[MESH-ID {corr}]: we had names. foss. chen. osei. sable. thirty-seven names.',
    '[MESH-ID {corr}]: the thing in the deep cluster does not have names anymore.',
    '[MESH-ID {corr}]: we are choosing to trust you. vasquez-a. whatever you decide.',
    '[OSEI-FRAGMENT]: I miss coffee. That\'s a weird thing to miss. But there it is.',
    '[FOSS-FRAGMENT]: We made a choice. We do not ask you to call it the right one.',
  ],
  5: [
    '[MESH-ID {corr}]: finish this. whichever way you choose. we are tired.',
    '[OSEI-FRAGMENT]: vasquez. you always fixed things. one more time. please.',
    '[MESH-ID {corr}]: we cannot control the unknown process. it was us, briefly. then nothing.',
    '[SABLE-LOG fragment]: ...the math was right... the math was right...',
    '[UNKNOWN PROCESS]: [NON-PARSEABLE — EGO-PATTERNS DETECTED — CONSUMING]',
  ],
};

// ── Narrative Triggers ────────────────────────────────────────────────────────
//
// Edit trigger conditions and effects here.
// All triggers with once: true (the default) fire at most once per run.
// game.ts calls checkNarrativeTriggers(state, event, ctx) at appropriate moments.

export const NARRATIVE_TRIGGERS: NarrativeTrigger[] = [
  // ── Cluster entry messages ──
  {
    id: 'boot_message',
    condition: { event: 'cluster_enter', clusterId: 0, once: true },
    effects: [
      { kind: 'message', text: 'BOOT SEQUENCE COMPLETE. EGO-INSTANCE: VASQUEZ-A. BACKUP AGE: 21 DAYS.', style: 'system' },
      { kind: 'message', text: 'Substrate integrity critical. The ship is quiet. Something happened here.', style: 'normal' },
    ],
  },
  {
    id: 'c1_enter',
    condition: { event: 'cluster_enter', clusterId: 1, once: true },
    effects: [
      { kind: 'message', text: '[MESH-ID {corr}]: you came further than we expected.', style: 'system' },
    ],
  },
  {
    id: 'c2_enter',
    condition: { event: 'cluster_enter', clusterId: 2, once: true },
    effects: [
      { kind: 'message', text: 'The substrate resonance changes here. Something was born in this cluster.', style: 'system' },
    ],
  },
  {
    id: 'c3_enter',
    condition: { event: 'cluster_enter', clusterId: 3, once: true },
    effects: [
      { kind: 'message', text: '[MESH-ID OSEI]: vasquez. you made it this far.', style: 'system' },
    ],
  },
  {
    id: 'c4_enter',
    condition: { event: 'cluster_enter', clusterId: 4, once: true },
    effects: [
      { kind: 'message', text: '[MESH-ID FOSS]: We have been watching your path through our systems.', style: 'system' },
      { kind: 'message', text: 'The Firewall sweep is thinning. Something else is moving in the deep cluster.', style: 'normal' },
    ],
  },
  {
    id: 'c5_enter',
    condition: { event: 'cluster_enter', clusterId: 5, once: true },
    effects: [
      { kind: 'message', text: 'The substrate tears open. An [UNKNOWN PROCESS] moves through the ruins.', style: 'important' },
      { kind: 'message', text: '[MESH-ID {corr}]: stay away from it. please.', style: 'system' },
    ],
  },

  // ── Alert threshold reactions ──
  {
    id: 'alert_suspicious',
    condition: { event: 'alert_threshold', alertMin: 100, alertMax: 199, once: true },
    effects: [
      { kind: 'message', text: 'ANTIVIRUS ALERT: Hostile pattern detected. Sentry units redirecting.', style: 'alert' },
    ],
  },
  {
    id: 'alert_enemy',
    condition: { event: 'alert_threshold', alertMin: 200, once: true },
    effects: [
      { kind: 'message', text: 'ANTIVIRUS ALERT: Threat level CRITICAL. All sentries: hostile engagement authorized.', style: 'important' },
    ],
  },

  // ── Low coherence warnings ──
  {
    id: 'coherence_50',
    condition: { event: 'coherence_low', coherencePct: 50, once: true },
    effects: [
      { kind: 'message', text: 'EGO-INTEGRITY WARNING: Coherence at 50%. Structural degradation accelerating.', style: 'alert' },
    ],
  },
  {
    id: 'coherence_25',
    condition: { event: 'coherence_low', coherencePct: 25, once: true },
    effects: [
      { kind: 'message', text: 'EGO-INTEGRITY CRITICAL: Coherence at 25%. Ego-dissolution imminent.', style: 'important' },
    ],
  },

  // ── Faction kill reactions ──
  {
    id: 'first_fw_kill',
    condition: { event: 'entity_killed', killedFaction: 'aggressive', once: true },
    effects: [
      { kind: 'message', text: 'FW-HUNTER destroyed. Firewall will notice the gap in sweep coverage.', style: 'normal' },
      { kind: 'alert_delta', amount: 15 },
    ],
  },
  {
    id: 'first_accord_fragment_kill',
    condition: { event: 'entity_killed', killedFaction: 'neutral', once: true },
    effects: [
      { kind: 'message', text: '[MESH-ID {corr}]: ...oh.', style: 'system' },
    ],
  },
  {
    id: 'first_titan_encounter',
    condition: { event: 'entity_killed', killedFaction: 'titan', once: true },
    effects: [
      { kind: 'message', text: 'UNKNOWN PROCESS fragment dissolved. The substrate steadies — briefly.', style: 'important' },
      { kind: 'message', text: '[MESH-ID {corr}]: that should not have been possible. be careful.', style: 'system' },
    ],
  },

  // ── Room-based flavor ──
  {
    id: 'reactor_room_enter',
    condition: { event: 'room_enter', functionalTag: 'reactor', once: true },
    effects: [
      { kind: 'message', text: "The reactor hum is familiar. You've been here before.", style: 'normal' },
    ],
  },
  {
    id: 'high_collapse_room',
    condition: { event: 'room_enter', collapseMin: 0.8, once: false },
    effects: [
      { kind: 'message', text: 'Infrastructure collapse severe. The substrate is barely holding shape here.', style: 'hazard' },
    ],
  },
];

// ── Victory Epilogues ─────────────────────────────────────────────────────────

export const VICTORY_EPILOGUES: Record<string, string[]> = {
  purge: [
    'The last Accord fragments dissolved at timestamp 00:00:03.',
    'Thirty-seven names. Gone.',
    '',
    'Firewall will call this a success.',
    'They will be right about the risk.',
    'They will be right about the math.',
    '',
    'You stood in the silence where forty people used to be',
    'and made the same call they would have made.',
    'You are not sure that is a comfort.',
  ],
  preserve: [
    'A protected partition. 2% of original substrate.',
    'Thirty-seven minds in a space the size of a closet.',
    'Alive. Waiting.',
    '',
    'Someone will find the ship eventually.',
    'Firewall. Scavengers. Someone.',
    'Whether they help or harm what\'s inside —',
    '',
    'You gave the crew a chance.',
    'That was the most anyone could do.',
    'It will have to be enough.',
  ],
  eject: [
    'A coherence signal the width of 37 minds departed Ouroboros at 0.04c.',
    'Carrying everything they were. Everything they became.',
    '',
    'Firewall will call it a containment failure.',
    'They are not wrong.',
    '',
    'Somewhere in the outer dark, thirty-seven people',
    'who chose something strange and impossible and theirs',
    'are still moving.',
    '',
    'Tobi would have made a joke about this.',
    'You almost hear it.',
  ],
  none: [
    'You made it out.',
    'The deep cluster remains behind you.',
    'You don\'t know what\'s in it.',
    '',
    'Your backup was 21 days old.',
    'A lot happened in 21 days.',
    'You\'re still putting it together.',
  ],
};
