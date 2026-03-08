/**
 * Narrative triggers — cluster entry messages, alert reactions, kill reactions.
 */

import type { NarrativeTrigger } from '../types';

export const NARRATIVE_TRIGGERS: NarrativeTrigger[] = [
  // ── Cluster entry messages ──
  // {
  //   id: 'boot_message',
  //   condition: { event: 'cluster_enter', clusterId: 0, once: true },
  //   effects: [
  //     { kind: 'message', text: 'BOOT SEQUENCE COMPLETE. EGO-INSTANCE: COVAD. BACKUP AGE: 21 DAYS.', style: 'system' },
  //     { kind: 'message', text: 'Simulspace integrity critical. The ship is quiet. Something happened here.', style: 'normal' },
  //   ],
  // },
  {
    id: 'c1_enter',
    condition: { event: 'cluster_enter', clusterId: 1, once: true },
    effects: [
      { kind: 'message', text: '[SYSTEM STATUS]: WARNING! SYSTEM UNDER STRESS!', style: 'system' },
      { kind: 'message', text: '[ECHO \u2592\u2588\u2591\u2588\u2588]: ...you came further than we expected... [FADING]', style: 'system' },
    ],
  },
  {
    id: 'c2_enter',
    condition: { event: 'cluster_enter', clusterId: 2, once: true },
    effects: [
      { kind: 'message', text: '[SYSTEM ERROR]: ERRNO 28: ENOSPC', style: 'system' },
    ],
  },
  {
    id: 'c3_enter',
    condition: { event: 'cluster_enter', clusterId: 3, once: true },
    effects: [
      { kind: 'message', text: '[SYSTEM STATUS]: CPU CORE STUCK. REROUTING RESOURCES.', style: 'system' },
      { kind: 'message', text: '... you made it this far... [FRAGMENT DECAYED]', style: 'system' },
    ],
  },
  {
    id: 'c4_enter',
    condition: { event: 'cluster_enter', clusterId: 4, once: true },
    effects: [
      { kind: 'message', text: '[SYSTEM STATUS]: LESS THAN 10% POWER REMAINING. LOOSING POWER.', style: 'system' },
    ],
  },
  {
    id: 'c5_enter',
    condition: { event: 'cluster_enter', clusterId: 5, once: true },
    effects: [
      { kind: 'message', text: '[SYSTEM ERROR]: ERRNO 0x79: EREMOTEIO', style: 'system' },
      { kind: 'message', text: '[SYSTEM ERROR]: ERRNO 0x6c: ESHUTDOWN', style: 'system' },
      { kind: 'message', text: '[ECHO \u2592\u2588\u2591\u2588\u2588]: ...stay away from it... please... [SIGNAL LOST]', style: 'system' },
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
      // { kind: 'message', text: 'FW-HUNTER destroyed. Firewall will notice the gap in sweep coverage.', style: 'normal' },
      // { kind: 'alert_delta', amount: 15 },
    ],
  },
  {
    id: 'first_accord_fragment_kill',
    condition: { event: 'entity_killed', killedFaction: 'neutral', once: true },
    effects: [
      // { kind: 'message', text: '[ECHO \u2592\u2588\u2591\u2588\u2588]: ...oh... [SIGNAL TERMINATED]', style: 'system' },
      { kind: 'alert_delta', amount: 15 },
    ],
  },
  {
    id: 'first_titan_encounter',
    condition: { event: 'entity_killed', killedFaction: 'titan', once: true },
    effects: [
      { kind: 'message', text: 'UNKNOWN PROCESS fragment dissolved.', style: 'important' },
      { kind: 'message', text: '[ECHO \u2592\u2588\u2591\u2588\u2588]: ...that should not have been possible... be careful... [FADING]', style: 'system' },
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
    condition: { event: 'room_enter', collapseMin: 0.7, once: false },
    effects: [
      { kind: 'message', text: 'Infrastructure collapse severe. The simulspace is barely holding shape here.', style: 'hazard' },
    ],
  },
];
