/** Unit tests: engines (expressions, resolution, reminders) and pure helpers. */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  // testRegex et non testMatch : un glob sur un chemin contenant un dossier cache (.claude/worktrees)
  // ne trouve aucun test sous Windows.
  testRegex: 'src/.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json', isolatedModules: true }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Mesure honnete : tout src/ compte, meme les fichiers qu'aucun test n'importe.
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/main.ts', '!src/scripts/**'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov', 'json-summary', 'json'],
};
