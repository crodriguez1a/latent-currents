// GLSL Shaders for GPGPU Particle Simulation & Rendering

// 1. Ashima Arts Simplex Noise 3D GLSL Implementation
const simplexNoiseGLSL = `
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}

float snoise(vec3 v){
  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy) );
  vec3 x0 =   v - i + dot(i, C.xxx) ;

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min( g.xyz, l.zxy );
  vec3 i2 = max( g.xyz, l.zxy );

  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - D.yyy;

  i = mod(i, 289.0 );
  vec4 p = permute( permute( permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

  float n_ = 1.0/7.0;
  vec3  ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z *ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = j - 7.0 * x_ ;

  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );

  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),
                                dot(p2,x2), dot(p3,x3) ) );
}
`;

// 2. GPGPU Velocity Simulation Shader
export const velocityShader = `
uniform float uTime;
uniform float uSpeed;
uniform float uTurbulence;
uniform float uCrowdDensity;
uniform vec3 uMouse3D;
uniform float uMouseActive;
uniform sampler2D uMotionTexture;
uniform float uWebcamActive;
uniform sampler2D uWebcamTexture;
uniform float uWebcamMirrorActive;
uniform sampler2D uFriendTexture;
uniform float uFriendMirrorActive;
uniform float uFriendModeActive;
uniform float uScreenAspect;

// Natural Elements Mode Uniforms
uniform float uNaturalMode;
uniform vec3 uBirdPos;
uniform vec3 uBirdRotation;
uniform float uFlapFreq;
uniform float uRippleAmp;
uniform vec2 uStemBend;
uniform float uBloomFactor;
uniform float uTargetAspect;
uniform vec2 uShapeOffset;
uniform float uShapeRotation;
uniform float uShapeScale;

${simplexNoiseGLSL}

vec2 transformUV(vec2 coord, vec2 offset, float angle, float scale) {
  vec2 p = coord - vec2(0.5);
  p /= scale;
  float c = cos(-angle);
  float s = sin(-angle);
  p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  p -= offset;
  return p + vec2(0.5);
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 posData = texture2D(texturePosition, uv);
  vec4 velData = texture2D(textureVelocity, uv);

  vec3 pos = posData.xyz;
  vec3 vel = velData.xyz;

  // Initialize and compute pullFactor early based on webcam/friend grid texture
  float pullFactor = 0.0;

  // Transform coordinates based on mouse hover/click interaction
  vec2 transformedUV = transformUV(uv, uShapeOffset, uShapeRotation, uShapeScale);

  // Calculate scaled targetGridUV to preserve aspect ratio of the target shape
  float scaleX = 1.0;
  float scaleY = 1.0;
  if (uWebcamMirrorActive > 0.5) {
    if (uTargetAspect < uScreenAspect) {
      scaleX = uTargetAspect / uScreenAspect;
    } else {
      scaleY = uScreenAspect / uTargetAspect;
    }
  }

  vec2 targetGridUV = vec2(
    (transformedUV.x - 0.5) / scaleX + 0.5,
    (transformedUV.y - 0.5) / scaleY + 0.5
  );

  if (uWebcamMirrorActive > 0.5 && targetGridUV.x >= 0.0 && targetGridUV.x <= 1.0 && targetGridUV.y >= 0.0 && targetGridUV.y <= 1.0) {
    vec2 sampleUV = vec2(1.0 - targetGridUV.x, targetGridUV.y);
    float camLuma = 0.0;
    if (uFriendModeActive > 0.5) {
      if (uFriendMirrorActive > 0.5) {
        vec4 camColor = texture2D(uWebcamTexture, sampleUV);
        camLuma = camColor.r * 0.299 + camColor.g * 0.587 + camColor.b * 0.114;
      } else {
        vec4 friendColor = texture2D(uFriendTexture, sampleUV);
        camLuma = friendColor.r * 0.299 + friendColor.g * 0.587 + friendColor.b * 0.114;
      }
    } else {
      vec4 camColor = texture2D(uWebcamTexture, sampleUV);
      camLuma = camColor.r * 0.299 + camColor.g * 0.587 + camColor.b * 0.114;
    }
    // Read local motion intensity from the optical flow texture
    vec4 motionData = texture2D(uMotionTexture, sampleUV);
    float motionIntensity = motionData.b;
    pullFactor = clamp(camLuma * 0.45 + motionIntensity * 0.38, 0.0, 0.88);

    // Obfuscate the edges by fading pull factor near the frame boundaries to let particles float away (entropy)
    float edgeFadeX = smoothstep(0.0, 0.12, targetGridUV.x) * (1.0 - smoothstep(0.88, 1.0, targetGridUV.x));
    float edgeFadeY = smoothstep(0.0, 0.08, targetGridUV.y) * (1.0 - smoothstep(0.92, 1.0, targetGridUV.y));
    pullFactor *= edgeFadeX * edgeFadeY;
  }

  // Calculate scaling factor to damp ambient currents inside active silhouettes
  // Softened damping (only 30% reduction) to allow ambient currents to organically ripple the shapes
  float ambientScale = 1.0;
  if (uWebcamMirrorActive > 0.5) {
    ambientScale = 1.0 - clamp(pullFactor * 0.30, 0.0, 0.30);
  }

  // Mass varies based on texture coordinate (gives some particles more inertia)
  // Let mass range from 0.35 (very light spray) to 2.2 (heavy plates)
  float mass = mix(0.35, 2.2, fract(uv.x * 12.9898 + uv.y * 78.233));

  // Apply mass-dependent drag: heavier particles slide longer with less drag
  float drag = mix(0.958, 0.993, (mass - 0.35) / (2.2 - 0.35));
  vel *= drag;

  // Apply gravity: a constant acceleration independent of mass
  float gravity = -0.0042;
  vel.y += gravity;

  // Initialize total force vector (forces will be divided by mass to get acceleration)
  vec3 totalForce = vec3(0.0);

  // 1. Simplex Noise Wind Force
  float windFreq = 0.08 * uTurbulence;
  float forceFactor = uSpeed * 0.018;
  float localTurbulence = uTurbulence * (0.8 + uCrowdDensity * 0.4);
  float windScale = mass > 1.1 ? 0.35 : 1.3;

  float noiseX = snoise(pos * windFreq + vec3(0.0, 0.0, uTime * 0.06)) * localTurbulence * windScale;
  float noiseY = snoise(pos * windFreq + vec3(2.34, 5.67, uTime * 0.06)) * localTurbulence * windScale;
  float noiseZ = snoise(pos * windFreq + vec3(8.91, 1.23, uTime * 0.06)) * localTurbulence * windScale;

  totalForce += vec3(noiseX, noiseY, noiseZ) * forceFactor * ambientScale;

  // 2. Circular Roller Currents
  // Roller 1: Center-left, pulling down and curling back up
  vec3 r1 = vec3(-6.0 + sin(uTime * 0.15) * 3.0, -2.0 + cos(uTime * 0.08) * 2.0, 0.0);
  vec3 d1 = pos - r1;
  float dist1Sq = d1.x * d1.x + d1.y * d1.y;
  if (dist1Sq < 144.0) { // Radius of 12
    float dist1 = sqrt(dist1Sq) + 0.1;
    float rollInfluence = (1.0 - dist1 / 12.0) * uSpeed * 0.22;
    totalForce.x += (-d1.y / dist1) * rollInfluence * ambientScale;
    totalForce.y += (d1.x / dist1) * rollInfluence * ambientScale;
  }

  // Roller 2: Right side, rotating opposite
  vec3 r2 = vec3(9.0 + cos(uTime * 0.12) * 2.0, -5.0 + sin(uTime * 0.1) * 2.0, 0.0);
  vec3 d2 = pos - r2;
  float dist2Sq = d2.x * d2.x + d2.y * d2.y;
  if (dist2Sq < 81.0) { // Radius of 9
    float dist2 = sqrt(dist2Sq) + 0.1;
    float rollInfluence = (1.0 - dist2 / 9.0) * (-uSpeed * 0.15);
    totalForce.x += (-d2.y / dist2) * rollInfluence * ambientScale;
    totalForce.y += (d2.x / dist2) * rollInfluence * ambientScale;
  }

  // 3. Crashing Swell Wave Front
  float wavePeriod = 16.0 / (uSpeed + 0.1);
  float wavePhase = mod(uTime, wavePeriod) / wavePeriod;
  float waveX = -28.0 + wavePhase * 56.0; // Sweeps from x=-28 to x=28
  
  float distToWave = pos.x - waveX;
  if (distToWave > -5.0 && distToWave < 1.0) {
    float liftFactor = (1.0 - abs(distToWave + 2.0) / 3.0);
    float normalizedLift = max(0.0, liftFactor) * (mass > 1.1 ? 0.35 : 0.8) * uSpeed;
    totalForce.y += normalizedLift * ambientScale;
    totalForce.x += normalizedLift * 0.5 * ambientScale;
    totalForce.z += snoise(pos * 0.2) * normalizedLift * 0.25 * ambientScale;
  } else if (distToWave >= -10.0 && distToWave <= -5.0) {
    float crashFactor = (1.0 - abs(distToWave + 7.5) / 2.5);
    float normalizedCrash = max(0.0, crashFactor) * (mass > 1.1 ? 0.4 : 0.2) * uSpeed;
    totalForce.y -= normalizedCrash * ambientScale;
    totalForce.x += normalizedCrash * 0.25 * ambientScale;
  }

  // 4. Mouse Interactive Forces
  vec3 mD = pos - uMouse3D;
  float mDistSq = mD.x * mD.x + mD.y * mD.y + mD.z * mD.z;
  if (mDistSq < 64.0) {
    float mDist = sqrt(mDistSq);
    float mouseStrength = (1.0 - mDist / 8.0) * 0.2;
    if (uMouseActive > 0.5) {
      // Suction vortex on click
      totalForce.x += (-mD.y / (mDist + 0.1)) * mouseStrength * 1.8;
      totalForce.y += (mD.x / (mDist + 0.1)) * mouseStrength * 1.8;
    } else {
      // Repulsion force field on hover
      totalForce += (mD / (mDist + 0.1)) * mouseStrength * 0.9;
    }
  }

  // 5. Webcam Motion Force Interaction
  if (uWebcamActive > 0.5) {
    // Map 3D position to normalized screen coordinates [0, 1]
    vec2 screenUV = vec2((pos.x + 22.0) / 44.0, (pos.y + 12.0) / 24.0);
    screenUV = clamp(screenUV, 0.0, 1.0);
    
    vec4 webcamData = texture2D(uMotionTexture, screenUV);
    // Webcam force: motion direction (r, g) multiplied by motion intensity (b)
    vec3 webcamForce = vec3(webcamData.r, webcamData.g, 0.0) * webcamData.b * 12.5;
    totalForce += webcamForce;
  }

  // 5.2 Webcam Mirror Attraction (Pulls particles to form the mirrored silhouette)
  if (uWebcamMirrorActive > 0.5) {
    vec2 targetGridUV = vec2(
      (transformedUV.x - 0.5) / scaleX + 0.5,
      (transformedUV.y - 0.5) / scaleY + 0.5
    );

    // Add a tiny, organic breathing sway to the targets if it is Friend Mode or Camera Mirror Friend shape
    float swayX = 0.0;
    float swayY = 0.0;
    if (uFriendMirrorActive > 0.5 || uWebcamActive < 0.5) {
      swayX = sin(uTime * 1.5 + targetGridUV.y * 5.0) * 0.10;
      swayY = cos(uTime * 1.1 + targetGridUV.x * 5.0) * 0.06;
    }

    vec3 targetPos = vec3(
      (targetGridUV.x - 0.5) * 43.6 * scaleX + swayX,
      (targetGridUV.y - 0.5) * 23.6 * scaleY + swayY,
      0.0
    );

    vec3 toGrid = targetPos - pos;
    // PD controller (Proportional-Derivative) with organic, fluid gains to allow flow-through and deformation
    vec3 pdForce = (toGrid * 1.85 - vel * 0.95) * pullFactor * uSpeed * mass;
    totalForce += pdForce;
  }

  // 5.5 Continuous Negative-Space Pressure (Pushes particles away from neighbors towards empty space)
  vec3 repulsionForce = vec3(0.0);
  float searchRadius = 3.6;
  
  for (int i = 1; i <= 8; i++) {
    float fi = float(i);
    // Pseudo-random sampling of other particles
    vec2 sampleUV = fract(uv + vec2(
      fract(sin(uv.x * 12.9898 + uv.y * 78.233 + fi * 3.14) * 43758.5453),
      fract(cos(uv.x * 35.1234 + uv.y * 91.5678 + fi * 5.71) * 23456.7891)
    ));
    vec3 otherPos = texture2D(texturePosition, sampleUV).xyz;
    vec3 repelDir = pos - otherPos;
    float distSq = dot(repelDir, repelDir);
    
    if (distSq < searchRadius * searchRadius && distSq > 0.0001) {
      float dist = sqrt(distSq);
      // Smoothed particle hydrodynamics (SPH) pressure curve: force falls off with distance, spikes when extremely close
      float forceStrength = (1.0 - dist / searchRadius) / (dist + 0.12);
      repulsionForce += (repelDir / dist) * forceStrength;
    }
  }

  // Apply continuous pressure force (multiplied by mass to bypass inertia and scale with speed)
  // Scale down neighbor pressure slightly inside silhouettes to allow cohesive clustering while keeping collision dynamics pliant
  float pressureScale = 1.0;
  if (uWebcamMirrorActive > 0.5) {
    pressureScale = 1.0 - clamp(pullFactor * 0.35, 0.0, 0.35);
  }
  totalForce += repulsionForce * 0.28 * uSpeed * mass * pressureScale;

  // Apply Natural Mode Forces
  if (uNaturalMode > 0.5) {
    // Dampen standard fluid forces so the elements can hold their geometry
    totalForce *= 0.12;
    vel *= 0.94; // high damping factor for structural stability

    if (uNaturalMode < 1.5) {
      // --- Pool of Water ---
      // Flat horizontal layout at Z = 0
      vec3 targetPos = vec3((uv.x - 0.5) * 43.6, (uv.y - 0.5) * 23.6, 0.0);
      
      // Radial wave ripples responding to mouse touch
      float mDist = distance(pos.xy, uMouse3D.xy);
      float ripple = sin(mDist * 3.5 - uTime * 14.0) * exp(-mDist * 0.20) * uRippleAmp * 1.8;
      targetPos.z += ripple;
      targetPos.y += ripple * 0.15; // minor y ripple offset
      
      totalForce += (targetPos - pos) * 5.5 * mass;
    } 
    else if (uNaturalMode < 2.5) {
      // --- Field of Flowers ---
      // Distribute particles into 320 columns (stems)
      float stemCol = floor(uv.x * 320.0) / 320.0;
      float heightIdx = uv.y; // 0.0 (base) to 1.0 (flower head)
      
      float stemX = (stemCol - 0.5) * 43.6;
      float restX = stemX;
      float restY = -12.0 + heightIdx * 24.0;
      float restZ = 0.0;

      // Wind sway noise (increasing with height index)
      float wind = sin(uTime * 1.6 + stemX * 0.3) * 0.65 * heightIdx * heightIdx;
      restX += wind;

      // Interactive mouse brush (bends the stem away from cursor position)
      float mouseDist = distance(vec2(restX, restY), uMouse3D.xy);
      if (mouseDist < 6.0) {
        float bend = (1.0 - mouseDist / 6.0) * 2.8 * (uMouseActive > 0.5 ? 2.0 : 1.0);
        restX += (restX - uMouse3D.x > 0.0 ? 1.0 : -1.0) * bend * heightIdx;
        restY -= bend * 0.2 * heightIdx;
      }

      // Flower petals (blooming circles at the top of stems, for uv.y > 0.75)
      if (heightIdx > 0.75) {
        float petalAngle = uv.y * 12.56636; // 4 * PI (radial distribution)
        float r = (0.22 + uBloomFactor * 0.65) * (heightIdx - 0.75) / 0.25;
        
        // Petal shape offset around flower head
        restX = stemX + wind + cos(petalAngle) * r;
        restY = -12.0 + 0.75 * 24.0 + sin(petalAngle) * r;
        restZ = sin(petalAngle * 2.0) * r * 0.4;
      }

      totalForce += (vec3(restX, restY, restZ) - pos) * 6.5 * mass;
    } 
    else if (uNaturalMode < 3.5) {
      // --- Flying Bird ---
      // We assign 30% of particles (uv.y > 0.70) to form the bird body/wings
      if (uv.y > 0.70) {
        // Normalize coordinates for the bird geometry
        float s = (uv.x - 0.5) * 2.0; // [-1.0, 1.0]
        float t = (uv.y - 0.85) * 6.666; // [-1.0, 1.0]

        float restX = s * 1.5;
        float restY = t * 2.2;
        float restZ = sin(t * 3.14159) * 0.30; // tail curve

        // Wings flap animation
        if (abs(s) > 0.12) {
          float flap = sin(uTime * uFlapFreq - abs(s) * 2.5) * abs(s) * 1.9;
          restX = s * 8.5;
          restY = t * 1.1 + flap;
          restZ = -abs(s) * 0.9; // sweep back
        }

        // Apply yaw & roll rotations from controller
        vec3 rotatedPos = vec3(restX, restY, restZ);
        
        // Roll (Z axis rotation)
        float cz = cos(uBirdRotation.z);
        float sz = sin(uBirdRotation.z);
        rotatedPos.xy = vec2(rotatedPos.x * cz - rotatedPos.y * sz, rotatedPos.x * sz + rotatedPos.y * cz);
        
        // Yaw (Y axis rotation)
        float cy = cos(uBirdRotation.y);
        float sy = sin(uBirdRotation.y);
        rotatedPos.xz = vec2(rotatedPos.x * cy - rotatedPos.z * sy, rotatedPos.x * sy + rotatedPos.z * cy);

        vec3 targetBirdWorld = uBirdPos + rotatedPos;
        totalForce += (targetBirdWorld - pos) * 10.5 * mass;
      } 
      else {
        // Wind currents trailing the bird
        // Swirl organically around the bird
        vec3 toBird = pos - uBirdPos;
        float birdD = length(toBird);
        if (birdD < 14.0) {
          float pull = (1.0 - birdD / 14.0) * 0.65;
          // Vortex suction + trail drag force
          totalForce.x += (-toBird.y / (birdD + 0.1)) * pull * 0.45;
          totalForce.y += (toBird.x / (birdD + 0.1)) * pull * 0.45;
          totalForce -= (toBird / (birdD + 0.1)) * pull * 0.22;
        }
      }
    }
  }

  // Apply acceleration = Force / mass
  vel += totalForce / mass;

  // 6. Absolute Bottom Undertow (pulls particles back left, independent of mass)
  if (pos.y < -2.0) {
    float undertowStrength = clamp((-2.0 - pos.y) / 10.0, 0.0, 1.0);
    vel.x -= undertowStrength * 0.012 * uSpeed;
  }

  // 7. Corner Wash Vortex (Clears out the bottom-right corner stagnation zone)
  if (pos.x > 18.0 && pos.y < -8.0) {
    vel.x -= 0.024 * uSpeed;
    vel.y += 0.016 * uSpeed;
  }

  // 8. Top-Right Corner Stagnation Prevention (Disperses particles left and down to prevent burn-in / hot spots)
  if (pos.x > 15.0 && pos.y > 7.0) {
    float trFactor = clamp((pos.x - 15.0) * (pos.y - 7.0) / 35.0, 0.0, 1.0);
    float trNoise = snoise(vec3(pos.xy * 0.12, uTime * 0.25)) * 0.12;
    vel.x -= trFactor * (0.042 + trNoise) * uSpeed;
    vel.y -= trFactor * (0.028 - trNoise) * uSpeed;
  }

  // --- SHADOWBOX BOUNDS & ELASTIC BOUNCES ---
  // X Bounds (Side Walls): [-22.0, 22.0]
  if (pos.x >= 22.0 && vel.x > 0.0) {
    vel.x = -vel.x * 0.4;
    vel.y += abs(vel.x) * 0.55; // Splash deflection: horizontal energy converts to vertical lift!
  } else if (pos.x <= -22.0 && vel.x < 0.0) {
    vel.x = -vel.x * 0.4;
    vel.y += abs(vel.x) * 0.55; // Splash deflection on left wall
  }

  // Y Bounds (Floor & Ceiling): [-12.0, 12.0]
  if (pos.y <= -12.0 && vel.y < 0.0) {
    vel.y = -vel.y * 0.3; // bounce up
    vel.x *= 0.82; // floor friction
    vel.z *= 0.82; // floor friction
    
    // Give nearly static particles on the floor a small thermal kick to prevent dead pile-ups
    if (length(vel) < 0.015) {
      vel.x = (fract(sin(uv.x * 321.45) * 456.78) - 0.5) * 0.12;
      vel.y = fract(sin(uv.y * 123.45) * 789.12) * 0.09;
      vel.z = (fract(sin(uv.x * 789.12) * 123.45) - 0.5) * 0.12;
    }
  } else if (pos.y >= 12.0 && vel.y > 0.0) {
    vel.y = -vel.y * 0.4;
  }

  // Z Bounds (Shadowbox Glass & Backing): [-6.0, 6.0]
  if (pos.z >= 6.0 && vel.z > 0.0) {
    vel.z = -vel.z * 0.5; // bounce back
  } else if (pos.z <= -6.0 && vel.z < 0.0) {
    vel.z = -vel.z * 0.5;
  }

  gl_FragColor = vec4(vel, 1.0);
}
`;

