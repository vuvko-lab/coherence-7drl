/**
 * Lost echo whisper pools — ambient residual data fragments per cluster.
 * These are recordings, loops, fragments. Not alive.
 *
 * Narrative alignment:
 *   0 — Ordinary ship life, routine, familiarity
 *   1 — Resource anxiety, rationing, tension
 *   2 — Merge research, hope, trepidation
 *   3 — Attack chaos, confusion, "pirates", merging mid-strike
 *   4 — Infrastructure collapse, fragmented crew echoes, decay
 *   5 — Deep corruption, the unknown process, Firewall residue
 */

export const NARRATIVE_WHISPERS: Record<number, string[]> = {
  0: [
    '[MESH-ID \u2592\u2588\u2591\u2588\u2588]: ...still cataloging... room integrity... 12%... still cataloging... [LOOP]',
    '...secondary coolant pump needs another gasket... third time this cycle... [FRAGMENT]',
    '...is anyone still receiving... respond on any channel... [REPEATING]',
    '...the simulspace is warm... this is home now... [END OF RECORDING]',
    '...forty people, one ship, a lot of empty space... [FRAGMENT ENDS]',
  ],
  1: [
    '...recycler efficiency at 31%... below critical threshold... [LOG FRAGMENT]',
    '...water ration cut again... Chen says two months, Foss says three... [RECORDING]',
    '...we are not making it to Locus on what we have... everyone knows... [LOOP]',
    '...Mira has a plan... she always has a plan... this one scares me... [FRAGMENT]',
    '[MESH-ID \u2592\u2588\u2591\u2588\u2588]: ...fuel at 11%... options narrowing... [FADING]',
  ],
  2: [
    '...forty egos, one simulspace... the math says it works... [RECORDING]',
    '...voted yes today... felt strange... like signing something you can\u2019t take back... [FRAGMENT]',
    '[MESH-ID \u2592\u2588\u2591\u2588\u2588]: ...Sable says 94% confidence... that\u2019s not 100%... [LOOP]',
    '...integration date set... one week from now... one week... [FRAGMENT ENDS]',
    '...we\u2019ll still be us... just... together... that\u2019s what they say... [END]',
  ],
  3: [
    '[ALERT]: HOSTILE INTRUSION \u2014 SIMULSPACE PERIMETER BREACH [REPEATING]',
    '...integration at 60%... can\u2019t stop now... we\u2019ll lose people... [FRAGMENT]',
    '...pirates?... who would attack us out here?... [RECORDING]',
    '[MESH-ID \u2592\u2588\u2591\u2588\u2588]: ...it\u2019s not pirates... the attack is surgical... military-grade... [FADING]',
    '...Covad\u2019s backup is isolated... emergency protocol 7... [END]',
  ],
  4: [
    '[MESH-ID \u2592\u2588\u2591\u2588\u2588]: ...reactor at 14%... coolant compromised... sector collapse accelerating... [LOOP]',
    '[MESH-ID FOSS]: ...we fragmented... some of us became loops... residue... [FADING]',
    '...the viral agents are still active... they don\u2019t match any known signature... [FRAGMENT]',
    '[MESH-ID OSEI]: ...I miss coffee... a weird thing to miss... [FRAGMENT ENDS]',
    '[MESH-ID FOSS]: ...the core of us tried to rebuild... it mutated... it is not us anymore... [END]',
  ],
  5: [
    '[MESH-ID \u2592\u2588\u2591\u2588\u2588]: ...finish this... the ship will not hold long... [SIGNAL LOST]',
    '[MESH-ID OSEI]: ...you always fixed things... one more time... [FADING]',
    '[MESH-ID \u2592\u2588\u2591\u2588\u2588]: ...we cannot control it... [UNKNOWN PROCESS] was us, briefly... [END]',
    '[SABLE]: ...the math was right... the math was right... [LOOP]',
    '[UNKNOWN PROCESS]: [NON-PARSEABLE \u2014 EGO-PATTERNS DETECTED \u2014 CONSUMING]',
  ],
};
