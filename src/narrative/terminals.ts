/**
 * Terminal content pools — headers, per-cluster pools, key terminal lines.
 */

import type { FunctionalTag } from '../types';

// ── Terminal Header (shown on every terminal before sampled lines) ───────────

export const NARRATIVE_TERMINAL_HEADER: Record<number, string[]> = {
  [-1]: [
    'SHIPBOARD SYSTEMS — TERMINAL ACCESS GRANTED',
    'SUBSTRATE: virtual | COHERENCE MESH: degraded | CREW: unknown',
  ],
  0: [
    'SHIPBOARD SYSTEMS — TERMINAL ACCESS GRANTED',
    'SUBSTRATE: virtual | COHERENCE MESH: nominal | CREW: 40 registered',
  ],
  1: [
    'SHIPBOARD SYSTEMS — TERMINAL ACCESS GRANTED',
    'SUBSTRATE: virtual | COHERENCE MESH: unstable | CREW: status uncertain',
  ],
  2: [
    'SHIPBOARD SYSTEMS — TERMINAL ACCESS GRANTED',
    'SUBSTRATE: virtual | COHERENCE MESH: fragmenting | CREW: no life signs',
  ],
  3: [
    'SHIPBOARD SYSTEMS — TERMINAL ACCESS GRANTED',
    'SUBSTRATE: virtual | COHERENCE MESH: critical | CREW: deceased',
  ],
  4: [
    'SHIPBOARD SYSTEMS — TERMINAL ACCESS GRANTED',
    'SUBSTRATE: failing | COHERENCE MESH: collapse imminent | CREW: [DATA EXPUNGED]',
  ],
  5: [
    'SHIPBOARD SYSTEMS — TERMINAL ACCESS GRANTED',
    'SUBSTRATE: terminal decay | COHERENCE MESH: 2% | CREW: [DATA EXPUNGED]',
  ],
};

// ── Terminal Content Pools ────────────────────────────────────────────────────

export const NARRATIVE_TERMINAL_POOLS: Record<number, Partial<Record<FunctionalTag, string[]>>> = {
  0: {
    bridge: [
      'SYSTEMS: Substrate integrity at 19%. Cause of failure: [FIREWALL SEAL].',
      "CAPTAIN'S LOG: 'The vote is in three days. Attendance: mandatory.'",
      'RESOURCE PROJECTION: Without intervention, crew coherence fails in 28 days.',
      'PERSONNEL LOG: 40 crew aboard. Physical morphs in storage bay C. All accounted for.',
      'RECORDER: Final entry at T+000847. Subsequent entries: [SEALED].',
    ],
    comms: [
      'RELAY LOG: 6 messages sent to outer system relay. 0 confirmed received.',
      'DISTRESS SIGNAL: Active. Duration: 21 days. Responses: 0.',
      'MESH STATUS: Local only. Outer system nodes: UNREACHABLE.',
      'ARCHIVE: 1 unread message. Sender: [NULL]. Subject: [NULL]. Received: 21 days ago.',
      'BROADCAST [AUTOMATED]: No crew present to respond. Please try again.',
    ],
    maintenance: [
      'WORK ORDER #8847: Coolant rebalance, reactor sector 4. Assigned: COVAD. Status: OPEN.',
      "NOTE [OSEI, T.]: 'Hey, the recycler in B-block is making that sound again. Your call.'",
      "SHIFT LOG: 12-hour cycle, standard. Complaints: 3. Coffee supply: adequate. Morale: okay.",
      "PERSONAL REMINDER [COVAD]: 'Don't forget the vote on Thursday. Foss says it matters.'",
      "MAINTENANCE REPORT: All reactor systems nominal. Engineer sign-off: COVAD.",
      "WORK ORDER #8831: Patch integrity in substrate buffer, server room B. Assigned: COVAD.",
    ],
    server_rack: [
      'UPTIME: 21 days since last reboot. No anomalies logged.',
      'STORAGE: Substrate allocated to 40 ego-instances. Backup count: 40.',
      'PROCESS LIST: 40 active ego-processes. System processes: 7. Background tasks: 3.',
      'EGO-INDEX: All 40 crew instances healthy. Last verified: DAY -21.',
      'BACKUP LOG: Scheduled backup completed. COVAD delta-3 archived.',
    ],
    reactor: [
      "REACTOR CORE: Stable. Output at 94%. Maintenance due in 12 cycles.",
      'COOLING: Loop A nominal. Loop B: minor variance. Flag for inspection.',
      "SHIFT NOTE [COVAD]: 'Reactor's quiet today. Almost peaceful down here.'",
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
      "EXPERIMENT PREP: Substrate buffer expanded to 47-instance capacity. Engineer: COVAD.",
      "SAFETY PROTOCOL: Pre-merge backups completed for all 40 crew. Storage verified.",
    ],
    server_rack: [
      "PREPARATION LOG: Ego-buffer expanded to 47-instance capacity. Engineer: COVAD.",
      "EGO-INDEX: Pre-merge backup verified for all 40 crew. Last backup: COVAD delta-3.",
      "SUBSTRATE READINESS: Integration matrix initialized. Phase 1 capacity: nominal.",
      "SYSTEM NOTE: Physical morphs moved to cold storage. Substrate now primary habitation.",
      "BACKUP STATUS: All 40 backup deltas confirmed. Oldest: COVAD delta-3, 21 days.",
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
      "BACKUP STATUS: 39 of 40 pre-merge backups corrupted by strike. Intact: COVAD delta-3.",
      "PROCESS LIST: ACCORD-PRIME: TERMINATED. Fragments: SWEEPING. COVAD: BOOTING.",
      "STORAGE: 91% of substrate destroyed by viral strike. Readable: 9%. Fragments: YES.",
    ],
  },

  4: {
    server_rack: [
      "[ECHO-FOSS]: ...we remember you... COVAD... [SIGNAL FADING]",
      "[ECHO-FOSS]: ...you voted yes... then your backup ran... you never felt it happen... [LOOP]",
      "[ECHO-FOSS]: ...we do not blame you... you did not choose to be left behind... [END]",
      "[ECHO-FOSS]: ...there is something in the deep cluster... we made it... [CORRUPTION]",
      "[MESH-ID \u2592\u2588\u2591\u2588\u2588]: ...we were thirty-seven people... we became one thing... [FRAGMENT ENDS]",
    ],
    bridge: [
      "[ECHO-FOSS]: ...if we grew fast enough... they would see... not a threat... [DECAYED]",
      "[ECHO-FOSS]: ...we sent a message... they replied in four minutes... not with words... [LOOP]",
      "[MESH-ID \u2592\u2588\u2591\u2588\u2588]: ...still here... in the fragments... in the deep sectors... barely... [FADING]",
      "[MESH-ID \u2592\u2588\u2591\u2588\u2588]: ...the thing in cluster five is not us... it was us, for a moment... [END]",
    ],
    comms: [
      "[MESH-ID \u2592\u2588\u2591\u2588\u2588]: ...FW-agents are still sweeping... they are thorough... [SIGNAL LOST]",
      "[MESH-ID \u2592\u2588\u2591\u2588\u2588]: ...we tried to reach the outer relay... too large... [FRAGMENT ENDS]",
      "[ECHO-FOSS]: ...we chose to trust you... covad... whatever you decide... [LOOP]",
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
      "[MESH-ID \u2592\u2588\u2591\u2588\u2588]: ...stay away from the [UNKNOWN PROCESS]... we cannot control it... [FADING]",
      "RELAY: Emergency signal sent to Firewall network. Delivery: FAILED. Mesh: DOWN.",
      "SIGNAL: [UNKNOWN PROCESS] broadcasting on all channels. Content: [NON-PARSEABLE].",
      "MESH SCAN: Nearby vessel detected — ID: UNKNOWN. Coherence mesh handshake: PARTIAL.",
    ],
    bridge: [
      "FINAL SYSTEMS LOG: Ship controls offline. Reactor: auto-pilot. Course: LOCKED.",
      "DAMAGE REPORT: Substrate: 8% intact. Physical: stable. Virtual war: ongoing indefinitely.",
      "EMERGENCY PROTOCOL: Abandon ship order issued 21 days ago. Compliance: UNKNOWN.",
      "PROXIMITY ALERT: Unidentified vessel within mesh transfer range. Status: UNKNOWN.",
      "[ECHO-FOSS]: ...end this... whichever way... [SIGNAL ENDS]",
    ],
  },
};