// 3. GPGPU Position Simulation Shader
export const positionShader = `
uniform float uTime;
uniform float uDeltaTime;
uniform sampler2D uInitialPosition;

// GPU Hash Random Generator
float rand(vec2 co) {
  return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 posData = texture2D(texturePosition, uv);
  vec4 velData = texture2D(textureVelocity, uv);

  vec3 pos = posData.xyz;
  vec3 vel = velData.xyz;

  // Euler integration
  pos += vel * uDeltaTime;

  // Recycle particle if it hits the right edge (x >= 21.8) or is uninitialized (0,0,0)
  // This prevents boundary wall compression and stacks
  if (dot(pos, pos) == 0.0 || pos.x >= 21.8) {
    vec4 initPos = texture2D(uInitialPosition, uv);
    // Distribute entries randomly inside the left zone to prevent left-wall clamping line
    pos.x = -21.2 + rand(uv + vec2(uTime, 1.35)) * 5.5;
    pos.y = (rand(uv + vec2(uTime, 4.72)) - 0.5) * 20.0;
    pos.z = (rand(uv + vec2(uTime, 8.19)) - 0.5) * 10.0;
  }

  // Clamp positions to shadowbox boundary box to prevent escape
  pos.x = clamp(pos.x, -22.0, 22.0);
  pos.y = clamp(pos.y, -12.0, 12.0);
  pos.z = clamp(pos.z, -6.0, 6.0);

  gl_FragColor = vec4(pos, posData.w);
}
`;

