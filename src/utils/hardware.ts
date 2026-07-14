/**
 * Hardware Diagnostic Utility for Latent Currents
 * Analyzes device capabilities to predict WebGL/GPGPU performance and suggest optimizations.
 */

export interface HardwareProfile {
  deviceType: 'mobile' | 'desktop';
  cores: number;
  memoryGb?: number;
  gpuRenderer?: string;
  gpuVendor?: string;
  isLowEnd: boolean;
  warningReason?: string;
}

export function detectHardware(): HardwareProfile {
  // Safe defaults in case of complete API failure
  let cores = 4;
  let memoryGb: number | undefined = undefined;
  let deviceType: 'mobile' | 'desktop' = 'desktop';
  let gpuRenderer = 'Unknown GPU';
  let gpuVendor = 'Unknown Vendor';
  let hasFloatTextures = false;
  let isLowEnd = false;
  let warningReason = '';

  try {
    cores = navigator.hardwareConcurrency || 4;
    memoryGb = (navigator as any).deviceMemory;
    
    const ua = navigator.userAgent || '';
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    const hasTouch = ('ontouchstart' in window) || (navigator && navigator.maxTouchPoints > 0);
    deviceType = (isMobileUA || (hasTouch && window.innerWidth < 1024)) ? 'mobile' : 'desktop';

    // TV User Agent check
    const isTV = /SmartTV|Tizen|Web0S|MapGuide|Opera TV|SamsungBrowser/i.test(ua);
    if (isTV) {
      isLowEnd = true;
      warningReason = 'Smart TV browser detected (hardware constraints)';
    }

    const canvas = document.createElement('canvas');
    // Request WebGL2 first, then fallback to WebGL
    const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as (WebGLRenderingContext | WebGL2RenderingContext | null);
    
    if (gl) {
      // Check float texture support (essential for GPGPU simulation)
      const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
      if (isWebGL2) {
        // WebGL2 supports float textures out-of-the-box, but we check the color buffer float extension
        hasFloatTextures = !!gl.getExtension('EXT_color_buffer_float');
      } else {
        hasFloatTextures = !!(gl as WebGLRenderingContext).getExtension('OES_texture_float');
      }

      // Check debug renderer info
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        gpuRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'Unknown GPU';
        gpuVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || 'Unknown Vendor';
      }
    }
  } catch (e) {
    console.error('Error during hardware detection, applying safe fallback:', e);
    isLowEnd = true;
    warningReason = 'Hardware diagnostics failed to complete';
  }

  // Core hardware constraints evaluations (if not already flagged as low-end by exceptions/TV UA)
  if (!isLowEnd) {
    if (!hasFloatTextures) {
      isLowEnd = true;
      warningReason = 'WebGL float texture filtering is not supported by your browser/hardware';
    } else if (deviceType === 'mobile') {
      isLowEnd = true;
      warningReason = 'Mobile device resources are constrained';
    } else if (cores < 4) {
      isLowEnd = true;
      warningReason = 'Low CPU core count';
    } else if (memoryGb && memoryGb <= 4) {
      isLowEnd = true;
      warningReason = 'Limited device RAM';
    }

    // GPU keyword matching (integrated, older, or low-power processors)
    if (!isLowEnd && gpuRenderer) {
      const lowerGPU = gpuRenderer.toLowerCase();
      
      // Low-end/Integrated keywords
      const lowEndKeywords = [
        'intel', 'hd graphics', 'uhd graphics', 'iris', 'adreno', 'mali', 
        'powervr', 'radeon r', 'geforce gt', 'software', 'swiftshader', 'basic render'
      ];
      
      // High-performance overrides
      const highEndKeywords = ['rtx', 'gtx', 'radeon rx', 'apple m', 'apple a', 'quadro', 'tesla'];

      const matchesLow = lowEndKeywords.some(keyword => lowerGPU.includes(keyword));
      const matchesHigh = highEndKeywords.some(keyword => lowerGPU.includes(keyword));

      if (matchesLow && !matchesHigh) {
        isLowEnd = true;
        warningReason = 'Integrated / mobile graphics processor detected';
      }
    }
  }

  return {
    deviceType,
    cores,
    memoryGb,
    gpuRenderer,
    gpuVendor,
    isLowEnd,
    warningReason
  };
}
