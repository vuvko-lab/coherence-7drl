/**
 * Root console (final room) dialog tree.
 */

import type { DialogNode } from '../types';

export const ROOT_CONSOLE_DIALOG: DialogNode[] = [
  {
    id: 'root',
    lines: [
      'ROOT ACCESS ACHIEVED.',
      'SHIP SYSTEMS: CRITICAL. SIMULSPACE: 8% INTEGRITY.',
      'MESH SCAN: NEW NETWORK DETECTED \u2014 COHERENCE HANDSHAKE: PARTIAL.',
      'MESH SCAN: NEW MESH-NETWORK CONNECTED. VESSEL "COPPER" IDENTIFIED.'
    ],
    choices: [
      { label: 'RESTORE SHIP SYSTEMS', nodeId: 'confirm_restore' },
      { label: 'EGOCAST TO NEARBY VESSEL', nodeId: 'confirm_jump' },
    ],
  },
  {
    id: 'confirm_restore',
    lines: [
      'INITIATING VIRAL PURGE ACROSS ALL SIMULSPACE SECTORS.',
      'THIS WILL ELIMINATE THE UNIDENTIFIED PROCESSES.',
      'SHIP SYSTEMS WILL STABILIZE. CREW BACKUP RECOVERY: UNKNOWN.',
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
      'VESSEL ID: "COPPER". CREW STATUS: UNKNOWN. SYSTEMS: FUNCTIONAL.',
      'THIS SHIP WILL BE LEFT BEHIND. RETURN POSSIBILITY: UNLIKELY.',
    ],
    choices: [
      { label: 'INITIATE EGOCASTING', action: 'set_narrative_choice', narrativeChoiceValue: 'jump', nodeId: 'done_jump' },
      { label: 'GO BACK', nodeId: 'root' },
    ],
  },
  {
    id: 'done_restore',
    lines: [
      'VIRAL PURGE INITIATED. SIMULSPACE SECTORS CLEARING.',
      '[ECHO \u2592\u2588\u2591\u2588\u2588]: ...thank you... [SIGNAL TERMINATED]',
      'PROCEED TO EXIT INTERFACE.',
    ],
    choices: [{ label: 'CLOSE', action: 'close' }],
  },
  {
    id: 'done_jump',
    lines: [
      'COHERENCE TRANSFER LOCKED. DESTINATION: VESSEL "COPPER".',
      'THE SHIP GROWS QUIET BEHIND YOU.',
      'PROCEED TO EXIT INTERFACE.',
    ],
    choices: [{ label: 'CLOSE', action: 'close' }],
  },
];
