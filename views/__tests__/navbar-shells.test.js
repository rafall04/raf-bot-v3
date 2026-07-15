const fs = require('fs');
const path = require('path');

function readView(filename) {
  return fs.readFileSync(path.join(__dirname, '..', 'sb-admin', filename), 'utf8');
}

// Aset sidebar (CSS/JS) diekstrak dari navbar ke static/ — lihat boundary-log #b126.
function readStatic(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'static', ...segments), 'utf8');
}

describe('admin and teknisi shell hardening', () => {
  test('teknisi navbar uses safe landing route and compact mobile drawer hooks', () => {
    const source = readView('_navbar_teknisi.php');

    // Navbar tetap memegang: rute pendaratan aman + markup drawer mobile.
    expect(source).toContain('href="/teknisi-pelanggan"');
    expect(source).not.toContain('href="/"');
    expect(source).toContain('class="mobile-sidebar-head d-md-none"');
    expect(source).toContain('id="mobileSidebarClose"');
    expect(source).toContain('Navigasi cepat teknisi');

    // CSS/JS sidebar diekstrak ke static/ (boundary #b126) — navbar hanya menautkannya,
    // JANGAN di-inline lagi. Hook drawer kompakt kini diuji di berkas asetnya.
    expect(source).toContain("rafAssetUrl('/css/sidebar.css')");
    expect(source).toContain("rafAssetUrl('/js/sidebar.js')");

    const sidebarCss = readStatic('css', 'sidebar.css');
    expect(sidebarCss).toContain('width: min(78vw, 15rem) !important;');
    expect(sidebarCss).toContain('.mobile-sidebar-head {');

    const sidebarJs = readStatic('js', 'sidebar.js');
    expect(sidebarJs).toContain('sidebar.querySelectorAll(\'.collapse-item[href], .nav-link[href]:not([data-toggle="collapse"])\')');
    expect(sidebarJs).toContain('closeMobileDrawerAndCollapse');
    expect(sidebarJs).toContain("getElementById('mobileSidebarClose')");
  });

  test('role-aware helper routes admin-like users to admin shell and technicians to teknisi shell', () => {
    const navbarHelper = readView('_role_aware_navbar.php');
    const topbarHelper = readView('_role_aware_teknisi_topbar.php');
    const roleHelper = readView('_role_shell.php');

    expect(roleHelper).toContain("function resolveShellRoleContext()");
    expect(roleHelper).toContain("'isAdminLike' => in_array($role, ['admin', 'owner', 'superadmin'], true)");
    expect(roleHelper).toContain("'isTeknisi' => $role === 'teknisi'");

    expect(navbarHelper).toContain("include __DIR__ . '/_navbar.php';");
    expect(navbarHelper).toContain("include __DIR__ . '/_navbar_teknisi.php';");
    expect(topbarHelper).toContain("include __DIR__ . '/topbar.php';");
    expect(topbarHelper).toContain("id=\"loggedInTechnicianInfo\"");
  });

  test('teknisi pages use role-aware shell includes instead of hardcoded teknisi shell', () => {
    const teknisiPages = [
      'teknisi-kasbon.php',
      'teknisi-map-viewer.php',
      'teknisi-olt.php',
      'teknisi-pelanggan.php',
      'teknisi-pembayaran.php',
      'teknisi-psb-installation.php',
      'teknisi-psb-setup.php',
      'teknisi-psb.php',
      'teknisi-request-paket.php',
      'teknisi-tiket.php',
    ];

    teknisiPages.forEach((file) => {
      const source = readView(file);
      expect(source).toContain("include '_role_aware_navbar.php';");
      expect(source).toContain("include '_role_aware_teknisi_topbar.php';");
      expect(source).not.toContain("include '_navbar_teknisi.php';");
    });
  });
});
