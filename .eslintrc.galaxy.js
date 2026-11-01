/**
 * ESLint flat configuration for Galaxy JavaScript.
 *
 * Architecture rules:
 * 1. No direct fetch/XMLHttpRequest in domain layer
 * 2. Validate api-client usage (HTTP must go through api-client)
 * 3. No SQL queries in presentation layer (frontend has no DB)
 * 4. Service layer must use ApiClient through dependency injection
 */

const noUnsanitized = require('eslint-plugin-no-unsanitized');

module.exports = [
    {
        ignores: ['js/engine/runtime/domains/_templates/TEMPLATE.js'],
    },
    {
        files: ['js/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
        },
        plugins: {
            'no-unsanitized': noUnsanitized,
        },
        rules: {
            'no-unsanitized/method': 'error',
            'no-unsanitized/property': 'error',
        },
    },
    {
        files: ['js/features/galaxy/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
        },
        rules: {
            'no-restricted-globals': [
                'error',
                {
                    name: 'fetch',
                    message: 'Use ApiClient instead of fetch(). Domain layer must be HTTP-agnostic.',
                },
            ],
            'no-restricted-syntax': [
                'error',
                {
                    selector: 'NewExpression[callee.name="XMLHttpRequest"]',
                    message: 'Use ApiClient instead of XMLHttpRequest(). Domain layer must be HTTP-agnostic.',
                },
            ],
            'no-eval': 'error',
            'no-new-func': 'error',
            'handle-callback-err': 'warn',
            'no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                },
            ],
        },
    },
];
