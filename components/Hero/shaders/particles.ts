// SAR pipeline particle shaders — all layers write luminance (R channel) into
// an offscreen RGBA16F (or RGBA8 fallback) framebuffer via additive blending.
// Fragment shaders output vec4(B, 0, 0, 1); gl.blendFunc(ONE, ONE) accumulates.

// Spec: docs/design/40-hero.md §A / §C.

export const RAMP = " .':;+*cvo%0OKBM"; // 16 steps, Lettra Mono measured.
export const GAIN = 0.85;
export const GAMMA = 0.70;

// Beats (seconds).
export const BEATS = {
  intro: 0,
  descendStart: 1.0,
  descendEnd: 3.8,
  patchFadeStart: 2.4,
  patchFadeEnd: 4.4,
  liftStart: 6.8,
  liftEnd: 10.0,
  lookStart: 7.4,
  lookEnd: 10.0,
  starsFadeStart: 1.0,
  starsFadeEnd: 2.2,
  loopT0: 10.0,
  period: 45.0,
  pass: 28.0,
};

// Particle counts (§C).
export const N_EARTH = 140_000;
export const N_PATCH = 160_000;
export const N_HAZE = 70_000;
export const N_STAR = 70;
export const N_PLANE = 6_000;
export const N_TRAIL = 40_000;

// Brightness (float16 path; divide by 4 for u8 fallback).
export const B = {
  EARTH: 1.35,
  PATCH: 3.30,
  STAR: 2.6,
  HAZE: 0.12,
  PLANE: 0.14,
  TRAIL: 0.09,
};

// Mulberry32 PRNG seeded for reproducibility.
export function mulberry32(seed: number) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box–Muller standard normal from two uniform samples.
export function stdNormalFromPair(u1: number, u2: number): number {
  const r = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-9)));
  return r * Math.cos(2 * Math.PI * u2);
}

