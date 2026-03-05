# Node (room) functionality

Since your player is a **Virtual Ego (Infomorph)**, the "ship" isn't just metal and wires—it's a massive, interconnected network of servers, wireless Mesh nodes, and localized Virtual Reality (VR) environments.

In this context, "Rooms" are **Subnets** or **Nodes**. The physical state of the ship (the "crumbling") translates to digital instability, packet loss, and hardware failure.

---

## Table 1: Virtual Node Functionality

These are the digital "rooms." Even if the player is purely virtual, these nodes represent the ship's subsystems they are traversing.

| Node Type | Core Function | Virtual Representation | Strategic Value |
| --- | --- | --- | --- |
| **Archive Node** | Data Storage | A vast, silent library or a graveyard of frozen icons. | High chance of "Lore Shards" or encryption keys. |
| **Logic Core** | Processing Power | A pulsing, hyper-fast geometric cathedral. | Boosts CPU cycles (Ability cooldowns/Speed). |
| **Sensor Matrix** | Internal/External Input | A room of floating eyes or a wireframe map of the ship. | Reveals the map or enemy locations in adjacent nodes. |
| **Fabrication Kernel** | 3D Print Logic | A workshop where ghost-like blueprints assemble themselves. | Can "spawn" digital decoys or temporary software tools. |
| **Comm-Relay** | External Signal | A literal forest of antennas or a blinding pillar of light. | Required to "ping" for an exit or signal for extraction. |
| **Life Support OS** | Enviro-Management | A surreal, green ecosystem or a rhythmic, breathing room. | Hacking this can cause physical distractions for organic enemies. |
| **Security Daemon Nest** | Defense Subnet | A stark, obsidian fortress with aggressive, angular architecture. | High risk, but allows you to disable ship-wide alarms. |
| **Ego-Sim Sandbox** | VR Entertainment | A "broken" simulation of a pre-Fall park or city. | High cover; easy to hide amongst "NPC" ghost data. |

---

## Table 2: Digital Hazards

Physical damage to the ship translates into "Glitch Hazards" in virtual space.

| Hazard Name | Effect on Virtual Ego | Stealth Interaction |
| --- | --- | --- |
| **Packet Loss** | Movement becomes "jittery"; chance to fail an action. | Harder for enemies to predict your path, but harder to move. |
| **Trace-Back Loop** | Every action increases your "Visibility" meter. | Forces the player to move quickly and avoid interacting with nodes. |
| **Logic Bomb** | A hidden trap that "detonates" on touch, dealing RAM damage. | Can be "defused" or re-routed to trigger when a security program passes. |
| **Buffer Overflow** | Floods the UI with junk data, obscuring the screen. | Effectively "Digital Smoke"; blinds both the player and AI. |
| **TITAN Worm** | A predatory code-entity that stalks the subnet. | Acts as an unkillable "Stalker" enemy that forces room transitions. |
| **Hardware Desync** | The floor/walls "flicker" out of existence as servers die. | Creates temporary gaps that require "Leaping" (Data Bursting). |

---

## Table 3: Virtual Additional Tags

These tags define the "State" of the network in that specific sector.

| Tag | Mechanical Effect | Narrative Flavor |
| --- | --- | --- |
| **[Encrypted]** | Interactions take 2x longer; rewards are higher. | Secure data that survived the initial ship-wide crash. |
| **[Orphaned]** | No connection to the wider Mesh; no map updates. | A disconnected server floating in a dead section of the hull. |
| **[Overclocked]** | +20% Movement Speed; +20% Enemy Aggro. | The hardware is melting down, running at dangerous speeds. |
| **[Fragmented]** | Map layout is randomized or "shuffled" upon entry. | The file system is corrupted; the "room" is rebuilding itself. |
| **[Ghosted]** | Contains echoes of dead Egos (distractions/lore). | Residual data "shadows" of the crew who didn't escape. |
| **[Hard-Wired]** | Cannot be hacked remotely; must be physically "touched." | A legacy system that requires direct interface. |

---

### Procedural Generation Tip: The "Digital-Physical Link"

Even though the player is in virtual space, remember that **Physical Entropy = Digital Chaos**.

* If a room has the **[Fragmented]** tag, you should visually represent it with "Z-fighting" textures or flickering geometry.
* If the physical ship's hull is breached in that area, the Virtual Node should have a **[Vacuum]** equivalent—perhaps a **"Data Leak"** where the player's energy/RAM slowly drains into the void unless they "patch" the connection.

