const createSharedConfig = require('@marinade.finance/eslint-config')

const sharedConfig = createSharedConfig({})

module.exports = [
  ...sharedConfig,
  {
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.spec.ts', '**/__tests__/**/*.ts', '**/test-utils/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/require-await': 'off',
      'import/no-extraneous-dependencies': ['error', { devDependencies: true }],
      'no-await-in-loop': 'off',
    },
  },
]
