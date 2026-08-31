module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest'],
  },
  // @stellar/stellar-sdk 17 pulls in a chain of ESM-only packages
  // (uint8array-extras, @exodus/bytes, …). Jest skips node_modules when
  // transforming, so each one reaches the CJS runtime as a raw `export`/
  // `import` statement and every suite that touches the SDK dies at import
  // with "Unexpected token 'export'" before running a single test.
  // Allow-listing them one by one just moves the error to the next package
  // down the chain, so transform node_modules too and let swc downlevel
  // whatever the SDK reaches. swc is fast and jest caches the output.
  transformIgnorePatterns: [],
};
