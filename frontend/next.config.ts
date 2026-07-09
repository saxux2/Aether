import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  webpack(config, { isServer }) {
    // snarkjs and circomlibjs use Node.js internals — exclude from server bundle
    // sodium-native is a native Node addon pulled in by @stellar/stellar-base;
    // the browser already uses tweetnacl so this package must never be bundled.
    const nativeExternals = ['snarkjs', 'circomlibjs', 'sodium-native', 'require-addon'];
    if (isServer) {
      config.externals = Array.isArray(config.externals)
        ? [...config.externals, ...nativeExternals]
        : [...nativeExternals];
    }

    // Enable WebAssembly (needed for circuit proof generation)
    config.experiments = { ...config.experiments, asyncWebAssembly: true };

    // Polyfill Buffer in browser (required by @stellar/stellar-sdk)
    // Mark native-only packages as false so webpack replaces them with empty modules.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      buffer: require.resolve('buffer/'),
      crypto: require.resolve('crypto-browserify'),
      stream: require.resolve('stream-browserify'),
      path: false,
      fs: false,
      'sodium-native': false,
      'require-addon': false,
    };

    return config;
  },

  // Allow serving large WASM/zkey files from public/circuits
  async headers() {
    // Deliberately NOT setting script-src/style-src/connect-src here. This
    // app's landing page pulls in Google Fonts, a TradingView embed widget
    // (which injects its own iframe/script from TradingView's CDN), and
    // live-price fetches to Coinbase/CoinGecko — and Next.js App Router
    // itself relies on inline <script> tags for hydration data, which a
    // strict script-src would need either 'unsafe-inline' (defeats most of
    // the point) or per-request nonces wired through middleware to allow.
    // Getting that fully correct needs to be verified against a running
    // build, not shipped blind, so it's left as a follow-up. What's below
    // is real protection with no such risk: frame-ancestors/X-Frame-Options
    // stop this wallet-connected, fund-moving app from ever being embedded
    // in a third-party page (clickjacking on Send/Cancel/Submit), and the
    // rest are standard zero-downside hardening.
    const securityHeaders = [
      { key: 'Content-Security-Policy', value: "object-src 'none'; base-uri 'self'; frame-ancestors 'none'" },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    ];

    return [
      { source: '/:path*', headers: securityHeaders },
      {
        source: '/circuits/:file*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ];
  },
};

export default nextConfig;
