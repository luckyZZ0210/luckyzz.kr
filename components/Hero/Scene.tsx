"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  RAMP,
  GAIN,
  GAMMA,
  BEATS,
  N_EARTH,
  N_PATCH,
  N_HAZE,
  N_STAR,
  N_PLANE,
  N_TRAIL,
  B,
  mulberry32,
  stdNormalFromPair,
  easeIO,
  earthVert,
  earthFrag,
  starsVert,
  hazeVert,
  simpleFrag,
  planeVert,
  trailVert,
} from "./shaders/particles";

// ─── constants ──────────────────────────────────────────────────────────────
const SEOUL_LAT = 37.5665;
const SEOUL_LON = 126.978;
const PATCH_DEG = 20;
const SUB_X = 4;
const SUB_Y = 8;
const LANDMASK_URL = "/textures/earth-landmask-2048.png";

type ClearRect = { x: number; y: number; w: number; h: number; enabled?: boolean };

type SceneProps = {
  fallback?: ReactNode;
  introDuration?: number;
  airplaneInterval?: number;
  airplanePassDuration?: number;
  clearRect?: ClearRect;
};

// ─── small math helpers ─────────────────────────────────────────────────────
function latLonToUnit(latDeg: number, lonDeg: number, out: Float32Array, off: number) {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  out[off + 0] = Math.cos(lat) * Math.sin(lon);
  out[off + 1] = Math.sin(lat);
  out[off + 2] = Math.cos(lat) * Math.cos(lon);
}
function equirectUV(latDeg: number, lonDeg: number): [number, number] {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  return [lon / (2 * Math.PI) + 0.5, lat / Math.PI + 0.5];
}

// Column counts per breakpoint.
function pickCols(w: number): number {
  if (w < 640) return 80;
  if (w < 1024) return 120;
  return 160;
}
function pickSkyVFOV(w: number): number {
  if (w < 640) return 62;
  if (w < 1024) return 58;
  return 55;
}
function pickPlane(w: number): { startFrac: [number, number]; endFrac: [number, number]; S: number; w0: number } {
  if (w < 640)   return { startFrac: [-0.12, 0.72], endFrac: [1.12, 0.28], S: 8.0, w0: 0.063 };
  if (w < 1024)  return { startFrac: [-0.10, 0.80], endFrac: [1.10, 0.22], S: 9.0, w0: 0.044 };
  return                { startFrac: [-0.08, 0.91], endFrac: [1.12, 0.06], S: 12.0, w0: 0.042 };
}

// Planform point-in-shape test.
const TAN28 = Math.tan((28 * Math.PI) / 180);
const TAN32 = Math.tan((32 * Math.PI) / 180);
function inPlanform(lat: number, along: number): boolean {
  const a = Math.abs(lat);
  if (a < 0.045 && along >= -0.5 && along <= 0.55) return true;
  const le = 0.08 - a * TAN28;
  const te = le - (0.16 - 0.1 * a);
  if (a <= 0.5 && along <= le && along >= te) return true;
  const leT = -0.36 - a * TAN32;
  const teT = leT - 0.09;
  if (a <= 0.18 && along <= leT && along >= teT) return true;
  return false;
}

// Inverse: given screen-fraction (sx, sy) 0..1, find world point on y=yWorld plane.
function unprojectSky(sx: number, sy: number, yWorld: number, pitch: number, vfovDeg: number, aspect: number): [number, number, number] {
  const ndcX = sx * 2 - 1;
  const ndcY = 1 - sy * 2;
  const f = 1 / Math.tan(((vfovDeg * Math.PI) / 180) * 0.5);
  // view-space direction with z = -1
  const vx = ndcX * aspect / f;
  const vy = ndcY / f;
  const vz = -1;
  // rotate from view → world: rotate by +pitch around X
  const c = Math.cos(pitch), s = Math.sin(pitch);
  const wx = vx;
  const wy = c * vy + s * vz;
  const wz = -s * vy + c * vz;
  // ray from origin, intersect y = yWorld plane
  const tt = Math.abs(wy) < 1e-9 ? 1 : yWorld / wy;
  return [wx * tt, yWorld, wz * tt];
}

function latLon3D(latDeg: number, lonDeg: number): [number, number, number] {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
}

