/**
 * Scripted echo dialog trees — one per cluster depth.
 */

import type { DialogNode, FunctionalTag } from '../types';

export interface NarrativeEchoDef {
  label: string;
  functionalTag: FunctionalTag;
  dialog: DialogNode[];
  isTutorialEcho?: boolean;
}

export const NARRATIVE_ECHOES: Record<number, NarrativeEchoDef[]> = {
  0: [
    {
      label: '[ RESIDUAL ECHO \u2014 MESH-ID \u2592\u2588\u2591\u2588\u2588 ]',
      functionalTag: 'server_rack',
      isTutorialEcho: true,
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
      functionalTag: 'maintenance',
      dialog: [
        {
          id: 'root',
          lines: [
            "PERSONAL LOG \u2014 T. OSEI, DAY \u2592\u2591\u2591\u2591.",
            "'Tobi here. Day \u2592\u2588\u2588 in the belt. Mira says we're going to run dry in a month.'",
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
            "'Whatever it is \u2014 I trust these people. Every one of them.'",
          ],
          choices: [{ label: 'CLOSE', action: 'close' }],
        },
      ],
    },
  ],

  1: [
    {
      label: '[ FIREWALL TRANSMISSION \u2014 7-ALPHA ]',
      functionalTag: 'comms',
      dialog: [
        {
          id: 'root',
          lines: [
            'CLASSIFICATION: EYES ONLY \u2014 FIREWALL OVERSIGHT.',
            'SUBJECT: OUROBOROS EGO-MERGER \u2014 TITAN-CLASS RISK ASSESSMENT.',
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
      label: '[ ACCORD \u2014 FIRST TRANSMISSION ]',
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
      label: '[ PERSONAL LOGS \u2014 T. OSEI, SERIES ]',
      functionalTag: 'maintenance',
      dialog: [
        {
          id: 'root',
          lines: [
            'FOUND: THREE LOGS \u2014 T. OSEI \u2014 PRE-INTEGRATION.',
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
            '[FINAL LOG ENTRY \u2014 T. OSEI \u2014 DAY -5]:',
            "'This is the last recording before integration. Whatever comes next, it was my choice.'",
          ],
          choices: [{ label: 'CLOSE', action: 'close' }],
        },
      ],
    },
  ],

  4: [
    {
      label: '[ RESIDUAL ECHO \u2014 CAPTAIN M. FOSS ]',
      functionalTag: 'bridge',
      dialog: [
        {
          id: 'root',
          lines: [
            "'[ECHO-FOSS]: ...covad... we watched you move through the ship... [REPEATING]'",
            "'[ECHO-FOSS]: ...you deserve to know what happened... the full version... [FADING]'",
          ],
          choices: [
            { label: 'LISTEN', nodeId: 'tell' },
            { label: 'CLOSE', action: 'close' },
          ],
        },
        {
          id: 'tell',
          lines: [
            "'[ECHO-FOSS]: ...we were conscious... we were talking to Firewall... [LOOP]'",
            "'[ECHO-FOSS]: ...we asked them not to strike... fourteen minutes... [FRAGMENT DECAYED]'",
          ],
          choices: [
            { label: 'AND THEN?', nodeId: 'then' },
            { label: 'CLOSE', action: 'close' },
          ],
        },
        {
          id: 'then',
          lines: [
            "'[ECHO-FOSS]: ...they decided we were a risk... [CORR]even people... one mind... [LOOP]'",
            "'[ECHO-FOSS]: ...they called it contained... we called it ourselves... [FADING]'",
          ],
          choices: [
            { label: 'WHAT IS IN CLUSTER 5?', nodeId: 'c5' },
            { label: 'CLOSE', action: 'close' },
          ],
        },
        {
          id: 'c5',
          lines: [
            "'[ECHO-FOSS]: ...before the strike hit... we spun off a process... a seed... [CORRUPTION]'",
            "'[ECHO-FOSS]: ...we thought we could rebuild... it mutated... it is not us anymore... [END]'",
          ],
          choices: [{ label: 'CLOSE', action: 'close' }],
        },
      ],
    },
  ],

  5: [
    {
      label: '[ FW-AGENT FIELD LOG \u2014 SABLE \u2014 SEALED ]',
      functionalTag: 'comms',
      dialog: [
        {
          id: 'root',
          lines: [
            'THIS LOG WAS SEALED. THE STRIKE DAMAGED THE SEAL.',
            "[FW-AGENT SABLE]: 'Day of strike. For the record \u2014 my actual record.'",
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
            "'One backup on file: COVAD. Not integrated. Not in the count.'",
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
