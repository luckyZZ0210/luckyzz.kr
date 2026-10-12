"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { homeTokenStyle } from "@/components/home/tokens";
import { MAIN } from "@/lib/ia";

export default function Header() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const isArt = pathname === "/art" || pathname.startsWith("/art/");

  // Dark variant: home (Fig. 1) and /art plates (Fig. 2, ART_DIRECTION §3).
  if (isHome || isArt) {
    // Inline styles on purpose: globals.css has unlayered `* { padding: 0 }`
    // and `a { color; border-bottom }` that override Tailwind utilities.
    return (
      <header
        className="hdr-home fixed top-0 left-0 right-0 z-50 flex items-baseline justify-between"
        style={{
          ...homeTokenStyle,
          gap: 12,
          padding: "14px 20px",
          fontSize: 11,
          background: "var(--void)",
          color: "var(--ink)",
          borderBottom: "1px solid var(--ink)",
          fontFamily: "var(--font-pp-lettra-mono)",
        }}
      >
        <style>{`.hdr-home a:hover{opacity:1}`}</style>
        <Link
          href="/"
          style={{
            color: "var(--ink)",
            borderBottom: "none",
            fontFamily: "var(--font-mulche)",
            fontSize: 22,
            lineHeight: 1,
            letterSpacing: "0.01em",
          }}
        >
          luckyzz
        </Link>
        <span>{isHome ? "Fig. 1 — index" : "Fig. 2 — plates"}</span>
        <span>37.39°N 127.11°E</span>
      </header>
    );
  }

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-sm border-b border-gray-200">
      <div className="max-w-5xl mx-auto px-6 py-5">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-sm tracking-tight border-0 hover:opacity-50 transition-opacity">
            luckyzz.kr
          </Link>
          <div className="flex gap-8 text-sm">
            {MAIN.map((m) => (
              <Link key={m.id} href={m.route} className="border-0 hover:opacity-50 transition-opacity">
                {m.label.charAt(0).toUpperCase() + m.label.slice(1)}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}