// easeIO (cubic in-out), input clamped.
export function easeIO(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ─── GLSL ────────────────────────────────────────────────────────────────────
// Common pinhole project helper.
// We work in view/world units: particle given in sphere-local; rotation uniform
// aligns Seoul to +Z, then view = camera at (0,0,uDist) looking at origin.
// Clip: xy_ndc = (X/(d−Z))·f  ·  (D_frac aspect handled by uAspect)
// f = D_frac / tan(asin(1/6.4))  with D_frac = diameter_px/W_px.
export const earthVert = /* glsl */ `#version 300 es
  precision highp float;
  precision highp sampler2D;
  layout(location = 0) in vec3 aPos;      // unit sphere position (object space)
  layout(location = 1) in vec2 aMaskUV;   // equirect uv [0,1]
  layout(location = 2) in float aR;       // random seed [0,1]
  layout(location = 3) in float aA;       // patch radius [0,1]; 0 for global

  uniform mat3 uRot;        // sphere alignment
  uniform float uDist;      // camera distance (in R)
  uniform float uF;         // focal in NDC: diameter/W × 1/tan(asin(1/6.4))
  uniform float uAspect;    // W / H
  uniform float uTime;
  uniform float uBScale;    // 1.0 (float16) or 0.25 (u8 fallback)
  uniform float uBase;      // B_EARTH or B_PATCH
  uniform float uIsPatch;   // 0 or 1
  uniform float uZoom;      // 0..1 (patch-vs-global crossfade, §C)
  uniform float uLift;      // 0..1 (sky transition, surface particles become haze)
  uniform float uLook;      // 0..1 (horizon drops → look up)
  uniform float uHorizonY;  // normalized screen y of horizon (−top..+top)
  uniform float uTop;       // RH / RW (half-height in sphere units)
  uniform float uT;         // raw seconds (for per-particle delay + haze drift)
  uniform float uBHaze;     // B_HAZE for mix target

  uniform sampler2D uLandMask;

  out float vB;

  void main() {
    // Rotate sphere, add wobble.
    vec3 pO = normalize(aPos);
    vec3 p = uRot * pO;
    // Breathing jitter (§C wob)
    float jr = 1.0 + 0.004 * sin(9.0 * p.y + 0.9 * uTime + 6.28 * aR);
    p *= jr;

    // Light & normal.
    vec3 n = normalize(p);
    vec3 sun = normalize(vec3(-0.55, 0.45, 0.70));
    float lightT = clamp((dot(n, sun) + 0.2) / 1.2, 0.0, 1.0);
    float land = texture(uLandMask, aMaskUV).r;
    // n·v: view direction from camera at (0,0,uDist)
    vec3 toCam = vec3(0.0, 0.0, uDist) - p;
    float ndv = clamp(dot(n, normalize(toCam)), 0.0, 1.0);

    float B = uBase * (0.18 + 0.82 * land) * (0.25 + 0.75 * lightT) *
              (0.6 + 0.4 * aR) * (0.15 + 0.85 * ndv);
    float rim = 1.0 - ndv;
    // 60% of particles get a rim-thin modulation.
    if (aR > 0.4) B *= (1.0 - 0.55 * rim * rim * rim);

    // Patch edge falloff (§C): r > 0.85 of patch fades out.
    if (uIsPatch > 0.5) {
      float a = aA;
      float t = clamp((a - 0.85) / 0.15, 0.0, 1.0);
      float e = t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
      B *= (1.0 - e);
    }

    // LOD mix: global fades to 15% as zoom→1; patch fades in with zoom.
    if (uIsPatch > 0.5) {
      B *= uZoom;
    } else {
      B *= (1.0 - 0.85 * uZoom);
    }

    // Back hemisphere cull (Z after rotation; cam looks from +Z).
    if (p.z <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // off-screen
      vB = 0.0;
      gl_PointSize = 1.0;
      return;
    }

    // Sphere-projected NDC (base position before any lift).
    float denom = max(uDist - p.z, 1e-3);
    float nx = (p.x / denom) * uF;
    float ny = (p.y / denom) * uF;
    float sphereNdcX = nx;
    float sphereNdcY = ny / uTop;

    // §C surface → haze transition: per-particle delay r·0.8s, duration 1.6s.
    // Clamped eased w_i; valid only once lift period has started (uT > 6.8).
    float dT = (uT - 6.8 - aR * 0.8) / 1.6;
    float wT = clamp(dT, 0.0, 1.0);
    // easeIO inlined (cubic in-out)
    float w_i = wT < 0.5 ? 4.0 * wT * wT * wT : 1.0 - pow(-2.0 * wT + 2.0, 3.0) / 2.0;
    // Scale by uLift so pre-6.8s guard still holds (uLift grows from 0 at t=6.8).
    w_i *= clamp(uLift * 2.0, 0.0, 1.0);

    // Haze target position (same formula as haze layer, derived from aR).
    // Use aR as both x- and y-seed (jittered via mantissa hash).
    float r2 = fract(aR * 7.919 + 0.21);
    float xH = fract(aR + 0.012 * uT * (0.5 + aR)) * 2.0 - 1.0;
    float yFrac = -log(max(1.0 - r2 * (1.0 - exp(-1.0 / 0.16)), 1e-5)) * 0.16;
    float yH = uHorizonY + yFrac * (1.0 - uHorizonY);
    yH += 0.02 * sin(uT * 0.8 + aR * 6.28);

    float ndcX = mix(sphereNdcX, xH, w_i);
    float ndcY = mix(sphereNdcY, yH, w_i);

    // Brightness blended toward haze.
    float Bout = mix(max(B, 0.0), uBHaze * (0.5 + 0.5 * aR), w_i);

    gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);
    gl_PointSize = 1.0;
    vB = Bout * uBScale;
  }
`;

export const earthFrag = /* glsl */ `#version 300 es
  precision highp float;
  in float vB;
  out vec4 outColor;
  void main() {
    outColor = vec4(vB, 0.0, 0.0, 1.0);
  }
`;

// Stars: static positions in screen space, 2 points per star (x and x+1 handled
// by drawing twice from JS). B modulated by uTime fade.
export const starsVert = /* glsl */ `#version 300 es
  precision highp float;
  layout(location = 0) in vec2 aPos; // NDC
  layout(location = 1) in float aR;
  uniform float uFade; // 1 → 0 across 1.0–2.2s
  uniform float uBScale;
  uniform float uBase;
  uniform float uShiftX; // NDC offset for second-pixel draw (= 2/RW)
  out float vB;
  void main() {
    vB = uBase * (0.5 + 0.5 * aR) * uFade * uBScale;
    gl_Position = vec4(aPos.x + uShiftX, aPos.y, 0.0, 1.0);
    gl_PointSize = 1.0;
  }
`;

// Haze: particles distributed in screen x uniformly, y exponential near horizon.
// Movement = drift in x, sine wobble in y. Scaled by uLift.
export const hazeVert = /* glsl */ `#version 300 es
  precision highp float;
  layout(location = 0) in float aU;   // random x seed [0,1]
  layout(location = 1) in float aV;   // random y seed [0,1]
  layout(location = 2) in float aR;
  uniform float uTime;
  uniform float uLift;
  uniform float uBScale;
  uniform float uBase;
  uniform float uHorizonY;   // in NDC (−1..1)
  uniform float uTop;
  out float vB;
  void main() {
    // x drift
    float x = fract(aU + 0.012 * uTime * (0.5 + aR)) * 2.0 - 1.0;
    // y: compressed to top of frame near horizon
    float yFrac = -log(max(1.0 - aV * (1.0 - exp(-1.0 / 0.16)), 1e-5)) * 0.16;
    // Convert fraction (above horizon) to NDC y
    float ndcY = uHorizonY + yFrac * (1.0 - uHorizonY);
    ndcY += 0.02 * sin(uTime * 0.8 + aR * 6.28);
    vB = uBase * (0.5 + 0.5 * aR) * uLift * uBScale;
    gl_Position = vec4(x, ndcY, 0.0, 1.0);
    gl_PointSize = 1.0;
  }
`;

// Common frag for simple layers that share "write vB to R".
export const simpleFrag = earthFrag;

// Plane layer: planform sample points in object space (lat, along), unit S.
export const planeVert = /* glsl */ `#version 300 es
  precision highp float;
  layout(location = 0) in vec2 aPos; // (lat, along) in units of S
  uniform float uTime;
  uniform vec3 uPlaneStart;   // world
  uniform vec3 uPlaneEnd;
  uniform float uK;           // 0..1 within pass
  uniform float uS;           // span
  uniform float uYaw;
  // Camera (scene B)
  uniform float uPitch;       // radians
  uniform float uVFOV;        // radians
  uniform float uAspect;
  uniform float uBScale;
  uniform float uBase;
  uniform float uVisible;     // 0 or 1
  out float vB;

  // Project world → NDC via sky camera at origin, pitching up (+rot around X).
  vec3 toCam(vec3 w) {
    float cp = cos(uPitch), sp = sin(uPitch);
    // Rotate world by −pitch around X to get view coords (camera looks −Z, up +Y).
    float yv = cp * w.y + sp * w.z;
    float zv = -sp * w.y + cp * w.z;
    return vec3(w.x, yv, zv);
  }
  vec4 project(vec3 v) {
    float f = 1.0 / tan(uVFOV * 0.5);
    float ndcX = (v.x / -v.z) * f / uAspect;
    float ndcY = (v.y / -v.z) * f;
    return vec4(ndcX, ndcY, 0.0, 1.0);
  }

  void main() {
    if (uVisible < 0.5) {
      gl_Position = vec4(2.0,2.0,2.0,1.0); vB = 0.0; gl_PointSize = 1.0; return;
    }
    // Planform point in local (lat along +X, along along +Y) → world yaw.
    vec2 l = aPos * uS;
    float cy = cos(uYaw), sy = sin(uYaw);
    vec3 local = vec3(cy * l.x - sy * l.y, 0.0, sy * l.x + cy * l.y);
    vec3 center = mix(uPlaneStart, uPlaneEnd, uK);
    vec3 world = center + local;
    vec3 v = toCam(world);
    if (v.z >= -1e-3) { gl_Position = vec4(2.0,2.0,2.0,1.0); vB = 0.0; gl_PointSize = 1.0; return; }
    gl_Position = project(v);
    gl_PointSize = 1.0;
    vB = uBase * uBScale;
  }
`;

// Trail layer: each particle has (age, side, g).
// Position = mix(start,end, k - age/pass) − dir*0.6S + side*S*(±(0.18+0.04*age)+w(age)*g).
export const trailVert = /* glsl */ `#version 300 es
  precision highp float;
  layout(location = 0) in float aAge;    // seconds
  layout(location = 1) in float aSide;   // −1 or +1
  layout(location = 2) in float aG;      // std normal
  layout(location = 3) in float aR;
  uniform float uTime;
  uniform vec3 uPlaneStart;
  uniform vec3 uPlaneEnd;
  uniform float uK;          // k_eff
  uniform float uS;
  uniform float uW0;
  uniform float uTau;
  uniform float uMaxAge;
  uniform float uPass;
  uniform float uPitch;
  uniform float uVFOV;
  uniform float uAspect;
  uniform float uBScale;
  uniform float uBase;
  uniform float uVisible;
  out float vB;

  vec3 toCam(vec3 w) {
    float cp = cos(uPitch), sp = sin(uPitch);
    float yv = cp * w.y + sp * w.z;
    float zv = -sp * w.y + cp * w.z;
    return vec3(w.x, yv, zv);
  }
  vec4 project(vec3 v) {
    float f = 1.0 / tan(uVFOV * 0.5);
    float ndcX = (v.x / -v.z) * f / uAspect;
    float ndcY = (v.y / -v.z) * f;
    return vec4(ndcX, ndcY, 0.0, 1.0);
  }

  void main() {
    if (uVisible < 0.5 || aAge > uMaxAge) {
      gl_Position = vec4(2.0,2.0,2.0,1.0); vB = 0.0; gl_PointSize = 1.0; return;
    }
    float kAgo = uK - aAge / uPass;
    if (kAgo < 0.0) {
      gl_Position = vec4(2.0,2.0,2.0,1.0); vB = 0.0; gl_PointSize = 1.0; return;
    }
    vec3 dir = normalize(uPlaneEnd - uPlaneStart);
    vec3 sideV = normalize(vec3(-dir.z, 0.0, dir.x));
    vec3 center = mix(uPlaneStart, uPlaneEnd, clamp(kAgo, 0.0, 1.0));
    float w = uW0 * (1.0 + 2.5 * aAge / uTau);
    float latOff = (0.18 + 0.04 * aAge) * aSide + w * aG;
    vec3 world = center - dir * (0.6 * uS) + sideV * (latOff * uS);
    vec3 v = toCam(world);
    if (v.z >= -1e-3) { gl_Position = vec4(2.0,2.0,2.0,1.0); vB = 0.0; gl_PointSize = 1.0; return; }
    gl_Position = project(v);
    gl_PointSize = 1.0;
    // Edge fade (SAR-style): 1 − easeIO((age−11)/3)
    float f = clamp((aAge - 11.0) / 3.0, 0.0, 1.0);
    float ef = f < 0.5 ? 4.0 * f * f * f : 1.0 - pow(-2.0 * f + 2.0, 3.0) / 2.0;
    float decay = exp(-aAge / uTau) * (1.0 - ef);
    vB = uBase * decay * uBScale;
  }
`;
