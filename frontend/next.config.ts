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
    return [
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
