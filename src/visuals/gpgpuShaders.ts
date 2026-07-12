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

${simplexNoiseGLSL}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 posData = texture2D(texturePosition, uv);
  vec4 velData = texture2D(textureVelocity, uv);

  vec3 pos = posData.xyz;
  vec3 vel = velData.xyz;

  // Mass varies based on texture coordinate (gives some particles more inertia)
  // Let mass range from 0.35 (very light spray) to 2.2 (heavy plates)
  float mass = mix(0.35, 2.2, fract(uv.x * 123.456 + uv.y * 789.123));

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

  totalForce += vec3(noiseX, noiseY, noiseZ) * forceFactor;

  // 2. Circular Roller Currents
  // Roller 1: Center-left, pulling down and curling back up
  vec3 r1 = vec3(-6.0 + sin(uTime * 0.15) * 3.0, -2.0 + cos(uTime * 0.08) * 2.0, 0.0);
  vec3 d1 = pos - r1;
  float dist1Sq = d1.x * d1.x + d1.y * d1.y;
  if (dist1Sq < 144.0) { // Radius of 12
    float dist1 = sqrt(dist1Sq) + 0.1;
    float rollInfluence = (1.0 - dist1 / 12.0) * uSpeed * 0.22;
    totalForce.x += (-d1.y / dist1) * rollInfluence;
    totalForce.y += (d1.x / dist1) * rollInfluence;
  }

  // Roller 2: Right side, rotating opposite
  vec3 r2 = vec3(9.0 + cos(uTime * 0.12) * 2.0, -5.0 + sin(uTime * 0.1) * 2.0, 0.0);
  vec3 d2 = pos - r2;
  float dist2Sq = d2.x * d2.x + d2.y * d2.y;
  if (dist2Sq < 81.0) { // Radius of 9
    float dist2 = sqrt(dist2Sq) + 0.1;
    float rollInfluence = (1.0 - dist2 / 9.0) * (-uSpeed * 0.15);
    totalForce.x += (-d2.y / dist2) * rollInfluence;
    totalForce.y += (d2.x / dist2) * rollInfluence;
  }

  // 3. Crashing Swell Wave Front
  float wavePeriod = 16.0 / (uSpeed + 0.1);
  float wavePhase = mod(uTime, wavePeriod) / wavePeriod;
  float waveX = -28.0 + wavePhase * 56.0; // Sweeps from x=-28 to x=28
  
  float distToWave = pos.x - waveX;
  if (distToWave > -5.0 && distToWave < 1.0) {
    float liftFactor = (1.0 - abs(distToWave + 2.0) / 3.0);
    float normalizedLift = max(0.0, liftFactor) * (mass > 1.1 ? 0.35 : 0.8) * uSpeed;
    totalForce.y += normalizedLift;
    totalForce.x += normalizedLift * 0.5;
    totalForce.z += snoise(pos * 0.2) * normalizedLift * 0.25;
  } else if (distToWave >= -10.0 && distToWave <= -5.0) {
    float crashFactor = (1.0 - abs(distToWave + 7.5) / 2.5);
    float normalizedCrash = max(0.0, crashFactor) * (mass > 1.1 ? 0.4 : 0.2) * uSpeed;
    totalForce.y -= normalizedCrash;
    totalForce.x += normalizedCrash * 0.25;
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

  // Clamp positions to shadowbox boundary box to prevent escape
  pos.x = clamp(pos.x, -22.0, 22.0);
  pos.y = clamp(pos.y, -12.0, 12.0);
  pos.z = clamp(pos.z, -6.0, 6.0);

  // Stagger respawn only if position is completely uninitialized (0,0,0) or invalid
  if (dot(pos, pos) == 0.0) {
    vec4 initPos = texture2D(uInitialPosition, uv);
    pos = initPos.xyz;
    
    pos.x = -22.0 - rand(uv + vec2(uTime, 0.0)) * 5.0;
    pos.y = (rand(uv + vec2(0.0, uTime)) - 0.5) * 16.0 - 2.0;
    pos.z = (rand(uv + vec2(uTime, uTime)) - 0.5) * 6.0;
  }

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

void main() {
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

varying vec3 vVelocity;
varying vec3 vPosition;
varying float vColorIdx;

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

  gl_FragColor = vec4(finalColor, uOpacity * intensity);
}
`;
