/**
 * Production Update Script
 * Sinkronisasi kode dari GitHub + auto migrasi database
 * 
 * Usage: node scripts/update-production.js
 * 
 * Apa yang dilakukan:
 * 1. Backup database (opsional, skip jika --no-backup)
 * 2. Git pull dari GitHub
 * 3. Install dependencies baru
 * 4. Jalankan migrasi database
 * 5. Tampilkan instruksi restart
 */

const { execSync } = require('child_process');
const path = require('path');

const skipBackup = process.argv.includes('--no-backup');
const skipInstall = process.argv.includes('--no-install');

function log(msg) {
    console.log(`[UPDATE] ${msg}`);
}

function exec(cmd, silent = false) {
    try {
        return execSync(cmd, { 
            encoding: 'utf8', 
            stdio: silent ? 'pipe' : 'inherit' 
        });
    } catch (e) {
        return null;
    }
}

async function main() {
    console.log('');
    console.log('╔════════════════════════════════════════╗');
    console.log('║     RAF BOT - Production Update        ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('');

    // Step 1: Backup (optional)
    if (!skipBackup) {
        log('1. Backup database...');
        exec('node scripts/backup-database.js');
    } else {
        log('1. Backup di-skip (--no-backup)');
    }

    // Step 2: Git pull
    log('2. Mengambil update dari GitHub...');
    const pullResult = exec('git pull origin main', true);
    
    if (pullResult === null) {
        console.log('   ERROR: Git pull gagal!');
        console.log('   Coba manual: git pull origin main');
        process.exit(1);
    }
    
    if (pullResult.includes('Already up to date')) {
        console.log('   Sudah up-to-date, tidak ada perubahan.');
    } else {
        console.log('   Update berhasil ditarik.');
        console.log(pullResult);
    }

    // Step 3: Install dependencies
    if (!skipInstall) {
        log('3. Install dependencies...');
        exec('npm install --production --silent');
    } else {
        log('3. Install di-skip (--no-install)');
    }

    // Step 4: Run migrations
    log('4. Menjalankan migrasi database...');
    exec('node scripts/auto-migrate-on-startup.js');

    // Done
    console.log('');
    console.log('╔════════════════════════════════════════╗');
    console.log('║           UPDATE SELESAI!              ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('');
    console.log('Langkah selanjutnya:');
    console.log('  pm2 restart raf-bot');
    console.log('');
    console.log('Opsi tambahan:');
    console.log('  --no-backup   Skip backup database');
    console.log('  --no-install  Skip npm install');
    console.log('');
}

main().catch(err => {
    console.error('ERROR:', err.message);
    process.exit(1);
});
