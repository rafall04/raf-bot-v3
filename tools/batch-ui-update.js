#!/usr/bin/env node

/**
 * Batch UI Update Script
 * Updates all admin pages to use modern UI standards
 * 
 * Usage: node tools/batch-ui-update.js
 */

const fs = require('fs');
const path = require('path');

// Files to process
const adminDir = path.join(__dirname, '..', 'views', 'sb-admin');

// Files that are already updated (skip these)
const skipFiles = [
    'index.php',
    'accounts.php',
    'payment-status.php',
    'tiket.php',
    'saldo-management.php',
    'agent-management.php',
    'kompensasi.php',
    'voucher.php',
    '_navbar.php',
    '_navbar_teknisi.php',
    'topbar.php',
    'footer.php',
    'login.php'
];

// Regex patterns for replacements
const replacements = [
    // 1. Font Inter instead of Nunito
    {
        search: /href="https:\/\/fonts\.googleapis\.com\/css\?family=Nunito:[^"]+"/g,
        replace: 'href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"'
    },
    // 2. Add dashboard-modern.css after sb-admin-2.min.css
    {
        search: /<link href="\/css\/sb-admin-2\.min\.css" rel="stylesheet">/g,
        replace: '<link href="/css/sb-admin-2.min.css" rel="stylesheet">\n  <link href="/css/dashboard-modern.css" rel="stylesheet">'
    },
    // 3. Fix /static/ paths to direct paths
    {
        search: /href="\/static\/(vendor|css|js)\//g,
        replace: 'href="/$1/'
    },
    {
        search: /src="\/static\/(vendor|js)\//g,
        replace: 'src="/$1/'
    }
];

function updateFile(filePath) {
    try {
        let content = fs.readFileSync(filePath, 'utf8');
        let updated = false;

        // Apply all replacements
        replacements.forEach(({ search, replace }) => {
            if (content.match(search)) {
                content = content.replace(search, replace);
                updated = true;
            }
        });

        // Check if dashboard-modern.css is already included
        if (!content.includes('dashboard-modern.css') && content.includes('sb-admin-2.min.css')) {
            content = content.replace(
                /<link href="\/css\/sb-admin-2\.min\.css" rel="stylesheet">/,
                '<link href="/css/sb-admin-2.min.css" rel="stylesheet">\n  <link href="/css/dashboard-modern.css" rel="stylesheet">'
            );
            updated = true;
        }

        if (updated) {
            // Backup original file
            const backupPath = filePath + '.backup-ui-update';
            if (!fs.existsSync(backupPath)) {
                fs.writeFileSync(backupPath, fs.readFileSync(filePath));
            }

            // Write updated content
            fs.writeFileSync(filePath, content);
            console.log(`✅ Updated: ${path.basename(filePath)}`);
            return true;
        } else {
            console.log(`⏭️  Skipped (no changes needed): ${path.basename(filePath)}`);
            return false;
        }
    } catch (error) {
        console.error(`❌ Error updating ${path.basename(filePath)}:`, error.message);
        return false;
    }
}

function main() {
    console.log('🚀 Starting Batch UI Update...\n');
    console.log('📁 Target directory:', adminDir);
    console.log('');

    if (!fs.existsSync(adminDir)) {
        console.error('❌ Admin directory not found:', adminDir);
        process.exit(1);
    }

    // Get all PHP files
    const files = fs.readdirSync(adminDir)
        .filter(file => file.endsWith('.php'))
        .filter(file => !skipFiles.includes(file));

    console.log(`📝 Found ${files.length} files to process\n`);

    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    files.forEach(file => {
        const filePath = path.join(adminDir, file);
        const result = updateFile(filePath);
        
        if (result === true) {
            updatedCount++;
        } else if (result === false) {
            skippedCount++;
        } else {
            errorCount++;
        }
    });

    // Check pembayaran subdirectory
    const pembayaranDir = path.join(adminDir, 'pembayaran');
    if (fs.existsSync(pembayaranDir)) {
        console.log('\n📁 Processing pembayaran directory...\n');
        const pembayaranFiles = fs.readdirSync(pembayaranDir)
            .filter(file => file.endsWith('.php'));

        pembayaranFiles.forEach(file => {
            const filePath = path.join(pembayaranDir, file);
            const result = updateFile(filePath);
            
            if (result === true) {
                updatedCount++;
            } else if (result === false) {
                skippedCount++;
            } else {
                errorCount++;
            }
        });
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 Summary:');
    console.log('='.repeat(50));
    console.log(`✅ Updated: ${updatedCount} files`);
    console.log(`⏭️  Skipped: ${skippedCount} files`);
    console.log(`❌ Errors: ${errorCount} files`);
    console.log('='.repeat(50));
    
    if (updatedCount > 0) {
        console.log('\n💾 Backup files created with .backup-ui-update extension');
        console.log('🎉 Batch UI update completed!');
        console.log('\n📝 Next steps:');
        console.log('   1. Review the changes');
        console.log('   2. Test each updated page');
        console.log('   3. Delete backup files if satisfied');
    } else {
        console.log('\n✨ All files are already up to date!');
    }
}

// Run the script
main();
