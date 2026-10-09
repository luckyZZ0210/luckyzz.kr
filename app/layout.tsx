import type { Metadata } from "next";
import { ppLettraMono, aritaBuri, mulche } from "@/lib/fonts";
import Header from "@/components/Header";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://luckyzz.kr"),
  title: "luckyzz.kr",
  description: "서울, 37.5665° N / 126.9780° E",
  openGraph: {
    type: "website",
    url: "https://luckyzz.kr",
    siteName: "luckyzz.kr",
    title: "luckyzz.kr",
    description: "서울, 37.5665° N / 126.9780° E",
    images: [{ url: "/images/hero-fallback.png", width: 1440, height: 900 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "luckyzz.kr",
    description: "서울, 37.5665° N / 126.9780° E",
    images: ["/images/hero-fallback.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${ppLettraMono.variable} ${aritaBuri.variable} ${mulche.variable}`}>
      <body className="antialiased">
        <Header />
        <main className="pt-20">
          {children}
        </main>
      </body>
    </html>
  );
}
