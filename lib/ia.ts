// IA rev. 2026-10-11 — single source for IndexField (41a).
// Spec: handoff/41a-home-design/DESIGN_DIRECTION.md §2.

export type SubNode = {
  id: string;
  label: string;
  route: string;
  acc?: boolean; // accent-highlighted (e.g. AI)
};

export type MainNode = {
  id: string;
  n: string;          // "01".. "05"
  label: string;
  route: string;
  ang: number;        // degrees, orbit angle
  sub: SubNode[];
};

export const MAIN: MainNode[] = [
  { id: "art",    n: "01", label: "art",    route: "/art",    ang: -150, sub: [] },
  { id: "build",  n: "02", label: "build",  route: "/build",  ang: -38,  sub: [
    { id: "ai", label: "AI ●", route: "/build?tag=ai", acc: true },
  ] },
  { id: "coffee", n: "03", label: "coffee", route: "/coffee", ang: 28,   sub: [
    { id: "beans",   label: "beans",   route: "/coffee/beans"   },
    { id: "recipes", label: "recipes", route: "/coffee/recipes" },
    { id: "cafes",   label: "cafes",   route: "/coffee/cafes"   },
  ] },
  { id: "blog",   n: "04", label: "blog",   route: "/blog",   ang: 112,  sub: [
    { id: "thinking", label: "thinking", route: "/blog?category=thinking" },
    { id: "daily",    label: "daily",    route: "/blog?category=daily"    },
  ] },
  { id: "about",  n: "05", label: "about",  route: "/about",  ang: 178,  sub: [] },
];

// Representative images per node (temporary — graduation / exhibit shots).
export const IMG: Record<string, string> = {
  art: "/home/art.jpg",
  build: "/home/build.jpg",
  ai: "/home/ai.jpg",
  coffee: "/home/coffee.jpg",
  beans: "/home/beans.jpg",
  recipes: "/home/recipes.jpg",
  cafes: "/home/cafes.jpg",
  blog: "/home/blog.jpg",
  thinking: "/home/thinking.jpg",
  daily: "/home/daily.jpg",
  about: "/home/about.jpg",
};

// Edge connections (curved dashed). `label` renders mid-arc.
export type Link = { a: string; b: string; label?: string };
export const LINKS: Link[] = [
  { a: "art",    b: "build"           },
  { a: "build",  b: "blog"            },
  { a: "blog",   b: "coffee", label: "essays" },
  { a: "coffee", b: "build"           },
  { a: "about",  b: "art"             },
  { a: "about",  b: "blog"            },
];

// Flattened lookup for routes (any node id → path).
export const ROUTES: Record<string, string> = (() => {
  const r: Record<string, string> = {};
  MAIN.forEach((m) => {
    r[m.id] = m.route;
    m.sub.forEach((s) => (r[s.id] = s.route));
  });
  return r;
})();
