const fs = require('fs');
const path = require('path');

/**
 * Membaca markup halaman DAN aset JS/CSS eksternalnya sebagai satu teks.
 * Perilaku yang diperiksa test ini dulu hidup di blok <script>/<style> inline
 * dalam .php; sejak dieksternalkan ke static/js|css (CLAUDE.md: aset halaman
 * disimpan eksternal), isinya tidak lagi ada di .php. Maksud test tidak berubah —
 * yang dicek tetap "perilaku ini masih ada", hanya sumbernya kini dua berkas.
 */
function readView(filename) {
  const base = filename.replace(/\.php$/, '');
  const parts = [fs.readFileSync(path.join(__dirname, '..', 'sb-admin', filename), 'utf8')];
  for (const [dir, ext] of [['js', '.js'], ['css', '.css']]) {
    const asset = path.join(__dirname, '..', '..', 'static', dir, base + ext);
    if (fs.existsSync(asset)) parts.push(fs.readFileSync(asset, 'utf8'));
  }
  return parts.join('\n');
}

describe('isolir admin pages approval fixes', () => {
  test('custom isolir keeps global selection helpers and sticky policy guards', () => {
    const source = readView('custom-isolir.php');

    expect(source).toContain('Pilih Halaman Ini');
    expect(source).toContain('selectedItems:new Map()');
    expect(source).toContain('function getSelectedRecords()');
    expect(source).toContain('function getVisibleSelectedCount()');
    expect(source).toContain('function getGlobalSelectedCount()');
    expect(source).toContain('hasInitializedPolicyDefaults:false');
    expect(source).toContain('userTouchedTargetProfile:false');
    expect(source).toContain('userTouchedDisconnect:false');
    expect(source).toContain('userTouchedReboot:false');
    expect(source).toContain('selection tidak tampil pada halaman ini');
    expect(source).toContain('/css/isolir-workspace.css');
    expect(source).toContain('class="isolir-header"');
  });

  test('buka isolir uses global selection summary and honest page-only copy', () => {
    const source = readView('buka-isolir.php');

    expect(source).toContain('Pilih Halaman Ini');
    expect(source).toContain('selectedItems:new Map()');
    expect(source).toContain('function getSelectedRecords()');
    expect(source).toContain('function getVisibleSelectedCount()');
    expect(source).toContain('function getGlobalSelectedCount()');
    expect(source).toContain('pelanggan dipilih global');
    expect(source).toContain('selection tidak tampil pada halaman ini');
    expect(source).toContain("onlyIsolated:'true'");
    expect(source).toContain('/css/isolir-workspace.css');
    expect(source).toContain('class="isolir-header"');
  });
});
