module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/e2e/support/env.ts'],
  // Lets every ordinary collection free a finished test file (docs/CICD_GUIDE.md, "e2e testleri yerelde").
  globalSetup: '<rootDir>/e2e/support/global-setup.ts',
  testTimeout: 30000,
  // The suites share one seeded Postgres database and clean up what they
  // create; running one file at a time keeps the seed data deterministic.
  maxWorkers: 1,
};
