import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@athena/db", "@athena/core", "@athena/llm", "@athena/crawler", "@athena/jobs", "@athena/ui", "@athena/emails"],
  serverExternalPackages: ["pg"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "connect-src 'self' https:",
              "report-uri /api/csp-report",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