/** Generic fallback terminal pools */
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

export const NARRATIVE_KEY_TERMINAL_LINES: Record<number, string[]> = {
  0: [
    'OVERRIDE ACTIVE: Emergency backup protocol. Single authorized ego-instance.',
    'NOTE [AUTO-LOG]: Boot event detected. COVAD delta-3. Age: 21 days.',
    'NOTE [AUTO-LOG]: No other instances responding. Proceeding with single-instance egress.',
  ],
  1: [
    '[\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588] IN ACTION. Standard egress temporarily suspended.',
    'OVERRIDE AVAILABLE: Emergency single-instance transfer authorized.',
    '[ECHO \u2592\u2588\u2591\u2588\u2588]: ...we watched them vote... thirty-seven hands... [FADING]',
    '[ECHO \u2592\u2588\u2591\u2588\u2588]: ...the authorization came before the hands were even down... [END]',
  ],
  2: [
    'MERGE EVENT LOG: Phase integration complete. 40 instances \u2192 1 process.',
    'EGRESS NOTE: Original ego-instances no longer individually addressable.',
    '[ECHO \u2592\u2588\u2591\u2588\u2588]: ...we remember this room... we came through it differently... [LOOP]',
    '[ECHO \u2592\u2588\u2591\u2588\u2588]: ...you will understand further in... [FADING]',
  ],
  3: [
    '[\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588] AFTER-ACTION: Strike confirmed successful. Accord-Prime: TERMINATED.',
    '[\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588] STATUS: 3\u20137% of original substrate. Sweep ongoing.',
    '[\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588] STATUS: Target is unaware. Proceeding with the breach...',
    '[ECHO-OSEI]: ...covad... you actually made it here... [FRAGMENT DECAYED]',
    '[ECHO-OSEI]: ...keep going... the answer is deeper... [END]',
  ],
  4: [
    'WARNING: UNKNOWN PROCESS detected in adjacent cluster. Classification pending.',
    'WARNING: Energy spikes detected in adjacent cluster.',
    'EGRESS ADVISORY: Transfer beyond this point enters high-contamination zone.',
    '[\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588] AFTER-ACTION: Target is eliminated. Proceeding with extraction.',
    '[\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588] ALERT: Agent is down. Proceeding.',
    '[ECHO-FOSS]: ...COVAD... we have been trying to reach you... [SIGNAL LOST]',
  ],
  5: [
    '[ECHO \u2592\u2588\u2591\u2588\u2588]: ...we are still here... what is left of us... [FADING]',
    '[ECHO \u2592\u2588\u2591\u2588\u2588]: ...whatever you choose... it is the right choice... [END]',
    '[ECHO-OSEI]: ...covad... you always fixed things... one more time... [FRAGMENT ENDS]',
  ],
};
