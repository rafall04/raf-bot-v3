/**
 * Helper argumen koneksi OLT untuk skrip discovery/test.
 * Ambil host/community/port dari argv lalu fallback env (OLT_HOST/OLT_COMMUNITY/OLT_PORT).
 * TIDAK menyimpan kredensial OLT di kode — wajib dilewatkan saat pakai.
 *
 * Usage di skrip: const { host, community, port } = require('./_olt-args')(argvOffset)
 *   argvOffset = index argv pertama untuk host (default 2).
 */
module.exports = function oltArgs(offset = 2) {
    const host = process.argv[offset] || process.env.OLT_HOST;
    const community = process.argv[offset + 1] || process.env.OLT_COMMUNITY || 'public';
    const port = parseInt(process.argv[offset + 2] || process.env.OLT_PORT, 10) || 161;
    if (!host) {
        console.error('Host OLT wajib. Contoh: node <skrip> <host> <community> <port>');
        console.error('  atau set env OLT_HOST / OLT_COMMUNITY / OLT_PORT');
        process.exit(1);
    }
    return { host, community, port };
};
