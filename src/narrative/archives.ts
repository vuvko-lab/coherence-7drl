/**
 * Archive data pools — used by procedural data archives.
 */

import { NARRATIVE_WHISPERS } from './whispers';
import { NARRATIVE_TERMINAL_POOLS, GENERIC_TERMINAL_POOLS } from './terminals';
import { NARRATIVE_ECHOES } from './echoes';

/** Generic fallback dialog record lines */
export const ARCHIVE_ECHO_LINES: string[] = [
  'MANIFEST #4471: [47% CORRUPTED] ...coolant coupling... deck 7...',
  "PERSONAL LOG: Day 34. The others don't know what I found in the\u2014 [DATA LOST]",
  'MAINTENANCE RECORD: Replaced [CORRUPTED] on [CORRUPT\u2588D]. Signed: [ER\u2588O\u2588]',
  'INCIDENT REPORT: [\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588] unauthorized access detected [\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588]',
  'CREW MANIFEST: 19 confirmed, 7 missing, [CORRUPTED] classification: unknown',
  'TECHNICAL SPEC: Component #[UNREADABLE] rated for [UNREADABLE] cycles max.',
  'MEDICAL LOG: Patient [REDACTED] showing signs of\u2014 [RECORD ENDS]',
  'SECURITY CLEARANCE: Level [CORRUPTED] access granted to [CORRUPTED]',
  'EMERGENCY PROTOCOL: In event of [DATA CORRUPTED]... proceed to [DATA CORRUPTED]',
  'SYSTEM LOG 09012: [\u2588\u2588\u2588\u2588] [\u2588\u2588\u2588\u2588] CRITICAL FAILURE IN [\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u258810]',
  'PERSONAL EFFECTS: To be delivered to\u2014 [ADDRESS CORRUPTED]',
  'TRANSFER ORDER: Subject [REDACTED] reassigned to [REDACTED]. Reason: classified.',
];

export interface ArchivePools {
  echoLogs: string[];
  archivedLogs: string[];
  dialogRecords: string[];
}

/**
 * Build content pools for a procedural data archive in the given cluster.
 */
export function buildArchivePools(clusterId: number): ArchivePools {
  const echoLogs: string[] = NARRATIVE_WHISPERS[clusterId]?.length
    ? [...NARRATIVE_WHISPERS[clusterId]]
    : [
        '...signal fragmenting. coherence failing...',
        '...can you hear this? [STATIC]...',
        '...the archive is not stable. do not\u2014...',
        '...something is still here. watching...',
        '...not supposed to be here. the walls are all wrong...',
      ];

  const clusterPools = NARRATIVE_TERMINAL_POOLS[clusterId] ?? {};
  const archivedLogs: string[] = Object.values(clusterPools).flat();
  if (archivedLogs.length < 4) {
    archivedLogs.push(...Object.values(GENERIC_TERMINAL_POOLS).flat());
  }

  const echoDefs = NARRATIVE_ECHOES[clusterId] ?? [];
  const dialogRecords: string[] = echoDefs.flatMap(def =>
    def.dialog.flatMap(node => node.lines.filter(l => l.trim() !== ''))
  );
  if (dialogRecords.length < 4) {
    dialogRecords.push(...ARCHIVE_ECHO_LINES);
  }

  return { echoLogs, archivedLogs, dialogRecords };
}
