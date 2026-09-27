import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native module used only on the server.
  serverExternalPackages: ["better-sqlite3"],
  poweredByHeader: false,
  devIndicators: false,
  // Do not generate AGENTS.md / CLAUDE.md into the repository.
  agentRules: false,
  experimental: {
    serverActions: { bodySizeLimit: "60mb" },
  },
};

export default nextConfig;
