import './style.css';
import { VisualEngine } from './visuals/visualEngine';
import type { PresetType, TimeOfDayType } from './visuals/visualEngine';
import { AudioEngine } from './audio/audioEngine';

// Global variables
let visualEngine: VisualEngine;
let audioEngine: AudioEngine;
let lastTime = 0;
let isStarted = false;

// DOM Elements
const splashOverlay = document.getElementById('splash-overlay') as HTMLDivElement;
const enterBtn = document.getElementById('enter-btn') as HTMLButtonElement;
const dashboard = document.getElementById('dashboard') as HTMLDivElement;
const dashboardTab = document.getElementById('dashboard-tab') as HTMLButtonElement;
const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement;

// Preset cards
const presetCards = document.querySelectorAll('.preset-card');

// Sliders and Selects
const speedSlider = document.getElementById('speed-slider') as HTMLInputElement;
const speedVal = document.getElementById('speed-val') as HTMLSpanElement;

const turbulenceSlider = document.getElementById('turbulence-slider') as HTMLInputElement;
const turbulenceVal = document.getElementById('turbulence-val') as HTMLSpanElement;

const particleSlider = document.getElementById('particle-slider') as HTMLInputElement;
const particleVal = document.getElementById('particle-val') as HTMLSpanElement;

const volumeSlider = document.getElementById('volume-slider') as HTMLInputElement;
const volumeVal = document.getElementById('volume-val') as HTMLSpanElement;
const audioToggle = document.getElementById('audio-toggle') as HTMLInputElement;
const webcamToggle = document.getElementById('webcam-toggle') as HTMLInputElement;

const crowdSlider = document.getElementById('crowd-slider') as HTMLInputElement;
const crowdVal = document.getElementById('crowd-val') as HTMLSpanElement;

const timeSelect = document.getElementById('time-select') as HTMLSelectElement;
const lightModeToggle = document.getElementById('light-mode-toggle') as HTMLInputElement;
const recordBtn = document.getElementById('record-btn') as HTMLButtonElement;

/**
 * Main Loop
 */
function animate(currentTime: number): void {
  requestAnimationFrame(animate);

  // Convert time to seconds
  const timeInSeconds = currentTime * 0.001;
  const dt = Math.min(timeInSeconds - lastTime, 0.1); // Cap delta time to prevent physics explosions
  lastTime = timeInSeconds;

  if (visualEngine) {
    visualEngine.update(dt, timeInSeconds);
  }

  // Modulate audio synthesis parameters dynamically based on particle velocity
  if (audioEngine && isStarted && visualEngine) {
    const avgVel = visualEngine.getAverageVelocity();
    audioEngine.modulateFilter(avgVel);

    // Dynamic chimes triggered by wave velocity peaks
    if (avgVel > 1.15 && Math.random() < 0.08) {
      const intensity = Math.min(1.0, (avgVel - 1.15) * 1.5);
      audioEngine.triggerChime(intensity);
    }
  }

  // Occasional random chimes during high turbulence
  if (audioEngine && isStarted && Math.random() < 0.002) {
    const t = parseFloat(turbulenceSlider.value);
    if (t > 2.0) {
      audioEngine.triggerChime(0.5 + Math.random() * 0.5);
    }
  }
}

/**
 * Initializes visual and audio engines and removes splash card.
 */
async function startApp(): Promise<void> {
  if (isStarted) return;
  isStarted = true;

  // Initialize Web Audio Engine
  audioEngine = new AudioEngine();
  await audioEngine.init();

  // Initialize WebGL/Three.js Engine
  visualEngine = new VisualEngine('webgl-canvas');

  // Trigger initial volume settings
  audioEngine.setVolume(parseInt(volumeSlider.value));
  audioEngine.setMute(!audioToggle.checked);

  // Animate transition out for splash card
  splashOverlay.classList.add('hidden');
  
  // Show UI after a brief delay
  setTimeout(() => {
    dashboard.style.display = 'flex';
  }, 1000);

  // Launch full-screen mode for the projection experience
  requestFullscreen();

  // Start frame loop
  lastTime = performance.now() * 0.001;
  requestAnimationFrame(animate);
}

/**
 * Enters fullscreen mode
 */
function requestFullscreen(): void {
  const docEl = document.documentElement;
  if (docEl.requestFullscreen) {
    docEl.requestFullscreen();
  } else if ((docEl as any).webkitRequestFullscreen) {
    (docEl as any).webkitRequestFullscreen();
  } else if ((docEl as any).msRequestFullscreen) {
    (docEl as any).msRequestFullscreen();
  }
}

/**
 * Toggle Fullscreen
 */
function toggleFullscreen(): void {
  if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
    requestFullscreen();
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if ((document as any).webkitExitFullscreen) {
      (document as any).webkitExitFullscreen();
    }
  }
}

let isEventsBound = false;

/**
 * Bind DOM Event Listeners
 */
