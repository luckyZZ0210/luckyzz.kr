// ASCII glyph atlas postprocess for Hero/Scene (40a-r2).
// Spec: docs/design/40-hero.md §1 — cell-wise ramp " .,:;-=+*#%@" (12 steps),
// 4x4 Bayer dither BETWEEN ramp steps (never per-pixel), density+intensity 2ch.

export const RAMP = " .,:;-=+*#%@";
export const GLYPH_COUNT = RAMP.length; // 12

export const asciiVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const asciiFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uSceneA;
  uniform sampler2D uSceneB;
  uniform sampler2D uAtlas;
  uniform float uSceneMix;
  uniform float uGlyphCount;
  uniform float uBlack;
  uniform float uWhite;
  uniform float uGamma;
  uniform float uContrast;
  uniform float uCut;
  uniform float uDither;
  uniform float uIntensityFloor;
  uniform vec2  uResolution;
  uniform vec2  uCellSize;
  uniform vec3  uInk;
  uniform vec3  uPaper;
  // Optional clear-rect (coord DOM lives above canvas → avoid overdraw cells here).
  uniform float uClearEnabled;
  uniform vec4  uClearRect; // x, y, w, h in device px, origin top-left

  float bayer4(vec2 p) {
    vec2 q = mod(p, 4.0);
    int ix = int(q.x);
    int iy = int(q.y);
    int i = iy * 4 + ix;
    float m[16];
    m[0]=0.0;  m[1]=8.0;  m[2]=2.0;  m[3]=10.0;
    m[4]=12.0; m[5]=4.0;  m[6]=14.0; m[7]=6.0;
    m[8]=3.0;  m[9]=11.0; m[10]=1.0; m[11]=9.0;
    m[12]=15.0;m[13]=7.0; m[14]=13.0;m[15]=5.0;
    float v = 0.5;
    for (int k = 0; k < 16; k++) {
      if (k == i) { v = (m[k] + 0.5) / 16.0; break; }
    }
    return v;
  }

  void main() {
    // Origin = top-left for cell grid.
    vec2 frag = vec2(vUv.x, 1.0 - vUv.y) * uResolution;
    vec2 cell = floor(frag / uCellSize);
    vec2 grid = ceil(uResolution / uCellSize);
    vec2 suv  = vec2(
      (cell.x + 0.5) / grid.x,
      1.0 - (cell.y + 0.5) / grid.y
    );

    // Clear rect: blank cells where coord DOM sits.
    if (uClearEnabled > 0.5) {
      vec2 cellPx = cell * uCellSize;
      if (cellPx.x + uCellSize.x > uClearRect.x &&
          cellPx.x < uClearRect.x + uClearRect.z &&
          cellPx.y + uCellSize.y > uClearRect.y &&
          cellPx.y < uClearRect.y + uClearRect.w) {
        gl_FragColor = vec4(uPaper, 1.0);
        return;
      }
    }

    const vec3 W = vec3(0.2126, 0.7152, 0.0722);
    vec3 colA = texture2D(uSceneA, suv).rgb;
    vec3 colB = texture2D(uSceneB, suv).rgb;
    float lum = mix(dot(colA, W), dot(colB, W), uSceneMix);

    float raw = clamp((lum - uBlack) / max(uWhite - uBlack, 1e-4), 0.0, 1.0);
    float l   = clamp(0.5 + (pow(raw, uGamma) - 0.5) * uContrast, 0.0, 1.0);
    float n1  = max(uGlyphCount - 1.0, 1.0);
    float ld  = clamp(l + (bayer4(cell) - 0.5) * uDither / n1, 0.0, 1.0);
    float idx = raw < uCut ? 0.0 : floor(ld * n1 + 0.5);

    vec2 inCell = fract(frag / uCellSize);
    float gx = (idx + inCell.x) / uGlyphCount;
    float gy = inCell.y;
    float g  = texture2D(uAtlas, vec2(gx, gy)).a;

    float inten = mix(uIntensityFloor, 1.0, l);
    gl_FragColor = vec4(mix(uPaper, uInk, g * inten), 1.0);
  }
`;

// Earth shader (scene A): custom luminance with optional landmask (fallback = fbm).
export const earthVert = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec2 vLL;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec4 vp = viewMatrix * wp;
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    // equirect uv from object-space position (so texture rotates WITH the globe)
    vec3 p = normalize(position);
    float lon = atan(p.x, p.z);               // -π..π
    float lat = asin(clamp(p.y, -1.0, 1.0));  // -π/2..π/2
    vLL = vec2(lon / (2.0 * 3.14159265) + 0.5, lat / 3.14159265 + 0.5);
    gl_Position = projectionMatrix * vp;
  }
`;

