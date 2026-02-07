import { resolve } from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/adapter-pg"],
  turbopack: {
    root: resolve(import.meta.dirname),
  },
};

export default nextConfig;
