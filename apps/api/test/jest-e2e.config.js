module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  testEnvironment: 'node',
  testTimeout: 30000,
  // The suites share one seeded Postgres database and clean up what they
  // create; running one file at a time keeps the seed data deterministic.
  maxWorkers: 1,
};
