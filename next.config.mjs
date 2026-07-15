/** @type {import('next').NextConfig} */
const nextConfig = {
  // The generate route reads prompt/example .md files from disk at runtime;
  // make sure Vercel's serverless bundle includes them.
  outputFileTracingIncludes: {
    "/api/generate": ["./prompts/**/*", "./examples/**/*"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
