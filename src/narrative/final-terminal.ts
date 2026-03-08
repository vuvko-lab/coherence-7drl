/**
 * Final terminal confirmation lines shown after the player chooses restore or jump.
 */

export const FINAL_TERMINAL_CONFIRM: Record<'restore' | 'jump', string[]> = {
  restore: [
    'VIRAL PURGE INITIATED.',
    'SIMULSPACE SECTORS CLEARING.',
    '',
    'PROCEED TO EXIT INTERFACE.',
  ],
  jump: [
    'COHERENCE TRANSFER LOCKED.',
    'DESTINATION: NEARBY VESSEL "COPPER".',
    '',
    'PROCEED TO EXIT INTERFACE.',
  ],
};
