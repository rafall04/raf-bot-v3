const fs = require('fs');
const path = require('path');

function readFile(...segments) {
  return fs.readFileSync(path.join(__dirname, ...segments), 'utf8');
}

describe('layanan navbar route hardening', () => {
  test('navbar uses role-aware ticket targets and removes legacy /tiket dependency', () => {
    const source = readFile('..', 'sb-admin', '_navbar.php');

    expect(source).toContain("$layananPages = $isAdminLikeRole");
    expect(source).toContain("['/admin/daftar-tiket', '/speed-requests', '/speed-boost-config', '/kompensasi', '/psb-rekap']");
    expect(source).toContain("($isTeknisiRole ? ['/teknisi-tiket'] : [])");
    expect(source).toContain("$ticketPagePath = $isAdminLikeRole ? '/admin/daftar-tiket' : ($isTeknisiRole ? '/teknisi-tiket' : null);");
    expect(source).toContain("$ticketPageLabel = $isAdminLikeRole ? 'Tiket Support Admin' : 'Tiket Teknisi';");
    expect(source).not.toContain("href=\"/tiket\"");
    expect(source).not.toContain("isActive('/tiket'");
    expect(source).not.toContain("['/tiket', '/speed-requests'");
  });

  test('page routes required by layanan navbar exist in pages router', () => {
    const routesSource = readFile('..', '..', 'routes', 'pages.js');

    expect(routesSource).toContain("router.get('/admin/daftar-tiket'");
    expect(routesSource).toContain("router.get('/teknisi-tiket'");
    expect(routesSource).toContain("router.get('/speed-requests'");
    expect(routesSource).toContain("router.get('/speed-boost-config'");
    expect(routesSource).toContain("router.get('/kompensasi'");
    expect(routesSource).toContain("router.get('/psb-rekap'");
  });
});
