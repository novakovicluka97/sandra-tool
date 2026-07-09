/** @type {import('next').NextConfig} */
const nextConfig = {
  // The generate route reads prompt/example .md files from disk at runtime;
  // make sure Vercel's serverless bundle includes them.
  outputFileTracingIncludes: {
    "/api/generate": ["./prompts/**/*", "./examples/**/*"],
  },
};

export default nextConfig;
