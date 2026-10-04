/** Pure logic only (api client, location queue, navigation); screens are exercised on devices and in Expo Go. */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.jest.json' }],
  },
  testEnvironment: 'node',
};
