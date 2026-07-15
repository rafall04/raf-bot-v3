const fs = require('fs');
const path = require('path');

function readView(filename) {
  return fs.readFileSync(path.join(__dirname, '..', 'sb-admin', filename), 'utf8');
}

// Aset sidebar (CSS/JS) diekstrak dari navbar ke static/ — lihat boundary-log #b126.
function readStatic(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'static', ...segments), 'utf8');
}

describe('mobile navbar drawer hardening', () => {
  test('navbar keeps compact mobile drawer affordances and leaf auto-close hooks', () => {
    const source = readView('_navbar.php');

    // Markup + teks drawer mobile tetap dipegang navbar.
    expect(source).toContain('class="mobile-sidebar-head d-md-none"');
    expect(source).toContain('id="mobileSidebarClose"');
    expect(source).toContain('Navigasi cepat admin');

    // CSS/JS sidebar diekstrak ke static/ (boundary #b126) — navbar hanya menautkannya,
    // JANGAN di-inline lagi. Lebar drawer & hook auto-close kini diuji di berkas asetnya.
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
});
