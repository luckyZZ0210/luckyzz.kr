"use client";

import { useEffect, useRef, useState } from "react";
import { MAIN, LINKS, IMG, ROUTES } from "@/lib/ia";

// ─── Motion & layout constants (spec §5, §6) ────────────────────────────────
const C = {
  CENTER_Y: 0.54,
  ORBIT_RX_DESK: 270,
  ORBIT_RX_FRAC_DESK: 0.22,
  ORBIT_RX_FRAC_MOB: 0.27,
  ORBIT_RY_FRAC_DESK: 0.23,
  ORBIT_RY_FRAC_MOB: 0.25,
  OUTER_SCALE: 1.6,
  MAIN_H: 30,
  SUB_H: 22,
  MAIN_PX_DESK: 13,
  MAIN_PX_MOB: 12,
  SUB_PX_DESK: 11,
  SUB_PX_MOB: 10,
  NUM_PX: 10,
  NODE_PAD_X: 11,
  REPEL_R: 40,
  REPEL_F: 2.6,
  REPEL_JITTER: 0.45,
  NODE_SPRING: 0.03,
  NODE_DAMP: 0.86,
  REST_EPS: 0.35,
  REST_FRAMES: 10,
  BITMAP_ERASE: 2.2,
  IMG_W_MAIN_DESK: 250,
  IMG_H_MAIN_DESK: 180,
  IMG_W_SUB_DESK: 190,
  IMG_H_SUB_DESK: 137,
  IMG_W_MAIN_MOB: 170,
  IMG_W_SUB_MOB: 140,
  IMG_SAMPLE_STEP: 2,
  IMG_MAX_DESK: 6500,
  IMG_MAX_MOB: 3600,
  IMG_SPRING_ARRIVE: 0.045,
  IMG_SPRING_DEPART: 0.06,
  IMG_DAMP: 0.8,
  IMG_ALPHA_IN: 0.06,
  IMG_ALPHA_OUT: 0.035,
  IMG_HOVER_JITTER: 1.3,
  POINT_NODE: 1.2,
  POINT_IMG: 1.5,
};