function bindEvents(): void {
  if (isEventsBound) return;
  isEventsBound = true;

  // Splash unlock button
  enterBtn.addEventListener('click', () => startApp());

  // UI Side-Drawer Toggle Tab
  dashboardTab.addEventListener('click', () => {
    dashboard.classList.toggle('collapsed');
  });

  // Presets selector
  presetCards.forEach((card) => {
    card.addEventListener('click', () => {
      presetCards.forEach((c) => c.classList.remove('active'));
      card.classList.add('active');

      const preset = card.getAttribute('data-preset') as PresetType;
      if (visualEngine) {
        visualEngine.applyPreset(preset);
      }

      // Play soft transition chime
      if (audioEngine) {
        audioEngine.triggerChime(0.8);
      }
    });
  });

  // Flow speed
  speedSlider.addEventListener('input', () => {
    const val = parseFloat(speedSlider.value);
    speedVal.textContent = val.toFixed(1) + 'x';
    if (visualEngine) {
      visualEngine.setSpeed(val);
    }
  });

  // Turbulence
  turbulenceSlider.addEventListener('input', () => {
    const val = parseFloat(turbulenceSlider.value);
    turbulenceVal.textContent = val.toFixed(1);
    if (visualEngine) {
      visualEngine.setTurbulence(val);
    }
  });

  // Particle Count
  particleSlider.addEventListener('input', () => {
    const val = parseInt(particleSlider.value);
    let count = 262144;
    let label = '262,144 (Medium)';
    if (val === 1) {
      count = 65536;
      label = '65,536 (Low)';
    } else if (val === 3) {
      count = 1048576;
      label = '1,048,576 (High)';
    }

    particleVal.textContent = label;
    if (visualEngine) {
      visualEngine.setParticleCount(count);
    }
  });

  // Volume
  volumeSlider.addEventListener('input', () => {
    const val = parseInt(volumeSlider.value);
    volumeVal.textContent = val + '%';
    if (audioEngine) {
      audioEngine.setVolume(val);
    }
  });

  // Audio Toggle
  audioToggle.addEventListener('change', () => {
    if (audioEngine) {
      audioEngine.setMute(!audioToggle.checked);
    }
  });

  // Crowd Density
  crowdSlider.addEventListener('input', () => {
    const val = parseInt(crowdSlider.value);
    let label = 'Low';
    if (val === 1) label = 'Medium';
    else if (val === 2) label = 'High';
    else if (val === 3) label = 'Max';
    
    crowdVal.textContent = label;
    
    if (visualEngine) {
      visualEngine.setCrowdDensity(val);
    }

    // Trigger dynamic interaction chime
    if (audioEngine && val > 1) {
      audioEngine.triggerChime(0.15 * val);
    }
  });

  // Time of Day selector
  timeSelect.addEventListener('change', () => {
    if (visualEngine) {
      visualEngine.setTimePreset(timeSelect.value as TimeOfDayType);
    }
  });

  // Light Mode toggle
  lightModeToggle.addEventListener('change', () => {
    const isLight = lightModeToggle.checked;
    if (isLight) {
      document.body.classList.add('light-mode');
    } else {
      document.body.classList.remove('light-mode');
    }
    if (visualEngine) {
      visualEngine.setLightMode(isLight);
    }
  });

  // Webcam Interaction toggle
  webcamToggle.addEventListener('change', async () => {
    if (visualEngine) {
      const active = webcamToggle.checked;
      const success = await visualEngine.setWebcamActive(active);
      if (!success && active) {
        webcamToggle.checked = false; // Reset UI switch if permissions are rejected
      }
    }
  });

  // Fullscreen button
  fullscreenBtn.addEventListener('click', () => toggleFullscreen());

  // Record 5s Clip button
  let mediaRecorder: MediaRecorder | null = null;
  let recordedChunks: Blob[] = [];

  recordBtn.addEventListener('click', () => {
    if (!visualEngine) return;
    
    const canvas = document.getElementById('webgl-canvas') as HTMLCanvasElement;
    if (!canvas) return;

    if (recordBtn.classList.contains('recording')) {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
      return;
    }

    recordedChunks = [];
    
    try {
      const stream = (canvas as any).captureStream ? (canvas as any).captureStream(60) : (canvas as any).mozCaptureStream ? (canvas as any).mozCaptureStream(60) : null;
      if (!stream) {
        alert('Canvas recording is not supported in this browser.');
        return;
      }

      let options = { mimeType: 'video/webm;codecs=vp9' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/webm;codecs=vp8' };
      }
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/webm' };
      }
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: '' };
      }

      mediaRecorder = new MediaRecorder(stream, options);
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordedChunks.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        recordBtn.classList.remove('recording');
        recordBtn.innerHTML = '<span class="record-dot"></span>Record Clip';
        
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = 'latent-currents-clip.webm';
        a.click();
        
        setTimeout(() => URL.revokeObjectURL(url), 100);
      };

      recordBtn.classList.add('recording');
      recordBtn.innerHTML = '<span class="record-dot"></span>Recording...';

      mediaRecorder.start();

      setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }
      }, 5000);

    } catch (err) {
      console.error('Failed to record canvas:', err);
      alert('Failed to start recording.');
      recordBtn.classList.remove('recording');
      recordBtn.innerHTML = '<span class="record-dot"></span>Record Clip';
    }
  });

  // Interactive chimes: clicking canvas repels particles and plays a sound
  window.addEventListener('mousedown', (e) => {
    if (!isStarted || !audioEngine) return;
    
    // Ignore clicks on control panels
    const target = e.target as HTMLElement;
    if (target.closest('#dashboard') || target.closest('#toggle-ui-btn') || target.closest('#splash-overlay')) {
      return;
    }

    // Play chime on interaction
    audioEngine.triggerChime(0.6 + Math.random() * 0.4);
  });

  window.addEventListener('touchstart', (e) => {
    if (!isStarted || !audioEngine) return;
    
    const target = e.target as HTMLElement;
    if (target.closest('#dashboard') || target.closest('#toggle-ui-btn') || target.closest('#splash-overlay')) {
      return;
    }

    audioEngine.triggerChime(0.5 + Math.random() * 0.3);
  });
}

// Bind events on load
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
});

// Polyfill in case DOMContentLoaded already fired
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  bindEvents();
}
