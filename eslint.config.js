import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'node_modules']),

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Express 5 forwards rejected promises from handlers to the error handler.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      // Logs go through the structured logger, never straight to stdout.
      'no-console': 'error',

      // Architecture boundaries: modules → shared → lib/config. A module talks to
      // another only through what the container passes in, never by deep import.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*/*.repository.js', '../*/*.service.js'],
              // Types are fine: they describe a contract and vanish at runtime.
              allowTypeImports: true,
              message:
                'Modules must not reach into each other at runtime. Get the dependency from the container.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/shared/**', 'src/lib/**', 'src/config/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/modules/**'],
              message: 'Shared code must not depend on feature modules.',
            },
          ],
        },
      ],
    },
  },
  {
    // Ambient declarations augment existing interfaces, which requires `interface`.
    files: ['**/*.d.ts'],
    rules: { '@typescript-eslint/consistent-type-definitions': 'off' },
  },
  {
    // supertest's `res.body` is `any`: asserting on it is the point of the tests.
    files: ['src/**/*.test.ts', 'src/test/**'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // The env loader runs before the logger exists, and CLI scripts print to the terminal.
    files: ['src/config/env.ts', 'src/scripts/**'],
    rules: { 'no-console': 'off' },
  },
  { files: ['eslint.config.js'], extends: [tseslint.configs.disableTypeChecked] },
  prettier,
]);
