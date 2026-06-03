const fs = require('fs');
const path = require('path');

describe('mobile navbar drawer hardening', () => {
  test('navbar keeps compact mobile drawer affordances and leaf auto-close hooks', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'sb-admin', '_navbar.php'),
      'utf8'
    );

    expect(source).toContain('width: min(78vw, 15rem) !important;');
    expect(source).toContain('class="mobile-sidebar-head d-md-none"');
    expect(source).toContain('id="mobileSidebarClose"');
    expect(source).toContain('sidebar.querySelectorAll(\'.collapse-item[href], .nav-link[href]:not([data-toggle="collapse"])\')');
    expect(source).toContain('closeMobileDrawerAndCollapse');
    expect(source).toContain('Navigasi cepat admin');
  });
});
