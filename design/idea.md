# COHERENCE -- 7DRL

> Some kind of interesting quote from the sci-fi or computer science

You are an uploaded mind of a ship engineer booted in crumbling ship system, trying to get to the controls before the ship would be lost to the war between anti-virus software and remnants of search-and-destroy viruses.
Stealth or bruteforce your way through the warzone to get to the root console and restore the ships controls.

## Main idea

The virtual systems are presented as clusters of sdjustent rooms. Each cluster is a isolated part of server infrastructure that is under heavy attack from remnants of the breach.
Clusters are connected with a secure intefaces that needs special keys or bruteforce to use.
As an engineer you have autherization to use some of the ship systems, and it's antivirus think of you as an ally.
But if you do enough damage to the systems (hacking, bruteforcing, corrupting), you become part of the problem.

## Narrative

The ship you part of was merging it's crew into a single hivemind, triggering Firewall about appearance of TITAN-like signatures.
You are a ship engineer that was booted from a damaged backup before the merging was decided. So you only remember parts of the ship and it's crew.
The player will encounder terminals and logs from the crew. The narrative is secondary to the mechanics, but can be useful to understand the great danger.

## Spatial dungeon

The "dungeon" is presented as clusters of adjustent rooms. Similar to this:

```
╔═════════════╤══════╗       ╔════
║             +      ║     ┅┅⇋
║             │      ║    ┇  ║
╟────────┬───+┴+─────╢    ┇  ║
║        +           ║    ┇  ║
╟+───────┼───────────╢    ┇  ║
║        +           ║    ┇
║        │           ║    ┇ 
║        │           ⇋┅┅┅┅
╚════════╧═══════════╝
```

where `⇋` represents the transfer to another cluster, and `+` represents a door.

* A cluster should be always a rectangel, but can consist of non-rectangle rooms.
* Each cluster should always have an exit to the next cluster
* Clusters are generating procedurally and lazy. Pregenerate up to three clusters.
* Enemies can also transfer through the interface connection if the interface was hacked or enemies found the key to it.

## UI

The UI should be design as mouse-first, keyboard second. The player should always be able to complete any action using only mouse, but have a keyboard shortcuts in place.

Only 4-way movement (no diagonal).

We should use simplistic design, but also use utf-8 symbols (not only ascii ones).

### SELF and TARGET windows

```
┌[ SELF ]──────────────────────┐  ┌[ TARGET ]─────────────────┐
│ ego-fragment    0x3A7F       │  │ fw-hunter-7      0x1B22   │
│ State: running               │  │ State: scanning           │
│ Coherence: 73%               │  │ ░░░░░░░░░░░░░░░░░░░░░░░░  │
│ Memory: 847 KB               |  |                           |
| Power: 5%                    │  │ ░░░░░░░░░░░░░░░░░░░░░░░░  │
│ ─── modules ───              │  │ ─── broadcast only ───    │
│ > alert_r2.m  [ 67%][loaded] │  │   (scan to reveal)        │
│ > corrupt.m   [100%][loaded] │  │                           │
│   overclock.m      [offload] │  │                           │
│ ─── perms ───                │  │                           │
│ user / read+write+exec       │  │                           │
| engineer / read+write+exec   |  |                           |
└──────────────────────────────┘  └───────────────────────────┘
```

## Player stats

The engineer should have it's COHERENCE stat similar to the HP stat. It's other stats are from modules it can instal. The modules provide additional functionality to the default built-it interactions. Each module costs memory slots and drawing processing power, depending on it's functionality, quality, build-it redundancy mechanism. Better quality represent more optimized software and costs less memory to equip.

As we are traveling in a manifistation of a virtual world, potentially everything is possible, given enough processing power and combination of modules.

Local cluster has limited processing power, and each active entity is trying it's best to have more of it. So player can find themself out of modules.

### Module primitives

Each module should be procedurally generated based on it's functionality primitives, quality, and self-repairing machnisms implemented.

Examples of functionality primitives:

* **Alert**. Alert the entity about another entity in the rool/local cluster/invisible (different functionalities, can have all of them) entity.
* **Corrupt**. Bruteforce primitive, costing a lot of processing power and alerting local antivirus. Can directly corrupt a targeted module/data/entity.
* **Redirect**. Redirect the incoming signal to the random space/random entity/attacker.
* **Cloak**. Make the entity invisible. But make the entity slower or alert the local antivirus.
* **Spoof**. Spoof the entity signal, making seen as another entity.
* **Overclock**. Request emergency priority to the processing power, making the entity faster.

Examples of self-repairing mechanisms:

| Protection | Memory Overhead | Auto-Repair? | Corruption Resistance |
| --- | --- | --- | --- |
| `none` | +0 blocks | No | Module corrupts instantly |
| `ecc` | +1-2 blocks | Yes (minor) | Auto-repairs 1-2 corrupted blocks per tick |
| `journal` | +2 blocks | Yes (rollback) | Can revert to last-known-good state |
| `raid-mirror` | +N blocks (2x total) | Yes (full) | Survives total loss of one copy |
| `erasure` | +k blocks | Yes (flexible) | Survives loss of any k blocks out of N+k |
| `cow` | +1-2 blocks | Yes (snapshot) | Keeps one previous version; can roll back once |

Side Effects

Drawbacks or costs that come with using the module. Procgen assigns 0-2 side effects.

| Side Effect | Description |
| --- | --- |
| `noisy` | Generates unwanted signals when used. +1 suspicion per use. |
| `slow` | Takes 2-3x normal ticks to execute. |
| `leaky` | Module requires more memmory after each use. |
| `hungry` | Consumes an extra memory slot while active. |
| `volatile` | Self-corrupts slightly each use (degrades over time). |
| `incompatible` | Conflicts with another base function — can't run both simultaneously. |
| `hot` | Raises server alert level slightly each use. |
| `lossy` | Output has small chance of being garbled (5-15%). |
| `fragile` | No protection override — ignores module's protection strategy on heavy damage. |
| `conspicuous` | Entities in the same room notice the module activating. |

Quirks

Unique properties that make specific module instances memorable. Procgen assigns 0-1 quirk.

| Quirk | Description |
| --- | --- |
| `recursive` | Can target itself (e.g., a scan.mod that scans its own internals). |
| `resonant` | Works better on targets of the same type (entity→entity, data→data). |
| `parasitic` | Slowly copies small data fragments from targets it interacts with. |
| `adaptive` | Improves slightly each time it's used (tier creep over many uses). |
| `mimic` | Disguises itself as a different module type to external scanners. |
| `bonded` | Works only for the entity that first activated it. Useless if stolen. |
| `unstable` | Randomly shifts between two base functions each use. |
| `echo` | Stores a ghost copy of the last result. Can be reviewed later. |
| `symbiotic` | Boosts an adjacent module's tier by 1 while both are loaded. |
| `ancient` | From a previous system version. Bypasses some modern protections but fails on new formats. |

### Starting modules

The engineers start with a basic version (no quirks) of:

* alert
* overclock
* corrupt
