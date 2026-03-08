/**
 * Sound system — Web Audio API singleton with category-based volume control.
 *
 * Usage:
 *   import { soundManager } from './audio';
 *   soundManager.init();  // call once on first user gesture
 *   soundManager.play('shoot');
 *   soundManager.playFootstep();
 *   soundManager.startAmbient('ambient_firewall');
 */

// ── Sound registry ──

type SoundCategory = 'sfx' | 'ui' | 'ambient';

const SOUND_REGISTRY: Record<string, { path: string; category: SoundCategory }> = {
  // Movement
  step1:              { path: '/sounds/movement/step1.wav', category: 'sfx' },
  step2:              { path: '/sounds/movement/step2.wav', category: 'sfx' },
  step3:              { path: '/sounds/movement/step3.wav', category: 'sfx' },
  door_open:          { path: '/sounds/movement/door_open.wav', category: 'sfx' },
  door_close:         { path: '/sounds/movement/door_close.wav', category: 'sfx' },
  transfer:           { path: '/sounds/movement/transfer.wav', category: 'sfx' },
  // Combat
  shoot:              { path: '/sounds/combat/shoot.wav', category: 'sfx' },
  shoot_alt:          { path: '/sounds/combat/shoot_alt.wav', category: 'sfx' },
  beam:               { path: '/sounds/combat/beam.wav', category: 'sfx' },
  hit:                { path: '/sounds/combat/hit.wav', category: 'sfx' },
  melee:              { path: '/sounds/combat/melee.wav', category: 'sfx' },
  entity_destroy:     { path: '/sounds/combat/destroy.wav', category: 'sfx' },
  // UI
  ui_click:           { path: '/sounds/ui/click.wav', category: 'ui' },
  ui_open:            { path: '/sounds/ui/open.wav', category: 'ui' },
  ui_close:           { path: '/sounds/ui/close.wav', category: 'ui' },
  ui_select:          { path: '/sounds/ui/click.wav', category: 'ui' },
  // Hazard one-shots
  hazard_enter:       { path: '/sounds/hazard/enter.wav', category: 'sfx' },
  explosion:          { path: '/sounds/hazard/explosion.wav', category: 'sfx' },
  seal:               { path: '/sounds/hazard/seal.wav', category: 'sfx' },
  // Hazard ambient loops
  ambient_firewall:       { path: '/sounds/hazard/firewall_loop.ogg', category: 'ambient' },
  ambient_memory_leak:    { path: '/sounds/hazard/memory_leak_loop.ogg', category: 'ambient' },
  ambient_corrupted:      { path: '/sounds/hazard/corruption_loop.ogg', category: 'ambient' },
  ambient_gravity_well:   { path: '/sounds/hazard/gravity_well_loop.ogg', category: 'ambient' },
  ambient_echo_chamber:   { path: '/sounds/hazard/echo_chamber_loop.ogg', category: 'ambient' },
  ambient_cascade:        { path: '/sounds/hazard/cascade_loop.ogg', category: 'ambient' },
  ambient_unstable:       { path: '/sounds/hazard/unstable_loop.ogg', category: 'ambient' },
  // Narrative (played as non-looping ambient)
  echo_appear:        { path: '/sounds/narrative/echo_appear.ogg', category: 'ambient' },
  terminal_open:      { path: '/sounds/narrative/terminal_open.ogg', category: 'ambient' },
  archive_open:       { path: '/sounds/narrative/archive_open.ogg', category: 'ambient' },
  // System
  module_toggle:      { path: '/sounds/system/module_toggle.wav', category: 'ui' },
};

// ── Volume persistence keys ──

const VOL_KEYS = {
  master:  'coherence_vol_master',
  sfx:     'coherence_vol_sfx',
  ui:      'coherence_vol_ui',
  ambient: 'coherence_vol_ambient',
} as const;

