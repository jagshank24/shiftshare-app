import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@react-pdf/renderer"],

  // The hosted preview serves the dev server through a proxied origin,
  // so allow it to request dev assets (HMR, /_next/*).
  allowedDevOrigins: ["*.e2b.app", "localhost", "127.0.0.1"],
};

export default nextConfig;
