#!/usr/bin/env node

/**
 * Fix HTML Structure Script
 * Updates page headers and card structures to match modern design
 */

const fs = require('fs');
const path = require('path');

// Target files that need HTML structure fixes
const targetFiles = [
    'views/sb-admin/cron.php',
    'views/sb-admin/teknisi-working-hours.php',
    'views/sb-admin/config.php',
    'views/sb-admin/packages.php',
    'views/sb-admin/templates.php',
    'views/sb-admin/wifi-logs.php',
    'views/sb-admin/wifi-templates.php',
    'views/sb-admin/announcements.php',
    'views/sb-admin/news.php',
    'views/sb-admin/transaction.php',
    'views/sb-admin/broadcast.php',
    'views/sb-admin/parameter-management.php',
    'views/sb-admin/payment-method.php',
    'views/sb-admin/speed-boost-config.php',
    'views/sb-admin/invoice-settings.php',
    'views/sb-admin/map-viewer.php',
    'views/sb-admin/network-assets.php',
    'views/sb-admin/statik.php',
    'views/sb-admin/atm.php',
    'views/sb-admin/migrate.php',
    'views/sb-admin/blank.php'
];

function fixPageHeader(content) {
    // Pattern 1: <h1 class="h3 ... ">Title</h1>
    content = content.replace(
        /<h1 class="h3[^"]*"[^>]*>([^<]+)<\/h1>/g,
        (match, title) => {
            return `<!-- Page Header -->
          <div class="dashboard-header">
            <h1>${title.trim()}</h1>
            <p>Kelola dan monitor ${title.trim().toLowerCase()}</p>
          </div>`;
        }
    );

    // Pattern 2: <h1 class="h3 ... ">Title</h1>\n<p class="mb-4">Description</p>
    content = content.replace(
        /<h1 class="h3[^"]*"[^>]*>([^<]+)<\/h1>\s*<p class="mb-4">([^<]+)<\/p>/g,
        (match, title, description) => {
            return `<!-- Page Header -->
          <div class="dashboard-header">
            <h1>${title.trim()}</h1>
            <p>${description.trim()}</p>
          </div>`;
        }
    );

    return content;
}

function fixTableCards(content) {
    // Pattern: <div class="card shadow mb-4">
    content = content.replace(
        /<div class="card shadow mb-4">\s*<div class="card-header py-3">\s*<h6 class="m-0 font-weight-bold text-primary">([^<]+)<\/h6>/g,
        (match, title) => {
            return `<!-- Table Section -->
          <h4 class="dashboard-section-title">${title.trim()}</h4>
          <div class="card table-card mb-4">
            <div class="card-header">
              <h6>${title.trim()}</h6>`;
        }
    );

    return content;
}

function fixStatCards(content) {
    // Convert old stat cards to new dashboard-card format
    // This is more complex, so we'll do simpler regex replacements
    
    // border-left-primary -> dashboard-card card-primary
    content = content.replace(/card border-left-primary shadow h-100 py-2/g, 'card dashboard-card card-primary');
    content = content.replace(/card border-left-success shadow h-100 py-2/g, 'card dashboard-card card-success');
    content = content.replace(/card border-left-info shadow h-100 py-2/g, 'card dashboard-card card-info');
    content = content.replace(/card border-left-warning shadow h-100 py-2/g, 'card dashboard-card card-warning');
    content = content.replace(/card border-left-danger shadow h-100 py-2/g, 'card dashboard-card card-danger');
    
    return content;
}

function processFile(filePath) {
    try {
        let content = fs.readFileSync(filePath, 'utf8');
        const original = content;
        
        // Apply all transformations
        content = fixPageHeader(content);
        content = fixTableCards(content);
        content = fixStatCards(content);
        
        if (content !== original) {
            // Backup
            const backupPath = filePath + '.backup-html-fix';
            if (!fs.existsSync(backupPath)) {
                fs.writeFileSync(backupPath, original);
            }
            
            // Write updated content
            fs.writeFileSync(filePath, content);
            console.log(`✅ Fixed: ${path.basename(filePath)}`);
            return true;
        } else {
            console.log(`⏭️  No changes: ${path.basename(filePath)}`);
            return false;
        }
    } catch (error) {
        console.error(`❌ Error: ${path.basename(filePath)} - ${error.message}`);
        return false;
    }
}

function main() {
    console.log('🔧 Fixing HTML Structure...\n');
    
    let fixed = 0;
    let skipped = 0;
    let errors = 0;
    
    targetFiles.forEach(file => {
        const fullPath = path.join(__dirname, '..', file);
        
        if (!fs.existsSync(fullPath)) {
            console.log(`⚠️  Not found: ${file}`);
            skipped++;
            return;
        }
        
        const result = processFile(fullPath);
        if (result === true) {
            fixed++;
        } else if (result === false) {
            skipped++;
        } else {
            errors++;
        }
    });
    
    console.log('\n' + '='.repeat(50));
    console.log(`✅ Fixed: ${fixed} files`);
    console.log(`⏭️  Skipped: ${skipped} files`);
    console.log(`❌ Errors: ${errors} files`);
    console.log('='.repeat(50));
    
    if (fixed > 0) {
        console.log('\n✨ HTML structure fixes applied!');
        console.log('💾 Backup files: *.backup-html-fix');
    }
}

main();
