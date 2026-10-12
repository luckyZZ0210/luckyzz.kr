import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/works", destination: "/art", permanent: false },
      { source: "/works/:slug", destination: "/art", permanent: false },
      { source: "/work", destination: "/build", permanent: false },
      { source: "/thinking", destination: "/blog?category=thinking", permanent: false },
      { source: "/info", destination: "/about", permanent: false },
      { source: "/experiments", destination: "/blog?category=thinking", permanent: false },
    ];
  },
};

export default nextConfig;
