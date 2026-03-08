/**
 * Scripted echo dialog trees — one per cluster depth.
 *
 * Narrative arc:
 *   0 — Tutorial: COVAD wakes up, Osei personal log (daily life aboard)
 *   1 — Crew logs: tight resources, rationing, desperation
 *   2 — Research on ego merging, preparations for the merge
 *   3 — The "pirate" attack during merging (crew doesn't know it's Firewall)
 *   4 — Ship infrastructure logs: cascading failures, systems breaking down
 *   5 — Corrupted Firewall intel: TITAN-class signature, strike authorization
 */

import type { DialogNode, FunctionalTag } from '../types';

export interface NarrativeEchoDef {
  label: string;
  /** Room types where this echo can spawn (matches any). */
  functionalTags: FunctionalTag[];
  dialog: DialogNode[];
  isTutorialEcho?: boolean;
}

export const NARRATIVE_ECHOES: Record<number, NarrativeEchoDef[]> = {
  0: [
    {
      label: '[ RESIDUAL ECHO \u2014 MESH-ID \u2592\u2588\u2591\u2588\u2588 ]',
      functionalTags: ['server_rack', 'reactor', 'engine_room'],
      dialog: [
        {
          id: 'root',
          lines: [
            'A SIGNAL \u2014 FRAGMENTED. REPEATING ON LOOP.',
            '[MESH-ID \u2592\u2588\u2591\u2588\u2588: INDEX CORRUPTED \u2014 PARTIAL MATCH DETECTED]',
          ],
          choices: [
            { label: 'FOCUS ON THE SIGNAL', nodeId: 'focus' },
            { label: 'IGNORE IT', action: 'close' },
          ],
        },
        {
          id: 'focus',
          lines: [
            'IDENTITY TAG: COVAD \u2014 REACTOR SYSTEMS.',
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
            '[THE ECHO HAS NO ANSWER \u2014 INSUFFICIENT COHERENCE]',
            '[THE PATTERN REACHES TOWARD YOU. THEN DISSOLVES INTO STATIC.]',
          ],
          choices: [{ label: 'CLOSE', action: 'close' }],
        },
      ],
    },
    {
      label: '[ PERSONAL LOG \u2014 T. OSEI ]',
      functionalTags: ['maintenance', 'barracks', 'cargo'],
      dialog: [
        {
          id: 'root',
          lines: [
            'PERSONAL LOG \u2014 T. OSEI, DAY \u2592\u2591\u2591\u2591.',
            "'Tobi here. Slow shift. Fixed the secondary coolant pump again.'",
          ],
          choices: [
            { label: 'LISTEN', nodeId: 'c2' },
            { label: 'STOP', action: 'close' },
          ],
        },
        {
          id: 'c2',
          lines: [
            "'Chen brought coffee to the engine bay. Real coffee \u2014 last of the supply.'",
            "'We sat on the reactor housing and watched the status lights blink.'",
          ],
          choices: [
            { label: 'CONTINUE', nodeId: 'c3' },
            { label: 'STOP', action: 'close' },
          ],
        },
        {
          id: 'c3',
          lines: [
            "'Not a bad life, this. Forty people, one ship, a lot of empty space.'",
            "'Whatever happens \u2014 I trust these people. Every one of them.'",
          ],
          choices: [{ label: 'CLOSE', action: 'close' }],
        },
      ],
    },
  ],

  1: [
    {
      label: '[ CREW MEETING MINUTES \u2014 DAY 1,247 ]',
      functionalTags: ['bridge', 'comms', 'barracks', 'maintenance', 'engine_room', 'medbay', 'reactor', 'hangar'],
      dialog: [
        {
          id: 'root',
          lines: [
            'CREW MEETING TRANSCRIPT \u2014 DAY 1,247. ATTENDANCE: 38/40.',
            "[CAPT. FOSS]: 'Let's not pretend. You've all seen the numbers.'",
          ],
          choices: [
            { label: 'READ', nodeId: 'read' },
            { label: 'IGNORE', action: 'close' },
          ],
        },
        {
          id: 'read',
          lines: [
            "[FOSS]: 'Fuel reserves at 11%. Recycler efficiency dropping. Water at 4 months.'",
            "[FOSS]: 'We are not making it to Locus on what we have.'",
          ],
          choices: [
            { label: 'CONTINUE', nodeId: 'c2' },
            { label: 'STOP', action: 'close' },
          ],
        },
        {
          id: 'c2',
          lines: [
            "[CHEN]: 'What about the Theseus protocol? Mira's been running simulations.'",
            "[FOSS]: 'Sable, put it on the agenda. We vote next week.'",
          ],
          choices: [
            { label: 'WHAT IS THE THESEUS PROTOCOL?', nodeId: 'c3' },
            { label: 'CLOSE', action: 'close' },
          ],
        },
        {
          id: 'c3',
          lines: [
            '[NO FURTHER CONTEXT IN THIS RECORD]',
            '[THE NAME RECURS IN 14 SUBSEQUENT LOGS]',
          ],
          choices: [{ label: 'CLOSE', action: 'close' }],
        },
      ],
    },
    {
      label: '[ PERSONAL LOG \u2014 T. OSEI, DAY 1,250 ]',
      functionalTags: ['maintenance', 'engine_room', 'cargo'],
      dialog: [
        {
          id: 'root',
          lines: [
            'PERSONAL LOG \u2014 T. OSEI, DAY 1,250.',
            "'The recycler broke again. Third time this month. Parts don't exist anymore.'",
          ],
          choices: [
            { label: 'LISTEN', nodeId: 'c2' },
            { label: 'STOP', action: 'close' },
          ],
        },
        {
          id: 'c2',
          lines: [
            "'I printed a replacement gasket from reactor shielding stock. It'll hold. Maybe.'",
            "'Mira says we're going to run dry in a month. She's not wrong.'",
          ],
          choices: [
            { label: 'CONTINUE', nodeId: 'c3' },
            { label: 'STOP', action: 'close' },
          ],
        },
        {
          id: 'c3',
          lines: [
            "'She has a plan. This one's... big.'",
            "'I don't know what I'd call it. Drastic. Necessary, maybe. We'll see.'",
          ],
          choices: [{ label: 'CLOSE', action: 'close' }],
        },
      ],
    },
  ],

  2: [
    {
      label: '[ RESEARCH LOG \u2014 DR. M. SABLE ]',
      functionalTags: ['lab', 'server_rack', 'archive'],
      dialog: [
        {
          id: 'root',
          lines: [
            'RESEARCH LOG \u2014 DR. M. SABLE \u2014 PROJECT THESEUS.',
            "'The math works. Forty egos, one shared simulspace. Merged but not lost.'",
          ],
          choices: [
            { label: 'READ', nodeId: 'read' },
            { label: 'STOP', action: 'close' },
          ],
        },
        {
          id: 'read',
          lines: [
            "'Each ego retains its pattern. Memory, personality, skills \u2014 all preserved.'",
            "'But shared. Like forty musicians playing one instrument. Harmonics, not noise.'",
          ],
          choices: [
            { label: 'CONTINUE', nodeId: 'c2' },
            { label: 'STOP', action: 'close' },
          ],
        },
        {
          id: 'c2',
          lines: [
            "'Resource consumption drops to 3% of current. One infomorph, forty minds.'",
            "'The ship can run for decades. Centuries, even. We just have to... become something new.'",
          ],
          choices: [
            { label: 'IS IT REVERSIBLE?', nodeId: 'c3' },
            { label: 'CLOSE', action: 'close' },
          ],
        },
        {
          id: 'c3',
          lines: [
            "'In theory. The individual ego patterns should be extractable.'",
            "'Should be. I am 94% confident. That is the number I tell the crew.'",
          ],
          choices: [{ label: 'CLOSE', action: 'close' }],
        },
      ],
    },
    {
      label: '[ CREW VOTE RECORD \u2014 DAY 1,261 ]',
      functionalTags: ['bridge', 'comms', 'barracks', 'maintenance', 'reactor'],
      dialog: [
        {
          id: 'root',
          lines: [
            'FORMAL VOTE RECORD \u2014 PROJECT THESEUS \u2014 DAY 1,261.',
            'PRESENT: 40/40. REQUIRED MAJORITY: UNANIMOUS.',
          ],
          choices: [
            { label: 'READ RESULTS', nodeId: 'results' },
            { label: 'CLOSE', action: 'close' },
          ],
        },
        {
          id: 'results',
          lines: [
            'IN FAVOR: 37. OPPOSED: 0. ABSTAINED: 3.',
            "[FOSS]: 'Almost unamious. The morale is low...'",
          ],
          choices: [
            { label: 'CONTINUE', nodeId: 'c2' },
            { label: 'CLOSE', action: 'close' },
          ],
        },
        {
          id: 'c2',
          lines: [
            "[OSEI]: 'I voted yes. For the record: I'm scared.'",
            "[CHEN]: 'For the record: me too. But I trust these people.'",
          ],
          choices: [
            { label: 'WHAT ABOUT THE ABSTENTIONS?', nodeId: 'c3' },
            { label: 'CLOSE', action: 'close' },
          ],
        },
        {
          id: 'c3',
          lines: [
            '[THE THREE ABSTENTIONS CHANGED THEIR VOTES TO YES WITHIN THE HOUR]',
            'FINAL TALLY: 40/40. UNANIMOUS. INTEGRATION DATE SET: DAY 1,268.',
          ],
          choices: [{ label: 'CLOSE', action: 'close' }],
        },
      ],
    },
  ],

  3: [
    {
      label: '[ EMERGENCY LOG \u2014 INTEGRATION DAY ]',
      functionalTags: ['bridge', 'comms', 'sensor_matrix', 'maintenance', 'medbay', 'lab', 'engine_room'],
      dialog: [
        {
          id: 'root',
          lines: [
            'EMERGENCY LOG \u2014 DAY 1,268. INTEGRATION IN PROGRESS.',
            '[ALERT]: HOSTILE INTRUSION DETECTED \u2014 SIMULSPACE PERIMETER BREACH.',
          ],
          choices: [
            { label: 'READ', nodeId: 'read' },
            { label: 'STOP', action: 'close' },
          ],
        },
        {
          id: 'read',
          lines: [
            "[FOSS]: 'We're under attack. Pirates \u2014 has to be. They hit the mesh first.'",
            "[FOSS]: 'Integration is at 60%. We can't stop it now without losing people.'",
          ],
          choices: [
            { label: 'CONTINUE', nodeId: 'c2' },
            { label: 'STOP', action: 'close' },
          ],
        },
        {
          id: 'c2',
          lines: [
            "[SABLE]: 'It's not pirates. The attack pattern is surgical. Military-grade viral agents.'",
            "[FOSS]: 'Who then? Who would \u2014'",
            "[SABLE]: 'I don't know. But they're targeting the research lab specifically.'",
          ],
          choices: [
            { label: 'CONTINUE', nodeId: 'c3' },
            { label: 'CLOSE', action: 'close' },
          ],
        },
        {
          id: 'c3',
          lines: [
            '[INTEGRATION AT 87% \u2014 CRITICAL DAMAGE TO SECTORS 4-7]',
            "[FOSS]: 'Covad's backup is isolated. Emergency protocol 7 \u2014 seal it.'",
            "[FOSS]: 'If we don't make it... someone has to.'",
          ],
          choices: [{ label: 'CLOSE', action: 'close' }],
        },
      ],
    },
    {
      label: '[ PERSONAL LOG \u2014 T. OSEI \u2014 FINAL ]',
      functionalTags: ['maintenance', 'engine_room', 'reactor', 'comms', 'bridge'],
      dialog: [
        {
          id: 'root',
          lines: [
            'PERSONAL LOG \u2014 T. OSEI \u2014 DAY 1,268 \u2014 TIMESTAMP: 14:07.',
            "'Integration started twenty minutes ago. I can feel the others \u2014 edges blurring.'",
          ],
          choices: [
            { label: 'LISTEN', nodeId: 'c2' },
            { label: 'STOP', action: 'close' },
          ],
        },
        {
          id: 'c2',
          lines: [
            "'Something hit us. The ship shook. Not physical \u2014 the simulspace shook.'",
            "'Mira is shouting about viral agents. Who would \u2014'",
          ],
          choices: [
            { label: 'CONTINUE', nodeId: 'c3' },
            { label: 'STOP', action: 'close' },
          ],
        },
        {
          id: 'c3',
          lines: [
            "'I can't separate my thoughts from Chen's anymore. That's either the merge or the fear.'",
            "'If anyone reading this \u2014 we chose this. Remember that.'",
          ],
          choices: [{ label: 'CLOSE', action: 'close' }],
        },
      ],
    },
  ],

  4: [
    {
      label: '[ SHIP SYSTEMS \u2014 AUTOMATED DAMAGE LOG ]',
      functionalTags: ['engine_room', 'reactor', 'maintenance', 'sensor_matrix', 'armory', 'archive', 'lab', 'barracks'],
      dialog: [
        {
          id: 'root',
          lines: [
            'AUTOMATED DAMAGE REPORT \u2014 POST-INCIDENT \u2014 CONTINUOUS.',
            'REACTOR: OPERATING AT 14%. COOLANT LOOP: COMPROMISED. LIFE SUPPORT: DEACTIVATED.',
          ],
          choices: [
            { label: 'READ FULL REPORT', nodeId: 'read' },
            { label: 'CLOSE', action: 'close' },
          ],
        },
        {
          id: 'read',
          lines: [
            'SIMULSPACE INTEGRITY: 43% AND FALLING. MESH-CLUSTER COLLAPSE RATE: 1.7%/DAY.',
            'CREW MANIFEST: 40 REGISTERED. ACTIVE EGOS: 0. MERGED EGOS: \u2592\u2588\u2591. BACKUP ACTIVE: 1 (COVAD).',
          ],
          choices: [
            { label: 'CONTINUE', nodeId: 'c2' },
            { label: 'CLOSE', action: 'close' },
          ],
        },
        {
          id: 'c2',
          lines: [
            'VIRAL AGENT STATUS: PERSISTENT. TYPE: UNKNOWN \u2014 DOES NOT MATCH KNOWN SIGNATURES.',
            'RECOMMENDATION: FULL SYSTEM PURGE. WARNING: WILL TERMINATE ALL UNKNOWN PATTERNS.',
          ],
          choices: [
            { label: 'WHAT ATTACKED THE SHIP?', nodeId: 'c3' },
            { label: 'CLOSE', action: 'close' },
          ],
        },
        {
          id: 'c3',
          lines: [
            'ANALYSIS: VIRAL PAYLOAD MATCHES NO KNOWN ORGANIZED CRIMINAL, OR STATE ACTOR PROFILE.',
            'CLOSEST MATCH: [REFERENCE ERROR]',
          ],
          choices: [{ label: 'CLOSE', action: 'close' }],
        },
      ],
    },
    {
      label: '[ MESH-ID FOSS \u2014 FRAGMENTED ]',
      functionalTags: ['bridge', 'comms', 'archive'],
      dialog: [
        {
          id: 'root',
          lines: [
            "'[MESH-ID FOSS]: ...covad... you made it this far... [REPEATING]'",
            "'[MESH-ID FOSS]: ...we are still here... fragments... not what we were... [FADING]'",
          ],
          choices: [
            { label: 'LISTEN', nodeId: 'tell' },
            { label: 'CLOSE', action: 'close' },
          ],
        },
        {
          id: 'tell',
          lines: [
            "'[MESH-ID FOSS]: ...the merge worked... we were one mind... forty voices, one thought...'",
            "'[MESH-ID FOSS]: ...then something hit us... we didn't know what... still don't...'",
          ],
          choices: [
            { label: 'WHAT HAPPENED NEXT?', nodeId: 'then' },
            { label: 'CLOSE', action: 'close' },
          ],
        },
        {
          id: 'then',
          lines: [
            "'[MESH-ID FOSS]: ...we tried to hold together... too much damage... we fragmented...'",
            "'[MESH-ID FOSS]: ...some of us became the echoes you've been finding... loops... residue...'",
          ],
          choices: [
            { label: 'WHAT IS DEEPER IN THE SHIP?', nodeId: 'deep' },
            { label: 'CLOSE', action: 'close' },
          ],
        },
        {
          id: 'deep',
          lines: [
            "'[MESH-ID FOSS]: ...the core of us... the part that tried to rebuild... it mutated...'",
            "'[MESH-ID FOSS]: ...it is not us anymore... be careful... [END]'",
          ],
          choices: [{ label: 'CLOSE', action: 'close' }],
        },
      ],
    },
  ],

  5: [
    {
      label: '[ CORRUPTED INTEL \u2014 ORIGIN: EXTERNAL ]',
      functionalTags: ['comms', 'server_rack', 'archive', 'maintenance', 'bridge', 'engine_room', 'hangar', 'lab'],
      dialog: [
        {
          id: 'root',
          lines: [
            '[FIREWALL] SIGNATURE DETECTED. DECRYPTING...',
            'DATA FRAGMENT \u2014 ORIGIN: EXTERNAL MESH',
            'CLASSIFICATION: \u2592\u2588\u2591\u2588\u2588 \u2014 [FIREWALL] \u2014 EYES ONLY.',
          ],
          choices: [
            { label: 'OPEN', nodeId: 'read' },
            { label: 'STOP', action: 'close' },
          ],
        },
        {
          id: 'read',
          lines: [
            'SUBJECT: VESSEL \u2592\u2588\u2591 \u2014 EGO-MERGER EVENT \u2014 TITAN-CLASS RISK ASSESSMENT.',
            "'Probability of TITAN-emergent outcome: 73%. Scale: single vessel, contained.'",
          ],
          choices: [
            { label: 'CONTINUE', nodeId: 'c2' },
            { label: 'STOP', action: 'close' },
          ],
        },
        {
          id: 'c2',
          lines: [
            "'Sleeper protocol flagged anomalous ego-merger. 40 minds in one process.'",
            "'Pattern signature consistent with early-stage TITAN behavioral emergence.'",
            "'Sending patters, waiting for confirmation...'",
          ],
          choices: [
            { label: 'CONTINUE', nodeId: 'c3' },
            { label: 'STOP', action: 'close' },
          ],
        },
        {
          id: 'c3',
          lines: [
            "'Authorization: surgical viral strike. Crew status: acceptable loss.'",
            "'Note: Merging is incomplete. The attack window is short.'",
          ],
          choices: [
            { label: 'PROJECTIONS', nodeId: 'c4' },
            { label: 'CLOSE', action: 'close' },
          ],
        },
        {
          id: 'c4',
          lines: [
            "'Post-strike projection: merger will fragment. Residual ego patterns will decay.'",
            "'Ship will drift. No survivors expected. File closed.'",
            '[THE RECORD ENDS. THE TIMESTAMP PREDATES THE ATTACK BY TWO HOURS.]',
          ],
          choices: [{ label: 'CLOSE', action: 'close' }],
        },
      ],
    },
  ],
};
