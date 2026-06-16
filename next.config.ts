import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle for a small production Docker image.
  output: "standalone",
  // Don't advertise the framework.
  poweredByHeader: false,
  reactStrictMode: true,
  // Keep native/Node-only DB packages out of the bundler (avoids standalone
  // tracing issues with mongoose/mongodb driver internals).
  serverExternalPackages: ["mongoose", "mongodb", "@auth/mongodb-adapter"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
