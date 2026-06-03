/**
 * Header Doc
 * Purpose: Source guardrail untuk parity halaman admin template pesan WhatsApp.
 * Caller: Jest test runner.
 * Deps: fs, path, views/sb-admin/templates.php.
 * MainFuncs: readTemplateView.
 * SideEffects: Membaca file view tanpa menjalankan PHP/JavaScript.
 */

const fs = require('fs');
const path = require('path');

function readTemplateView() {
  return fs.readFileSync(path.join(__dirname, '..', 'sb-admin', 'templates.php'), 'utf8');
}

describe('templates admin parity view', () => {
  test('menggunakan full editor endpoint dan menampilkan kategori menu/report', () => {
    const source = readTemplateView();

    expect(source).toContain("fetch('/api/templates'");
    expect(source).toContain('id="menu-tab"');
    expect(source).toContain('href="#menu"');
    expect(source).toContain('id="menuTemplates"');
    expect(source).toContain('id="report-tab"');
    expect(source).toContain('href="#report"');
    expect(source).toContain('id="reportTemplates"');
    expect(source).toContain('menu: 0');
    expect(source).toContain('report: 0');
  });

  test('save payload memetakan menu/report dan preserve metadata existing', () => {
    const source = readTemplateView();

    expect(source).toContain('function buildTemplatePayloadEntry(sourceEntry, headerText, templateText)');
    expect(source).toContain('...sourceEntry');
    expect(source).toContain("targetGroup = 'menuTemplates'");
    expect(source).toContain("targetGroup = 'reportTemplates'");
    expect(source).toContain('allTemplatesData[targetGroup] && allTemplatesData[targetGroup][key]');
    expect(source).not.toContain('These are not editable in the UI but should not be lost on save');
  });

  test('template card menampilkan placeholder hasil ekstraksi dari isi template', () => {
    const source = readTemplateView();

    expect(source).toContain('function extractTemplatePlaceholders(templateText)');
    expect(source).toContain('const placeholders = extractTemplatePlaceholders(templateValue)');
    expect(source).toContain('data-template-placeholders="${placeholderText}"');
    expect(source).toContain('Placeholder:');
    expect(source).toContain('${placeholder}');
  });
});
