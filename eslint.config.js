"use strict";

/**
 * Flat ESLint config (ESLint 9+).
 * Baseline lenient: fokus menangkap bug nyata (no-undef) dan kode mati (no-unused-vars=warn),
 * styling diserahkan ke Prettier.
 */
module.exports = [
    {
        ignores: [
            'node_modules/**',
            'database/**',
            'sessions/**',
            'uploads/**',
            'public/uploads/**',
            'static/vendor/**',
            'coverage/**',
            '.worktrees/**',
            '**/*.min.js'
        ]
    },
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                process: 'readonly',
                console: 'readonly',
                require: 'readonly',
                module: 'writable',
                __dirname: 'readonly',
                __filename: 'readonly',
                exports: 'writable',
                Buffer: 'readonly',
                global: 'writable',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                setImmediate: 'readonly',
                URL: 'readonly',
                fetch: 'readonly',
                describe: 'readonly',
                test: 'readonly',
                it: 'readonly',
                expect: 'readonly',
                beforeEach: 'readonly',
                afterEach: 'readonly',
                beforeAll: 'readonly',
                afterAll: 'readonly',
                jest: 'readonly'
            }
        },
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            'no-undef': 'error'
        }
    }
];
