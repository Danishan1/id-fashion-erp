import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js blocks cross-origin requests to dev-server assets (/_next/*) by
  // default as a DNS-rebinding protection — without this, loading the app
  // from another device's browser via the LAN IP gets a 403 on every chunk.
  allowedDevOrigins: ["192.168.29.215"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