export default function IndexField() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hudParticles, setHudParticles] = useState(0);
  const [hudCursor, setHudCursor] = useState("—");
  const [hudNode, setHudNode] = useState("—");

  useEffect(() => {
    const hostEl = hostRef.current;
    const cvEl = canvasRef.current;
    const svgEl = svgRef.current;
    if (!hostEl || !cvEl || !svgEl) return;
    const ctx2d = cvEl.getContext("2d");
    if (!ctx2d) return;
    const host: HTMLDivElement = hostEl;
    const cv: HTMLCanvasElement = cvEl;
    const svg: SVGSVGElement = svgEl;
    const ctx: CanvasRenderingContext2D = ctx2d;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ns = "http://www.w3.org/2000/svg";

    // Load images once.
    const imgs: Record<string, HTMLImageElement> = {};
    for (const k of Object.keys(IMG)) {
      const im = new Image();
      im.src = IMG[k];
      imgs[k] = im;
    }

    let W = 0, H = 0, dpr = 1;
    let mx = -9999, my = -9999;
    let raf = 0;
    let hub = { x: 0, y: 0 };
    let narrow = false;
    const mode = "dark";
    const colorMode = "color" as const;

    type Node = {
      id: string;
      parent: string | null;
      x: number;
      y: number;
      w: number;
      h: number;
      lab: string;
      num?: string;
      px: number;
      main: 0 | 1;
      acc?: boolean;
      ux: number;
      uy: number;
    };
    let nodes: Node[] = [];
    type Pt = {
      hx: number; hy: number;
      x: number; y: number;
      vx: number; vy: number;
      a: number;
      on: boolean;
      rest: number;
      held: 0 | 1;
      n: number;
    };
    let pts: Pt[] = [];
    let byNode: Pt[][] = [];
    let mask: HTMLCanvasElement, mctx: CanvasRenderingContext2D;
    let layer: HTMLCanvasElement, lctx: CanvasRenderingContext2D;
    let hov: Node | null = null;
    let lines: SVGElement[] = [];
    type Part = {
      x: number; y: number;
      vx: number; vy: number;
      tx: number; ty: number;
      l: number; r: number; g: number; b: number;
      delay: number;
      die: 0 | 1;
      al: number;
    };
    let parts: Part[] = [];
    let lead: SVGPolylineElement, cap: SVGTextElement;

    const monoFamily = () =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--font-pp-lettra-mono")
        .trim() || "ui-monospace, Menlo, monospace";

    const measure = (txt: string, px: number) => {
      ctx.font = `${px}px ${monoFamily()}`;
      return ctx.measureText(txt).width;
    };

    const g = <K extends keyof SVGElementTagNameMap>(tag: K, at: Record<string, string | number>) => {
      const e = document.createElementNS(ns, tag) as SVGElementTagNameMap[K];
      for (const k in at) e.setAttribute(k, String(at[k]));
      return e;
    };

    function layout() {
      const r = host.getBoundingClientRect();
      W = r.width; H = r.height;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      narrow = W < 700;
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      mask = document.createElement("canvas");
      mask.width = W * dpr; mask.height = H * dpr;
      mctx = mask.getContext("2d", { willReadFrequently: true })!;
      mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      layer = document.createElement("canvas");
      layer.width = W * dpr; layer.height = H * dpr;
      lctx = layer.getContext("2d")!;

      const cx = W * 0.5, cy = H * C.CENTER_Y;
      const rx = narrow ? W * C.ORBIT_RX_FRAC_MOB : Math.min(W * C.ORBIT_RX_FRAC_DESK, C.ORBIT_RX_DESK);
      const ry = narrow ? H * C.ORBIT_RY_FRAC_MOB : H * C.ORBIT_RY_FRAC_DESK;
      hub = { x: cx, y: cy };
      nodes = [];
      parts = [];
      const FM = narrow ? C.MAIN_PX_MOB : C.MAIN_PX_DESK;
      const FS = narrow ? C.SUB_PX_MOB : C.SUB_PX_DESK;

      MAIN.forEach((m) => {
        const a = (m.ang * Math.PI) / 180;
        const ux = Math.cos(a), uy = Math.sin(a);
        const nd: Node = {
          id: m.id,
          parent: null,
          x: cx + ux * rx,
          y: cy + uy * ry,
          w: measure(m.label, FM) + 22,
          h: C.MAIN_H,
          lab: m.label,
          num: `[${m.n}]`,
          px: FM,
          main: 1,
          ux, uy,
        };
        nodes.push(nd);
        const k = m.sub.length;
        const subs = m.sub.map((s) => ({ s, w: measure(s.label, FS) + 16 }));
        const vertical = narrow || Math.abs(uy) > Math.abs(ux) * 1.5;
        if (vertical) {
          const tot = subs.reduce((acc, b) => acc + b.w, 0) + (k - 1) * 8;
          let x = nd.x - tot / 2;
          const y = nd.y + (uy >= 0 ? 1 : -1) * 44;
          subs.forEach(({ s, w }) => {
            nodes.push({
              id: s.id, parent: m.id,
              x: x + w / 2, y,
              w, h: C.SUB_H,
              lab: s.label, px: FS, main: 0, acc: s.acc, ux, uy,
            });
            x += w + 8;
          });
        } else {
          const dir = ux >= 0 ? 1 : -1;
          subs.forEach(({ s, w }, i) => {
            nodes.push({
              id: s.id, parent: m.id,
              x: nd.x + dir * (nd.w / 2 + 34 + w / 2),
              y: nd.y + (i - (k - 1) / 2) * 30 - (k === 1 ? 16 : 0),
              w, h: C.SUB_H,
              lab: s.label, px: FS, main: 0, acc: s.acc, ux, uy,
            });
          });
        }
      });
      nodes.forEach((n) => {
        n.x = Math.max(n.w / 2 + 12, Math.min(W - n.w / 2 - 12, n.x));
        n.y = Math.max(74, Math.min(H - 56, n.y));
      });
      const P: Record<string, Node> = Object.fromEntries(nodes.map((n) => [n.id, n]));

      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      svg.innerHTML = "";
      lines = [];

      svg.appendChild(g("ellipse", { class: "orbit", cx, cy, rx, ry }));
      svg.appendChild(g("ellipse", { class: "orbit", cx, cy, rx: rx * C.OUTER_SCALE, ry: ry * C.OUTER_SCALE }));
      svg.appendChild(g("line", { class: "cross", x1: cx - 6, y1: cy, x2: cx + 6, y2: cy }));
      svg.appendChild(g("line", { class: "cross", x1: cx, y1: cy - 6, x2: cx, y2: cy + 6 }));

      nodes.filter((n) => n.main).forEach((n) => {
        const s = g("line", { class: "spoke", x1: n.x, y1: n.y, x2: cx, y2: cy });
        s.dataset.a = n.id;
        svg.appendChild(s);
        lines.push(s);
      });
      nodes.filter((n) => n.parent).forEach((n) => {
        const p = P[n.parent!];
        const s = g("line", { class: "spoke", x1: p.x, y1: p.y, x2: n.x, y2: n.y });
        s.style.opacity = "0.55";
        s.dataset.a = n.parent!;
        s.dataset.b = n.id;
        svg.appendChild(s);
        lines.push(s);
      });
      LINKS.forEach(({ a, b, label }) => {
        const A = P[a], B = P[b];
        if (!A || !B) return;
        const mxp = (A.x + B.x) / 2, myp = (A.y + B.y) / 2;
        const dx = B.x - A.x, dy = B.y - A.y, kcurv = 0.22;
        const qx = mxp - dy * kcurv, qy = myp + dx * kcurv;
        const p = g("path", { class: "edge", d: `M${A.x},${A.y} Q${qx},${qy} ${B.x},${B.y}` });
        p.dataset.a = a; p.dataset.b = b;
        svg.appendChild(p); lines.push(p);
        if (label) {
          const tx = g("text", { class: "elab", x: (mxp + qx) / 2 + 4, y: (myp + qy) / 2 });
          tx.textContent = label;
          svg.appendChild(tx);
        }
      });
      lead = g("polyline", { class: "lead", points: "" });
      svg.appendChild(lead);
      cap = g("text", { class: "cap", x: 0, y: 0 });
      svg.appendChild(cap);

      nodes.forEach((n) => {
        const gg = g("a", {
          class: "node",
          href: ROUTES[n.id] || "#",
          "aria-label": n.parent ? `${n.parent} / ${n.lab}` : n.lab,
        });
        gg.appendChild(g("rect", {
          class: "hit",
          x: n.x - n.w / 2 - 3, y: n.y - n.h / 2 - 3,
          width: n.w + 6, height: n.h + 6,
        }));
        gg.addEventListener("focus", () => setHover(n));
        gg.addEventListener("blur", () => setHover(null));
        svg.appendChild(gg);
      });

      // Node bitmap for pixel sampling.
      mctx.clearRect(0, 0, W, H);
      mctx.fillStyle = "#000";
      mctx.strokeStyle = "#000";
      mctx.textBaseline = "middle";
      nodes.forEach((n) => {
        mctx.globalAlpha = 1;
        mctx.lineWidth = 1;
        mctx.strokeRect(Math.round(n.x - n.w / 2) + 0.5, Math.round(n.y - n.h / 2) + 0.5, Math.round(n.w), Math.round(n.h));
        mctx.font = `${n.px}px ${monoFamily()}`;
        mctx.fillText(n.lab, Math.round(n.x - n.w / 2 + C.NODE_PAD_X - (n.main ? 0 : 3)), Math.round(n.y) + 0.5);
        if (n.num) {
          mctx.globalAlpha = 0.5;
          mctx.font = `${C.NUM_PX}px ${monoFamily()}`;
          mctx.fillText(n.num, Math.round(n.x - n.w / 2), Math.round(n.y - n.h / 2 - 9));
        }
      });
      mctx.globalAlpha = 1;
      const id = mctx.getImageData(0, 0, mask.width, mask.height).data;
      pts = [];
      byNode = nodes.map(() => []);
      nodes.forEach((n, ni) => {
        const x0 = Math.floor((n.x - n.w / 2 - 2) * dpr);
        const x1 = Math.ceil((n.x + n.w / 2 + 2) * dpr);
        const y0 = Math.floor((n.y - n.h / 2 - 18) * dpr);
        const y1 = Math.ceil((n.y + n.h / 2 + 2) * dpr);
        const st = Math.max(1, Math.round(dpr));
        for (let y = Math.max(0, y0); y < y1; y += st) {
          for (let x = Math.max(0, x0); x < x1; x += st) {
            const alpha = id[(y * mask.width + x) * 4 + 3] / 255;
            if (alpha > 0.22) {
              const hx = x / dpr, hy = y / dpr;
              const an = Math.random() * 6.283;
              const rr = 60 + Math.random() * Math.max(W, H) * 0.45;
              const p: Pt = {
                hx, hy,
                x: reduce ? hx : hub.x + Math.cos(an) * rr,
                y: reduce ? hy : hub.y + Math.sin(an) * rr,
                vx: 0, vy: 0,
                a: alpha,
                on: !reduce,
                rest: 0,
                held: 0,
                n: ni,
              };
              pts.push(p);
              byNode[ni].push(p);
            }
          }
        }
      });
      setHudParticles(pts.length);
      draw();
    }

    function sampleImage(n: Node) {
      const im = imgs[n.id];
      if (!im || !im.complete || !im.naturalWidth) return null;
      const bw = narrow
        ? (n.main ? C.IMG_W_MAIN_MOB : C.IMG_W_SUB_MOB)
        : (n.main ? C.IMG_W_MAIN_DESK : C.IMG_W_SUB_DESK);
      const bh = Math.round(bw * 0.72);
      let bx: number, by: number;
      const side = Math.abs(n.uy) > Math.abs(n.ux) * 1.5 && !narrow;
      if (side) {
        bx = n.x - bw / 2;
        by = n.uy >= 0 ? n.y + n.h / 2 + (n.main ? 62 : 24) : n.y - n.h / 2 - bh - (n.main ? 62 : 24);
      } else {
        const dir = n.ux >= 0 ? 1 : -1;
        bx = dir > 0
          ? n.x + n.w / 2 + (n.main ? ((n.id === "build" || n.id === "coffee") ? 150 : 40) : 30)
          : n.x - n.w / 2 - bw - (n.main ? 40 : 30);
        by = n.y - bh / 2;
      }
      if (narrow) {
        bx = W / 2 - bw / 2;
        by = n.y < hub.y ? n.y + n.h / 2 + 40 : n.y - n.h / 2 - bh - 40;
      }
      bx = Math.max(14, Math.min(W - bw - 14, bx));
      by = Math.max(70, Math.min(H - bh - 48, by));

      const c = document.createElement("canvas");
      c.width = bw; c.height = bh;
      const gi = c.getContext("2d")!;
      const s = Math.max(bw / im.naturalWidth, bh / im.naturalHeight);
      gi.drawImage(im, (bw - im.naturalWidth * s) / 2, (bh - im.naturalHeight * s) / 2, im.naturalWidth * s, im.naturalHeight * s);
      const d = gi.getImageData(0, 0, bw, bh).data;
      let mean = 0;
      for (let i = 0; i < d.length; i += 16) mean += d[i] + d[i + 1] + d[i + 2];
      mean /= (d.length / 16) * 765;
      const inv = mean > 0.55;
      const step = narrow ? C.IMG_SAMPLE_STEP : C.IMG_SAMPLE_STEP;
      const maxN = narrow ? C.IMG_MAX_MOB : C.IMG_MAX_DESK;
      const out: { x: number; y: number; l: number; r: number; g: number; b: number }[] = [];
      for (let y = 0; y < bh; y += step) {
        for (let x = 0; x < bw; x += step) {
          const i = (y * bw + x) * 4;
          let l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
          if (inv) l = 1 - l;
          if (Math.random() < Math.min(1, Math.pow(l, 1.05) * 1.25)) {
            out.push({
              x: bx + x + Math.random() * step,
              y: by + y + Math.random() * step,
              l, r: d[i], g: d[i + 1], b: d[i + 2],
            });
          }
        }
      }
      for (let i = out.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [out[i], out[j]] = [out[j], out[i]];
      }
      return { pts: out.slice(0, maxN), bx, by, bw, bh };
    }

    function setHover(n: Node | null) {
      if (n === hov) return;
      if (hov) {
        const src = byNode[nodes.indexOf(hov)];
        parts.forEach((q) => {
          if (!q.die) {
            q.die = 1;
            const h = src[(Math.random() * src.length) | 0] || { hx: hov!.x, hy: hov!.y };
            q.tx = h.hx; q.ty = h.hy;
          }
        });
        src.forEach((p) => { p.held = 0; });
      }
      hov = n;
      const id = n ? (n.parent || n.id) : null;
      svg.classList.toggle("on", !!n);
      lines.forEach((e) => {
        e.classList.toggle(
          "hot",
          !!id && (e.dataset.a === id || e.dataset.b === id || e.dataset.b === (n && n.id))
        );
      });
      setHudNode(n ? (n.parent ? `${n.parent} / ${n.lab}` : n.lab) : "—");
      lead.classList.remove("show");
      cap.classList.remove("show");
      if (!n) return;
      const S = sampleImage(n);
      if (!S) return;
      const ni = nodes.indexOf(n);
      const src = byNode[ni];
      src.forEach((p) => {
        p.on = true; p.held = 1; p.rest = 0;
        p.vx += (Math.random() - 0.5) * 3; p.vy += (Math.random() - 0.5) * 3;
      });
      S.pts.forEach((t, i) => {
        const h = src[(Math.random() * src.length) | 0] || { hx: n.x, hy: n.y };
        parts.push({
          x: h.hx, y: h.hy,
          vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4,
          tx: t.x, ty: t.y,
          l: t.l, r: t.r, g: t.g, b: t.b,
          delay: ((i / S.pts.length) * 26) | 0,
          die: 0, al: 0,
        });
      });
      if (reduce) parts.forEach((q) => { q.x = q.tx; q.y = q.ty; q.al = 1; q.delay = 0; });
      const ax = Math.max(S.bx, Math.min(S.bx + S.bw, n.x));
      const ay = n.y < S.by ? S.by : (n.y > S.by + S.bh ? S.by + S.bh : n.y);
      const ex = ax === n.x ? n.x : (ax < n.x ? n.x - n.w / 2 : n.x + n.w / 2);
      lead.setAttribute("points", `${ex},${n.y} ${ax},${ay}`);
      const mainMatch = MAIN.find((m) => m.id === n.id);
      const label = n.parent ? `${n.parent} / ${n.lab.replace(" ●", "")}` : n.lab;
      const fig = n.parent ? "" : ` ${mainMatch?.n || ""}`;
      cap.setAttribute("x", String(S.bx));
      cap.setAttribute("y", String(S.by + S.bh + 14));
      cap.innerHTML = `<tspan class="k">Fig.${fig.trim() || "·"}</tspan> — ${label} · 대표 이미지(임시)`;
      requestAnimationFrame(() => { lead.classList.add("show"); cap.classList.add("show"); });
      if (reduce) draw();
    }

    const col = (): [string, string, string] =>
      mode === "dark" ? ["#0A0B0C", "#E9E9E3", "#9DB8FF"] : ["#ECEEEE", "#121414", "#1F3FBF"];

    function draw() {
      const [bg, ink, acc] = col();
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = bg;
      nodes.forEach((n) => ctx.fillRect(n.x - n.w / 2, n.y - n.h / 2, n.w + 1, n.h + 1));
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, layer.width, layer.height);
      lctx.globalCompositeOperation = "source-over";
      lctx.drawImage(mask, 0, 0);
      lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lctx.globalCompositeOperation = "destination-out";
      lctx.fillStyle = "#000";
      for (const p of pts) if (p.on) lctx.fillRect(p.hx - 0.6, p.hy - 0.6, C.BITMAP_ERASE, C.BITMAP_ERASE);
      lctx.globalCompositeOperation = "source-in";
      lctx.fillStyle = ink;
      lctx.fillRect(0, 0, W, H);
      lctx.globalCompositeOperation = "source-atop";
      lctx.fillStyle = acc;
      nodes.forEach((n) => {
        if (n.acc) lctx.fillRect(n.x - n.w / 2 - 1, n.y - n.h / 2 - 1, n.w + 3, n.h + 3);
      });
      lctx.globalCompositeOperation = "source-over";
      ctx.drawImage(layer, 0, 0, W, H);
      for (const p of pts) {
        if (!p.on) continue;
        const nd = nodes[p.n];
        const hot = hov && (nd.id === hov.id || nd.parent === hov.id || nd.id === hov.parent);
        ctx.fillStyle = hot || nd.acc ? acc : ink;
        ctx.globalAlpha = Math.min(1, 0.4 + p.a);
        ctx.fillRect(p.x, p.y, C.POINT_NODE, C.POINT_NODE);
      }
      // image dots
      const light = mode !== "dark";
      for (const q of parts) {
        if (q.delay > 0 || q.al <= 0) continue;
        if (colorMode === "color") {
          const k = light ? 1 : 1.25;
          ctx.fillStyle = `rgb(${Math.min(255, (q.r * k) | 0)},${Math.min(255, (q.g * k) | 0)},${Math.min(255, (q.b * k) | 0)})`;
          ctx.globalAlpha = q.al * (light ? 0.95 : Math.min(1, 0.35 + q.l));
        } else {
          ctx.fillStyle = ink;
          ctx.globalAlpha = q.al * Math.min(1, 0.25 + q.l * 0.9);
        }
        ctx.fillRect(q.x, q.y, C.POINT_IMG, C.POINT_IMG);
      }
      ctx.globalAlpha = 1;
    }

    function step() {
      const R = C.REPEL_R, R2 = R * R;
      for (const p of pts) {
        const dx = p.x - mx, dy = p.y - my, d2 = dx * dx + dy * dy;
        if (d2 < R2) {
          const f = (1 - d2 / R2) * C.REPEL_F;
          const dd = Math.sqrt(d2) || 1;
          p.vx += (dx / dd) * f + (Math.random() - 0.5) * C.REPEL_JITTER * 2;
          p.vy += (dy / dd) * f + (Math.random() - 0.5) * C.REPEL_JITTER * 2;
          p.on = true; p.rest = 0;
        }
        if (!p.on) continue;
        let tx = p.hx, ty = p.hy;
        if (p.held) {
          tx += Math.sin(p.hx * 0.7 + performance.now() * 0.004) * C.IMG_HOVER_JITTER;
          ty += Math.cos(p.hy * 0.7 + performance.now() * 0.004) * C.IMG_HOVER_JITTER;
        }
        p.vx += (tx - p.x) * C.NODE_SPRING;
        p.vy += (ty - p.y) * C.NODE_SPRING;
        p.vx *= C.NODE_DAMP; p.vy *= C.NODE_DAMP;
        p.x += p.vx; p.y += p.vy;
        if (!p.held && Math.abs(p.x - p.hx) < C.REST_EPS && Math.abs(p.y - p.hy) < C.REST_EPS && Math.abs(p.vx) + Math.abs(p.vy) < 0.08) {
          if (++p.rest > C.REST_FRAMES) {
            p.on = false; p.x = p.hx; p.y = p.hy; p.vx = p.vy = 0;
          }
        }
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i];
        if (q.delay > 0) { q.delay--; continue; }
        const k = q.die ? C.IMG_SPRING_DEPART : C.IMG_SPRING_ARRIVE;
        q.vx += (q.tx - q.x) * k; q.vy += (q.ty - q.y) * k;
        q.vx *= C.IMG_DAMP; q.vy *= C.IMG_DAMP;
        q.x += q.vx; q.y += q.vy;
        if (!q.die) {
          q.al = Math.min(1, q.al + C.IMG_ALPHA_IN);
          const dx = q.x - mx, dy = q.y - my, d2 = dx * dx + dy * dy;
          if (d2 < 1600) {
            const f = (1 - d2 / 1600) * 1.6;
            const dd = Math.sqrt(d2) || 1;
            q.vx += (dx / dd) * f; q.vy += (dy / dd) * f;
          }
        } else {
          q.al -= C.IMG_ALPHA_OUT;
          if (q.al <= 0 || (Math.abs(q.x - q.tx) < 1 && Math.abs(q.y - q.ty) < 1)) parts.splice(i, 1);
        }
      }
    }

    function loop() { step(); draw(); raf = requestAnimationFrame(loop); }

    // Pointer events
    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      mx = e.clientX - r.left; my = e.clientY - r.top;
      setHudCursor(`${mx | 0},${my | 0}`);
      const n = nodes.find((n) => Math.abs(mx - n.x) < n.w / 2 + 6 && Math.abs(my - n.y) < n.h / 2 + 6) || null;
      if (n !== hov) setHover(n);
    };
    const onLeave = () => {
      mx = my = -9999;
      setHudCursor("—");
      setHover(null);
    };
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);

    function start() {
      if (!host.getBoundingClientRect().width) return;
      hov = null;
      layout();
      if (!reduce) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(loop);
      }
    }
    const readyP = document.fonts?.ready ?? Promise.resolve();
    readyP.then(start);

    let resizeTO: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(resizeTO);
      resizeTO = setTimeout(start, 120);
    };
    window.addEventListener("resize", onResize);

    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (reduce) return;
        if (e.isIntersecting) {
          if (!pts.length) layout();
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(loop);
        } else cancelAnimationFrame(raf);
      });
    });
    io.observe(host);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      io.disconnect();
      if (resizeTO) clearTimeout(resizeTO);
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className="hX"
      data-mode="dark"
      style={{
        position: "fixed",
        inset: 0,
        background: "#0A0B0C",
        color: "#E9E9E3",
        overflow: "hidden",
        fontFamily: "var(--font-pp-lettra-mono)",
      }}
    >
      <style>{`
        .hX .grid{position:absolute;inset:0;background-image:linear-gradient(#1A1D20 1px,transparent 1px),linear-gradient(90deg,#1A1D20 1px,transparent 1px);background-size:40px 40px;opacity:.6;pointer-events:none}
        .hX canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
        .hX svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
        .hX .edge{fill:none;stroke:#E9E9E3;stroke-width:.8;stroke-dasharray:3 4;opacity:.75;transition:stroke .2s,opacity .2s}
        .hX .spoke{fill:none;stroke:#E9E9E3;stroke-width:.6;opacity:.35}
        .hX .orbit{fill:none;stroke:#E9E9E3;stroke-width:.6;opacity:.22}
        .hX svg.on .edge,.hX svg.on .spoke{opacity:.12}
        .hX .hot{stroke:#9DB8FF!important;opacity:1!important;stroke-width:1.4;stroke-dasharray:none}
        .hX .node{cursor:pointer;outline:none}
        .hX .node rect.hit{fill:transparent;stroke:none}
        .hX .node:focus-visible rect.hit{stroke:#9DB8FF;stroke-width:1.5;stroke-dasharray:2 2}
        .hX .lead{stroke:#9DB8FF;stroke-width:.8;fill:none;opacity:0;transition:opacity .3s}
        .hX .lead.show{opacity:1}
        .hX .cap{font-family:var(--font-pp-lettra-mono);font-size:10px;fill:#6E7378;opacity:0;transition:opacity .4s .25s}
        .hX .cap.show{opacity:1}
        .hX .cap tspan.k{fill:#9DB8FF}
        .hX .elab{font-family:var(--font-pp-lettra-mono);font-size:8.5px;fill:#6E7378}
        .hX .cross{stroke:#E9E9E3;stroke-width:.7;opacity:.6}
        .hX .hud{position:absolute;font-size:10.5px;line-height:1.6;color:#6E7378;z-index:3;font-family:var(--font-pp-lettra-mono)}
        .hX .hud b{color:#E9E9E3;font-weight:400}
      `}</style>
      <div className="grid" aria-hidden="true" />
      <svg ref={svgRef} aria-label="luckyzz.kr 사이트 구조" />
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="hud" style={{ left: 20, bottom: 16 }}>
        PARTICLES <b>{hudParticles.toLocaleString("en-US")}</b>
        <br />IA <b>rev. 2026.10.11</b> · 5 routes
      </div>
      <div className="hud" style={{ right: 20, bottom: 16, textAlign: "right" }}>
        CURSOR <b>{hudCursor}</b>
        <br />NODE <b>{hudNode}</b>
      </div>
      {/* SSR fallback for accessibility — hidden visually but present for crawlers */}
      <ul className="sr-only" aria-hidden="false" style={{ position: "absolute", left: -9999, top: -9999 }}>
        {MAIN.map((m) => (
          <li key={m.id}>
            <a href={m.route}>{m.label}</a>
            {m.sub.length > 0 && (
              <ul>
                {m.sub.map((s) => (
                  <li key={s.id}><a href={s.route}>{s.label}</a></li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
