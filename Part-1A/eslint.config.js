const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', 'dist/**', 'build/**', 'coverage/**']
  },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: globals.node
    },
    rules: {
      'no-restricted-globals': ['error', 'event', 'name'],
      'no-warning-comments': ['error', { terms: ['todo', 'fixme'], location: 'start' }],
      'object-shorthand': ['error', 'always'],
      'prefer-const': 'error'
    }
  }
];