// 4. Particle Rendering Vertex Shader
export const renderVertexShader = `
uniform sampler2D uPositionTexture;
uniform sampler2D uVelocityTexture;
uniform float uPointSize;
uniform float uDensityScale; // Shrink size as count grows

attribute vec2 reference;

varying vec3 vVelocity;
varying vec3 vPosition;
varying float vColorIdx;
varying vec2 vReference;

void main() {
  // Pass reference to fragment shader for webcam pixel mapping
  vReference = reference;

  // Read coordinates from position texture
  vec4 posData = texture2D(uPositionTexture, reference);
  vPosition = posData.xyz;

  // Read coordinates from velocity texture
  vec4 velData = texture2D(uVelocityTexture, reference);
  vVelocity = velData.xyz;

  // Permanent color index seed based on reference UV coordinates
  vColorIdx = mod(floor(reference.x * 324.56 + reference.y * 876.54), 5.0);

  vec4 mvPosition = modelViewMatrix * vec4(vPosition, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // Attenuate point size by depth and particle density scale factor
  gl_PointSize = uPointSize * uDensityScale * (25.0 / -mvPosition.z);
}
`;

// 5. Particle Rendering Fragment Shader
export const renderFragmentShader = `
uniform vec3 uBaseColors[5];
uniform vec3 uHighlightColor;
uniform float uOpacity;
uniform sampler2D uWebcamTexture;
uniform float uWebcamMirrorActive;
uniform float uWebcamActive;
uniform sampler2D uFriendTexture;
uniform float uFriendMirrorActive;
uniform float uFriendModeActive;
uniform float uScreenAspect;
uniform float uTargetAspect;
uniform vec2 uShapeOffset;
uniform float uShapeRotation;
uniform float uShapeScale;

uniform float uNaturalMode;

varying vec3 vVelocity;
varying vec3 vPosition;
varying float vColorIdx;
varying vec2 vReference;

vec2 transformUV(vec2 coord, vec2 offset, float angle, float scale) {
  vec2 p = coord - vec2(0.5);
  p /= scale;
  float c = cos(-angle);
  float s = sin(-angle);
  p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  p -= offset;
  return p + vec2(0.5);
}

void main() {
  // Draw soft glowing circular particles (billboards)
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = dot(coord, coord);
  if (dist > 0.25) discard;

  // Radial gradient glow
  float intensity = 1.0 - (dist * 4.0);
  intensity = pow(intensity, 1.5);

  // Speed-based color blending (increased divisor to 4.2 to preserve base colors)
  float speed = length(vVelocity);
  float colorFactor = clamp(speed / 4.2, 0.0, 1.0);

  int colorIdx = int(vColorIdx);

  vec3 baseColor = uBaseColors[0];
  if (colorIdx == 1) baseColor = uBaseColors[1];
  else if (colorIdx == 2) baseColor = uBaseColors[2];
  else if (colorIdx == 3) baseColor = uBaseColors[3];
  else if (colorIdx == 4) baseColor = uBaseColors[4];

  vec3 finalColor = mix(baseColor, uHighlightColor, colorFactor);

  // Apply Natural Elements Custom Coloring Overrides
  if (uNaturalMode > 0.5) {
    if (uNaturalMode < 1.5) {
      // --- Pool of Water Color Palette ---
      vec3 waterColors[4];
      waterColors[0] = vec3(0.015, 0.082, 0.282); // Deep Ocean Blue
      waterColors[1] = vec3(0.047, 0.251, 0.478); // Teal-Navy
      waterColors[2] = vec3(0.118, 0.549, 0.647); // Turquoise
      waterColors[3] = vec3(0.278, 0.776, 0.718); // Cyan foam base
      
      int wIdx = int(mod(vColorIdx, 4.0));
      vec3 waterBase = wIdx == 0 ? waterColors[0] : (wIdx == 1 ? waterColors[1] : (wIdx == 2 ? waterColors[2] : waterColors[3]));
      
      // Wave height highlight foam (Z displacement mapped to white highlights)
      float waveHeight = clamp((vPosition.z + 1.2) / 2.4, 0.0, 1.0);
      vec3 foamHighlight = vec3(0.85, 0.98, 1.0);
      finalColor = mix(waterBase, foamHighlight, waveHeight * 0.76 + colorFactor * 0.24);
    } 
    else if (uNaturalMode < 2.5) {
      // --- Field of Flowers Color Palette ---
      if (vReference.y > 0.75) {
        // Flower Petals/Bulbs: Orchid Magenta, Violet, Gold Pollen
        vec3 flowerColors[3];
        flowerColors[0] = vec3(0.92, 0.078, 0.549); // Wild Orchid
        flowerColors[1] = vec3(0.722, 0.176, 0.882); // Royal Violet
        flowerColors[2] = vec3(1.0, 0.647, 0.051);  // Gold Pollen
        
        int fIdx = int(mod(vColorIdx, 3.0));
        vec3 petalColor = fIdx == 0 ? flowerColors[0] : (fIdx == 1 ? flowerColors[1] : flowerColors[2]);
        finalColor = mix(petalColor, vec3(1.0, 0.95, 0.65), colorFactor * 0.35);
      } else {
        // Flower Stems: Forest Green, Emerald, Lime
        vec3 stemColors[3];
        stemColors[0] = vec3(0.078, 0.376, 0.176); // Forest Green
        stemColors[1] = vec3(0.118, 0.584, 0.251); // Emerald
        stemColors[2] = vec3(0.482, 0.784, 0.176); // Lime Green
        
        int sIdx = int(mod(vColorIdx, 3.0));
        finalColor = sIdx == 0 ? stemColors[0] : (sIdx == 1 ? stemColors[1] : stemColors[2]);
      }
    } 
    else if (uNaturalMode < 3.5) {
      // --- Flapping Bird Color Palette ---
      if (vReference.y > 0.70) {
        // The Bird: Golden Phoenix, Crimson fire trail, Pure White crest
        vec3 birdColors[3];
        birdColors[0] = vec3(1.0, 0.824, 0.118); // Golden Feather
        birdColors[1] = vec3(1.0, 0.451, 0.016); // Phoenix Orange
        birdColors[2] = vec3(0.98, 0.98, 0.98);   // Celestial White
        
        int bIdx = int(mod(vColorIdx, 3.0));
        finalColor = bIdx == 0 ? birdColors[0] : (bIdx == 1 ? birdColors[1] : birdColors[2]);
      } else {
        // Wind Draft Trails: Stardust Cyan, Slate Grey
        vec3 airColors[2];
        airColors[0] = vec3(0.22, 0.282, 0.376); // Slate
        airColors[1] = vec3(0.482, 0.647, 0.784); // Stardust Cyan
        
        int aIdx = int(mod(vColorIdx, 2.0));
        vec3 airBase = aIdx == 0 ? airColors[0] : airColors[1];
        finalColor = mix(airBase, vec3(1.0, 0.90, 0.72), colorFactor * 0.38);
      }
    }
  }

  if (uWebcamMirrorActive > 0.5) {
    // Transform coordinates based on mouse hover/click interaction
    vec2 transformedUV = transformUV(vReference, uShapeOffset, uShapeRotation, uShapeScale);

    float scaleX = 1.0;
    float scaleY = 1.0;
    if (uTargetAspect < uScreenAspect) {
      scaleX = uTargetAspect / uScreenAspect;
    } else {
      scaleY = uScreenAspect / uTargetAspect;
    }
    vec2 targetGridUV = vec2(
      (transformedUV.x - 0.5) / scaleX + 0.5,
      (transformedUV.y - 0.5) / scaleY + 0.5
    );
    
    if (targetGridUV.x >= 0.0 && targetGridUV.x <= 1.0 && targetGridUV.y >= 0.0 && targetGridUV.y <= 1.0) {
      vec2 sampleUV = vec2(1.0 - targetGridUV.x, targetGridUV.y);
      vec4 colorSample;
      if (uFriendModeActive > 0.5) {
        if (uFriendMirrorActive > 0.5) {
          colorSample = texture2D(uWebcamTexture, sampleUV);
        } else {
          colorSample = texture2D(uFriendTexture, sampleUV);
        }
      } else {
        colorSample = texture2D(uWebcamTexture, sampleUV);
      }
      
      // Obfuscate the boundaries by fading the webcam blend factor near the frame edges
      float edgeFadeX = smoothstep(0.0, 0.12, targetGridUV.x) * (1.0 - smoothstep(0.88, 1.0, targetGridUV.x));
      float edgeFadeY = smoothstep(0.0, 0.08, targetGridUV.y) * (1.0 - smoothstep(0.92, 1.0, targetGridUV.y));
      float edgeFade = edgeFadeX * edgeFadeY;

      // Blend camera/friend colors (fading to preset background color near edges)
      finalColor = mix(finalColor, colorSample.rgb, 0.72 * colorSample.a * edgeFade);
    }
  }

  // Fade out particles as they approach the right wall to prevent sudden boundary pops or stacks
  float rightWallFade = clamp((21.5 - vPosition.x) / 3.0, 0.0, 1.0);

  gl_FragColor = vec4(finalColor, uOpacity * intensity * rightWallFade);
}
`;
