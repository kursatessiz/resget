/** Route handlers and other server-side logic of the web app; pages are exercised by the Playwright suite (e2e/). */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testEnvironment: 'node',
};
