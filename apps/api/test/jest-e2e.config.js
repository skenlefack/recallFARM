/** End-to-end tests (Supertest) against TEST_DATABASE_URL. */
module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  testRegex: 'test/.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json', isolatedModules: true }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 120000,
  // Couverture e2e (rapport separe de la couverture unitaire) : npm run test:e2e -- --coverage
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/main.ts', '!src/scripts/**'],
  coverageDirectory: 'coverage-e2e',
  coverageReporters: ['text-summary', 'lcov', 'json-summary', 'json'],
};
