import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Node 24 drops stdout from the detached TypeScript CLI subprocess used by
  // Next 16's default experimental path. TypeScript 5.8 exposes the compiler
  // API, so keep configuration parsing in-process until that runtime issue is
  // resolved upstream.
  experimental: {
    useTypeScriptCli: false,
  },
};

export default nextConfig;
