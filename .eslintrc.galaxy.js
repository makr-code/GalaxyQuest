/**
 * .eslintrc.galaxy.js – ESLint configuration for Galaxy feature module.
 *
 * Architecture rules:
 * 1. No direct fetch/XMLHttpRequest in domain layer
 * 2. Validate api-client usage (HTTP must go through api-client)
 * 3. No SQL queries in presentation layer (frontend has no DB)
 * 4. Service layer must use ApiClient through dependency injection
 */

module.exports = {
    rules: {
        /**
         * No direct fetch() calls in domain/service/controller layers.
         * All HTTP must go through ApiClient.
         */
        'no-restricted-globals': [
            'error',
            {
                name: 'fetch',
                message: 'Use ApiClient instead of fetch(). Domain layer must be HTTP-agnostic.',
            },
        ],

        /**
         * No direct XMLHttpRequest usage.
         * Must use ApiClient for all HTTP calls.
         */
        'no-restricted-syntax': [
            'error',
            {
                selector: 'NewExpression[callee.name="XMLHttpRequest"]',
                message: 'Use ApiClient instead of XMLHttpRequest(). Domain layer must be HTTP-agnostic.',
            },
        ],

        /**
         * No eval() or Function() constructor (security, maintainability).
         */
        'no-eval': 'error',
        'no-new-func': 'error',

        /**
         * Enforce consistent error handling in async/await.
         */
        'handle-callback-err': 'warn',
        'no-unused-vars': [
            'error',
            {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
            },
        ],
    },

    /**
     * Environment-specific configurations.
     */
    env: {
        browser: true,
        es2021: true,
        node: true,
    },

    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
    },
};
