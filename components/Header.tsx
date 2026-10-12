"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Header() {
  const pathname = usePathname();
  const isHome = pathname === "/";

  if (isHome) {
    return (
      <header
        className="fixed top-0 left-0 right-0 z-50 flex items-baseline justify-between gap-3 px-5 py-[14px] text-[11px]"
        style={{
          background: "#0A0B0C",
          color: "#E9E9E3",
          borderBottom: "1px solid #E9E9E3",
          fontFamily: "var(--font-pp-lettra-mono)",
        }}
      >
        <Link
          href="/"
          className="border-0"
          style={{
            fontFamily: "var(--font-mulche)",
            fontSize: "22px",
            lineHeight: 1,
            letterSpacing: "0.01em",
          }}
        >
          luckyzz
        </Link>
        <span>Fig. 1 — index</span>
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
            <Link href="/thinking" className="border-0 hover:opacity-50 transition-opacity">Thinking</Link>
            <Link href="/work" className="border-0 hover:opacity-50 transition-opacity">Work</Link>
            <Link href="/experiments" className="border-0 hover:opacity-50 transition-opacity">Experiments</Link>
            <Link href="/info" className="border-0 hover:opacity-50 transition-opacity">Info</Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
