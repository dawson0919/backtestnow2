import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'img.clerk.com' },
    ],
  },
  // yahoo-finance2 uses node.js crypto — mark as server-only
  serverExternalPackages: ['yahoo-finance2'],
}

export default nextConfig