const DEFAULT_VOLUMES: Record<string, number> = {
  master: 0.8,
  sfx: 0.8,
  ui: 0.8,
  ambient: 0.6,
};

// ── SoundManager ──

class SoundManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private categoryGains: Record<SoundCategory, GainNode | null> = { sfx: null, ui: null, ambient: null };
  private buffers = new Map<string, AudioBuffer>();
  private activeAmbient: { key: string; source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private activeSources: { source: AudioBufferSourceNode; gain: GainNode }[] = [];
  private footstepIdx = 0;
  private lastPlay = new Map<string, number>();
  private initPromise: Promise<void> | null = null;
  private _ready = false;

  /** Call on first user gesture. No-op after first successful init. Returns the init promise. */
  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this._init();
    }
    return this.initPromise;
  }

  private async _init(): Promise<void> {
    try {
      this.ctx = new AudioContext();
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }

      // Build gain chain: source → categoryGain → masterGain → destination
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);

      for (const cat of ['sfx', 'ui', 'ambient'] as SoundCategory[]) {
        const g = this.ctx.createGain();
        g.connect(this.masterGain);
        this.categoryGains[cat] = g;
      }

      this.loadVolumes();

      // Preload all buffers in parallel
      const entries = Object.entries(SOUND_REGISTRY);
      const results = await Promise.allSettled(
        entries.map(async ([id, def]) => {
          try {
            const resp = await fetch(def.path);
            if (!resp.ok) return;
            const arrayBuf = await resp.arrayBuffer();
            const audioBuf = await this.ctx!.decodeAudioData(arrayBuf);
            this.buffers.set(id, audioBuf);
          } catch {
            // Silently skip missing/invalid files
          }
        })
      );
      void results; // consumed by allSettled
      this._ready = true;
    } catch {
      // AudioContext not available (headless, old browser, etc.)
    }
  }

  isReady(): boolean { return this._ready; }

  /** Play a one-shot sound. */
  play(id: string, opts?: { category?: SoundCategory; pitchVariation?: number; debounceMs?: number; volume?: number }): void {
    if (!this.ctx || !this.masterGain) return;
    const buf = this.buffers.get(id);
    if (!buf) return;

    // Debounce
    const debounce = opts?.debounceMs ?? 100;
    const now = performance.now();
    const last = this.lastPlay.get(id) ?? 0;
    if (now - last < debounce) return;
    this.lastPlay.set(id, now);

    const def = SOUND_REGISTRY[id];
    const cat = opts?.category ?? def?.category ?? 'sfx';
    const gainNode = this.categoryGains[cat];
    if (!gainNode) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    if (opts?.pitchVariation) {
      source.playbackRate.value = 1 + (Math.random() * 2 - 1) * opts.pitchVariation;
    }
    const envGain = this.ctx.createGain();
    if (opts?.volume != null) envGain.gain.value = opts.volume;
    envGain.connect(gainNode);
    source.connect(envGain);
    source.start();

    const entry = { source, gain: envGain };
    this.activeSources.push(entry);
    source.onended = () => {
      const idx = this.activeSources.indexOf(entry);
      if (idx >= 0) this.activeSources.splice(idx, 1);
    };
  }

  /** Play a randomized footstep sound. */
  playFootstep(): void {
    const steps = ['step1', 'step2', 'step3'];
    const id = steps[this.footstepIdx % steps.length];
    this.footstepIdx++;
    this.play(id, { pitchVariation: 0.1, debounceMs: 60 });
  }

  /** Start an ambient loop with crossfade. */
  startAmbient(id: string): void {
    if (!this.ctx || !this.masterGain) return;
    // Already playing the same loop
    if (this.activeAmbient?.key === id) return;

    const buf = this.buffers.get(id);
    if (!buf) return;

    const now = this.ctx.currentTime;

    // Fade out old ambient
    if (this.activeAmbient) {
      const old = this.activeAmbient;
      old.gain.gain.linearRampToValueAtTime(0, now + 0.3);
      setTimeout(() => { try { old.source.stop(); } catch { /* already stopped */ } }, 350);
      this.activeAmbient = null;
    }

    // Start new ambient loop
    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(1, now + 0.3);
    gainNode.connect(this.categoryGains.ambient!);

    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    source.loop = true;
    source.connect(gainNode);
    source.start();

    this.activeAmbient = { key: id, source, gain: gainNode };
  }

  /** Start a non-looping sound on the ambient channel (crossfades like ambient). */
  startAmbientOnce(id: string): void {
    if (!this.ctx || !this.masterGain) return;
    if (this.activeAmbient?.key === id) return;

    const buf = this.buffers.get(id);
    if (!buf) return;

    const now = this.ctx.currentTime;

    // Fade out old ambient
    if (this.activeAmbient) {
      const old = this.activeAmbient;
      old.gain.gain.linearRampToValueAtTime(0, now + 0.3);
      setTimeout(() => { try { old.source.stop(); } catch { /* already stopped */ } }, 350);
      this.activeAmbient = null;
    }

    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(1, now + 0.3);
    gainNode.connect(this.categoryGains.ambient!);

    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    source.loop = false;
    source.connect(gainNode);
    source.start();

    this.activeAmbient = { key: id, source, gain: gainNode };
    source.onended = () => {
      if (this.activeAmbient?.source === source) {
        this.activeAmbient = null;
      }
    };
  }

  /** Stop the current ambient loop with fade-out. */
  stopAmbient(fadeMs = 500): void {
    if (!this.ctx || !this.activeAmbient) return;
    const old = this.activeAmbient;
    this.activeAmbient = null;
    const now = this.ctx.currentTime;
    old.gain.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
    setTimeout(() => { try { old.source.stop(); } catch { /* already stopped */ } }, fadeMs + 50);
  }

  /** Fade out and stop all active sounds (one-shots + ambient). */
  stopAll(fadeMs = 500): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const entry of this.activeSources) {
      entry.gain.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
      const src = entry.source;
      setTimeout(() => { try { src.stop(); } catch { /* already stopped */ } }, fadeMs + 50);
    }
    this.activeSources = [];
    this.stopAmbient(fadeMs);
  }

  /** Set volume for a category (0–1). Persists to localStorage. */
  setVolume(category: 'master' | SoundCategory, value: number): void {
    const v = Math.max(0, Math.min(1, value));
    if (category === 'master') {
      this.masterGain?.gain.setValueAtTime(v, this.ctx?.currentTime ?? 0);
    } else {
      this.categoryGains[category]?.gain.setValueAtTime(v, this.ctx?.currentTime ?? 0);
    }
    const key = VOL_KEYS[category];
    if (key) localStorage.setItem(key, String(v));
  }

  /** Get current volume for a category. */
  getVolume(category: 'master' | SoundCategory): number {
    const key = VOL_KEYS[category];
    const stored = key ? localStorage.getItem(key) : null;
    if (stored != null) return Number(stored);
    return DEFAULT_VOLUMES[category] ?? 0.8;
  }

  /** Load volumes from localStorage and apply to gain nodes. */
  private loadVolumes(): void {
    for (const cat of ['master', 'sfx', 'ui', 'ambient'] as const) {
      const val = this.getVolume(cat);
      if (cat === 'master') {
        this.masterGain?.gain.setValueAtTime(val, 0);
      } else {
        this.categoryGains[cat]?.gain.setValueAtTime(val, 0);
      }
    }
  }

  /** Get all registered sound IDs (for dev soundboard). */
  getAllSoundIds(): string[] {
    return Object.keys(SOUND_REGISTRY);
  }

  /** Check if a sound buffer is loaded. */
  hasSound(id: string): boolean {
    return this.buffers.has(id);
  }
}

export const soundManager = new SoundManager();
