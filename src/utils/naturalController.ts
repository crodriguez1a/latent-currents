import * as THREE from 'three';

export type NaturalModeType = 'none' | 'water' | 'flowers' | 'bird';

export class NaturalInteractionController {
  private activeMode: NaturalModeType = 'none';
  
  // Reusable variables for inputs
  private mouseSpeed = 0.0;
  private prevMouse = new THREE.Vector2(0, 0);

  // Water mode variables
  private rippleAmp = 0.0;

  // Flowers mode variables
  private stemBend = new THREE.Vector2(0, 0);
  private bloomFactor = 0.0;

  // Bird mode variables
  private birdPos = new THREE.Vector3(0, 0, -100); // start far back
  private birdVelocity = new THREE.Vector3(0, 0, 0);
  private birdRotation = new THREE.Vector3(0, 0, 0);
  private flapFreq = 6.5;

  // Microphone stream for bird flapping
  private micStream: MediaStream | null = null;
  private micContext: AudioContext | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private micDataArray: Uint8Array | null = null;
  private micVolume = 0.0;

  constructor() {}

  public setMode(mode: NaturalModeType): void {
    if (this.activeMode === mode) return;
    this.activeMode = mode;

    // Manage microphone state
    if (mode === 'bird') {
      void this.initMicrophone();
    } else {
      this.closeMicrophone();
    }

    // Reset parameters
    this.rippleAmp = 0.0;
    this.stemBend.set(0, 0);
    this.bloomFactor = 0.0;
    this.birdPos.set(0, 0, -100.0);
    this.birdVelocity.set(0, 0, 0);
    this.birdRotation.set(0, 0, 0);
    this.flapFreq = 6.5;
  }

  public getMode(): NaturalModeType {
    return this.activeMode;
  }

  public getBirdPos(): THREE.Vector3 {
    return this.birdPos;
  }

  public getBirdRotation(): THREE.Vector3 {
    return this.birdRotation;
  }

  public getFlapFreq(): number {
    return this.flapFreq;
  }

  public getRippleAmp(): number {
    return this.rippleAmp;
  }

  public getStemBend(): THREE.Vector2 {
    return this.stemBend;
  }

  public getBloomFactor(): number {
    return this.bloomFactor;
  }

  public update(time: number, dt: number, mouse: THREE.Vector2, isMouseActive: boolean, mouse3D: THREE.Vector3): void {
    // 1. Calculate mouse speed
    const currentMouse = mouse.clone();
    this.mouseSpeed = currentMouse.distanceTo(this.prevMouse) / Math.max(0.001, dt);
    this.prevMouse.copy(currentMouse);

    if (this.activeMode === 'water') {
      // Water Mode ripples calculations
      // Ripple amplitude responds to mouse speed, decaying slowly
      const targetAmp = this.mouseSpeed * 0.15 + (isMouseActive ? 0.8 : 0.0);
      this.rippleAmp += (targetAmp - this.rippleAmp) * 0.08;
    } 
    else if (this.activeMode === 'flowers') {
      // Flowers Mode sway and brush calculations
      // Stem bend follows mouse displacement relative to center, peaking near hover points
      const mouseDistFromCenter = mouse.length();
      const targetBendX = mouse.x * 0.45 * Math.max(0.0, 1.0 - mouseDistFromCenter);
      const targetBendY = mouse.y * 0.30 * Math.max(0.0, 1.0 - mouseDistFromCenter);
      this.stemBend.x += (targetBendX - this.stemBend.x) * 0.08;
      this.stemBend.y += (targetBendY - this.stemBend.y) * 0.08;

      // Bloom factor peaks when mouse clicks or hovers close
      const targetBloom = isMouseActive ? 1.0 : (mouseDistFromCenter < 0.25 ? 0.7 : 0.0);
      this.bloomFactor += (targetBloom - this.bloomFactor) * 0.08;
    } 
    else if (this.activeMode === 'bird') {
      // Bird Mode flight path calculations
      // Standard steering physics: bird position sways/chases the 3D mouse position
      const targetPos = mouse3D.clone();
      
      // Soaring gliding offset (lower frequency, smoother: time * 0.6 instead of 1.5)
      targetPos.y += Math.sin(time * 0.6) * 1.5;
      targetPos.z += Math.cos(time * 0.4) * 0.8;

      // Smooth tracking LERP for bird position
      // Slow, heavy bird inertia (glide speed)
      const prevPos = this.birdPos.clone();
      
      // Interpolate position with high damping LERP
      this.birdPos.lerp(targetPos, 0.045); // 4.5% glide LERP

      // Compute flight heading/velocity vector based on position delta
      this.birdVelocity.subVectors(this.birdPos, prevPos).multiplyScalar(1.0 / Math.max(0.001, dt));

      // Limit roll banking angle and low-pass filter rotations to prevent spastic tilts
      const targetRoll = Math.max(-0.65, Math.min(0.65, -this.birdVelocity.x * 0.08));
      const targetYaw = Math.atan2(this.birdVelocity.x, 8.0); // smooth yaw heading
      
      this.birdRotation.z += (targetRoll - this.birdRotation.z) * 0.06; // slower rotation LERP
      this.birdRotation.y += (targetYaw - this.birdRotation.y) * 0.06;

      // Update microphone voice level analysis
      this.micVolume = 0.0;
      if (this.micAnalyser && this.micDataArray) {
        this.micAnalyser.getByteFrequencyData(this.micDataArray as any);
        let sum = 0;
        for (let i = 0; i < this.micDataArray.length; i++) {
          sum += this.micDataArray[i];
        }
        this.micVolume = sum / this.micDataArray.length / 255.0;
      }

      // Base flap frequency is 6.5Hz, volume increases it up to 18Hz!
      const targetFlapFreq = 6.5 + this.micVolume * 12.0;
      this.flapFreq += (targetFlapFreq - this.flapFreq) * 0.15;
    }
  }

  private async initMicrophone(): Promise<void> {
    if (this.micStream) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.micContext = new AudioCtx();
      const source = this.micContext.createMediaStreamSource(stream);
      this.micAnalyser = this.micContext.createAnalyser();
      this.micAnalyser.fftSize = 64;
      source.connect(this.micAnalyser);
      
      const bufferLength = this.micAnalyser.frequencyBinCount;
      this.micDataArray = new Uint8Array(bufferLength);
      this.micStream = stream;
      console.log('Natural Mode: Microphone initialized for bird wing sync.');
    } catch (err) {
      console.warn('Natural Mode: Microphone access denied or unavailable. Static flap speed active.', err);
    }
  }

  private closeMicrophone(): void {
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }
    if (this.micContext) {
      this.micContext.close();
      this.micContext = null;
    }
    this.micAnalyser = null;
    this.micDataArray = null;
    this.micVolume = 0.0;
    console.log('Natural Mode: Microphone closed.');
  }
}
