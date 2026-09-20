/*
 * Purpose: Konfigurasi Jest untuk regresi otomatis aplikasi RAF Bot.
 * Caller: `npm test` dan eksekusi Jest lokal/CI.
 * Deps: Jest runtime, struktur test `__tests__`, dan file `.test.js`.
 * MainFuncs: Menentukan environment, pola test, timeout, coverage source, dan direktori yang diabaikan.
 * SideEffects: Membatasi discovery test agar artefak/cache/tmp eksternal tidak ikut menjalankan suite aplikasi.
 */
// Produksi memaksa TZ=Asia/Jakarta di index.js — Jest harus menyamakannya supaya suite
// date/time-sensitive (jam-diam teknisi, batas siklus paket, frasa "hari ini pukul 08:00")
// tidak merah di mesin UTC/CI non-WIB padahal logikanya benar di produksi. Di-set sebelum
// worker spawn → berlaku untuk runInBand maupun mode paralel.
process.env.TZ = 'Asia/Jakarta';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js', '**/*.test.js'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/venv/',
    '/\\.venv/',
    '/env/',
    '/vendor/',
    '/target/',
    '/\\.gradle/',
    '/bin/',
    '/obj/',
    '/pkg/',
    '/\\.git/',
    '/\\.vscode/',
    '/\\.idea/',
    '/pycache/',
    '/dist/',
    '/build/',
    '/tmp/',
    '/coverage/',
    '/\\.next/',
    '/\\.nuxt/',
    '/\\.cache/',
    // Worktree agen (`.worktrees/<branch>`) berisi SALINAN repo. Tanpa baris ini jest
    // menjalankan suite USANG dari sana seolah milik repo utama — terbukti menambah
    // 4 suite/53 test hantu sampai worktree-nya dibersihkan.
    '/\\.worktrees/'
  ],
  verbose: true,
  testTimeout: 30000, // 30 seconds for property tests
  collectCoverageFrom: [
    'lib/**/*.js',
    '!lib/**/*.test.js'
  ]
};
