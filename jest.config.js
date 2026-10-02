/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: true }] },
  // react-native is not installed; the tests run against a small mock of the
  // pieces this package touches.
  moduleNameMapper: { '^react-native$': '<rootDir>/test/react-native-mock.ts' },
  clearMocks: true,
};