This three-way ecosystem creates a "Three-Body Problem" for your stealth mechanics. The player isn't just hiding from a guard; they are navigating a digital war zone where the "terrain" (Neutral systems) is being eaten by "predators" (Malware) while the "police" (Defense) try to shoot everything that doesn't have a verified ID.

Here are the regenerated entity tables based on these three factions.

---

# Factions

## Faction 1: The "Architects" (Neutral/Maintenance)

**Motto:** *The ship must function.*
These entities are usually indifferent to the player unless you block their path or consume the resources they are trying to use for repairs.

| Entity | Virtual Representation | Behavior | Stealth Interaction |
| --- | --- | --- | --- |
| **Repair Scrubber** | A small, fast-moving "cleaning" drone made of white light. | Moves to "Broken" tiles (Hazard zones) to fix them. | Can be followed; they effectively "pave" a safe path through hazards for the player. |
| **Load Balancer** | A pulsating orb that tethers itself to nearby nodes with golden threads. | Reallocates "CPU Cycles." If you stand near it, your ability cooldowns speed up, but the node "dims," reducing cover. | High-value temporary buff, but makes you visually stand out in the dark. |
| **The Chronicler** | A giant, translucent eye made of scrolling green code. | It doesn't move. It simply records everything. It has no "Attack" but provides a massive "Verification" buff to any Defense units nearby. | If you stay in its LoS too long, it "flags" you, making Defense units seek you out instantly. |

---

## Faction 2: The "Fractals" (Attack Malware/Viruses)

**Motto:** *Consumption is the only logic.*
These are TITAN-remnants or "Fall-era" scrap-code. They want to tear the ship apart and find your Ego particularly "delicious."

| Entity | Virtual Representation | Behavior | Stealth Interaction |
| --- | --- | --- | --- |
| **Bit-Mite Swarm** | A cloud of jagged, red-and-black static pixels. | Aggressively attacks the nearest non-Malware entity (Neutral, Defense, or Player). | Can be "lured" toward a Defense patrol to create a distraction. |
| **Logic Leech** | A spider-like entity that clings to the "walls" of the subnet. | It waits for an entity to use an ability. When you do, it "leaps" and attaches, draining your RAM (energy) over time. | Moving slowly and using no abilities makes you invisible to them. |
| **The Disassembler** | A massive, shifting void that looks like a "hole" in the world. | It moves slowly, literally deleting "Cover" and "Nodes" as it passes. | It creates "Digital Gaps." It is a timer—if it reaches your exit node, that exit is gone forever. |

---

## Faction 3: The "Sentinels" (Defense/Anti-Virus)

**Motto:** *Identify. Quarantine. Purge.*
The ship’s automated security. They view both the Malware and the player (an unauthorized Ego) as threats to be deleted.

| Entity | Virtual Representation | Behavior | Stealth Interaction |
| --- | --- | --- | --- |
| **White-Hat Sentry** | A rigid, hovering diamond with a spotlight-like sensor beam. | Classic patrol. It has a "Soft Detect" (Yellow) and "Hard Detect" (Red). | It will prioritize Malware over the player *if* the Malware is currently damaging a Neutral system. |
| **Trace-Router** | A long, snake-like wireframe entity that "slithers" along data paths. | It doesn't look for *you*; it looks for "Disturbances" (hacks, deleted files, or dead Sentinels). | If it finds "evidence" of your passage, it begins a ship-wide "Search" state. |
| **The Purge Daemon** | A terrifying, multi-armed gladiator made of mirrored obsidian. | High-speed hunter. It only spawns when "Alert Level" is Max. It ignores Malware to focus entirely on the Player. | Needs to be "Line-of-Sight" broken constantly. It can be "stuck" if led into a area the Disassembler has deleted. |

---

## The "Procedural War" Logic

To make your generator feel alive, you can use these factions to create **Emergent Scenarios** in specific rooms:

1. **The Siege:** A room starts with 3 **White-Hat Sentries** defending a **Load Balancer** from a **Bit-Mite Swarm**. The player can slip past while they are fighting.
2. **The Infested Corridor:** A room filled with **Logic Leeches** and **Disassemblers**. No Defense units are here because they’ve already "quarantined" the room (locked the doors). The player must hack the door while being hunted by "The Hole."
3. **The Factory Floor:** **Repair Scrubbers** are frantically trying to fix a room that is actively "crumbling." The player must jump between flickering platforms.

### Strategic Layer: "Faction Heat"

As a virtual ego, you could have a "Spoofing" ability.

* **Spoof Defense:** Sentries ignore you, but Malware treats you as a high-priority target.
* **Spoof Malware:** You can move through "Disassembler" zones safely, but Sentries will hunt you with extreme prejudice.

