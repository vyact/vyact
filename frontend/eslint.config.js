import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslintPlugin from '@typescript-eslint/eslint-plugin'
import tseslintParser from '@typescript-eslint/parser'
import { defineConfig, globalIgnores } from 'eslint/config'

const asWarnings = (rules) => Object.fromEntries(
  Object.entries(rules).map(([ruleName, ruleConfig]) => [
    ruleName,
    Array.isArray(ruleConfig) ? ['warn', ...ruleConfig.slice(1)] : 'warn',
  ]),
)

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parser: tseslintParser,
    },
    plugins: {
      '@typescript-eslint': tseslintPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // Existing code is adopted gradually; warnings still appear locally and in CI logs.
      ...asWarnings(js.configs.recommended.rules),
      ...asWarnings(tseslintPlugin.configs.recommended.rules),
      ...asWarnings(reactHooks.configs.recommended.rules),
      ...asWarnings(reactRefresh.configs.vite.rules),
      // The TypeScript-aware rule handles type-only parameters correctly.
      'no-unused-vars': 'off',
      // TypeScript's build step resolves globals and type declarations more accurately.
      'no-undef': 'off',
    },
  },
])
