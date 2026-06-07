"use strict";

/**
 * Flat ESLint config (ESLint 9+).
 * Baseline lenient: fokus menangkap bug nyata (no-undef) dan kode mati (no-unused-vars=warn);
 * styling diserahkan ke Prettier.
 *
 * Catatan: aplikasi memakai sejumlah runtime global (`global.*` dari index.js) sebagai kontrak
 * legacy. Global tersebut dideklarasikan di bawah agar `no-undef` tetap BERMAKNA — yaitu hanya
 * menyala untuk simbol yang benar-benar tak terdefinisi (mis. fungsi lupa di-`require`), bukan
 * untuk akses global yang memang disengaja. (Utang teknis ini sedang dikurangi bertahap.)
 */

const nodeGlobals = {
    process: 'readonly', console: 'readonly', require: 'readonly', module: 'writable',
    __dirname: 'readonly', __filename: 'readonly', exports: 'writable', Buffer: 'readonly',
    global: 'writable',
    setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly',
    clearInterval: 'readonly', setImmediate: 'readonly', clearImmediate: 'readonly',
    queueMicrotask: 'readonly', performance: 'readonly',
    // Global Node 18+ (web-compat) yang dipakai di backend
    URL: 'readonly', URLSearchParams: 'readonly', fetch: 'readonly',
    FormData: 'readonly', Blob: 'readonly', Headers: 'readonly', Response: 'readonly',
    Request: 'readonly', AbortController: 'readonly', AbortSignal: 'readonly',
    TextEncoder: 'readonly', TextDecoder: 'readonly', structuredClone: 'readonly',
    atob: 'readonly', btoa: 'readonly'
};

// Runtime `global.*` yang diinisialisasi di index.js (kontrak legacy; lihat audit best-practice).
const appRuntimeGlobals = {
    conn: 'writable', raf: 'writable', db: 'writable', io: 'writable', config: 'writable',
    whatsappConnectionState: 'writable', users: 'writable', packages: 'writable',
    reports: 'writable', compensations: 'writable', speed_requests: 'writable',
    packageChangeRequests: 'writable', accounts: 'writable', payment: 'writable',
    paymentMethod: 'writable', statik: 'writable', voucher: 'writable', atm: 'writable',
    networkAssets: 'writable', cronConfig: 'writable', monitoring: 'writable',
    monitoringConfig: 'writable', alertSystem: 'writable', errorRecovery: 'writable',
    delay: 'writable'
};

const jestGlobals = {
    describe: 'readonly', test: 'readonly', it: 'readonly', expect: 'readonly',
    beforeEach: 'readonly', afterEach: 'readonly', beforeAll: 'readonly',
    afterAll: 'readonly', jest: 'readonly'
};

// Global browser + vendor lib yang dimuat di halaman SB-Admin (front-end klasik).
const browserGlobals = {
    window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'writable',
    history: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly',
    alert: 'readonly', confirm: 'readonly', prompt: 'readonly',
    XMLHttpRequest: 'readonly', WebSocket: 'readonly', FileReader: 'readonly',
    Image: 'readonly', Event: 'readonly', CustomEvent: 'readonly', FileList: 'readonly',
    getComputedStyle: 'readonly', requestAnimationFrame: 'readonly',
    MutationObserver: 'readonly', IntersectionObserver: 'readonly', ResizeObserver: 'readonly',
    DOMParser: 'readonly', HTMLElement: 'readonly', Node: 'readonly',
    $: 'readonly', jQuery: 'readonly', Chart: 'readonly', bootstrap: 'readonly',
    io: 'readonly', Swal: 'readonly', feather: 'readonly', moment: 'readonly',
    L: 'readonly', google: 'readonly', grecaptcha: 'readonly',
    toastr: 'readonly', Notification: 'readonly'
};

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
            'tmp/**',
            '.worktrees/**',
            '**/*.min.js'
        ]
    },
    {
        // Backend Node (CommonJS) + test runner
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: { ...nodeGlobals, ...appRuntimeGlobals, ...jestGlobals }
        },
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            'no-undef': 'error'
        }
    },
    {
        // Aset front-end (classic browser scripts) — sediakan global browser + vendor.
        files: ['static/**/*.js'],
        languageOptions: {
            globals: { ...browserGlobals }
        }
    }
];
