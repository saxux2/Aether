/** Jest config for relayer unit tests (ts-jest, tests live in src/**\/*.test.ts). */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
};
