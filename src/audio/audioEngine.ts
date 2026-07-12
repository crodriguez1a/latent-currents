// Generative Audio Engine using the Web Audio API
// Synthesizes a deep ambient drone and responsive chime tones.

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private isMuted: boolean = false;
  private targetVolume: number = 0.4; // 0.0 to 1.0

  // Ambient Drone Synthesizers
  private droneOscs: OscillatorNode[] = [];
  private droneGains: GainNode[] = [];
  private filter: BiquadFilterNode | null = null;
  private lfo: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;

  // Cavernous Delay
  private delayNode: DelayNode | null = null;
  private delayGain: GainNode | null = null;

  // Wind-Chime Voice Pool
  private maxChimeVoices = 4;
  private activeChimes = 0;

  // Harmonious Pentatonic Scale (frequencies in Hz for deep ambient pads)
  // C minor pentatonic: C, Eb, F, G, Bb
  private droneFrequencies = [65.41, 77.78, 87.31, 98.00, 116.54]; // C2, Eb2, F2, G2, Bb2
  private chimeFrequencies = [
    261.63, 293.66, 329.63, 392.00, 440.00, // C4, D4, E4, G4, A4 (C major pentatonic)
    523.25, 587.33, 659.25, 783.99, 880.00, // C5, D5, E5, G5, A5
    1046.50, 1174.66, 1318.51, 1567.98 // C6, D6, E6, G6
  ];

  constructor() {}

  /**
   * Initializes the Audio Context and builds the node graph.
   * This must be called inside a user gesture event listener.
   */
  public async init(): Promise<void> {
    if (this.ctx) return; // Already initialized

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();

      // Resume context if suspended (common browser behavior)
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }

      // Create Master Nodes
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.targetVolume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      // Create Cavernous Delay Effect
      this.delayNode = this.ctx.createDelay(2.0);
      this.delayGain = this.ctx.createGain();
      
      // Delay parameters
      this.delayNode.delayTime.setValueAtTime(0.8, this.ctx.currentTime); // 800ms echo
      this.delayGain.gain.setValueAtTime(0.4, this.ctx.currentTime); // 40% feedback

      // Connect Delay loop: Master -> Delay -> FeedbackGain -> Delay -> Master
      this.delayNode.connect(this.delayGain);
      this.delayGain.connect(this.delayNode);
      this.delayNode.connect(this.masterGain);

      // Setup Lowpass Filter for Drone
      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.setValueAtTime(300, this.ctx.currentTime);
      this.filter.Q.setValueAtTime(3.0, this.ctx.currentTime);
      this.filter.connect(this.masterGain);

      // Setup LFO to modulate filter cutoff frequency slowly
      this.lfo = this.ctx.createOscillator();
      this.lfoGain = this.ctx.createGain();
      this.lfo.type = 'sine';
      this.lfo.frequency.setValueAtTime(0.08, this.ctx.currentTime); // LFO at 0.08Hz (12.5s cycle)
      this.lfoGain.gain.setValueAtTime(150, this.ctx.currentTime); // Modulate by +/- 150Hz

      this.lfo.connect(this.lfoGain);
      if (this.filter.frequency) {
        this.lfoGain.connect(this.filter.frequency as any);
      }
      this.lfo.start();

      // Start Ambient Drone Pads
      this.startDrone();

      console.log('Audio Engine successfully initialized');
    } catch (err) {
      console.error('Failed to initialize Audio Engine:', err);
    }
  }

  /**
   * Starts the multi-voice synthesizer drone
   */
  private startDrone(): void {
    if (!this.ctx || !this.filter) return;

    // We start 3 oscillators tuned to chord steps
    const chordIndexes = [0, 2, 4]; // Root, 3rd, 5th equivalent

    chordIndexes.forEach((freqIdx) => {
      if (!this.ctx || !this.filter) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      // Smooth triangle wave for a gentle, warm tone
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(this.droneFrequencies[freqIdx], this.ctx.currentTime);

      // Very quiet base volume to keep it subtle
      gain.gain.setValueAtTime(0.15, this.ctx.currentTime);

      osc.connect(gain);
      gain.connect(this.filter);
      
      osc.start();

      this.droneOscs.push(osc);
      this.droneGains.push(gain);
    });
  }

  /**
   * Triggers a resonant, metallic chime sound (synthesized FM/Additive chime).
   * Polyphony capped strictly to prevent AudioContext clipping.
   */
  public triggerChime(intensity: number = 0.5): void {
    if (!this.ctx || !this.masterGain || this.isMuted || this.activeChimes >= this.maxChimeVoices) return;

    this.activeChimes++;
    const now = this.ctx.currentTime;

    // Pick a random pitch from the major pentatonic scale
    const pitchIndex = Math.floor(Math.random() * this.chimeFrequencies.length);
    const fundamentalFreq = this.chimeFrequencies[pitchIndex];

    // Create FM pair (Carrier & Modulator) for metallic/bell-like chime timbre
    const carrier = this.ctx.createOscillator();
    const modulator = this.ctx.createOscillator();
    const modulatorGain = this.ctx.createGain();
    const chimeGain = this.ctx.createGain();

    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(fundamentalFreq, now);

    // Modulator frequency is set to a ratio (e.g. 1.5x) for metallic harmonics
    modulator.type = 'sine';
    modulator.frequency.setValueAtTime(fundamentalFreq * 1.5, now);
    
    // Modulation index determines the chime brightness
    modulatorGain.gain.setValueAtTime(fundamentalFreq * 0.8 * intensity, now);
    modulatorGain.gain.exponentialRampToValueAtTime(0.1, now + 1.2);

    // Envelope for main chime volume: instant attack, long decay
    chimeGain.gain.setValueAtTime(0, now);
    chimeGain.gain.linearRampToValueAtTime(0.08 * intensity, now + 0.05); // Attack
    chimeGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.5); // 2.5s Decay

    // Wire up FM synthesis
    modulator.connect(modulatorGain);
    modulatorGain.connect(carrier.frequency);
    
    carrier.connect(chimeGain);
    
    // Connect to Master and Delay (so chimes ring out in the cavernous echo chamber)
    chimeGain.connect(this.masterGain);
    if (this.delayNode) {
      chimeGain.connect(this.delayNode);
    }

    // Start nodes
    carrier.start(now);
    modulator.start(now);

    // Clean up nodes after chime finishes decaying to free resources
    carrier.stop(now + 3.0);
    modulator.stop(now + 3.0);

    setTimeout(() => {
      this.activeChimes = Math.max(0, this.activeChimes - 1);
    }, 3000);
  }

  /**
   * Dynamic Volume adjustment
   */
  public setVolume(percent: number): void {
    this.targetVolume = Math.max(0, Math.min(1, percent / 100));
    if (this.ctx && this.masterGain && !this.isMuted) {
      this.masterGain.gain.setTargetAtTime(this.targetVolume, this.ctx.currentTime, 0.1);
    }
  }

  /**
   * Dynamic Filter modulation (can link to visual speed or turbulence)
   */
  public modulateFilter(velocity: number): void {
    if (this.ctx && this.filter) {
      // Scale velocity to cutoff frequency.
      // E.g. velocity of 0.3 yields ~170Hz; velocity of 2.0 yields ~1020Hz.
      const targetFreq = 120 + Math.max(0, velocity - 0.2) * 500;
      this.filter.frequency.setTargetAtTime(Math.min(2000, targetFreq), this.ctx.currentTime, 0.3);
    }
  }

  /**
   * Mute / Unmute the engine
   */
  public setMute(mute: boolean): void {
    this.isMuted = mute;
    if (this.ctx && this.masterGain) {
      const volume = mute ? 0 : this.targetVolume;
      this.masterGain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.15);
    }
  }
}
