import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  distDir: ".next",
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
