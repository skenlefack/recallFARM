/** Unit tests: engines (expressions, resolution, reminders) and pure helpers. */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json', isolatedModules: true }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
};
