// ── §10 네 상수 (open decisions, user tunes later) ─────────────────────────
export const AUTO_PULL = true;
export const SETTLE_MS = 650;
export const STEP_UNIT: "image" | "project" = "image";
export const SPREAD: "row" | "fan" = "row";
export const SLIT_X = 0.78;
export const PULL_MS = 1000;

// ── other spec numbers (§3–§8) — grep-visible, locked by review ─────────────
export const STEP_MS = 55;
export const WHEEL_NOTCH = 48;
export const TICK = 22;
export const SPRING_V = 0.22;
export const SPRING_DECAY = 0.62;
export const STAGGER_MS = 90;
export const HOT_MS_PULL = 170;
export const HOT_MS_OPEN = 520;
export const HOT_MS_CLOSE = 460;
export const OPEN_MS = 700;
export const CLOSE_MS = 420;
export const EDGES_HIDE_DELAY = 450;
export const SHEET_MS = 620;
export const SHEET_DELAY = 0.12;
export const SHEET_STAGGER = 0.09;
export const VISIBLE_DEPTH = 16;
export const CANCEL_T_LIMIT = 0.75;
export const FAST_OPEN_T = 0.42;

export interface ArtProject {
  slug: string;
  order: number;
  title: string;
  ko: string;
  year: string;
  material: string;
  description: string;
  images: string[];
}

export interface ArtPlate {
  j: number;
  p: number;
  i: number;
  src: string;
}

export function getArtPlates(projects: ArtProject[]): ArtPlate[] {
  const plates: ArtPlate[] = [];
  projects.forEach((p, pi) => {
    p.images.forEach((src, ii) => {
      plates.push({ j: plates.length, p: pi, i: ii, src });
    });
  });
  return plates;
}
