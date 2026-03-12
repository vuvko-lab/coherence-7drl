/**
 * Narrative module — re-exports all narrative content.
 */

export {
  NARRATIVE_TERMINAL_HEADER, NARRATIVE_TERMINAL_POOLS, GENERIC_TERMINAL_POOLS, NARRATIVE_KEY_TERMINAL_LINES,
  TERMINAL_LABELS, TERMINAL_CONTENT_POOLS, FALLBACK_CONTENT, KEY_CONTENT_LINES,
  HAZARD_DISPLAY_NAMES, HAZARD_DEACTIVATION_LINES,
  INFO_LINES, LOST_ECHO_LINES, LOST_ECHO_WARNING_LINES,
} from './terminals';
export { NARRATIVE_ECHOES } from './echoes';
export type { NarrativeEchoDef } from './echoes';
export { NARRATIVE_WHISPERS } from './whispers';
export { ROOT_CONSOLE_DIALOG } from './dialog';
export { ARCHIVE_ECHO_LINES, buildArchivePools } from './archives';
export type { ArchivePools } from './archives';
export { NARRATIVE_TRIGGERS } from './triggers';
export { VICTORY_EPILOGUES } from './epilogues';
export { GAME_MESSAGES } from './messages';
