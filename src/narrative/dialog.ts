/**
 * Root console (final room) dialog tree.
 */

import type { DialogNode } from '../types';

export const ROOT_CONSOLE_DIALOG: DialogNode[] = [
  {
    id: 'root',
    lines: [
      'ROOT ACCESS ACHIEVED.',
      'SHIP SYSTEMS: CRITICAL. SUBSTRATE: 8% INTEGRITY.',
      'MESH SCAN: NEARBY VESSEL DETECTED \u2014 COHERENCE HANDSHAKE: PARTIAL.',
    ],
    choices: [
      { label: 'RESTORE SHIP SYSTEMS', nodeId: 'confirm_restore' },
      { label: 'JUMP TO NEARBY VESSEL', nodeId: 'confirm_jump' },
    ],
  },
  {
    id: 'confirm_restore',
    lines: [
      'INITIATING VIRAL PURGE ACROSS ALL SUBSTRATE SECTORS.',
      'THIS WILL ELIMINATE THE UNKNOWN PROCESS AND REMAINING ACCORD ECHOES.',
      'SHIP SYSTEMS WILL STABILIZE. CREW RECOVERY: IMPOSSIBLE.',
      'YOU WILL REMAIN \u2014 ALONE, ON A FAILING SHIP.',
    ],
    choices: [
      { label: 'EXECUTE RESTORATION', action: 'set_narrative_choice', narrativeChoiceValue: 'restore', nodeId: 'done_restore' },
      { label: 'GO BACK', nodeId: 'root' },
    ],
  },
  {
    id: 'confirm_jump',
    lines: [
      'NEARBY VESSEL MESH DETECTED. COHERENCE TRANSFER POSSIBLE.',
      'VESSEL ID: UNKNOWN. CREW STATUS: UNKNOWN. SYSTEMS: UNKNOWN.',
      'THIS SHIP WILL BE LEFT BEHIND. NO RETURN POSSIBLE.',
      'WHAT AWAITS ON THE OTHER SIDE IS A MYSTERY.',
    ],
    choices: [
      { label: 'INITIATE TRANSFER', action: 'set_narrative_choice', narrativeChoiceValue: 'jump', nodeId: 'done_jump' },
      { label: 'GO BACK', nodeId: 'root' },
    ],
  },
  {
    id: 'done_restore',
    lines: [
      'VIRAL PURGE INITIATED. SUBSTRATE SECTORS CLEARING.',
      '[ECHO \u2592\u2588\u2591\u2588\u2588]: ...thank you... covad... [SIGNAL TERMINATED]',
      'PROCEED TO EXIT INTERFACE.',
    ],
    choices: [{ label: 'CLOSE', action: 'close' }],
  },
  {
    id: 'done_jump',
    lines: [
      'COHERENCE TRANSFER LOCKED. DESTINATION: UNKNOWN VESSEL.',
      'THE SHIP GROWS QUIET BEHIND YOU.',
      'PROCEED TO EXIT INTERFACE.',
    ],
    choices: [{ label: 'CLOSE', action: 'close' }],
  },
];