---

In an *Eclipse Phase* setting, the ship's network isn't just a map—it's a **living topology**. When one subnet "bleeds," the data-pressure pushes into the neighbors.

Here are four predefined "Scenario Rooms" designed to create systemic chaos and force the player to make hard stealth choices.

---

## 1. The Quarantine "Bottle"

**Factions:** Sentinels vs. Fractals (Malware)
Defense has identified a massive malware infection and has "walled off" this node. The Sentinels are in a frenzy, trying to delete everything before the malware can escape.

* **The Scenario:** A **Purge Daemon** is circling the center of the room, while **Bit-Mite Swarms** are chewing through the "walls" (the exit portals).
* **Player Choice:** * *Aggressive:* Help the Malware break the wall to escape faster (increases ship-wide Alert Level).
* *Stealth:* Use the chaos to slip through the "System Trash" being generated by the fighting.


* **Adjacency Effect (Bleed):** * **[Lag Spikes]:** All adjacent rooms suffer a 20% movement speed penalty as the Defense system reroutes processing power to maintain the "Bottle."

---

## 2. The Logic Core Hemorrhage

**Factions:** Neutral (Architects) vs. Fractals (Malware)
The ship's main processing unit in this sector is being disassembled. The Neutral systems are desperately trying to offload data to stay "alive."

* **The Scenario:** A **Disassembler** is slowly eating the room’s "Floor" tiles. **Repair Scrubbers** are frantically spawning new tiles to replace them, but they are losing the war.
* **Player Choice:**
* *Risk:* Stay in the crumbling room to "harvest" the high-value data being offloaded by the dying Neutral systems.
* *Safety:* Sprint across the flickering platforms before the exit path is deleted.


* **Adjacency Effect (Bleed):** * **[Data Debris]:** Adjacent rooms become "cluttered" with ghost-code. This provides +30% more cover objects, but moving through them creates "Noise" that alerts **Bloodhounds**.

---

## 3. The Surveillance Feedback Loop

**Factions:** Neutral (Architects) vs. Sentinels (Defense)
A **Chronicler** (Neutral) has been "hacked" or corrupted. It is now broadcasting everything it sees directly to the Defense network in a high-speed loop.

* **The Scenario:** The room is bathed in a sweeping, high-frequency **Green Searchlight**. If the light hits the player, or even a **Repair Scrubber**, a **White-Hat Sentry** is instantly spawned at that location.
* **Player Choice:**
* *Sabotage:* "Overload" the Chronicler. This stops the broadcast but creates a massive "Digital Flashbang" that blinds the player for 3 seconds.
* *Finesse:* Time your movement to stay in the "Shadows" cast by the Sentinels themselves.


* **Adjacency Effect (Bleed):** * **[Full Visibility]:** For the next 2 rooms, the player’s "Detection Meter" fills 2x faster because their "Signature" is already cached in the local defense buffer.

---

## 4. The Thermal "Dump"

**Factions:** All Three
The physical hardware in this sector is literally melting. The Neutral systems have given up on "Repair" and are now just venting heat into the virtual space to delay the inevitable.

* **The Scenario:** The room has a **"Heat Timer."** Every 10 seconds, a wave of thermal static pulses through the node, dealing RAM damage to anyone not standing behind a **Coolant Vent** (High Cover).
* **Player Choice:**
* *Predatory:* Bait a **Sentinel** or **Malware** entity into the open right before a pulse hits to "delete" them without firing a shot.
* *Speed:* Sacrifice RAM (Health) to dash through the room before the next pulse.


* **Adjacency Effect (Bleed):** * **[Thermal Noise]:** Adjacent rooms become "Foggy." Long-range visibility is reduced for everyone (including enemies), making it a "Stealth Paradise" but a "Navigation Nightmare."

---

### Scenario Distribution Logic

To ensure the game stays a "roguelike" and doesn't just become a mess, I recommend this **PCG Weighting**:

| Room Type | Frequency | Impact |
| --- | --- | --- |
| **Standard Node** | 70% | Localized threats only. |
| **Scenario Room** | 20% | Affects 1-ring of adjacent rooms. |
| **Apex Scenario** | 10% | Affects the entire Sector (3+ rooms deep). |

### The "Warzone" HUD

When the player is in an adjacent room affected by "Bleed," their UI should reflect it.

* *Ex:* If the neighbor is the **Logic Core Hemorrhage**, the player's screen should occasionally "flicker" with the same color as the crumbling core, warning them that the terrain ahead is unstable.
