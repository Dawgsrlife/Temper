import { resolve } from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: resolve(import.meta.dirname),
  },
  // Load env from monorepo root
  env: {
    // Next.js will auto-load from .env.local in the frontend folder,
    // but we want to also support the root .env for shared config
  },
  experimental: {
    // Allow loading env from parent directories
  },
};

export default nextConfig;
