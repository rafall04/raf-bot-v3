const fs = require('fs');
const path = require('path');

function readView(filename) {
  return fs.readFileSync(path.join(__dirname, '..', 'sb-admin', filename), 'utf8');
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
