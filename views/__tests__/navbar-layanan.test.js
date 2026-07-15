const fs = require('fs');
const path = require('path');

function readFile(...segments) {
  return fs.readFileSync(path.join(__dirname, ...segments), 'utf8');
}

describe('layanan navbar route hardening', () => {
  test('navbar renders layanan menu with admin ticket target and no legacy /tiket dependency', () => {
    const source = readFile('..', 'sb-admin', '_navbar.php');

    // _navbar.php = sidebar ADMIN. php-express merender PHP via CLI tanpa $_COOKIE, jadi konteks
    // admin dipaksa di file ini (lihat catatan di _navbar.php); menu Layanan dari daftar eksplisit.
    expect(source).toContain("$layananPages = ['/admin/daftar-tiket', '/speed-requests', '/speed-boost-config', '/kompensasi', '/papan-psb', '/laporan-marketing-psb']");
    expect(source).toContain("$ticketPagePath = '/admin/daftar-tiket';");
    expect(source).toContain("$ticketPageLabel = 'Tiket Support Admin';");

    // Guard: tak boleh balik ke rute /tiket legacy.
    expect(source).not.toContain('href="/tiket"');
    expect(source).not.toContain("isActive('/tiket'");
    expect(source).not.toContain("['/tiket', '/speed-requests'");
  });

  test('page routes required by layanan navbar exist in pages router', () => {
    const routesSource = readFile('..', '..', 'routes', 'pages.js');

    // Setiap item menu Layanan wajib punya rute terdaftar (anti tautan mati).
    expect(routesSource).toContain("router.get('/admin/daftar-tiket'");
    expect(routesSource).toContain("router.get('/speed-requests'");
    expect(routesSource).toContain("router.get('/speed-boost-config'");
    expect(routesSource).toContain("router.get('/kompensasi'");
    expect(routesSource).toContain("router.get('/papan-psb'");
    expect(routesSource).toContain("router.get('/laporan-marketing-psb'");
  });
});
