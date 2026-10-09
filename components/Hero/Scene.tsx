"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { ditherFrag, ditherVert } from "./shaders/dither";

type SceneProps = {
  fallback?: ReactNode;
  // seconds for the earth → sky auto-intro
  introDuration?: number;
  // seconds between airplane crossings
  airplaneInterval?: number;
};

function detectWebGL(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

export default function Scene({
  fallback = null,
  introDuration = 4,
  airplaneInterval = 10,
}: SceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [disabled, setDisabled] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reduceMotion = prefersReducedMotion();
    if (!detectWebGL()) {
      setDisabled(true);
      return;
    }

    // --- Renderer ------------------------------------------------------------
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 1);
    const canvas = renderer.domElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    mount.appendChild(canvas);

    // --- Scene / Camera ------------------------------------------------------
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);

    // Earth globe — unlit shaded via directional light so terminator survives
    // the dither threshold as classic halftone light/dark.
    const earthGeom = new THREE.SphereGeometry(1, 96, 96);
    const earthMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
    });
    const earth = new THREE.Mesh(earthGeom, earthMat);
    scene.add(earth);

    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(3, 1.2, 2);
    scene.add(sun);
    const ambient = new THREE.AmbientLight(0xffffff, 0.08);
    scene.add(ambient);

    // Sky dome — large inside-out sphere, mild gradient via vertex normal.
    const skyGeom = new THREE.SphereGeometry(30, 32, 32);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {},
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          vPos = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          // Bright top, slightly darker toward horizon.
          float t = clamp(vPos.y * 0.6 + 0.55, 0.0, 1.0);
          float v = mix(0.55, 0.95, t);
          gl_FragColor = vec4(vec3(v), 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(skyGeom, skyMat);
    scene.add(sky);

    // Airplane — tiny triangle silhouette (billboard-ish; we rotate per path).
    const planeShape = new THREE.Shape();
    planeShape.moveTo(0, 0.08);
    planeShape.lineTo(-0.14, -0.05);
    planeShape.lineTo(0, -0.02);
    planeShape.lineTo(0.14, -0.05);
    planeShape.lineTo(0, 0.08);
    const planeGeom = new THREE.ShapeGeometry(planeShape);
    const planeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const airplane = new THREE.Mesh(planeGeom, planeMat);
    airplane.visible = false;
    scene.add(airplane);

    // Airplane trail — short line of recent positions.
    const TRAIL_SEGMENTS = 48;
    const trailPositions = new Float32Array(TRAIL_SEGMENTS * 3);
    const trailGeom = new THREE.BufferGeometry();
    trailGeom.setAttribute(
      "position",
      new THREE.BufferAttribute(trailPositions, 3)
    );
    trailGeom.setDrawRange(0, 0);
    const trailMat = new THREE.LineBasicMaterial({ color: 0x000000 });
    const trail = new THREE.Line(trailGeom, trailMat);
    trail.visible = false;
    scene.add(trail);

    // --- Postprocess (fullscreen quad with dither) ---------------------------
    let width = mount.clientWidth || window.innerWidth;
    let height = mount.clientHeight || window.innerHeight;

    const makeTarget = (w: number, h: number) =>
      new THREE.WebGLRenderTarget(Math.max(1, Math.floor(w * dpr)), Math.max(1, Math.floor(h * dpr)), {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: true,
      });
    let renderTarget = makeTarget(width, height);

    const postScene = new THREE.Scene();
    const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const postMat = new THREE.ShaderMaterial({
      uniforms: {
        uScene: { value: renderTarget.texture },
        uResolution: { value: new THREE.Vector2(width * dpr, height * dpr) },
        uPixelSize: { value: 3.0 },
        uContrast: { value: 1.15 },
      },
      vertexShader: ditherVert,
      fragmentShader: ditherFrag,
    });
    const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat);
    postScene.add(postQuad);

    // --- Sizing --------------------------------------------------------------
    const resize = () => {
      width = mount.clientWidth || window.innerWidth;
      height = mount.clientHeight || window.innerHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderTarget.dispose();
      renderTarget = makeTarget(width, height);
      postMat.uniforms.uScene.value = renderTarget.texture;
      postMat.uniforms.uResolution.value.set(width * dpr, height * dpr);
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    // --- Camera path ---------------------------------------------------------
    // Phase 0: wide earth shot
    // Phase 1 (t 0 → 1 over introDuration): zoom into surface, tilt camera up
    // Phase 2: fixed sky look-up; airplane loops
    const camStart = new THREE.Vector3(0, 0.2, 3.4);
    const camEnd = new THREE.Vector3(0, 1.02, 0.9); // just outside surface
    const lookStart = new THREE.Vector3(0, 0, 0);   // look at earth center
    const lookEnd = new THREE.Vector3(0, 2.2, -1.5); // look up at sky

    const easeInOutCubic = (x: number) =>
      x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

    // --- Scroll binding ------------------------------------------------------
    let scrollNorm = 0; // 0..1 within hero section
    const updateScroll = () => {
      const rect = mount.getBoundingClientRect();
      // How far the top of the hero has scrolled past the viewport top,
      // normalized by hero height. 0 at page top, 1 after one hero-height scroll.
      const scrolled = Math.min(Math.max(-rect.top / Math.max(rect.height, 1), 0), 1.5);
      scrollNorm = scrolled;
    };
    updateScroll();
    window.addEventListener("scroll", updateScroll, { passive: true });

    // --- FPS watchdog --------------------------------------------------------
    let fpsSampleStart = performance.now();
    let fpsFrames = 0;
    let lowFpsStrikes = 0;
    let bailed = false;

    // --- Loop ----------------------------------------------------------------
    const start = performance.now();
    let rafId = 0;

    const render = () => {
      const now = performance.now();
      const tSec = (now - start) / 1000;

      // Intro progress 0..1
      const introT = reduceMotion ? 1 : Math.min(tSec / introDuration, 1);
      const e = easeInOutCubic(introT);

      camera.position.lerpVectors(camStart, camEnd, e);
      const lookAt = new THREE.Vector3().lerpVectors(lookStart, lookEnd, e);
      camera.lookAt(lookAt);

      // Slow globe spin until we've zoomed in.
      earth.rotation.y = 0.08 * tSec * (1 - e);

      // Airplane cycle starts once intro ~done.
      if (introT >= 1) {
        airplane.visible = true;
        trail.visible = true;

        // Base time progress through one cycle (0..1).
        const cycleT = reduceMotion
          ? 0.5
          : ((tSec - introDuration) % airplaneInterval) / airplaneInterval;
        // Scroll scrubs forward within cycle, "stretching" the trail length.
        const stretched = Math.min(cycleT + scrollNorm * 0.6, 1.2);

        // Diagonal path across the sky: left-bottom to right-top, mid-depth.
        const pathStart = new THREE.Vector3(-2.2, 1.6, -2.5);
        const pathEnd = new THREE.Vector3(2.4, 3.0, -2.2);
        const pos = new THREE.Vector3().lerpVectors(pathStart, pathEnd, stretched);
        airplane.position.copy(pos);
        airplane.lookAt(camera.position);
        airplane.rotation.z = Math.PI * 0.08;

        // Trail: fill N recent points along the path behind current progress.
        // Length scales with scrollNorm so the trail "stretches" on scroll.
        const tailLen = 0.08 + Math.min(scrollNorm, 1) * 0.6;
        for (let i = 0; i < TRAIL_SEGMENTS; i++) {
          const k = i / (TRAIL_SEGMENTS - 1);
          const sampleT = Math.max(stretched - tailLen * (1 - k), 0);
          const p = new THREE.Vector3().lerpVectors(pathStart, pathEnd, sampleT);
          trailPositions[i * 3 + 0] = p.x;
          trailPositions[i * 3 + 1] = p.y;
          trailPositions[i * 3 + 2] = p.z;
        }
        trailGeom.attributes.position.needsUpdate = true;
        trailGeom.setDrawRange(0, TRAIL_SEGMENTS);
      }

      // Pass 1 → offscreen
      renderer.setRenderTarget(renderTarget);
      renderer.clear();
      renderer.render(scene, camera);

      // Pass 2 → screen with dither
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(postScene, postCamera);

      // FPS watchdog — bail to fallback if sustained <20fps.
      fpsFrames++;
      if (now - fpsSampleStart > 1000) {
        const fps = fpsFrames * 1000 / (now - fpsSampleStart);
        fpsFrames = 0;
        fpsSampleStart = now;
        if (fps < 20) {
          lowFpsStrikes++;
          if (lowFpsStrikes >= 3 && !bailed) {
            bailed = true;
            setDisabled(true);
            return;
          }
        } else {
          lowFpsStrikes = 0;
        }
      }

      rafId = requestAnimationFrame(render);
    };
    rafId = requestAnimationFrame(render);

    // --- Cleanup -------------------------------------------------------------
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", updateScroll);
      ro.disconnect();
      renderTarget.dispose();
      earthGeom.dispose();
      earthMat.dispose();
      skyGeom.dispose();
      skyMat.dispose();
      planeGeom.dispose();
      planeMat.dispose();
      trailGeom.dispose();
      trailMat.dispose();
      (postQuad.geometry as THREE.BufferGeometry).dispose();
      postMat.dispose();
      renderer.dispose();
      if (canvas.parentNode === mount) mount.removeChild(canvas);
    };
  }, [introDuration, airplaneInterval]);

  if (disabled) {
    return (
      <div
        role="img"
        aria-label="서울 상공에서 비행기가 지나가는 히어로 애니메이션"
        style={{ width: "100%", height: "100%" }}
      >
        {fallback}
      </div>
    );
  }

  return (
    <div
      ref={mountRef}
      role="img"
      aria-label="서울 상공에서 비행기가 지나가는 히어로 애니메이션"
      style={{ width: "100%", height: "100%", background: "#000" }}
    />
  );
}
