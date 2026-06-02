import type { NextConfig } from "next";
import path from "node:path";

const ALLOWED_FRAME_ANCESTORS = [
  "'self'",
  "https://ttfscaffolding.com",
  "https://www.ttfscaffolding.com",
];

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${ALLOWED_FRAME_ANCESTORS.join(" ")};`,
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
