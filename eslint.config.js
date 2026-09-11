// Flat ESLint config (ESLint 9+). Lints game.js only — the file that
// actually ships game logic; styles.css/index.html are plain markup with
// nothing for a JS linter to check.
module.exports = [
  {
    files: ['game.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        AudioContext: 'readonly',
        webkitAudioContext: 'readonly',
        PointerEvent: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-var': 'error',
      eqeqeq: ['warn', 'smart'],
    },
  },
];
