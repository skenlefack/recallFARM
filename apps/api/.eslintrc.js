module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { project: false, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, jest: true },
  ignorePatterns: ['dist/', 'node_modules/', '*.js'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    '@typescript-eslint/no-non-null-assertion': 'off',
    'no-constant-condition': ['error', { checkLoops: false }],
  },
};
