import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import { NaturalInteractionController, type NaturalModeType } from '../utils/naturalController';

import {
  velocityShader,
  positionShader,
  renderVertexShader,
  renderFragmentShader
} from './gpgpuShaders';

export type PresetType = 'paint' | 'neon' | 'monolith' | 'nebula';
export type TimeOfDayType = 'auto' | 'morning' | 'midday' | 'evening' | 'night';

export class VisualEngine {
  private canvas: HTMLCanvasElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;

  // Lighting
  private ambientLight!: THREE.AmbientLight;
  private pointLight!: THREE.PointLight;
  private spotlight!: THREE.SpotLight;

  // GPGPU Computation
  private gpuCompute!: GPUComputationRenderer;
  private positionVariable!: any;
  private velocityVariable!: any;
  private initialPositionTexture!: THREE.DataTexture;
  private naturalController = new NaturalInteractionController();
  private renderMaterial!: THREE.ShaderMaterial;
  private pointsMesh!: THREE.Points;

  // Particle System Configuration
  private textureSize = 512; // Default size: 512x512 = 262,144 particles
  private activeParticles = 262144;
  
  // Simulation Variables
  private speed = 1.0;
  private turbulence = 1.5;
  private crowdDensity = 1.0;
  private timePreset: TimeOfDayType = 'auto';
  private currentPreset: PresetType = 'paint';
  private isLightMode = false;

  // Interaction State
  private mouse = new THREE.Vector2(0, 0);
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // Intersection plane at z=0
  private mouse3D = new THREE.Vector3(0, 0, 0);
  private isMouseActive = false;

  // Average velocity metric for audio integration
  private averageVelocity = 0.0;



  // Curated Coolors-inspired Color Palettes
  private palettes = {
    paint: [
      new THREE.Color('#e76f51'), // Terracotta
      new THREE.Color('#f4a261'), // Sandy Orange
      new THREE.Color('#e9c46a'), // Saffron Gold
      new THREE.Color('#2a9d8f'), // Persian Teal
      new THREE.Color('#264653')  // Charcoal Blue
    ],
    neon: [
      new THREE.Color('#ff007f'), // Acid Magenta
      new THREE.Color('#7b2cbf'), // Deep Violet
      new THREE.Color('#3f37c9'), // Electric Blue
      new THREE.Color('#4cc9f0'), // Electric Cyan
      new THREE.Color('#f72585')  // Bioluminescent Pink
    ],
    monolith: [
      new THREE.Color('#ede0d4'), // Alabaster Cream
      new THREE.Color('#ddb892'), // Warm Copper
      new THREE.Color('#7f5539'), // Terracotta Slate
      new THREE.Color('#9c6644'), // Sienna Stone
      new THREE.Color('#b5828c')  // Warm Rose Slate
    ],
    nebula: [
      new THREE.Color('#2b4c3f'), // Deep Moss
      new THREE.Color('#a3b19b'), // Sage Green
      new THREE.Color('#83c5be'), // Glacial Teal
      new THREE.Color('#edf6f9'), // Ice White
      new THREE.Color('#006d77')  // Deep Sea Forest
    ]
  };

  // Peak Highlight Colors for velocity transitions
  private highlights = {
    paint: new THREE.Color('#ffffff'),    // White foam
    neon: new THREE.Color('#39ff14'),     // Acid green
    monolith: new THREE.Color('#ffffff'), // Polished silver reflect
    nebula: new THREE.Color('#d8f3dc')    // Bright seafoam
  };

  // Webcam tracking states
  private webcamStream: MediaStream | null = null;
  private webcamVideo: HTMLVideoElement | null = null;
  private webcamCanvas: HTMLCanvasElement | null = null;
  private webcamCtx: CanvasRenderingContext2D | null = null;
  private prevBrightness = new Float32Array(64 * 64);
  private currentBrightness = new Float32Array(64 * 64);
  private motionData = new Float32Array(64 * 64 * 4);
  private motionTexture!: THREE.DataTexture;
  private isWebcamActive = false;
  private webcamVideoTexture: THREE.VideoTexture | null = null;
  private webcamAspect = 1.0;
  private dummyTexture!: THREE.DataTexture;