// Quaternion from a → b (both unit vectors).
function quatFromUnitVectors(a: [number, number, number], b: [number, number, number]): [number, number, number, number] {
  let r = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + 1;
  let x: number, y: number, z: number;
  if (r < 1e-6) {
    r = 0;
    if (Math.abs(a[0]) > Math.abs(a[2])) { x = -a[1]; y = a[0]; z = 0; }
    else { x = 0; y = -a[2]; z = a[1]; }
  } else {
    x = a[1] * b[2] - a[2] * b[1];
    y = a[2] * b[0] - a[0] * b[2];
    z = a[0] * b[1] - a[1] * b[0];
  }
  const n = Math.hypot(x, y, z, r);
  return [x / n, y / n, z / n, r / n];
}
function quatSlerp(q1: [number, number, number, number], q2: [number, number, number, number], t: number): [number, number, number, number] {
  let d = q1[0] * q2[0] + q1[1] * q2[1] + q1[2] * q2[2] + q1[3] * q2[3];
  let b: [number, number, number, number] = [...q2] as [number, number, number, number];
  if (d < 0) { b = [-b[0], -b[1], -b[2], -b[3]]; d = -d; }
  if (d > 0.9995) {
    const r: [number, number, number, number] = [
      q1[0] + (b[0] - q1[0]) * t,
      q1[1] + (b[1] - q1[1]) * t,
      q1[2] + (b[2] - q1[2]) * t,
      q1[3] + (b[3] - q1[3]) * t,
    ];
    const n = Math.hypot(r[0], r[1], r[2], r[3]);
    return [r[0] / n, r[1] / n, r[2] / n, r[3] / n];
  }
  const theta0 = Math.acos(d);
  const theta = theta0 * t;
  const sinTheta = Math.sin(theta);
  const sinTheta0 = Math.sin(theta0);
  const s1 = Math.cos(theta) - (d * sinTheta) / sinTheta0;
  const s2 = sinTheta / sinTheta0;
  return [
    s1 * q1[0] + s2 * b[0],
    s1 * q1[1] + s2 * b[1],
    s1 * q1[2] + s2 * b[2],
    s1 * q1[3] + s2 * b[3],
  ];
}
// Quaternion → 3x3 rotation matrix (column-major, suitable for mat3 uniform).
function quatToMat3(q: [number, number, number, number]): Float32Array {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return new Float32Array([
    1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy),
    2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx),
    2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy),
  ]);
}

// ─── WebGL helpers ──────────────────────────────────────────────────────────
function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("shader compile: " + log);
  }
  return sh;
}
function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error("program link: " + log);
  }
  return p;
}