export const earthFrag = /* glsl */ `
  precision highp float;
  varying vec3 vN;
  varying vec3 vV;
  varying vec2 vLL;
  uniform sampler2D uLandMask;
  uniform float     uHasLandMask;
  uniform vec3  uSunDir;
  uniform float uWrap;
  uniform float uOceanAlbedo;
  uniform float uLandAlbedo;
  uniform float uGrainFreq;
  uniform float uGrainAmpOcean;
  uniform float uGrainAmpLand;
  uniform float uRimStrength;
  uniform float uRimPower;
  uniform float uAmbient;

  // Hash + fbm
  float hash12(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm3(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
      v += a * noise2(p);
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    // Landmask (if provided), else fbm-based fallback continents.
    float m;
    if (uHasLandMask > 0.5) {
      m = texture2D(uLandMask, vLL).r;
    } else {
      // Big-scale fbm, warped slightly, thresholded to produce continent-like patches.
      vec2 q = vLL * vec2(4.0, 2.0);
      float w = fbm3(q + 7.3) * 0.6;
      m = fbm3(q + vec2(w, -w));
    }
    float land = smoothstep(0.35, 0.68, m);

    // Mid-freq grain, fixed to surface uv (not screen).
    float grain = fbm3(vLL * uGrainFreq);
    float grainAmp = mix(uGrainAmpOcean, uGrainAmpLand, land);
    float albedo = mix(uOceanAlbedo, uLandAlbedo, land) + (grain - 0.5) * grainAmp;

    vec3 L = normalize(uSunDir);
    float d = clamp((dot(normalize(vN), L) + uWrap) / (1.0 + uWrap), 0.0, 1.0);
    float rim = uRimStrength * pow(max(1.0 - dot(normalize(vN), normalize(vV)), 0.0), uRimPower);
    float lum = albedo * d + rim * d + uAmbient;
    lum = clamp(lum, 0.0, 1.5);
    gl_FragColor = vec4(vec3(lum), 1.0);
  }
`;

// Sky dome shader (scene B): altitude-angle luminance.
export const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const skyFrag = /* glsl */ `
  precision highp float;
  varying vec3 vDir;
  void main() {
    // altitude angle: 0 at horizon, 90° at zenith
    float sinA = clamp(normalize(vDir).y, -1.0, 1.0);
    // Piecewise linear from spec: 0°→0.20, 20°→0.11, 45°→0.05, 90°→0.00
    float a = asin(sinA);          // -π/2 .. π/2
    float lum;
    if (a <= 0.0) {
      lum = 0.0;
    } else {
      float d = degrees(a);
      if (d < 20.0) {
        lum = mix(0.20, 0.11, d / 20.0);
      } else if (d < 45.0) {
        lum = mix(0.11, 0.05, (d - 20.0) / 25.0);
      } else {
        lum = mix(0.05, 0.00, (d - 45.0) / 45.0);
      }
    }
    gl_FragColor = vec4(vec3(lum), 1.0);
  }
`;

// Cloud plane shader (scene B): large horizontal plane at y=60.
export const cloudVert = /* glsl */ `
  varying vec2 vWorldXZ;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldXZ = wp.xz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const cloudFrag = /* glsl */ `
  precision highp float;
  varying vec2 vWorldXZ;
  uniform vec2  uDrift;    // world units offset
  uniform float uTime;

  float hash12(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm3(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * noise2(p); p *= 2.0; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 p = (vWorldXZ + uDrift) * vec2(0.018, 0.030);
    float f = fbm3(p);
    float cloud = clamp((f - 0.56) * 3.0, 0.0, 1.0) * 0.22;
    gl_FragColor = vec4(vec3(cloud), 1.0);
  }
`;

// Contrail ribbon shader: vertex attribute aLum → luminance.
export const ribbonVert = /* glsl */ `
  attribute float aLum;
  varying float vLum;
  void main() {
    vLum = aLum;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const ribbonFrag = /* glsl */ `
  precision highp float;
  varying float vLum;
  void main() {
    gl_FragColor = vec4(vec3(vLum), 1.0);
  }
`;

// Stars background: tiny bright marks at ~0.15% of half-cell grid.
// Rendered as full-screen quad in scene A before earth draw. Fades by uDescend.
export const starsVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const starsFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec2  uResolution;
  uniform vec2  uCellSize;
  uniform float uDescend; // 0..1 — fades out as camera descends

  float hash12(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 frag = vec2(vUv.x, 1.0 - vUv.y) * uResolution;
    vec2 halfCell = floor(frag / (uCellSize * 0.5));
    float h = hash12(halfCell);
    float on = step(0.9985, h);
    float fade = 1.0 - smoothstep(0.0, 0.5, uDescend);
    gl_FragColor = vec4(vec3(on * 0.55 * fade), 1.0);
  }
`;
