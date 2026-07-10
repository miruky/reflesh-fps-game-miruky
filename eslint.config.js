import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // dev専用のE2E/スクリプトハーネス(plain .mjs、Node+ブラウザ両globalsを使う)。
  // ゲームバンドルには含まれない。no-undefを実globalで満たす(TSではないため型では担保されない)。
  {
    files: ['e2e/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
);
