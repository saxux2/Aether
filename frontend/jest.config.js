/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest', {
      jsc: { transform: { react: { runtime: 'automatic' } } },
    }],
  },
  // Same ESM chain the relayer's jest.config.js hit: @stellar/stellar-sdk 17
  // reaches ESM-only packages (uint8array-extras, @exodus/bytes, ...), and
  // jest skips node_modules when transforming, so they arrive at the CJS
  // runtime as raw `export`/`import` and every suite importing the SDK dies
  // before its first assertion. Allow-listing them one at a time just moves
  // the error to the next package down, so transform node_modules too and
  // let swc downlevel whatever the SDK pulls in.
  transformIgnorePatterns: [],
};

module.exports = config;
