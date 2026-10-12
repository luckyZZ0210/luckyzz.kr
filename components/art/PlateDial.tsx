"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import styles from "./PlateDial.module.css";
import {
  AUTO_PULL,
  SETTLE_MS,
  SLIT_X,
  PULL_MS,
  STEP_MS,
  WHEEL_NOTCH,
  TICK,
  SPRING_V,
  SPRING_DECAY,
  STAGGER_MS,
  HOT_MS_PULL,
  HOT_MS_OPEN,
  HOT_MS_CLOSE,
  VISIBLE_DEPTH,
  CANCEL_T_LIMIT,
  FAST_OPEN_T,
  getArtPlates,
  type ArtProject,
} from "@/lib/art";

type Props = { projects: ArtProject[]; initialSlug?: string };

type RuntimePlate = {
  j: number;
  p: number;
  i: number;
  src: string;
  el: HTMLDivElement;
  img: HTMLImageElement;
  tk: HTMLDivElement;
  pt: number;
  gone: boolean;
  s?: number;
};

export default function PlateDial({ projects, initialSlug }: Props) {
  const router = useRouter();
  const stageRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const indRef = useRef<HTMLDivElement>(null);
  const slitRef = useRef<HTMLDivElement>(null);
  const projRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const metaNRef = useRef<HTMLDivElement>(null);
  const metaTRef = useRef<HTMLHeadingElement>(null);
  const metaKRef = useRef<HTMLDivElement>(null);
  const metaYRef = useRef<HTMLElement>(null);
  const metaMRef = useRef<HTMLElement>(null);
  const metaCRef = useRef<HTMLElement>(null);
  const metaDRef = useRef<HTMLParagraphElement>(null);
  const hudNRef = useRef<HTMLElement>(null);
  const hudTRef = useRef<HTMLElement>(null);
  const hudPRef = useRef<HTMLElement>(null);
  const hudXRef = useRef<HTMLElement>(null);
  const hudMRef = useRef<HTMLElement>(null);
  const hudSRef = useRef<HTMLElement>(null);

  const plates = useMemo(() => getArtPlates(projects), [projects]);

  // Derived initial pos: if initialSlug given, we are entering direct — skip animation, start opened.
  const initialProjIdx = useMemo(
    () => (initialSlug ? projects.findIndex((p) => p.slug === initialSlug) : -1),
    [projects, initialSlug]
  );

  useEffect(() => {
    const stage = stageRef.current!;
    const stack = stackRef.current!;
    const ruler = rulerRef.current!;
    const ind = indRef.current!;
    const slit = slitRef.current!;
    const proj = projRef.current!;
    const strip = stripRef.current!;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Build plate DOM
    const rp: RuntimePlate[] = plates.map((pl) => {
      const el = document.createElement("div");
      el.className = styles.pl;
      el.dataset.j = String(pl.j);
      const im = new Image();
      im.src = pl.src;
      im.alt = "";
      el.appendChild(im);
      const n = document.createElement("span");
      n.className = styles.num;
      n.textContent = `${String(pl.p + 1).padStart(2, "0")}.${pl.i + 1}`;
      el.appendChild(n);
      stack.appendChild(el);
      const tk = document.createElement("div");
      tk.className = styles.tk + (pl.i === 0 ? " " + styles.major : "");
      tk.style.top = pl.j * TICK + "px";
      if (pl.i === 0) {
        const lb = document.createElement("span");
        lb.className = styles.lb;
        const P = projects[pl.p];
        lb.innerHTML = `<b>${String(pl.p + 1).padStart(2, "0")}</b>${P.title}<small>${P.year}</small>`;
        lb.addEventListener("click", () => {
          markInput();
          target = pl.j;
          queue = 0;
        });
        tk.appendChild(lb);
      }
      ruler.appendChild(tk);
      return { ...pl, el, img: im, tk, pt: 0, gone: false };
    });
    rp.forEach((pl) => {
      pl.el.addEventListener("click", () => onPlateClick(pl));
    });
    if (hudTRef.current) hudTRef.current.textContent = String(rp.length).padStart(2, "0");

    let W = 0,
      H = 0,
      narrow = false,
      pw = 0,
      ph = 0,
      frontX = 0,
      frontY = 0,
      slitX = 0,
      dx = 0,
      dz = 0;
    let pos = 0,
      vel = 0,
      target = 0,
      queue = 0,
      acc = 0,
      lastStep = 0,
      lastInput = 0,
      blockAuto = true;
    let state: "browse" | "pull" | "through" | "opening" | "open" | "closing" | "return" | "cancel" = "browse";
    let pullT0 = 0,
      pullProj = -1,
      sibs: RuntimePlate[] = [],
      stripX = 0,
      stripT = 0,
      stripMin = 0;
    let hotTo: ReturnType<typeof setTimeout> | null = null;
    let tickTo: ReturnType<typeof setTimeout> | null = null;
    let openSettleTo: ReturnType<typeof setTimeout> | null = null;
    let closeTo: ReturnType<typeof setTimeout> | null = null;

    function layout() {
      const r = stage.getBoundingClientRect();
      W = r.width;
      H = r.height;
      narrow = W < 700;
      pw = narrow ? W * 0.64 : Math.min(W * 0.33, 470);
      ph = (pw * 2) / 3;
      frontX = narrow ? W * 0.08 : W * 0.2;
      frontY = H * 0.5 - ph / 2 - H * 0.02;
      slitX = W * (narrow ? 0.9 : SLIT_X);
      dx = narrow ? pw * 0.05 : pw * 0.04;
      dz = narrow ? 52 : 80;
      stack.style.perspective = "1100px";
      stack.style.perspectiveOrigin = `${slitX}px 50%`;
      slit.style.left = slitX + "px";
      proj.style.transformOrigin = `${slitX}px 50%`;
      if (hudXRef.current) hudXRef.current.textContent = Math.round((slitX / W) * 100) + "%";
      rp.forEach((pl) => {
        pl.el.style.width = pw + "px";
        pl.el.style.height = ph + "px";
        pl.el.style.left = frontX + "px";
        pl.el.style.top = frontY + "px";
      });
    }
    const smooth = (a: number, b: number, x: number) => {
      const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };

    function render() {
      const travel = slitX - (frontX + pw / 2);
      for (const pl of rp) {
        const el = pl.el;
        const k = pl.j - pos;
        if (pl.gone || k < -1.05 || k > VISIBLE_DEPTH) {
          el.style.opacity = "0";
          el.style.pointerEvents = "none";
          continue;
        }
        el.style.pointerEvents = "";
        let x: number, z: number, op: number, ry = 12, sx = 1, sy = 1;
        if (k < 0) {
          x = k * 170;
          z = -k * dz * 1.2;
          op = Math.max(0, 1 + k * 1.3);
          ry = 12 + k * 18;
        } else {
          x = k * dx;
          z = -k * dz;
          op = k > 11 ? Math.max(0, 1 - (k - 11) / 5) : 1;
        }
        if (pl.pt > 0) {
          const e = Math.pow(pl.pt, 2.8);
          const kk = Math.max(0, k);
          x = kk * dx * (1 - e) + e * travel;
          z = -kk * dz * (1 - e);
          ry = 12 * (1 - e);
          const sq = smooth(0.72, 1, pl.pt);
          sx = 1 - sq * 0.985;
          sy = 1 + sq * 0.14;
          op = 1;
        }
        el.style.transform = `translate3d(${x.toFixed(2)}px,0,${z.toFixed(2)}px) rotateY(${ry.toFixed(2)}deg) scale(${sx.toFixed(4)},${sy.toFixed(4)})`;
        el.style.opacity = op.toFixed(3);
        if (pl.pt > 0.35) el.classList.add(styles.pulling);
        else el.classList.remove(styles.pulling);
        pl.img.style.opacity = k > 0 ? Math.max(0.26, 1 - k * 0.045).toFixed(3) : "1";
      }
      ruler.style.transform = `translateY(${(-pos * TICK).toFixed(2)}px)`;
      const cur = rp[Math.max(0, Math.min(rp.length - 1, Math.round(pos)))];
      rp.forEach((pl) => {
        if (pl.i === 0) {
          if (pl.p === cur.p) pl.tk.classList.add(styles.cur);
          else pl.tk.classList.remove(styles.cur);
        }
      });
      if (hudNRef.current) hudNRef.current.textContent = String(cur.j + 1).padStart(2, "0");
      if (hudPRef.current)
        hudPRef.current.textContent = `${String(cur.p + 1).padStart(2, "0")} — ${projects[cur.p].title}`;
    }

    function tick() {
      ind.classList.add(styles.tick);
      if (tickTo) clearTimeout(tickTo);
      tickTo = setTimeout(() => ind.classList.remove(styles.tick), 90);
    }
    function hot(ms: number) {
      slit.classList.add(styles.hot);
      if (hotTo) clearTimeout(hotTo);
      hotTo = setTimeout(() => slit.classList.remove(styles.hot), ms);
    }
    function setState(s: typeof state) {
      state = s;
      if (hudMRef.current) hudMRef.current.textContent = s;
      if (hudSRef.current)
        hudSRef.current.textContent =
          s === "browse"
            ? "DIAL — scroll to advance · stop to open"
            : s === "pull"
              ? "PULL → slit · scroll to cancel"
              : s === "open"
                ? "OPEN — esc to return · scroll to slide"
                : s === "return"
                  ? "RETURN ← slit"
                  : "…";
    }
    function markInput() {
      lastInput = performance.now();
      blockAuto = false;
    }

    function startPull(now: number, fast: boolean) {
      pullProj = rp[target].p;
      sibs = rp.filter((pl) => pl.p === pullProj && pl.j >= target);
      rp.forEach((pl) => {
        if (pl.p === pullProj && pl.j < target) pl.gone = true;
      });
      sibs.forEach((pl, s) => {
        pl.s = s;
        pl.pt = 0;
      });
      pullT0 = now - (fast ? PULL_MS * FAST_OPEN_T : 0);
      setState("pull");
    }
    function cancelPull() {
      setState("cancel");
      rp.forEach((pl) => {
        if (pl.p === pullProj && pl.j < target) pl.gone = false;
      });
    }
    function openProject() {
      setState("opening");
      stack.classList.add(styles.dim);
      const P = projects[pullProj];
      if (metaNRef.current) metaNRef.current.textContent = String(pullProj + 1).padStart(2, "0");
      if (metaTRef.current) metaTRef.current.textContent = P.title;
      if (metaKRef.current) metaKRef.current.textContent = P.ko;
      if (metaYRef.current) metaYRef.current.textContent = P.year;
      if (metaMRef.current) metaMRef.current.textContent = P.material;
      if (metaCRef.current) metaCRef.current.textContent = String(P.images.length).padStart(2, "0");
      if (metaDRef.current) metaDRef.current.textContent = P.description;
      strip.innerHTML = "";
      P.images.forEach((src, i) => {
        const sh = document.createElement("figure");
        sh.className = styles.sheet;
        sh.style.transitionDelay = (reduce ? 0 : 0.12 + i * 0.09) + "s";
        const im = new Image();
        im.src = src;
        im.alt = `${P.title} ${i + 1}`;
        sh.appendChild(im);
        const c = document.createElement("span");
        c.className = styles.cap;
        c.textContent = `${String(pullProj + 1).padStart(2, "0")}.${i + 1} / ${String(P.images.length).padStart(2, "0")}`;
        sh.appendChild(c);
        strip.appendChild(sh);
      });
      const end = document.createElement("div");
      end.className = styles.end;
      strip.appendChild(end);
      stripX = stripT = 0;
      strip.style.transform = `translate(0,${narrow ? 0 : -50}%)`;
      proj.classList.remove(styles.closing);
      proj.style.display = "block";
      void proj.offsetWidth;
      proj.classList.add(styles.open);
      hot(HOT_MS_OPEN);
      // URL push
      router.push(`/art/${P.slug}`, { scroll: false });
      if (openSettleTo) clearTimeout(openSettleTo);
      openSettleTo = setTimeout(
        () => {
          setState("open");
          const sw = strip.scrollWidth;
          const left = strip.getBoundingClientRect().left - stage.getBoundingClientRect().left;
          stripMin = Math.min(0, -(sw - (W - left - 24)));
        },
        reduce ? 30 : 720
      );
    }
    function closeProject() {
      if (state !== "open") return;
      setState("closing");
      proj.classList.remove(styles.open);
      proj.classList.add(styles.closing);
      hot(HOT_MS_CLOSE);
      // URL back
      router.push("/art", { scroll: false });
      if (closeTo) clearTimeout(closeTo);
      closeTo = setTimeout(
        () => {
          proj.style.display = "none";
          proj.classList.remove(styles.closing);
          stack.classList.remove(styles.dim);
          rp.forEach((pl) => {
            if (pl.p === pullProj) pl.gone = false;
          });
          sibs.forEach((pl) => (pl.pt = 1));
          blockAuto = true;
          lastInput = performance.now();
          setState("return");
        },
        reduce ? 30 : 430
      );
    }
    function onPlateClick(pl: RuntimePlate) {
      markInput();
      const k = pl.j - pos;
      if (state === "open" || state === "opening" || state === "closing" || state === "return") return;
      if (state === "pull") {
        pullT0 = Math.min(pullT0, performance.now() - PULL_MS * 0.5);
        return;
      }
      if (Math.abs(k) < 0.5) {
        target = pl.j;
        queue = 0;
        startPull(performance.now(), true);
      } else {
        target = pl.j;
        queue = 0;
      }
    }

    let rafId = 0;
    function frame(now: number) {
      if (queue !== 0 && now - lastStep >= STEP_MS && (state === "browse" || state === "cancel")) {
        const d = Math.sign(queue);
        const nt = target + d;
        if (nt >= 0 && nt < rp.length) {
          target = nt;
          tick();
        }
        queue -= d;
        lastStep = now;
      }
      vel += (target - pos) * SPRING_V;
      vel *= SPRING_DECAY;
      pos += vel;
      if (Math.abs(target - pos) < 0.002 && Math.abs(vel) < 0.002) {
        pos = target;
        vel = 0;
      }
      if (
        AUTO_PULL &&
        state === "browse" &&
        !reduce &&
        !blockAuto &&
        queue === 0 &&
        pos === target &&
        now - lastInput > SETTLE_MS
      )
        startPull(now, false);
      if (state === "pull") {
        let all = true;
        for (const pl of sibs) {
          if (pl.gone) continue;
          const t = Math.max(0, Math.min(1, (now - pullT0) / PULL_MS - (pl.s ?? 0) * (STAGGER_MS / 1000)));
          pl.pt = t;
          if (t >= 1) {
            pl.gone = true;
            pl.pt = 0;
            hot(HOT_MS_PULL);
          } else all = false;
        }
        if (all) {
          setState("through");
          setTimeout(openProject, 120);
        }
      }
      if (state === "cancel" || state === "return") {
        let done = true;
        for (const pl of sibs) {
          pl.pt += (0 - pl.pt) * (state === "cancel" ? 0.22 : 0.14);
          if (pl.pt < 0.006) pl.pt = 0;
          else done = false;
        }
        if (done) {
          sibs = [];
          setState("browse");
        }
      }
      if (state === "open") {
        stripX += (stripT - stripX) * 0.16;
        strip.style.transform = `translate(${stripX.toFixed(1)}px,${narrow ? 0 : -50}%)`;
      }
      render();
      rafId = requestAnimationFrame(frame);
    }

    function scrollInput(dy: number) {
      markInput();
      if (state === "open") {
        stripT = Math.max(stripMin, Math.min(0, stripT - dy * 1.2));
        return;
      }
      if (state === "opening" || state === "closing" || state === "through") return;
      if (state === "pull") {
        const mx = Math.max(...sibs.map((p) => p.pt));
        if (mx < CANCEL_T_LIMIT) cancelPull();
        else return;
      }
      acc += dy;
      while (Math.abs(acc) >= WHEEL_NOTCH) {
        queue += Math.sign(acc);
        acc -= Math.sign(acc) * WHEEL_NOTCH;
      }
      queue = Math.max(-10, Math.min(10, queue));
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      scrollInput(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY);
    };
    let py: number | null = null;
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      py = e.clientY;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (py === null) return;
      scrollInput((py - e.clientY) * 1.1);
      py = e.clientY;
    };
    const onPointerUp = () => {
      py = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeProject();
        return;
      }
      if (state === "open") {
        if (e.key === "ArrowRight") stripT = Math.max(stripMin, stripT - 200);
        if (e.key === "ArrowLeft") stripT = Math.min(0, stripT + 200);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        markInput();
        if (state === "pull") cancelPull();
        queue += 1;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        markInput();
        if (state === "pull") cancelPull();
        queue -= 1;
      }
      if (e.key === "Enter" && (state === "browse" || state === "cancel")) {
        markInput();
        startPull(performance.now(), true);
      }
    };

    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerup", onPointerUp);
    stage.addEventListener("pointercancel", onPointerUp);
    document.addEventListener("keydown", onKey);
    let resizeTo: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (resizeTo) clearTimeout(resizeTo);
      resizeTo = setTimeout(layout, 100);
    };
    window.addEventListener("resize", onResize);

    layout();
    setState("browse");
    lastInput = performance.now();

    // Direct-slug: skip animation, render project opened over last-plate-of-project
    if (initialProjIdx >= 0) {
      // Position dial at the first plate of the project so return is sensible
      const firstPlate = rp.find((pl) => pl.p === initialProjIdx && pl.i === 0);
      if (firstPlate) {
        pos = target = firstPlate.j;
      }
      pullProj = initialProjIdx;
      sibs = rp.filter((pl) => pl.p === initialProjIdx);
      sibs.forEach((pl) => (pl.gone = true));
      const P = projects[initialProjIdx];
      if (metaNRef.current) metaNRef.current.textContent = String(initialProjIdx + 1).padStart(2, "0");
      if (metaTRef.current) metaTRef.current.textContent = P.title;
      if (metaKRef.current) metaKRef.current.textContent = P.ko;
      if (metaYRef.current) metaYRef.current.textContent = P.year;
      if (metaMRef.current) metaMRef.current.textContent = P.material;
      if (metaCRef.current) metaCRef.current.textContent = String(P.images.length).padStart(2, "0");
      if (metaDRef.current) metaDRef.current.textContent = P.description;
      strip.innerHTML = "";
      P.images.forEach((src, i) => {
        const sh = document.createElement("figure");
        sh.className = styles.sheet;
        sh.style.transitionDelay = "0s";
        const im = new Image();
        im.src = src;
        im.alt = `${P.title} ${i + 1}`;
        sh.appendChild(im);
        const c = document.createElement("span");
        c.className = styles.cap;
        c.textContent = `${String(initialProjIdx + 1).padStart(2, "0")}.${i + 1} / ${String(P.images.length).padStart(2, "0")}`;
        sh.appendChild(c);
        strip.appendChild(sh);
      });
      const end = document.createElement("div");
      end.className = styles.end;
      strip.appendChild(end);
      proj.classList.remove(styles.closing);
      proj.classList.remove(styles.open);
      proj.classList.add(styles.instant);
      proj.style.display = "block";
      stack.classList.add(styles.dim);
      stripX = stripT = 0;
      strip.style.transform = `translate(0,${narrow ? 0 : -50}%)`;
      setState("open");
      const sw = strip.scrollWidth;
      const left = strip.getBoundingClientRect().left - stage.getBoundingClientRect().left;
      stripMin = Math.min(0, -(sw - (W - left - 24)));
    } else if (!reduce) {
      // intro: pos=12 → 0 rewind
      pos = target = 12;
      queue = -12;
    }

    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerup", onPointerUp);
      stage.removeEventListener("pointercancel", onPointerUp);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      if (hotTo) clearTimeout(hotTo);
      if (tickTo) clearTimeout(tickTo);
      if (openSettleTo) clearTimeout(openSettleTo);
      if (closeTo) clearTimeout(closeTo);
      if (resizeTo) clearTimeout(resizeTo);
      rp.forEach((pl) => {
        pl.el.remove();
        pl.tk.remove();
      });
    };
  }, [plates, projects, initialProjIdx, router]);

  return (
    <div ref={stageRef} className={styles.stage} id="art-stage">
      <header className={styles.header}>
        <span className={styles.w}>luckyzz</span>
        <nav>
          <a href="/art" className={styles.on}>art</a>
          <a href="/build">build</a>
          <a href="/coffee">coffee</a>
          <a href="/blog">blog</a>
          <a href="/about">about</a>
        </nav>
        <span>Fig. 2 — plates / 37.5665°N 126.9780°E</span>
      </header>

      <div className={styles.dial}>
        <div ref={rulerRef} className={styles.ruler} />
      </div>
      <div ref={indRef} className={styles.ind} />

      <div ref={stackRef} className={styles.stack} />
      <div ref={slitRef} className={styles.slit}>
        <span className={styles.lab}>SLIT</span>
      </div>

      <section ref={projRef} className={styles.proj} aria-live="polite">
        <div className={styles.edges} />
        <div className={styles.meta}>
          <div ref={metaNRef} className={styles.n}>01</div>
          <h2 ref={metaTRef} />
          <div ref={metaKRef} className={styles.ko} />
          <dl>
            <dt>YEAR</dt>
            <dd ref={metaYRef as React.RefObject<HTMLElement>} />
            <dt>MATERIAL</dt>
            <dd ref={metaMRef as React.RefObject<HTMLElement>} />
            <dt>PLATES</dt>
            <dd ref={metaCRef as React.RefObject<HTMLElement>} />
          </dl>
          <p ref={metaDRef} />
          <button
            type="button"
            className={styles.back}
            onClick={() => {
              const ev = new KeyboardEvent("keydown", { key: "Escape" });
              document.dispatchEvent(ev);
            }}
          >
            ← plates (esc)
          </button>
        </div>
        <div ref={stripRef} className={styles.strip} />
      </section>

      <div className={`${styles.hud} ${styles.bl}`}>
        PLATE <b ref={hudNRef}>01</b> / <b ref={hudTRef}>20</b>
        <br />
        PROJ <b ref={hudPRef}>01 — </b>
      </div>
      <div className={`${styles.hud} ${styles.br}`}>
        <span ref={hudSRef}>DIAL — scroll to advance · stop to open</span>
        <br />
        SLIT x=<b ref={hudXRef}>78%</b> · <b ref={hudMRef}>browse</b>
      </div>
    </div>
  );
}
