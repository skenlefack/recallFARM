/** End-to-end tests (Supertest) against TEST_DATABASE_URL. */
module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json', isolatedModules: true }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 120000,
};