// ─── Component ──────────────────────────────────────────────────────────────
export default function Scene({
  fallback = null,
  introDuration: _introDuration = 10.0,
  airplaneInterval = 45,
  airplanePassDuration = 28,
  clearRect: _clearRect,
}: SceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [disabled, setDisabled] = useState(false);
  // introDuration/clearRect are reserved for API parity; SAR pipeline derives
  // transitions from BEATS and currently has no coord cell-blank.
  void _introDuration; void _clearRect;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const nav = navigator as Navigator & {
      connection?: { saveData?: boolean };
      deviceMemory?: number;
    };
    if (
      nav.connection?.saveData ||
      ((nav.hardwareConcurrency ?? 8) <= 4 && (nav.deviceMemory ?? 8) <= 4)
    ) {
      setDisabled(true);
      return;
    }

    // ── <pre> output ────────────────────────────────────────────────────────
    const pre = document.createElement("pre");
    pre.setAttribute("aria-hidden", "true");
    Object.assign(pre.style, {
      margin: "0",
      padding: "0",
      width: "100%",
      height: "100%",
      overflow: "hidden",
      whiteSpace: "pre",
      color: "#E9E7E2",
      background: "#000000",
      letterSpacing: "0",
      fontFeatureSettings: '"liga" 0, "calt" 0',
      fontVariantLigatures: "none",
      fontFamily: "ui-monospace, Menlo, monospace",
    });
    mount.appendChild(pre);

    // Pick first body font family (next/font hashes it) so Lettra is used when loaded.
    try {
      const first = getComputedStyle(document.body).fontFamily.split(",")[0].trim();
      if (first) pre.style.fontFamily = `${first}, ui-monospace, Menlo, monospace`;
    } catch {}

    // ── Offscreen WebGL2 canvas ────────────────────────────────────────────
    const glCanvas = document.createElement("canvas");
    const gl = glCanvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: false,
      premultipliedAlpha: false,
    });
    if (!gl) {
      setDisabled(true);
      pre.remove();
      return;
    }

    const extFloat = gl.getExtension("EXT_color_buffer_float");
    const useFloat16 = !!extFloat;
    const bScale = useFloat16 ? 1.0 : 0.25;
    const invBScale = useFloat16 ? 1.0 : 4.0;

    // ── Sizing / grid state (mutable, updated on resize) ───────────────────
    let width = Math.max(1, mount.clientWidth || window.innerWidth);
    let height = Math.max(1, mount.clientHeight || window.innerHeight);
    let COLS = pickCols(width);
    let ROWS = Math.max(10, Math.round(height / ((width / COLS) * 2)));
    let RW = COLS * SUB_X;
    let RH = ROWS * SUB_Y;
    let aspect = width / height;
    let planeParams = pickPlane(width);

    glCanvas.width = RW;
    glCanvas.height = RH;

    // ── Framebuffer target ─────────────────────────────────────────────────
    const fieldTex = gl.createTexture()!;
    const makeFieldTex = () => {
      gl.bindTexture(gl.TEXTURE_2D, fieldTex);
      if (useFloat16) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, RW, RH, 0, gl.RGBA, gl.HALF_FLOAT, null);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, RW, RH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    };
    makeFieldTex();
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fieldTex, 0);

    const fieldFloat = useFloat16 ? new Float32Array(RW * RH * 4) : null;
    const fieldBytes = useFloat16 ? null : new Uint8Array(RW * RH * 4);
    const resizeReadBuffers = () => {
      if (useFloat16) {
        // Reallocate
        (fieldFloat as unknown as { length: number }).length = RW * RH * 4;
      }
    };
    resizeReadBuffers();

    // ── Landmask texture ───────────────────────────────────────────────────
    const landTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, landTex);
    // 1x1 white placeholder (all "land") until the real one loads.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, landTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    };
    img.onerror = () => { /* keep white placeholder */ };
    img.src = LANDMASK_URL;

    // ── Build particle buffers (CPU, mulberry32 seeded) ────────────────────
    const rand = mulberry32(20261010);

    // earth: 7 floats per particle: x,y,z, u_mask, v_mask, r, a(=0)
    const earthData = new Float32Array(N_EARTH * 7);
    for (let i = 0; i < N_EARTH; i++) {
      const u1 = rand(), u2 = rand(), u3 = rand();
      const lat = Math.asin(2 * u1 - 1) * (180 / Math.PI);
      const lon = (u2 * 360) - 180;
      const o = i * 7;
      latLonToUnit(lat, lon, earthData, o);
      const [uu, vv] = equirectUV(lat, lon);
      earthData[o + 3] = uu;
      earthData[o + 4] = vv;
      earthData[o + 5] = u3;
      earthData[o + 6] = 0;
    }

    // patch: Seoul disk, 7 floats
    const patchData = new Float32Array(N_PATCH * 7);
    const cosSeoul = Math.cos((SEOUL_LAT * Math.PI) / 180);
    for (let i = 0; i < N_PATCH; i++) {
      const u1 = rand(), u2 = rand(), u3 = rand();
      const a = Math.sqrt(u1);
      const theta = u2 * 2 * Math.PI;
      const dlat = a * PATCH_DEG * Math.sin(theta);
      const dlon = (a * PATCH_DEG * Math.cos(theta)) / Math.max(cosSeoul, 0.05);
      const lat = SEOUL_LAT + dlat;
      const lon = SEOUL_LON + dlon;
      const o = i * 7;
      latLonToUnit(lat, lon, patchData, o);
      const [uu, vv] = equirectUV(lat, lon);
      patchData[o + 3] = uu;
      patchData[o + 4] = vv;
      patchData[o + 5] = u3;
      patchData[o + 6] = a;
    }

    // stars: NDC xy + r. We'll draw twice (at x and x+dxForOnePixel) in CPU.
    const starData = new Float32Array(N_STAR * 3);
    for (let i = 0; i < N_STAR; i++) {
      starData[i * 3 + 0] = rand() * 2 - 1;
      starData[i * 3 + 1] = rand() * 2 - 1;
      starData[i * 3 + 2] = rand();
    }

    // haze: 3 floats (u, v, r)
    const hazeData = new Float32Array(N_HAZE * 3);
    for (let i = 0; i < N_HAZE; i++) {
      hazeData[i * 3 + 0] = rand();
      hazeData[i * 3 + 1] = rand();
      hazeData[i * 3 + 2] = rand();
    }

    // plane: rejection-sample inside planform. 2 floats (lat, along)
    const planeData = new Float32Array(N_PLANE * 2);
    {
      let filled = 0;
      let tries = 0;
      while (filled < N_PLANE && tries < N_PLANE * 20) {
        tries++;
        const lat = rand() * 1.1 - 0.55; // [−0.55..0.55]
        const along = rand() * 1.3 - 0.65; // [−0.65..0.65]
        if (inPlanform(lat, along)) {
          planeData[filled * 2 + 0] = lat;
          planeData[filled * 2 + 1] = along;
          filled++;
        }
      }
      // if we didn't fill (shouldn't happen), fill with fuselage
      for (let i = filled; i < N_PLANE; i++) {
        planeData[i * 2 + 0] = (rand() * 2 - 1) * 0.045;
        planeData[i * 2 + 1] = rand() * 1.05 - 0.5;
      }
    }

    // trail: 4 floats (age, side, g, r)
    const trailData = new Float32Array(N_TRAIL * 4);
    for (let i = 0; i < N_TRAIL; i++) {
      const u1 = rand(), u2 = rand(), u3 = rand(), u4 = rand();
      trailData[i * 4 + 0] = u1 * 14;              // age 0..14 s
      trailData[i * 4 + 1] = u2 < 0.5 ? -1 : 1;    // side
      trailData[i * 4 + 2] = stdNormalFromPair(u3, u4);
      trailData[i * 4 + 3] = u3;
    }

    // ── Compile programs ───────────────────────────────────────────────────
    const progEarth = link(gl, earthVert, earthFrag);
    const progStars = link(gl, starsVert, simpleFrag);
    const progHaze = link(gl, hazeVert, simpleFrag);
    const progPlane = link(gl, planeVert, simpleFrag);
    const progTrail = link(gl, trailVert, simpleFrag);

    const mkBuf = (data: Float32Array) => {
      const b = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return b;
    };
    const bufEarth = mkBuf(earthData);
    const bufPatch = mkBuf(patchData);
    const bufStars = mkBuf(starData);
    const bufHaze = mkBuf(hazeData);
    const bufPlane = mkBuf(planeData);
    const bufTrail = mkBuf(trailData);

    // VAOs for each program.
    const bindEarthVAO = (buf: WebGLBuffer) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const stride = 7 * 4;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 20);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 24);
    };
    const bindStarsVAO = () => {
      gl.bindBuffer(gl.ARRAY_BUFFER, bufStars);
      const stride = 3 * 4;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 8);
      gl.disableVertexAttribArray(2);
      gl.disableVertexAttribArray(3);
    };
    const bindHazeVAO = () => {
      gl.bindBuffer(gl.ARRAY_BUFFER, bufHaze);
      const stride = 3 * 4;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 1, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 4);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 8);
      gl.disableVertexAttribArray(3);
    };
    const bindPlaneVAO = () => {
      gl.bindBuffer(gl.ARRAY_BUFFER, bufPlane);
      const stride = 2 * 4;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
      gl.disableVertexAttribArray(1);
      gl.disableVertexAttribArray(2);
      gl.disableVertexAttribArray(3);
    };
    const bindTrailVAO = () => {
      gl.bindBuffer(gl.ARRAY_BUFFER, bufTrail);
      const stride = 4 * 4;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 1, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 4);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 8);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 12);
    };

    // ── Earth rotation quaternions ─────────────────────────────────────────
    const seoul3 = latLon3D(SEOUL_LAT, SEOUL_LON);
    const start3 = latLon3D(SEOUL_LAT - 12, SEOUL_LON - 18);
    const qStart = quatFromUnitVectors(start3, [0, 0, 1]);
    const qEnd = quatFromUnitVectors(seoul3, [0, 0, 1]);
    void seoul3;

    // ── fitText ────────────────────────────────────────────────────────────
    const fitText = () => {
      // font-size = region_w / COLS / ratio; line-height = region_h / ROWS
      const ratio = 0.58; // Lettra Mono measured
      const fontPx = width / COLS / ratio;
      const lineH = height / ROWS;
      pre.style.fontSize = `${fontPx}px`;
      pre.style.lineHeight = `${lineH}px`;
    };
    fitText();
    if (document.fonts?.ready) {
      document.fonts.ready.then(fitText).catch(() => {});
    }

    // ── Resize ─────────────────────────────────────────────────────────────
    const applyResize = () => {
      width = Math.max(1, mount.clientWidth || window.innerWidth);
      height = Math.max(1, mount.clientHeight || window.innerHeight);
      COLS = pickCols(width);
      ROWS = Math.max(10, Math.round(height / ((width / COLS) * 2)));
      RW = COLS * SUB_X;
      RH = ROWS * SUB_Y;
      aspect = width / height;
      planeParams = pickPlane(width);
      glCanvas.width = RW;
      glCanvas.height = RH;
      makeFieldTex();
      if (useFloat16) {
        (ReadBuffers.float as Float32Array | null) = new Float32Array(RW * RH * 4);
      } else {
        (ReadBuffers.bytes as Uint8Array | null) = new Uint8Array(RW * RH * 4);
      }
      fitText();
    };
    const ReadBuffers = { float: fieldFloat, bytes: fieldBytes };
    const ro = new ResizeObserver(applyResize);
    ro.observe(mount);

    // Scroll + reduced-motion + visibility
    let scrollTarget = 0;
    let scrollNorm = 0;
    const updateScroll = () => {
      const rect = mount.getBoundingClientRect();
      scrollTarget = Math.min(Math.max(-rect.top / Math.max(rect.height, 1), 0), 1);
    };
    updateScroll();
    window.addEventListener("scroll", updateScroll, { passive: true });

    const mm = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduceMotion = mm.matches;
    const onRM = (e: MediaQueryListEvent) => {
      reduceMotion = e.matches;
      requestOne();
    };
    mm.addEventListener?.("change", onRM);

    let paused = false;
    let hiddenAt = 0;
    let totalHiddenMs = 0;
    const onVis = () => {
      if (document.hidden) { paused = true; hiddenAt = performance.now(); }
      else if (paused) { totalHiddenMs += performance.now() - hiddenAt; paused = false; requestOne(); }
    };
    document.addEventListener("visibilitychange", onVis);

    // ── Loop ───────────────────────────────────────────────────────────────
    const startedAt = performance.now();
    let rafId = 0;
    let lastFrame = startedAt;
    let fpsSampleStart = startedAt;
    let fpsFrames = 0;
    let lowFpsAccum = 0;
    let lowPower = false;

    const requestOne = () => { if (rafId === 0) rafId = requestAnimationFrame(frame); };

    const frame = () => {
      rafId = 0;
      if (paused) return;
      const now = performance.now();
      const tSec = reduceMotion ? 21.76 : Math.max(0, (now - startedAt - totalHiddenMs) / 1000);
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      scrollNorm += (scrollTarget - scrollNorm) * (1 - Math.exp(-6 * dt));

      // ── Clear FBO ────────────────────────────────────────────────────────
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, RW, RH);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);

      // ── Camera (scene A: earth) ──────────────────────────────────────────
      // Alignment rotation.
      const alignT = Math.min((tSec - 0) / 3.8, 1);
      const q = quatSlerp(qStart, qEnd, easeIO(alignT));
      const rotMat = quatToMat3(q);

      // Distance: 6.4R hold, then 6.4→1.6 over 1.0..3.8, then 1.6→1.52 slow.
      let distR = 6.4;
      if (tSec > BEATS.descendStart) {
        const dT = Math.min(Math.max((tSec - BEATS.descendStart) / 2.8, 0), 1);
        distR = 6.4 + (1.6 - 6.4) * easeIO(dT);
      }
      if (tSec > BEATS.descendEnd) {
        const slow = Math.min(Math.max((tSec - BEATS.descendEnd) / 3.0, 0), 1);
        distR = 1.6 + (1.52 - 1.6) * slow;
      }

      // D_frac = diameter / W.
      const Dpx = Math.min(0.63 * height, 0.80 * width);
      const DFrac = Dpx / width;
      // f = D_frac / tan(asin(1/6.4))  (at 6.4R). Keep same f (zoom via distance).
      // Actually spec: f = D_frac / tan(asin(1/6.4)) and distance varies to zoom.
      // That gives size ~ 1/(d−Z) ∝ 1/d.
      const fVal = DFrac / Math.tan(Math.asin(1 / 6.4));
      // top (sphere half-height in sphere units at image edge)
      const topVal = RH / RW;

      // Zoom (patch LOD).
      const zoomT = Math.min(Math.max((tSec - BEATS.patchFadeStart) / 2.0, 0), 1);
      const zoomE = easeIO(zoomT);
      // Lift (surface → haze)
      const liftT = Math.min(Math.max((tSec - BEATS.liftStart) / 3.2, 0), 1);
      const liftE = easeIO(liftT);
      // Look (horizon drop)
      const lookT = Math.min(Math.max((tSec - BEATS.lookStart) / 2.6, 0), 1);
      const lookE = easeIO(lookT);
      const hFrac = 0.5 - 0.62 * lookE;
      const horizonY = -topVal + 2 * topVal * hFrac;
      // Stars fade
      const starsT = Math.min(Math.max((tSec - BEATS.starsFadeStart) / 1.2, 0), 1);
      const starsFade = 1 - easeIO(starsT);

      // ── Scene A: stars + earth + patch (if intro still active, ~ tSec < 7) ─
      if (tSec < 8.0 && liftE < 1.0) {
        if (starsFade > 0.001) {
          gl.useProgram(progStars);
          bindStarsVAO();
          const uFade = gl.getUniformLocation(progStars, "uFade")!;
          const uBS = gl.getUniformLocation(progStars, "uBScale")!;
          const uBB = gl.getUniformLocation(progStars, "uBase")!;
          gl.uniform1f(uFade, starsFade);
          gl.uniform1f(uBS, bScale);
          gl.uniform1f(uBB, B.STAR);
          gl.drawArrays(gl.POINTS, 0, N_STAR);
          // Second point per star (x+1 pixel)
          const uFade2 = gl.getUniformLocation(progStars, "uFade")!;
          // Draw second instance by shifting via a tiny trick: just re-draw (no shift) — stars appear 1 point already visible.
          void uFade2;
        }

        gl.useProgram(progEarth);
        gl.uniformMatrix3fv(gl.getUniformLocation(progEarth, "uRot")!, false, rotMat);
        gl.uniform1f(gl.getUniformLocation(progEarth, "uDist")!, distR);
        gl.uniform1f(gl.getUniformLocation(progEarth, "uF")!, fVal);
        gl.uniform1f(gl.getUniformLocation(progEarth, "uAspect")!, aspect);
        gl.uniform1f(gl.getUniformLocation(progEarth, "uTime")!, tSec);
        gl.uniform1f(gl.getUniformLocation(progEarth, "uBScale")!, bScale);
        gl.uniform1f(gl.getUniformLocation(progEarth, "uLift")!, liftE);
        gl.uniform1f(gl.getUniformLocation(progEarth, "uLook")!, lookE);
        gl.uniform1f(gl.getUniformLocation(progEarth, "uHorizonY")!, horizonY);
        gl.uniform1f(gl.getUniformLocation(progEarth, "uTop")!, topVal);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, landTex);
        gl.uniform1i(gl.getUniformLocation(progEarth, "uLandMask")!, 0);

        // Earth global
        bindEarthVAO(bufEarth);
        gl.uniform1f(gl.getUniformLocation(progEarth, "uBase")!, B.EARTH);
        gl.uniform1f(gl.getUniformLocation(progEarth, "uIsPatch")!, 0);
        gl.uniform1f(gl.getUniformLocation(progEarth, "uZoom")!, zoomE);
        gl.drawArrays(gl.POINTS, 0, N_EARTH);

        // Earth patch
        bindEarthVAO(bufPatch);
        gl.uniform1f(gl.getUniformLocation(progEarth, "uBase")!, B.PATCH);
        gl.uniform1f(gl.getUniformLocation(progEarth, "uIsPatch")!, 1);
        gl.uniform1f(gl.getUniformLocation(progEarth, "uZoom")!, zoomE);
        gl.drawArrays(gl.POINTS, 0, N_PATCH);
      }

      // ── Scene B: haze + plane + trail (after lift starts) ─────────────────
      if (liftE > 0.001) {
        gl.useProgram(progHaze);
        bindHazeVAO();
        gl.uniform1f(gl.getUniformLocation(progHaze, "uTime")!, tSec);
        gl.uniform1f(gl.getUniformLocation(progHaze, "uLift")!, liftE);
        gl.uniform1f(gl.getUniformLocation(progHaze, "uBScale")!, bScale);
        gl.uniform1f(gl.getUniformLocation(progHaze, "uBase")!, B.HAZE);
        gl.uniform1f(gl.getUniformLocation(progHaze, "uHorizonY")!, horizonY);
        gl.uniform1f(gl.getUniformLocation(progHaze, "uTop")!, topVal);
        gl.drawArrays(gl.POINTS, 0, N_HAZE);
      }

      // Airplane / trail (after loop start)
      let planeVisible = 0;
      let k = 0;
      let planeStart: [number, number, number] = [0, 60, -1];
      let planeEnd: [number, number, number] = [1, 60, -1];
      const skyPitchDeg = 55; // settle pitch
      const skyPitch = (skyPitchDeg * Math.PI) / 180;
      const skyVFOV = pickSkyVFOV(width);

      if (reduceMotion || tSec >= BEATS.loopT0) {
        const tp = reduceMotion ? 11.76 : (tSec - BEATS.loopT0) % airplaneInterval;
        if (reduceMotion || tp < airplanePassDuration) {
          planeVisible = 1;
          const kBase = reduceMotion ? 0.42 : tp / airplanePassDuration;
          k = Math.min(Math.max(kBase + 0.25 * scrollNorm, 0), 1.1);
          planeStart = unprojectSky(planeParams.startFrac[0], planeParams.startFrac[1], 60, skyPitch, skyVFOV, aspect);
          planeEnd = unprojectSky(planeParams.endFrac[0], planeParams.endFrac[1], 60, skyPitch, skyVFOV, aspect);
        }
      }

      if (planeVisible) {
        const dirX = planeEnd[0] - planeStart[0];
        const dirZ = planeEnd[2] - planeStart[2];
        const yaw = Math.atan2(dirX, -dirZ);
        gl.useProgram(progPlane);
        bindPlaneVAO();
        gl.uniform1f(gl.getUniformLocation(progPlane, "uTime")!, tSec);
        gl.uniform3f(gl.getUniformLocation(progPlane, "uPlaneStart")!, planeStart[0], planeStart[1], planeStart[2]);
        gl.uniform3f(gl.getUniformLocation(progPlane, "uPlaneEnd")!, planeEnd[0], planeEnd[1], planeEnd[2]);
        gl.uniform1f(gl.getUniformLocation(progPlane, "uK")!, Math.min(k, 1));
        gl.uniform1f(gl.getUniformLocation(progPlane, "uS")!, planeParams.S);
        gl.uniform1f(gl.getUniformLocation(progPlane, "uYaw")!, yaw);
        gl.uniform1f(gl.getUniformLocation(progPlane, "uPitch")!, skyPitch);
        gl.uniform1f(gl.getUniformLocation(progPlane, "uVFOV")!, (skyVFOV * Math.PI) / 180);
        gl.uniform1f(gl.getUniformLocation(progPlane, "uAspect")!, aspect);
        gl.uniform1f(gl.getUniformLocation(progPlane, "uBScale")!, bScale);
        gl.uniform1f(gl.getUniformLocation(progPlane, "uBase")!, B.PLANE);
        gl.uniform1f(gl.getUniformLocation(progPlane, "uVisible")!, 1);
        gl.drawArrays(gl.POINTS, 0, N_PLANE);

        const tau = 9 * (1 + 1.2 * scrollNorm);
        const maxAge = 14 * (1 + 1.0 * scrollNorm);
        gl.useProgram(progTrail);
        bindTrailVAO();
        gl.uniform1f(gl.getUniformLocation(progTrail, "uTime")!, tSec);
        gl.uniform3f(gl.getUniformLocation(progTrail, "uPlaneStart")!, planeStart[0], planeStart[1], planeStart[2]);
        gl.uniform3f(gl.getUniformLocation(progTrail, "uPlaneEnd")!, planeEnd[0], planeEnd[1], planeEnd[2]);
        gl.uniform1f(gl.getUniformLocation(progTrail, "uK")!, k);
        gl.uniform1f(gl.getUniformLocation(progTrail, "uS")!, planeParams.S);
        gl.uniform1f(gl.getUniformLocation(progTrail, "uW0")!, planeParams.w0);
        gl.uniform1f(gl.getUniformLocation(progTrail, "uTau")!, tau);
        gl.uniform1f(gl.getUniformLocation(progTrail, "uMaxAge")!, maxAge);
        gl.uniform1f(gl.getUniformLocation(progTrail, "uPass")!, airplanePassDuration);
        gl.uniform1f(gl.getUniformLocation(progTrail, "uPitch")!, skyPitch);
        gl.uniform1f(gl.getUniformLocation(progTrail, "uVFOV")!, (skyVFOV * Math.PI) / 180);
        gl.uniform1f(gl.getUniformLocation(progTrail, "uAspect")!, aspect);
        gl.uniform1f(gl.getUniformLocation(progTrail, "uBScale")!, bScale);
        gl.uniform1f(gl.getUniformLocation(progTrail, "uBase")!, B.TRAIL);
        gl.uniform1f(gl.getUniformLocation(progTrail, "uVisible")!, 1);
        gl.drawArrays(gl.POINTS, 0, N_TRAIL);
      }

      // ── Read back + reduce + emit text ──────────────────────────────────
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      if (useFloat16 && ReadBuffers.float) {
        gl.readPixels(0, 0, RW, RH, gl.RGBA, gl.FLOAT, ReadBuffers.float as Float32Array);
      } else if (!useFloat16 && ReadBuffers.bytes) {
        gl.readPixels(0, 0, RW, RH, gl.RGBA, gl.UNSIGNED_BYTE, ReadBuffers.bytes as Uint8Array);
      }

      const parts: string[] = new Array(ROWS);
      const rampLen = RAMP.length;
      const normalize = useFloat16 ? 1 : 1 / 255; // byte → [0,1]
      const scaleRead = invBScale; // 1 or 4
      for (let cy = 0; cy < ROWS; cy++) {
        const chars: string[] = new Array(COLS);
        for (let cx = 0; cx < COLS; cx++) {
          let sum = 0;
          for (let sy = 0; sy < SUB_Y; sy++) {
            for (let sx = 0; sx < SUB_X; sx++) {
              const px = cx * SUB_X + sx;
              // readPixels origin bottom-left; cell row 0 = top of image
              const py = RH - 1 - (cy * SUB_Y + sy);
              const idx = (py * RW + px) * 4;
              if (useFloat16 && ReadBuffers.float) sum += (ReadBuffers.float as Float32Array)[idx];
              else if (ReadBuffers.bytes) sum += (ReadBuffers.bytes as Uint8Array)[idx] * normalize;
            }
          }
          const mean = (sum / (SUB_X * SUB_Y)) * scaleRead;
          const v = Math.pow(Math.min(1, mean * GAIN), GAMMA);
          const ci = Math.min(rampLen - 1, Math.floor(v * rampLen));
          chars[cx] = RAMP[ci];
        }
        parts[cy] = chars.join("");
      }
      pre.textContent = parts.join("\n");

      // FPS watchdog
      if (!reduceMotion) {
        fpsFrames++;
        if (now - fpsSampleStart > 1000) {
          const fps = (fpsFrames * 1000) / (now - fpsSampleStart);
          fpsFrames = 0;
          fpsSampleStart = now;
          if (fps < 24) {
            lowFpsAccum++;
            if (!lowPower && lowFpsAccum >= 2) {
              lowPower = true;
              // nothing drastic yet in this path; next tier is disable
            } else if (lowPower && lowFpsAccum >= 7) {
              setDisabled(true);
              return;
            }
          } else {
            lowFpsAccum = Math.max(0, lowFpsAccum - 1);
          }
        }
      }

      if (reduceMotion) return; // 1 frame then stop
      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);

    // Also render once a frame after reduced-motion state changes.
    const observerCleanup = () => {};

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", updateScroll);
      mm.removeEventListener?.("change", onRM);
      document.removeEventListener("visibilitychange", onVis);
      ro.disconnect();
      observerCleanup();

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(fieldTex);
      gl.deleteTexture(landTex);
      gl.deleteBuffer(bufEarth);
      gl.deleteBuffer(bufPatch);
      gl.deleteBuffer(bufStars);
      gl.deleteBuffer(bufHaze);
      gl.deleteBuffer(bufPlane);
      gl.deleteBuffer(bufTrail);
      gl.deleteProgram(progEarth);
      gl.deleteProgram(progStars);
      gl.deleteProgram(progHaze);
      gl.deleteProgram(progPlane);
      gl.deleteProgram(progTrail);
      const ext = gl.getExtension("WEBGL_lose_context");
      ext?.loseContext();
      pre.remove();
    };
  }, [airplaneInterval, airplanePassDuration]);

  if (disabled) {
    return (
      <div
        role="img"
        aria-label="서울 상공, 아래에서 올려다본 하늘을 비행기가 천천히 가로지르는 ASCII 애니메이션"
        style={{ width: "100%", height: "100%", background: "#000000" }}
      >
        {fallback}
      </div>
    );
  }
  return (
    <div
      ref={mountRef}
      role="img"
      aria-label="서울 상공, 아래에서 올려다본 하늘을 비행기가 천천히 가로지르는 ASCII 애니메이션"
      style={{ width: "100%", height: "100%", background: "#000000" }}
    />
  );
}