  constructor(canvasId: string, initialTextureSize = 512) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    
     // Create a fallback empty black texture for when the webcam is inactive
    this.dummyTexture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
    this.dummyTexture.needsUpdate = true;

    // Create motion tracking texture and canvas contexts
    this.webcamCanvas = document.createElement('canvas');
    this.webcamCanvas.width = 64;
    this.webcamCanvas.height = 64;
    this.webcamCtx = this.webcamCanvas.getContext('2d', { willReadFrequently: true });
    
    this.motionTexture = new THREE.DataTexture(
      this.motionData,
      64,
      64,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    this.motionTexture.minFilter = THREE.LinearFilter;
    this.motionTexture.magFilter = THREE.LinearFilter;
    this.motionTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.motionTexture.wrapT = THREE.ClampToEdgeWrapping;

    this.initThree();
    this.initGPGPU(initialTextureSize); // Set initial particle count
    this.applyPreset(this.currentPreset);
    this.setupEvents();
  }

  private initThree(): void {
    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#020204');
    this.scene.fog = new THREE.FogExp2('#020204', 0.012);

    // 2. Camera
    this.camera = new THREE.PerspectiveCamera(
      65,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 0, 16);

    // 3. WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.localClippingEnabled = true;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // 4. Lighting
    this.ambientLight = new THREE.AmbientLight('#ffffff', 0.15);
    this.scene.add(this.ambientLight);

    this.pointLight = new THREE.PointLight('#4cc9f0', 14, 50);
    this.pointLight.position.set(5, 5, 8);
    this.scene.add(this.pointLight);

    this.spotlight = new THREE.SpotLight('#ffffff', 25);
    this.spotlight.position.set(-15, 20, 12);
    this.spotlight.angle = Math.PI / 3.5;
    this.spotlight.penumbra = 0.9;
    this.scene.add(this.spotlight);

    // 5. Post Processing Pipeline
    const renderPass = new RenderPass(this.scene, this.camera);
    
    // Config UnrealBloomPass for dreamy glow (will be bypassed in light mode)
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.75, // Bloom Strength
      0.45, // Radius
      0.82  // Threshold
    );

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(this.bloomPass);


  }

  /**
   * Initializes GPGPU textures, variables, and shaders
   */
  private initGPGPU(size: number): void {
    // If GPGPU objects already exist, remove points mesh from scene
    if (this.pointsMesh) {
      this.scene.remove(this.pointsMesh);
      this.pointsMesh.geometry.dispose();
      (this.pointsMesh.material as THREE.ShaderMaterial).dispose();
    }

    this.textureSize = size;
    this.activeParticles = size * size;

    // Create GPU Computation Renderer
    this.gpuCompute = new GPUComputationRenderer(size, size, this.renderer);

    // Create Initial Textures
    const dtPosition = this.gpuCompute.createTexture();
    const dtVelocity = this.gpuCompute.createTexture();

    // Populate initial textures
    this.fillPositionTexture(dtPosition);
    this.fillVelocityTexture(dtVelocity);

    // Store a copy of initial positions to read during resets
    this.initialPositionTexture = dtPosition.clone();

    // Add variables to renderer
    this.positionVariable = this.gpuCompute.addVariable('texturePosition', positionShader, dtPosition);
    this.velocityVariable = this.gpuCompute.addVariable('textureVelocity', velocityShader, dtVelocity);

    // Set variable dependencies (each shader relies on both positions and velocities)
    this.gpuCompute.setVariableDependencies(this.positionVariable, [this.positionVariable, this.velocityVariable]);
    this.gpuCompute.setVariableDependencies(this.velocityVariable, [this.positionVariable, this.velocityVariable]);

    // Setup Shader Uniforms
    // Position Shaders
    this.positionVariable.material.uniforms.uTime = { value: 0.0 };
    this.positionVariable.material.uniforms.uDeltaTime = { value: 0.0 };
    this.positionVariable.material.uniforms.uInitialPosition = { value: this.initialPositionTexture };

    // Velocity Shaders
    this.velocityVariable.material.uniforms.uTime = { value: 0.0 };
    this.velocityVariable.material.uniforms.uSpeed = { value: this.speed };
    this.velocityVariable.material.uniforms.uTurbulence = { value: this.turbulence };
    this.velocityVariable.material.uniforms.uCrowdDensity = { value: this.crowdDensity };
    this.velocityVariable.material.uniforms.uMouse3D = { value: this.mouse3D };
    this.velocityVariable.material.uniforms.uMouseActive = { value: 0.0 };
    this.velocityVariable.material.uniforms.uMotionTexture = { value: this.motionTexture };
    this.velocityVariable.material.uniforms.uWebcamActive = { value: 0.0 };
    this.velocityVariable.material.uniforms.uWebcamTexture = { value: this.webcamVideoTexture || this.dummyTexture };
    this.velocityVariable.material.uniforms.uWebcamMirrorActive = { value: this.isWebcamActive ? 1.0 : 0.0 };
    this.velocityVariable.material.uniforms.uFriendTexture = { value: this.dummyTexture };
    this.velocityVariable.material.uniforms.uFriendMirrorActive = { value: 0.0 };
    this.velocityVariable.material.uniforms.uFriendModeActive = { value: 0.0 };
    this.velocityVariable.material.uniforms.uScreenAspect = { value: window.innerWidth / window.innerHeight };
    this.velocityVariable.material.uniforms.uTargetAspect = { value: 1.0 };
    this.velocityVariable.material.uniforms.uShapeOffset = { value: new THREE.Vector2(0, 0) };
    this.velocityVariable.material.uniforms.uShapeRotation = { value: 0.0 };
    this.velocityVariable.material.uniforms.uShapeScale = { value: 1.0 };
    this.velocityVariable.material.uniforms.uNaturalMode = { value: 0.0 };
    this.velocityVariable.material.uniforms.uBirdPos = { value: new THREE.Vector3(0, 0, 0) };
    this.velocityVariable.material.uniforms.uBirdRotation = { value: new THREE.Vector3(0, 0, 0) };
    this.velocityVariable.material.uniforms.uFlapFreq = { value: 6.5 };
    this.velocityVariable.material.uniforms.uRippleAmp = { value: 0.0 };
    this.velocityVariable.material.uniforms.uStemBend = { value: new THREE.Vector2(0, 0) };
    this.velocityVariable.material.uniforms.uBloomFactor = { value: 0.0 };

    // Initialize renderer
    const error = this.gpuCompute.init();
    if (error !== null) {
      console.error('GPGPU Initialization Error:', error);
    }

    // Create Render Geometry
    const count = this.activeParticles;
    const geometry = new THREE.BufferGeometry();

    const positions = new Float32Array(count * 3);
    const references = new Float32Array(count * 2);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const i2 = i * 2;

      // Positions can remain zero; shader maps coordinates using references
      positions[i3] = 0;
      positions[i3 + 1] = 0;
      positions[i3 + 2] = 0;

      // UV coordinates of pixel inside GPGPU simulation texture
      const x = i % size;
      const y = Math.floor(i / size);
      references[i2] = (x + 0.5) / size;
      references[i2 + 1] = (y + 0.5) / size;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('reference', new THREE.BufferAttribute(references, 2));

    // Custom Shader Material for rendering GPGPU output
    this.renderMaterial = new THREE.ShaderMaterial({
      vertexShader: renderVertexShader,
      fragmentShader: renderFragmentShader,
      uniforms: {
        uPositionTexture: { value: null },
        uVelocityTexture: { value: null },
        uPointSize: { value: 3.2 },
        uDensityScale: { value: 1.0 },
        uBaseColors: { value: this.palettes[this.currentPreset] },
        uHighlightColor: { value: this.highlights[this.currentPreset] },
        uOpacity: { value: 0.40 },
        uWebcamTexture: { value: this.webcamVideoTexture || this.dummyTexture },
        uWebcamMirrorActive: { value: this.isWebcamActive ? 1.0 : 0.0 },
        uWebcamActive: { value: 0.0 },
        uFriendTexture: { value: this.dummyTexture },
        uFriendMirrorActive: { value: 0.0 },
        uFriendModeActive: { value: 0.0 },
        uScreenAspect: { value: window.innerWidth / window.innerHeight },
        uTargetAspect: { value: 1.0 },
        uShapeOffset: { value: new THREE.Vector2(0, 0) },
        uShapeRotation: { value: 0.0 },
        uShapeScale: { value: 1.0 },
        uNaturalMode: { value: 0.0 }
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    // Create point cloud
    this.pointsMesh = new THREE.Points(geometry, this.renderMaterial);
    this.scene.add(this.pointsMesh);
  }

  private fillPositionTexture(texture: THREE.DataTexture): void {
    const data = texture.image.data as Float32Array;
    if (!data) return;
    for (let i = 0; i < data.length; i += 4) {
      // Spawn particles randomly in a wide 3D viewport region
      data[i] = (Math.random() - 0.5) * 36;
      data[i + 1] = (Math.random() - 0.5) * 20;
      data[i + 2] = (Math.random() - 0.5) * 8;
      data[i + 3] = Math.random(); // mass/scale
    }
  }

  private fillVelocityTexture(texture: THREE.DataTexture): void {
    const data = texture.image.data as Float32Array;
    if (!data) return;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = (Math.random() - 0.5) * 0.5;
      data[i + 1] = (Math.random() - 0.5) * 0.5;
      data[i + 2] = (Math.random() - 0.5) * 0.2;
      data[i + 3] = 1.0;
    }
  }

  private applyTimeOfDayPalette(): void {
    let bg: string;
    let lightColor: string;
    let intensity = 1.0;

    let selectedTime = this.timePreset;
    if (selectedTime === 'auto') {
      const hours = new Date().getHours();
      if (hours >= 6 && hours < 12) selectedTime = 'morning';
      else if (hours >= 12 && hours < 17) selectedTime = 'midday';
      else if (hours >= 17 && hours < 21) selectedTime = 'evening';
      else selectedTime = 'night';
    }

    if (this.isLightMode) {
      bg = '#f3f3f6'; // Warm alabaster plaster white
      lightColor = '#ffffff';
      intensity = 1.5;
      
      this.ambientLight.color.set('#ffffff');
      this.ambientLight.intensity = 0.55; // high ambient brightness for soft white look
      this.spotlight.intensity = 14;
    } else {
      this.ambientLight.color.set('#ffffff');
      this.ambientLight.intensity = 0.15;
      this.spotlight.intensity = 25;

      switch (selectedTime) {
        case 'morning':
          bg = '#060c14'; // Cool silver dawn
          lightColor = '#94d2bd';
          intensity = 1.3;
          break;
        case 'midday':
          bg = '#140c04'; // Warm amber sun
          lightColor = '#ee9b00';
          intensity = 1.6;
          break;
        case 'evening':
          bg = '#0d0414'; // Indigo dusk
          lightColor = '#ae2012';
          intensity = 1.2;
          break;
        case 'night':
        default:
          bg = '#010103'; // Bioluminescent night
          lightColor = '#005f73';
          intensity = 0.95;
          break;
      }
    }

    this.scene.background = new THREE.Color(bg);
    this.scene.fog = new THREE.FogExp2(bg, 0.012);
    this.pointLight.color.set(lightColor);
    this.pointLight.intensity = 14 * intensity;
  }

  private setupEvents(): void {
    window.addEventListener('resize', () => this.handleResize());
    window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    window.addEventListener('touchmove', (e) => this.handleTouchMove(e));
    window.addEventListener('mousedown', () => { this.isMouseActive = true; });
    window.addEventListener('mouseup', () => { this.isMouseActive = false; });
    window.addEventListener('touchstart', () => { this.isMouseActive = true; });
    window.addEventListener('touchend', () => { this.isMouseActive = false; });
  }

  private handleResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.bloomPass.setSize(window.innerWidth, window.innerHeight);
  }

  private handleMouseMove(e: MouseEvent): void {
    this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  }

  private handleTouchMove(e: TouchEvent): void {
    if (e.touches.length > 0) {
      this.mouse.x = (e.touches[0].clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.touches[0].clientY / window.innerHeight) * 2 + 1;
    }
  }

  /**
   * Main Frame Loop
   * Updates GPGPU Computation pass and renders.
   */
  public update(dt: number, time: number): void {
    this.applyTimeOfDayPalette();

    // Keep background GPGPU particles visible
    if (this.pointsMesh) {
      this.pointsMesh.visible = true;
    }

    // Spotlight orbits slowly
    this.spotlight.position.x = Math.sin(time * 0.12) * 16;
    this.spotlight.position.y = 14 + Math.cos(time * 0.06) * 4;

    // Raycast mouse position
    this.raycaster.setFromCamera(this.mouse, this.camera);
    this.raycaster.ray.intersectPlane(this.plane, this.mouse3D);

    // Update webcam motion texture buffer if enabled
    if (this.isWebcamActive) {
      this.updateWebcamMotionTexture();
    }

    // Update natural elements simulation states
    this.naturalController.update(time, dt, this.mouse, this.isMouseActive, this.mouse3D);
    const modeStr = this.naturalController.getMode();
    let modeVal = 0.0;
    if (modeStr === 'water') modeVal = 1.0;
    else if (modeStr === 'flowers') modeVal = 2.0;
    else if (modeStr === 'bird') modeVal = 3.0;

    // 1. Update GPGPU simulation uniforms
    this.positionVariable.material.uniforms.uTime.value = time;
    this.positionVariable.material.uniforms.uDeltaTime.value = dt;

    this.velocityVariable.material.uniforms.uTime.value = time;
    this.velocityVariable.material.uniforms.uSpeed.value = this.speed;
    this.velocityVariable.material.uniforms.uTurbulence.value = this.turbulence;
    this.velocityVariable.material.uniforms.uCrowdDensity.value = this.crowdDensity;
    this.velocityVariable.material.uniforms.uMouse3D.value.copy(this.mouse3D);
    this.velocityVariable.material.uniforms.uMouseActive.value = this.isMouseActive ? 1.0 : 0.0;
    this.velocityVariable.material.uniforms.uMotionTexture.value = this.motionTexture;
    this.velocityVariable.material.uniforms.uWebcamActive.value = this.isWebcamActive ? 1.0 : 0.0;
    this.velocityVariable.material.uniforms.uFriendMirrorActive.value = 0.0;
    this.velocityVariable.material.uniforms.uFriendModeActive.value = 0.0;
    this.velocityVariable.material.uniforms.uShapeOffset.value.set(0.0, 0.0);
    this.velocityVariable.material.uniforms.uShapeRotation.value = 0.0;
    this.velocityVariable.material.uniforms.uShapeScale.value = 1.0;
    this.velocityVariable.material.uniforms.uNaturalMode.value = modeVal;
    this.velocityVariable.material.uniforms.uBirdPos.value.copy(this.naturalController.getBirdPos());
    this.velocityVariable.material.uniforms.uBirdRotation.value.copy(this.naturalController.getBirdRotation());
    this.velocityVariable.material.uniforms.uFlapFreq.value = this.naturalController.getFlapFreq();
    this.velocityVariable.material.uniforms.uRippleAmp.value = this.naturalController.getRippleAmp();
    this.velocityVariable.material.uniforms.uStemBend.value.copy(this.naturalController.getStemBend());
    this.velocityVariable.material.uniforms.uBloomFactor.value = this.naturalController.getBloomFactor();

    this.renderMaterial.uniforms.uWebcamActive.value = this.isWebcamActive ? 1.0 : 0.0;
    this.renderMaterial.uniforms.uFriendMirrorActive.value = 0.0;
    this.renderMaterial.uniforms.uFriendModeActive.value = 0.0;
    this.renderMaterial.uniforms.uShapeOffset.value.set(0.0, 0.0);
    this.renderMaterial.uniforms.uShapeRotation.value = 0.0;
    this.renderMaterial.uniforms.uShapeScale.value = 1.0;
    this.renderMaterial.uniforms.uNaturalMode.value = modeVal;

    // Dynamically calculate and update aspect ratio scaling uniforms
    const screenAspect = window.innerWidth / window.innerHeight;
    const targetAspect = this.webcamAspect;
    this.velocityVariable.material.uniforms.uScreenAspect.value = screenAspect;
    this.velocityVariable.material.uniforms.uTargetAspect.value = targetAspect;
    this.renderMaterial.uniforms.uScreenAspect.value = screenAspect;
    this.renderMaterial.uniforms.uTargetAspect.value = targetAspect;

    // 2. Compute GPGPU step on GPU
    this.gpuCompute.compute();

    // 3. Link output textures to the rendering material
    this.renderMaterial.uniforms.uPositionTexture.value = this.gpuCompute.getCurrentRenderTarget(this.positionVariable).texture;
    this.renderMaterial.uniforms.uVelocityTexture.value = this.gpuCompute.getCurrentRenderTarget(this.velocityVariable).texture;

    // 4. Mathematical scaling factor: shrink particles as count increases to avoid layout saturation
    // Reference base is 262,144 particles at 100% scale
    const densityScale = Math.pow(262144.0 / this.activeParticles, 0.22);
    this.renderMaterial.uniforms.uDensityScale.value = densityScale;

    // 5. Render post-processing passes
    this.composer.render();

    // Analytical estimate of average velocity to avoid CPU block readPixels
    this.averageVelocity = 0.4 + this.speed * 0.5 + this.turbulence * 0.2;
  }

  // Setters for Dynamic UI Adjustments
  public setSpeed(value: number): void {
    this.speed = value;
  }

  public setTurbulence(value: number): void {
    this.turbulence = value;
  }

  public setCrowdDensity(value: number): void {
    this.crowdDensity = value;
  }

  public setTimePreset(value: TimeOfDayType): void {
    this.timePreset = value;
  }

  public setNaturalMode(mode: NaturalModeType): void {
    this.naturalController.setMode(mode);
  }

  /**
   * Updates particle count by re-initializing GPGPU textures at appropriate dimensions
   */
  public setParticleCount(value: number): void {
    let newSize = 512;
    if (value <= 65536) {
      newSize = 256; // 65,536
    } else if (value <= 262144) {
      newSize = 512; // 262,144
    } else {
      newSize = 1024; // 1,048,576
    }

    if (newSize !== this.textureSize) {
      console.log(`Re-initializing GPGPU for particle size: ${newSize * newSize}`);
      this.initGPGPU(newSize);
      this.applyPreset(this.currentPreset);
      this.setLightMode(this.isLightMode);
    }
  }

  public setLightMode(isLight: boolean): void {
    this.isLightMode = isLight;

    if (isLight) {
      // Bypasses bloom completely so bright white background does not wash out the screen
      this.bloomPass.strength = 0.0;
      this.bloomPass.threshold = 1.0;

      // Adjust particle rendering material attributes for light mode contrast
      this.renderMaterial.blending = THREE.NormalBlending; // opaque blend
      this.renderMaterial.depthWrite = true;
      this.renderMaterial.uniforms.uOpacity.value = 0.85; // higher opacity
      this.renderMaterial.uniforms.uPointSize.value = 4.0; // slightly larger dot size
    } else {
      this.applyPreset(this.currentPreset); // Restore preset bloom/blending
    }
  }

  public getAverageVelocity(): number {
    return this.averageVelocity;
  }

  public getActiveParticleCount(): number {
    return this.activeParticles;
  }

  /**
   * Curated visual presets with color palettes
   */
  public applyPreset(preset: PresetType): void {
    if (!preset || !this.palettes[preset]) return;
    this.currentPreset = preset;
    
    if (!this.renderMaterial) return;

    // Load base and highlight colors
    this.renderMaterial.uniforms.uBaseColors.value = this.palettes[preset];
    this.renderMaterial.uniforms.uHighlightColor.value = this.highlights[preset];

    // Toggle blending and bloom based on preset (when in dark mode)
    if (!this.isLightMode) {
      this.renderMaterial.blending = THREE.AdditiveBlending;
      this.renderMaterial.depthWrite = false;
      this.renderMaterial.uniforms.uOpacity.value = 0.40;
      this.renderMaterial.uniforms.uPointSize.value = 3.2;

      switch (preset) {
        case 'paint':
          this.bloomPass.strength = 0.65;
          this.bloomPass.radius = 0.4;
          this.bloomPass.threshold = 0.82;
          break;
        case 'neon':
          this.bloomPass.strength = 1.35; // Intense Cyberpunk bloom
          this.bloomPass.radius = 0.55;
          this.bloomPass.threshold = 0.75;
          this.renderMaterial.uniforms.uOpacity.value = 0.48;
          break;
        case 'monolith':
          this.bloomPass.strength = 0.35;
          this.bloomPass.radius = 0.25;
          this.bloomPass.threshold = 0.85;
          this.renderMaterial.uniforms.uPointSize.value = 3.5;
          break;
        case 'nebula':
          this.bloomPass.strength = 0.95;
          this.bloomPass.radius = 0.5;
          this.bloomPass.threshold = 0.8;
          break;
      }
    }
  }

  /**
   * Initializes webcam and sets up streaming elements
   */
  public async setWebcamActive(active: boolean): Promise<boolean> {
    if (active === this.isWebcamActive) return active;
    
    if (active) {
      this.webcamVideo = document.getElementById('webcam-video') as HTMLVideoElement;
      if (!this.webcamVideo) {
        console.error('Webcam video element not found in DOM.');
        return false;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 320, facingMode: 'user' },
          audio: false
        });
        
        this.webcamStream = stream;
        this.webcamVideo.srcObject = stream;
        this.webcamVideo.play();

        // Listen for metadata to calculate correct aspect ratio of camera stream
        this.webcamVideo.onloadedmetadata = () => {
          if (this.webcamVideo) {
            const w = this.webcamVideo.videoWidth;
            const h = this.webcamVideo.videoHeight;
            if (w > 0 && h > 0) {
              this.webcamAspect = w / h;
              console.log(`Webcam aspect ratio metadata loaded: ${this.webcamAspect}`);
            }
          }
        };
        if (this.webcamVideo.videoWidth > 0 && this.webcamVideo.videoHeight > 0) {
          this.webcamAspect = this.webcamVideo.videoWidth / this.webcamVideo.videoHeight;
        }
        
        // Initialize Three.js VideoTexture from the webcam element
        this.webcamVideoTexture = new THREE.VideoTexture(this.webcamVideo);
        this.webcamVideoTexture.minFilter = THREE.LinearFilter;
        this.webcamVideoTexture.magFilter = THREE.LinearFilter;
        this.webcamVideoTexture.format = THREE.RGBAFormat;

        // Bind texture to GPGPU velocity and rendering material uniforms
        if (this.velocityVariable) {
          this.velocityVariable.material.uniforms.uWebcamTexture.value = this.webcamVideoTexture;
          this.velocityVariable.material.uniforms.uWebcamMirrorActive.value = 1.0;
        }
        if (this.renderMaterial) {
          this.renderMaterial.uniforms.uWebcamTexture.value = this.webcamVideoTexture;
          this.renderMaterial.uniforms.uWebcamMirrorActive.value = 1.0;
        }

        this.isWebcamActive = true;
        
        // Warm up previous frame buffer
        this.prevBrightness.fill(0);
        console.log('Webcam initialized successfully.');
        return true;
      } catch (err) {
        console.error('Error accessing webcam:', err);
        this.isWebcamActive = false;
        return false;
      }
    } else {
      this.closeWebcam();
      this.isWebcamActive = false;
      return false;
    }
  }



  private closeWebcam(): void {
    if (this.webcamStream) {
      this.webcamStream.getTracks().forEach((track) => track.stop());
      this.webcamStream = null;
    }
    if (this.webcamVideo) {
      this.webcamVideo.srcObject = null;
      this.webcamVideo.pause();
    }
    
    // Dispose the webcam video texture if it exists
    if (this.webcamVideoTexture) {
      this.webcamVideoTexture.dispose();
      this.webcamVideoTexture = null;
    }
    
    // Bind dummy texture back and reset active states
    if (this.velocityVariable) {
      this.velocityVariable.material.uniforms.uWebcamTexture.value = this.dummyTexture;
      this.velocityVariable.material.uniforms.uWebcamMirrorActive.value = 0.0;
    }
    if (this.renderMaterial) {
      this.renderMaterial.uniforms.uWebcamTexture.value = this.dummyTexture;
      this.renderMaterial.uniforms.uWebcamMirrorActive.value = 0.0;
    }

    // Reset motion data texture buffer to zeros
    this.motionData.fill(0);
    this.motionTexture.needsUpdate = true;
    this.webcamAspect = 1.0;
    console.log('Webcam closed.');
  }





  /**
   * Reads current video frame, computes optical flow vectors and updates motionTexture
   */
  private updateWebcamMotionTexture(): void {
    if (!this.isWebcamActive || !this.webcamVideo || !this.webcamCtx) return;
    
    // Check if video is playing and has data
    if (this.webcamVideo.readyState >= 2) {
      const size = 64;
      
      // Draw webcam frame onto 64x64 helper canvas
      this.webcamCtx.drawImage(this.webcamVideo, 0, 0, size, size);
      
      const imgData = this.webcamCtx.getImageData(0, 0, size, size);
      const pixels = imgData.data;

      // 1. Calculate luminance grid for current frame
      for (let i = 0; i < size * size; i++) {
        const idx = i * 4;
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];
        this.currentBrightness[i] = r * 0.299 + g * 0.587 + b * 0.114;
      }

      // 2. Compute spatial and temporal gradients to calculate optical flow
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = y * size + x;
          const i4 = i * 4;

          // Temporal gradient (difference over time)
          const diff = this.currentBrightness[i] - this.prevBrightness[i];

          // Spatial gradients: neighboring pixel differences
          const xLeft = x > 0 ? x - 1 : x;
          const xRight = x < size - 1 ? x + 1 : x;
          const yTop = y > 0 ? y - 1 : y;
          const yBottom = y < size - 1 ? y + 1 : y;

          const dx = this.currentBrightness[y * size + xRight] - this.currentBrightness[y * size + xLeft];
          const dy = this.currentBrightness[yBottom * size + x] - this.currentBrightness[yTop * size + x];

          // Compute optical flow: velocity = -diff * grad / (gradSq + epsilon)
          const gradSq = dx * dx + dy * dy + 0.08; // epsilon prevents division by zero
          
          // Mirror horizontal speed (since webcam user sees a mirrored view)
          let vx = (diff * dx) / gradSq; 
          let vy = -(diff * dy) / gradSq;

          // Normalize and scale velocity values
          vx = Math.max(-4.0, Math.min(4.0, vx * 0.18));
          vy = Math.max(-4.0, Math.min(4.0, vy * 0.18));
          
          // Calculate motion magnitude
          const intensity = Math.min(1.0, Math.abs(diff) / 25.0);

          // Write vectors to texture data buffer
          this.motionData[i4] = vx;
          this.motionData[i4 + 1] = vy;
          this.motionData[i4 + 2] = intensity; // Force intensity scale
          this.motionData[i4 + 3] = 1.0;
        }
      }

      // Swap buffers
      this.prevBrightness.set(this.currentBrightness);
      
      // Notify Three.js that the texture buffer changed
      this.motionTexture.needsUpdate = true;
    }
  }
}

