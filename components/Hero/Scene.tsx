"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import {
  RAMP,
  GLYPH_COUNT,
  asciiVert,
  asciiFrag,
  earthVert,
  earthFrag,
  skyVert,
  skyFrag,
  cloudVert,
  cloudFrag,
  ribbonVert,
  ribbonFrag,
  starsVert,
  starsFrag,
} from "./shaders/ascii";

type ClearRect = { x: number; y: number; w: number; h: number; enabled?: boolean };

type SceneProps = {
  fallback?: ReactNode;
  introDuration?: number;        // s. default 6.8
  airplaneInterval?: number;     // s. default 45
  airplanePassDuration?: number; // s. default 28
  clearRect?: ClearRect;         // optional cell-blank for coord DOM area
};

// ─── constants ───────────────────────────────────────────────────────────────
const LANDMASK_URL = "/textures/earth-landmask-2048.png";
const SEOUL_LAT = 37.5665;
const SEOUL_LON = 126.978;

// ─── small utils ────────────────────────────────────────────────────────────
function detectWebGL(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function pickCellCSS(width: number): { cellW: number; cellH: number } {
  if (width < 640) return { cellW: 6, cellH: 10 };
  return { cellW: 7, cellH: 12 };
}

function pickSkyVFOV(width: number): number {
  if (width < 640) return 62;
  if (width < 1024) return 58;
  return 55;
}

// §3.1a scene A vfov from screen size, in degrees. Earth diameter = min(0.63H, 0.80W).
function computeEarthVFOV(width: number, height: number): { vS0: number; vS1: number } {
  const D = Math.min(0.63 * height, 0.80 * width);
  const vS0 = (2 * Math.atan((height * 0.15826) / D) * 180) / Math.PI;
  const t0 = Math.tan((vS0 / 2) * (Math.PI / 180));
  const vS1 = (2 * Math.atan(1.381 * t0) * 180) / Math.PI;
  return { vS0, vS1 };
}

// Airplane path breakpoint params (screen fractions).
function pickAirplaneParams(width: number): {
  startFrac: [number, number];
  endFrac: [number, number];
  spanS: number; // wingspan in world units
} {
  if (width < 640)   return { startFrac: [-0.12, 0.72], endFrac: [1.12, 0.28], spanS: 7.0 };
  if (width < 1024)  return { startFrac: [-0.10, 0.80], endFrac: [1.10, 0.22], spanS: 9.0 };
  return                    { startFrac: [-0.08, 0.91], endFrac: [1.12, 0.06], spanS: 12.0 };
}

// easings
const easeInOutSine  = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;
const easeInOutQuart = (x: number) =>
  x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2;
const smooth01 = (x: number) => {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
};

// Lat/lon (degrees) → unit vector on sphere.
function latLonToUnit(latDeg: number, lonDeg: number): THREE.Vector3 {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  return new THREE.Vector3(
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
    Math.cos(lat) * Math.cos(lon)
  );
}

// Build the ASCII atlas canvas: 12 glyphs horizontally, cellH tall, in device px.
function buildAsciiAtlas(
  cellWDev: number,
  cellHDev: number,
  fontFamily: string
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = cellWDev * GLYPH_COUNT;
  canvas.height = cellHDev;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const fontSize = Math.max(4, Math.round(cellHDev * 0.86));
  ctx.font = `400 ${fontSize}px ${fontFamily}`;
  for (let i = 0; i < RAMP.length; i++) {
    const x = i * cellWDev + cellWDev / 2;
    const y = cellHDev * 0.54;
    ctx.fillText(RAMP[i], x, y);
  }
  return canvas;
}

// Project a screen-fraction (sx, sy) through camera to intersect the y=yWorld plane.
// Returns a world point. sx/sy use top-left origin, (0..1).
function unprojectToPlane(
  camera: THREE.PerspectiveCamera,
  sx: number,
  sy: number,
  yWorld: number
): THREE.Vector3 {
  const ndc = new THREE.Vector3(sx * 2 - 1, 1 - sy * 2, 0.5);
  ndc.unproject(camera);
  const dir = ndc.sub(camera.position).normalize();
  if (Math.abs(dir.y) < 1e-6) return new THREE.Vector3(0, yWorld, 0);
  const t = (yWorld - camera.position.y) / dir.y;
  return camera.position.clone().add(dir.multiplyScalar(t));
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function Scene({
  fallback = null,
  introDuration = 6.8,
  airplaneInterval = 45,
  airplanePassDuration = 28,
  clearRect,
}: SceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [disabled, setDisabled] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    if (!detectWebGL()) {
      setDisabled(true);
      return;
    }

    // Pre-screen low-end hardware.
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

    // ── Renderer ──────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(0x0b0b0b, 1);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = true;
    const canvas = renderer.domElement;
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    mount.appendChild(canvas);

    // ── Mutable sizing/state ──────────────────────────────────────────────
    let width = Math.max(1, mount.clientWidth || window.innerWidth);
    let height = Math.max(1, mount.clientHeight || window.innerHeight);
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let lowPower = false; // true after one FPS strike → dpr=1, cell+1
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);

    // Cell size (device px, integer)
    const computeCellDev = () => {
      const css = pickCellCSS(width);
      const extra = lowPower ? 1 : 0;
      return {
        cellWDev: Math.max(2, Math.round((css.cellW + extra) * dpr)),
        cellHDev: Math.max(2, Math.round((css.cellH + extra) * dpr)),
      };
    };
    let { cellWDev, cellHDev } = computeCellDev();

    // Grid (cells) and scene target size (grid × 2)
    const computeGrid = () => ({
      cols: Math.ceil((width * dpr) / cellWDev),
      rows: Math.ceil((height * dpr) / cellHDev),
    });
    let { cols, rows } = computeGrid();

    const makeTarget = (w: number, h: number) =>
      new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
        stencilBuffer: false,
      });
    let targetA = makeTarget(cols * 2, rows * 2);
    let targetB = makeTarget(cols * 2, rows * 2);
    targetA.texture.colorSpace = THREE.NoColorSpace;
    targetB.texture.colorSpace = THREE.NoColorSpace;

    // ── ASCII atlas ───────────────────────────────────────────────────────
    const defaultMonoFamily = "ui-monospace, Menlo, monospace";
    let atlasFamily = defaultMonoFamily;
    try {
      const body = document.body;
      const first = getComputedStyle(body).fontFamily.split(",")[0].trim();
      if (first) atlasFamily = `${first}, ${defaultMonoFamily}`;
    } catch {
      // keep default
    }

    let atlasCanvas = buildAsciiAtlas(cellWDev, cellHDev, atlasFamily);
    let atlasTex = new THREE.CanvasTexture(atlasCanvas);
    atlasTex.minFilter = THREE.LinearFilter;
    atlasTex.magFilter = THREE.LinearFilter;
    atlasTex.generateMipmaps = false;
    atlasTex.flipY = false;
    atlasTex.needsUpdate = true;

    // Try to upgrade atlas once PP Lettra Mono has loaded.
    const upgradeAtlasOnFontLoad = async () => {
      try {
        const px = Math.round(cellHDev * 0.86);
        const firstFamily = atlasFamily.split(",")[0].trim();
        if (document.fonts && firstFamily) {
          await document.fonts.load(`400 ${px}px ${firstFamily}`);
        }
      } catch {
        // ignore
      }
      rebuildAtlas();
    };
    const rebuildAtlas = () => {
      atlasCanvas = buildAsciiAtlas(cellWDev, cellHDev, atlasFamily);
      const newTex = new THREE.CanvasTexture(atlasCanvas);
      newTex.minFilter = THREE.LinearFilter;
      newTex.magFilter = THREE.LinearFilter;
      newTex.generateMipmaps = false;
      newTex.flipY = false;
      newTex.needsUpdate = true;
      atlasTex.dispose();
      atlasTex = newTex;
      asciiMat.uniforms.uAtlas.value = atlasTex;
    };
    upgradeAtlasOnFontLoad();

    // ── Scene A: stars + earth ────────────────────────────────────────────
    const sceneA = new THREE.Scene();
    sceneA.background = new THREE.Color(0x000000);

    // Stars pass (ortho full-screen quad)
    const starsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const starsScene = new THREE.Scene();
    const starsMat = new THREE.ShaderMaterial({
      vertexShader: starsVert,
      fragmentShader: starsFrag,
      uniforms: {
        uResolution: { value: new THREE.Vector2(cols * 2, rows * 2) },
        uCellSize: { value: new THREE.Vector2(2, 2) }, // in target px (target is 2x cells)
        uDescend: { value: 0 },
      },
    });
    const starsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), starsMat);
    starsScene.add(starsQuad);

    // Earth
    const earthGeom = new THREE.SphereGeometry(1, 128, 96);
    const earthMat = new THREE.ShaderMaterial({
      vertexShader: earthVert,
      fragmentShader: earthFrag,
      uniforms: {
        uLandMask: { value: null as THREE.Texture | null },
        uHasLandMask: { value: 0 },
        uSunDir: { value: new THREE.Vector3(-0.55, 0.45, 0.70).normalize() },
        uWrap: { value: 0.20 },
        uOceanAlbedo: { value: 0.36 },
        uLandAlbedo: { value: 0.82 },
        uGrainFreq: { value: 48 },
        uGrainAmpOcean: { value: 0.05 },
        uGrainAmpLand: { value: 0.17 },
        uRimStrength: { value: 0.22 },
        uRimPower: { value: 2.5 },
        uAmbient: { value: 0.03 },
      },
    });
    const earth = new THREE.Mesh(earthGeom, earthMat);
    earth.rotation.order = "YXZ";
    sceneA.add(earth);

    // Try to load landmask asynchronously; fallback shader continues meanwhile.
    new THREE.TextureLoader().load(
      LANDMASK_URL,
      (tex) => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        earthMat.uniforms.uLandMask.value = tex;
        earthMat.uniforms.uHasLandMask.value = 1;
      },
      undefined,
      () => {
        // 404 is expected until 40c lands — keep fbm fallback.
      }
    );

    // Earth rotation keyframes: start = Seoul − (−18°, −12°) direction, end = Seoul.
    const seoulUnit = latLonToUnit(SEOUL_LAT, SEOUL_LON);
    const startUnit = latLonToUnit(SEOUL_LAT - 12, SEOUL_LON - 18);
    const qStart = new THREE.Quaternion().setFromUnitVectors(startUnit, new THREE.Vector3(0, 0, 1));
    const qEnd = new THREE.Quaternion().setFromUnitVectors(seoulUnit, new THREE.Vector3(0, 0, 1));

    // Camera A (perspective, variable vfov).
    const camA = new THREE.PerspectiveCamera(28, width / height, 0.01, 1000);
    camA.position.set(0, 0, 6.4);
    camA.lookAt(0, 0, 0);

    // ── Scene B: sky + clouds + airplane + 2 ribbons ──────────────────────
    const sceneB = new THREE.Scene();
    sceneB.background = new THREE.Color(0x000000);

    const skyGeom = new THREE.SphereGeometry(500, 32, 24);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: skyVert,
      fragmentShader: skyFrag,
    });
    const sky = new THREE.Mesh(skyGeom, skyMat);
    sceneB.add(sky);

    const cloudGeom = new THREE.PlaneGeometry(4000, 4000, 1, 1);
    const cloudMat = new THREE.ShaderMaterial({
      transparent: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: cloudVert,
      fragmentShader: cloudFrag,
      uniforms: {
        uDrift: { value: new THREE.Vector2(0, 0) },
        uTime: { value: 0 },
      },
    });
    const clouds = new THREE.Mesh(cloudGeom, cloudMat);
    clouds.rotation.x = -Math.PI / 2; // lay flat on xz
    clouds.position.y = 60;
    sceneB.add(clouds);

    // Airplane planform (lat along ±x, "along" axis along -z so yaw works intuitively).
    const planeParams = pickAirplaneParams(width);
    const buildPlaneShape = (S: number) => {
      const shape = new THREE.Shape();
      // Approximate planform: fuselage + swept wings + tail.
      // Build as a single filled outline, in units of S, with "along" as +y in shape space.
      // We'll rotate the ShapeGeometry so along → +X world after being laid flat.
      // Points (lat, along):
      // right wing tip 0.50 lat at along=0.08 − 0.50*tan28°
      const tan28 = Math.tan((28 * Math.PI) / 180);
      const tan32 = Math.tan((32 * Math.PI) / 180);
      const pts: [number, number][] = [
        // fuselage front
        [0.0, 0.55],
        // right wing leading edge path
        [0.04, 0.55 - 0.50 * 0.0], // keep near fuselage
        [0.50, 0.08 - 0.50 * tan28],
        [0.50, 0.08 - 0.50 * tan28 - (0.16 - 0.10 * 0.50)],
        [0.045, -0.1],
        // right tail
        [0.045, -0.36 + 0.18 * tan32],
        [0.18, -0.36 - 0.18 * tan32],
        [0.18, -0.36 - 0.18 * tan32 - 0.09],
        [0.045, -0.50],
        // tail bottom center
        [0.0, -0.50],
        // mirror to left
        [-0.045, -0.50],
        [-0.18, -0.36 - 0.18 * tan32 - 0.09],
        [-0.18, -0.36 - 0.18 * tan32],
        [-0.045, -0.36 + 0.18 * tan32],
        [-0.045, -0.1],
        [-0.50, 0.08 - 0.50 * tan28 - (0.16 - 0.10 * 0.50)],
        [-0.50, 0.08 - 0.50 * tan28],
        [-0.04, 0.55 - 0.50 * 0.0],
      ];
      shape.moveTo(pts[0][0] * S, pts[0][1] * S);
      for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0] * S, pts[i][1] * S);
      shape.closePath();
      return shape;
    };
    const makeAirplane = (S: number) => {
      const shape = buildPlaneShape(S);
      const geom = new THREE.ShapeGeometry(shape);
      geom.rotateX(-Math.PI / 2); // lay flat on xz, "along" → +x
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.97, 0.97, 0.97), side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.y = 60;
      mesh.visible = false;
      return { mesh, mat, geom };
    };
    let airplane = makeAirplane(planeParams.spanS);
    sceneB.add(airplane.mesh);

    // Contrail ribbons: 2 ribbons × 56 segments. BufferGeometry with 2 vertices per segment.
    const RIBBON_SEGMENTS = 56;
    const makeRibbon = () => {
      const positions = new Float32Array(RIBBON_SEGMENTS * 2 * 3);
      const lums = new Float32Array(RIBBON_SEGMENTS * 2);
      const indices: number[] = [];
      for (let i = 0; i < RIBBON_SEGMENTS - 1; i++) {
        const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
        indices.push(a, b, c, b, d, c);
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geom.setAttribute("aLum", new THREE.BufferAttribute(lums, 1));
      geom.setIndex(indices);
      const mat = new THREE.ShaderMaterial({
        vertexShader: ribbonVert,
        fragmentShader: ribbonFrag,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.visible = false;
      return { mesh, mat, geom, positions, lums };
    };
    const ribbonL = makeRibbon();
    const ribbonR = makeRibbon();
    sceneB.add(ribbonL.mesh);
    sceneB.add(ribbonR.mesh);

    // Camera B (perspective, pitch 55° final).
    const camB = new THREE.PerspectiveCamera(pickSkyVFOV(width), width / height, 0.1, 2000);
    camB.position.set(0, 0, 0);

    // ── Postprocess (ASCII) ───────────────────────────────────────────────
    const postScene = new THREE.Scene();
    const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const asciiMat = new THREE.ShaderMaterial({
      vertexShader: asciiVert,
      fragmentShader: asciiFrag,
      uniforms: {
        uSceneA: { value: targetA.texture },
        uSceneB: { value: targetB.texture },
        uAtlas: { value: atlasTex },
        uSceneMix: { value: 0 },
        uGlyphCount: { value: GLYPH_COUNT },
        uBlack: { value: 0.06 },
        uWhite: { value: 0.90 },
        uGamma: { value: 0.85 },
        uContrast: { value: 0.92 },
        uCut: { value: 0.035 },
        uDither: { value: 0.50 },
        uIntensityFloor: { value: 0.40 },
        uResolution: { value: new THREE.Vector2(width * dpr, height * dpr) },
        uCellSize: { value: new THREE.Vector2(cellWDev, cellHDev) },
        uInk: { value: new THREE.Color(0.914, 0.906, 0.886) },
        uPaper: { value: new THREE.Color(0.043, 0.043, 0.043) },
        uClearEnabled: { value: clearRect?.enabled ? 1 : 0 },
        uClearRect: {
          value: new THREE.Vector4(
            (clearRect?.x ?? 0) * dpr,
            (clearRect?.y ?? 0) * dpr,
            (clearRect?.w ?? 0) * dpr,
            (clearRect?.h ?? 0) * dpr
          ),
        },
      },
    });
    const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), asciiMat);
    postScene.add(postQuad);

    // ── Resize handler ────────────────────────────────────────────────────
    const applyResize = () => {
      width = Math.max(1, mount.clientWidth || window.innerWidth);
      height = Math.max(1, mount.clientHeight || window.innerHeight);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(lowPower ? 1 : dpr);
      renderer.setSize(width, height, false);
      const effDpr = lowPower ? 1 : dpr;

      ({ cellWDev, cellHDev } = computeCellDev());
      ({ cols, rows } = computeGrid());

      targetA.dispose();
      targetB.dispose();
      targetA = makeTarget(cols * 2, rows * 2);
      targetB = makeTarget(cols * 2, rows * 2);
      targetA.texture.colorSpace = THREE.NoColorSpace;
      targetB.texture.colorSpace = THREE.NoColorSpace;
      asciiMat.uniforms.uSceneA.value = targetA.texture;
      asciiMat.uniforms.uSceneB.value = targetB.texture;

      asciiMat.uniforms.uResolution.value.set(width * effDpr, height * effDpr);
      asciiMat.uniforms.uCellSize.value.set(cellWDev, cellHDev);
      if (clearRect?.enabled) {
        asciiMat.uniforms.uClearRect.value.set(
          clearRect.x * effDpr,
          clearRect.y * effDpr,
          clearRect.w * effDpr,
          clearRect.h * effDpr
        );
      }

      starsMat.uniforms.uResolution.value.set(cols * 2, rows * 2);

      rebuildAtlas();

      // Recompute camera A vfov (post-descend) based on new aspect
      const { vS0, vS1 } = computeEarthVFOV(width, height);
      // Keep both for use in anim loop; store on refs below
      vfovA.vS0 = vS0;
      vfovA.vS1 = vS1;
      camA.aspect = width / height;
      camA.updateProjectionMatrix();

      // Camera B vfov per breakpoint
      camB.fov = pickSkyVFOV(width);
      camB.aspect = width / height;
      camB.updateProjectionMatrix();

      // Rebuild airplane for new breakpoint span.
      const newParams = pickAirplaneParams(width);
      if (newParams.spanS !== planeParamsRef.spanS) {
        sceneB.remove(airplane.mesh);
        airplane.geom.dispose();
        airplane.mat.dispose();
        airplane = makeAirplane(newParams.spanS);
        sceneB.add(airplane.mesh);
      }
      planeParamsRef.startFrac = newParams.startFrac;
      planeParamsRef.endFrac = newParams.endFrac;
      planeParamsRef.spanS = newParams.spanS;
    };

    const vfovA = computeEarthVFOV(width, height);
    const planeParamsRef = { ...planeParams };

    const ro = new ResizeObserver(() => applyResize());
    ro.observe(mount);

    // Scroll scrub (smoothed)
    let scrollTarget = 0;
    let scrollNorm = 0;
    const updateScroll = () => {
      const rect = mount.getBoundingClientRect();
      scrollTarget = Math.min(Math.max(-rect.top / Math.max(rect.height, 1), 0), 1);
    };
    updateScroll();
    window.addEventListener("scroll", updateScroll, { passive: true });

    // Reduced-motion
    const mm = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduceMotion = mm.matches;
    const onRMChange = (e: MediaQueryListEvent) => {
      reduceMotion = e.matches;
      // Force one render
      pausedByVisibility = false;
      requestRender();
    };
    mm.addEventListener?.("change", onRMChange);

    // Page visibility: pause rAF when tab hidden; adjust tSec on resume.
    let pausedByVisibility = false;
    let hiddenAt = 0;
    let totalHiddenMs = 0;
    const onVis = () => {
      if (document.hidden) {
        pausedByVisibility = true;
        hiddenAt = performance.now();
      } else {
        if (pausedByVisibility) {
          totalHiddenMs += performance.now() - hiddenAt;
          pausedByVisibility = false;
          requestRender();
        }
      }
    };
    document.addEventListener("visibilitychange", onVis);

    // ── Animation loop ────────────────────────────────────────────────────
    const start = performance.now();
    let rafId = 0;
    let lastFrame = start;

    // FPS watchdog
    let fpsSampleStart = start;
    let fpsFrames = 0;
    let lowFpsAccum = 0;

    const requestRender = () => {
      if (rafId === 0) rafId = requestAnimationFrame(render);
    };

    function render() {
      rafId = 0;
      if (pausedByVisibility) return;
      const now = performance.now();
      const tSec = Math.max(0, (now - start - totalHiddenMs) / 1000);
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;

      // Scroll smoothing: s += (target − s) × (1 − exp(−6·dt))
      scrollNorm += (scrollTarget - scrollNorm) * (1 - Math.exp(-6 * dt));

      // ── Intro / stage logic ────────────────────────────────────────────
      // Spec stages: S0 0–1 hold, S1 1–3.8 descend, X 3.4–4.4 crossfade,
      // S2 4.4–6.8 look-up, S3 6.8+ settle.
      const scaled = (reduceMotion ? Infinity : tSec);
      const alignT = reduceMotion ? 1 : Math.min(scaled / 3.8, 1);
      const descT = reduceMotion ? 1 : Math.min(Math.max((scaled - 1) / 2.8, 0), 1);
      const mixT = reduceMotion ? 1 : smooth01((scaled - 3.4) / 1.0);
      const pitchT = reduceMotion ? 1 : Math.min(Math.max((scaled - 4.4) / 2.4, 0), 1);

      // ── Scene A: earth rotation + camera vfov/distance ────────────────
      if (mixT < 1) {
        earth.quaternion.copy(
          qStart.clone().slerp(qEnd, easeInOutSine(alignT))
        );
        const e = easeInOutQuart(descT);
        const dist = THREE.MathUtils.lerp(6.4, 1.12, e);
        const fov = THREE.MathUtils.lerp(vfovA.vS0, vfovA.vS1, e);
        camA.position.set(0, 0, dist);
        camA.fov = fov;
        camA.updateProjectionMatrix();
        camA.lookAt(0, 0, 0);
        starsMat.uniforms.uDescend.value = e;
      }

      // ── Scene B: pitch animation 8° → 55° ──────────────────────────────
      const pitchDeg = THREE.MathUtils.lerp(8, 55, easeInOutSine(pitchT));
      camB.rotation.order = "YXZ";
      camB.rotation.set(THREE.MathUtils.degToRad(pitchDeg), 0, 0);

      // Clouds drift
      const drift = cloudMat.uniforms.uDrift.value as THREE.Vector2;
      drift.x += 0.35 * dt;
      drift.y += -0.12 * dt;
      cloudMat.uniforms.uTime.value = tSec;

      asciiMat.uniforms.uSceneMix.value = mixT;

      // ── Airplane + ribbons (scene B) ───────────────────────────────────
      // First pass starts at t=8s (relative to tSec=0). Interval=45s.
      const planeStartT = 8.0;
      const passD = airplanePassDuration;
      // Relative time inside the current cycle:
      const inCycle = (scaled - planeStartT) % airplaneInterval;
      const hasStarted = scaled >= planeStartT;
      // k in [0..1] during pass, else before/after.
      let kBase = 0;
      let planeVisible = false;
      if (reduceMotion) {
        kBase = 0.42;
        planeVisible = true;
      } else if (hasStarted) {
        if (inCycle >= 0 && inCycle <= passD) {
          kBase = inCycle / passD;
          planeVisible = true;
        } else {
          planeVisible = false;
        }
      }

      // Scroll scrub
      const k = Math.min(kBase + 0.25 * scrollNorm, 1.1);

      // Compute world start/end from screen fractions each frame (for current camB pitch & aspect).
      camB.updateMatrixWorld();
      const planeStart = unprojectToPlane(camB, planeParamsRef.startFrac[0], planeParamsRef.startFrac[1], 60);
      const planeEnd = unprojectToPlane(camB, planeParamsRef.endFrac[0], planeParamsRef.endFrac[1], 60);

      const dirXZ = new THREE.Vector3().subVectors(planeEnd, planeStart);
      dirXZ.y = 0;
      const lenXZ = Math.max(dirXZ.length(), 1e-6);
      dirXZ.multiplyScalar(1 / lenXZ);
      const sideXZ = new THREE.Vector3(-dirXZ.z, 0, dirXZ.x);

      const kClamped = Math.min(Math.max(k, 0), 1);
      const planePos = new THREE.Vector3().lerpVectors(planeStart, planeEnd, kClamped);

      // Airplane
      airplane.mesh.visible = planeVisible || reduceMotion;
      airplane.mesh.position.copy(planePos);
      // yaw: atan2(dir.x, −dir.z)
      const yaw = Math.atan2(dirXZ.x, -dirXZ.z);
      airplane.mesh.rotation.set(0, yaw, 0);

      // Ribbons
      const tauBase = 9;
      const maxAgeBase = 14;
      const tau = tauBase * (1 + 1.2 * scrollNorm);
      const maxAge = maxAgeBase * (1 + 1.0 * scrollNorm);
      const S = planeParamsRef.spanS;
      const halfLatOffset = 0.18 * S;
      const latPerAge = 0.04 * S;
      const minCellWidthWorld = (1.5 * cellWDev) / dpr; // rough; keeps ribbon ≥ 1.5 CSS cell
      const _ = minCellWidthWorld; void _; // (not used explicitly beyond intent)

      const updateRibbon = (ribbon: { mesh: THREE.Mesh; positions: Float32Array; lums: Float32Array; geom: THREE.BufferGeometry }, latSign: 1 | -1) => {
        ribbon.mesh.visible = planeVisible || reduceMotion;
        if (!(planeVisible || reduceMotion)) return;
        const posAttr = ribbon.geom.getAttribute("position") as THREE.BufferAttribute;
        const lumAttr = ribbon.geom.getAttribute("aLum") as THREE.BufferAttribute;
        for (let i = 0; i < RIBBON_SEGMENTS; i++) {
          const age = i * 0.25; // s
          const kAgo = k - age / passD;
          const kAgoClamped = Math.min(Math.max(kAgo, 0), 1);
          const C = new THREE.Vector3().lerpVectors(planeStart, planeEnd, kAgoClamped);
          // Tail offset: − dir × 0.6S (behind the plane body)
          C.addScaledVector(dirXZ, -0.6 * S);
          const sideOff = latSign * (halfLatOffset + latPerAge * age);
          C.addScaledVector(sideXZ, sideOff);
          // Half-width (world):
          const w = 0.030 * S * (1 + 2.5 * age / tau);
          // Minimum visual width — ensure ≥1.5 cell near-plane. (Simplified.)
          const edgeFade = 1 - smooth01((age - (maxAge - 3)) / 3);
          const lum = 0.85 * Math.exp(-age / tau) * edgeFade;
          const hidden = kAgo < 0 ? 0 : 1;
          // Vertex 0: +side × w
          const v0 = new THREE.Vector3().copy(C).addScaledVector(sideXZ, +w);
          const v1 = new THREE.Vector3().copy(C).addScaledVector(sideXZ, -w);
          posAttr.setXYZ(i * 2, v0.x, v0.y, v0.z);
          posAttr.setXYZ(i * 2 + 1, v1.x, v1.y, v1.z);
          lumAttr.setX(i * 2, lum * hidden);
          lumAttr.setX(i * 2 + 1, lum * hidden);
        }
        posAttr.needsUpdate = true;
        lumAttr.needsUpdate = true;
      };
      updateRibbon(ribbonL, +1);
      updateRibbon(ribbonR, -1);

      // ── Render A (stars + earth) if still relevant ─────────────────────
      renderer.setPixelRatio(lowPower ? 1 : dpr);

      if (mixT < 1) {
        renderer.setRenderTarget(targetA);
        renderer.setClearColor(0x000000, 1);
        renderer.autoClear = true;
        renderer.clear();
        renderer.render(starsScene, starsCam);
        renderer.autoClear = false;
        renderer.render(sceneA, camA);
        renderer.autoClear = true;
      }

      // ── Render B after it starts ───────────────────────────────────────
      if (mixT > 0) {
        renderer.setRenderTarget(targetB);
        renderer.setClearColor(0x000000, 1);
        renderer.autoClear = true;
        renderer.clear();
        renderer.render(sceneB, camB);
      }

      // ── Post ASCII pass to screen ──────────────────────────────────────
      renderer.setRenderTarget(null);
      renderer.setClearColor(0x0b0b0b, 1);
      renderer.clear();
      renderer.render(postScene, postCam);

      // ── FPS watchdog ───────────────────────────────────────────────────
      if (!reduceMotion) {
        fpsFrames++;
        if (now - fpsSampleStart > 1000) {
          const fps = (fpsFrames * 1000) / (now - fpsSampleStart);
          fpsSampleStart = now;
          fpsFrames = 0;
          if (fps < 24) {
            lowFpsAccum += 1;
            if (!lowPower && lowFpsAccum >= 2) {
              lowPower = true;
              applyResize(); // re-create at dpr=1, cell+1
            } else if (lowPower && lowFpsAccum >= 5) {
              setDisabled(true);
              return;
            }
          } else {
            lowFpsAccum = Math.max(0, lowFpsAccum - 1);
          }
        }
      }

      // Reduced-motion: render once + stay off rAF (resize/visibility will reschedule).
      if (reduceMotion) return;

      rafId = requestAnimationFrame(render);
    }

    rafId = requestAnimationFrame(render);

    // ── Cleanup ───────────────────────────────────────────────────────────
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", updateScroll);
      mm.removeEventListener?.("change", onRMChange);
      document.removeEventListener("visibilitychange", onVis);
      ro.disconnect();

      targetA.dispose();
      targetB.dispose();
      atlasTex.dispose();

      earthGeom.dispose();
      earthMat.dispose();
      skyGeom.dispose();
      skyMat.dispose();
      cloudGeom.dispose();
      cloudMat.dispose();
      starsMat.dispose();
      (starsQuad.geometry as THREE.BufferGeometry).dispose();
      asciiMat.dispose();
      (postQuad.geometry as THREE.BufferGeometry).dispose();

      airplane.geom.dispose();
      airplane.mat.dispose();
      ribbonL.geom.dispose();
      ribbonL.mat.dispose();
      ribbonR.geom.dispose();
      ribbonR.mat.dispose();

      const landTex = earthMat.uniforms.uLandMask.value as THREE.Texture | null;
      landTex?.dispose?.();

      renderer.dispose();
      if (canvas.parentNode === mount) mount.removeChild(canvas);
    };
  }, [airplaneInterval, airplanePassDuration, clearRect, introDuration]);

  if (disabled) {
    return (
      <div
        role="img"
        aria-label="서울 상공, 아래에서 올려다본 하늘을 비행기가 천천히 가로지르는 ASCII 애니메이션"
        style={{ width: "100%", height: "100%", background: "#0B0B0B" }}
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
      style={{ width: "100%", height: "100%", background: "#0B0B0B" }}
    />
  );
}
