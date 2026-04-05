import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  distDir: "dist",
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
