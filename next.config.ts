import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  /* config options here */
  serverExternalPackages: ["@databricks/sql"],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
