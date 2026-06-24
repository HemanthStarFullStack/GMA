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
          {
            // Conservative CSP: tightens the safe directives (no framing, no
            // object/embed, locked base-uri & form-action) while staying
            // permissive on script/style — Next.js App Router injects inline
            // bootstrap scripts and we don't run nonce middleware. img-src allows
            // https for remote product packshots (Open Food Facts) + user uploads.
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "object-src 'none'",
              "frame-ancestors 'self'",
              "form-action 'self'",
              "img-src 'self' data: blob: https:",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "font-src 'self' data:",
              "connect-src 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
