import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
        fetch: 'readonly',
        FormData: 'readonly',
        location: 'readonly',
        navigator: 'readonly',
        confirm: 'readonly',
        URLSearchParams: 'readonly',
      },
    },
  },
);
