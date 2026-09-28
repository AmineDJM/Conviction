import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native module and bundled ffmpeg binary, used only on the server (never bundled).
  serverExternalPackages: ["better-sqlite3", "ffmpeg-static"],
  poweredByHeader: false,
  devIndicators: false,
  // Do not generate AGENTS.md / CLAUDE.md into the repository.
  agentRules: false,
  experimental: {
    serverActions: { bodySizeLimit: "60mb" },
  },
};

export default nextConfig;
