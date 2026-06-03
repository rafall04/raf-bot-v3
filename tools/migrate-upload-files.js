#!/usr/bin/env node

/**
 * Upload Files Migration Script
 * Migrate existing upload files to new organized folder structure
 * 
 * Usage: node tools/migrate-upload-files.js
 */

const fs = require('fs');
const path = require('path');

console.log('📦 UPLOAD FILES MIGRATION\n');
console.log('Moving files to organized structure...\n');

const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

let totalMoved = 0;
let totalErrors = 0;

// ===== MIGRATE SPEED REQUEST FILES =====
console.log('1️⃣  Migrating Speed Request files...\n');

const oldSpeedDir = path.join(__dirname, '..', 'static', 'uploads');
const newSpeedDir = path.join(__dirname, '..', 'static', 'uploads', 'speed-requests', currentMonth);

if (fs.existsSync(oldSpeedDir)) {
    const files = fs.readdirSync(oldSpeedDir).filter(f => 
        f.startsWith('payment-speed-') || f.startsWith('payment-')
    );
    
    if (files.length > 0) {
        // Create new directory
        if (!fs.existsSync(newSpeedDir)) {
            fs.mkdirSync(newSpeedDir, { recursive: true });
            console.log(`   ✅ Created: speed-requests/${currentMonth}/`);
        }
        
        files.forEach(file => {
            const oldPath = path.join(oldSpeedDir, file);
            const newPath = path.join(newSpeedDir, file);
            
            try {
                // Check if it's a file (not directory)
                const stats = fs.statSync(oldPath);
                if (stats.isFile()) {
                    fs.renameSync(oldPath, newPath);
                    console.log(`   ✅ Moved: ${file}`);
                    totalMoved++;
                }
            } catch (error) {
                console.error(`   ❌ Error moving ${file}:`, error.message);
                totalErrors++;
            }
        });
        
        console.log(`\n   📊 Speed requests: ${files.length} files migrated\n`);
    } else {
        console.log(`   ℹ️  No speed request files found\n`);
    }
}

// ===== MIGRATE TOPUP FILES =====
console.log('2️⃣  Migrating Topup files...\n');

const oldTopupDir = path.join(__dirname, '..', 'temp', 'topup-proofs');
const newTopupDir = path.join(__dirname, '..', 'static', 'uploads', 'topup-requests', currentMonth);

if (fs.existsSync(oldTopupDir)) {
    const topupFiles = fs.readdirSync(oldTopupDir);
    
    if (topupFiles.length > 0) {
        // Create new directory
        if (!fs.existsSync(newTopupDir)) {
            fs.mkdirSync(newTopupDir, { recursive: true });
            console.log(`   ✅ Created: topup-requests/${currentMonth}/`);
        }
        
        topupFiles.forEach(file => {
            const oldPath = path.join(oldTopupDir, file);
            const newPath = path.join(newTopupDir, file);
            
            try {
                const stats = fs.statSync(oldPath);
                if (stats.isFile()) {
                    fs.renameSync(oldPath, newPath);
                    console.log(`   ✅ Moved: ${file}`);
                    totalMoved++;
                }
            } catch (error) {
                console.error(`   ❌ Error moving ${file}:`, error.message);
                totalErrors++;
            }
        });
        
        console.log(`\n   📊 Topup requests: ${topupFiles.length} files migrated\n`);
        
        // Remove old temp directory if empty
        try {
            const remaining = fs.readdirSync(oldTopupDir);
            if (remaining.length === 0) {
                fs.rmdirSync(oldTopupDir);
                console.log(`   🗑️  Removed empty directory: temp/topup-proofs/\n`);
            }
        } catch (error) {
            console.log(`   ⚠️  Could not remove old directory: ${error.message}\n`);
        }
    } else {
        console.log(`   ℹ️  No topup files found\n`);
    }
} else {
    console.log(`   ℹ️  Old topup directory not found\n`);
}

// ===== UPDATE DATABASE REFERENCES =====
console.log('3️⃣  Updating database references...\n');

let dbUpdated = 0;

// Update speed_requests.json
const speedRequestsPath = path.join(__dirname, '..', 'database', 'speed_requests.json');
if (fs.existsSync(speedRequestsPath)) {
    try {
        const speedRequests = JSON.parse(fs.readFileSync(speedRequestsPath, 'utf8'));
        let updated = 0;
        
        speedRequests.forEach(req => {
            if (req.paymentProof) {
                // Update old paths
                if (req.paymentProof.startsWith('/uploads/payment-') || 
                    req.paymentProof.startsWith('/static/uploads/payment-')) {
                    const filename = path.basename(req.paymentProof);
                    req.paymentProof = `/static/uploads/speed-requests/${currentMonth}/${filename}`;
                    updated++;
                }
            }
        });
        
        if (updated > 0) {
            fs.writeFileSync(speedRequestsPath, JSON.stringify(speedRequests, null, 2));
            console.log(`   ✅ Updated speed_requests.json (${updated} records)`);
            dbUpdated += updated;
        } else {
            console.log(`   ℹ️  No speed_requests.json updates needed`);
        }
    } catch (error) {
        console.error(`   ❌ Error updating speed_requests.json:`, error.message);
        totalErrors++;
    }
}

// Update topup_requests.json
const topupRequestsPath = path.join(__dirname, '..', 'database', 'topup_requests.json');
if (fs.existsSync(topupRequestsPath)) {
    try {
        const topupRequests = JSON.parse(fs.readFileSync(topupRequestsPath, 'utf8'));
        let updated = 0;
        
        topupRequests.forEach(req => {
            if (req.paymentProof) {
                // Update old paths
                if (req.paymentProof.startsWith('/temp/topup-proofs/')) {
                    const filename = path.basename(req.paymentProof);
                    req.paymentProof = `/static/uploads/topup-requests/${currentMonth}/${filename}`;
                    updated++;
                }
            }
        });
        
        if (updated > 0) {
            fs.writeFileSync(topupRequestsPath, JSON.stringify(topupRequests, null, 2));
            console.log(`   ✅ Updated topup_requests.json (${updated} records)`);
            dbUpdated += updated;
        } else {
            console.log(`   ℹ️  No topup_requests.json updates needed`);
        }
    } catch (error) {
        console.error(`   ❌ Error updating topup_requests.json:`, error.message);
        totalErrors++;
    }
}

console.log();

// ===== FINAL SUMMARY =====
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 MIGRATION SUMMARY:\n');
console.log(`   ✅ Files moved:      ${totalMoved}`);
console.log(`   ✅ DB records updated: ${dbUpdated}`);
console.log(`   ❌ Errors:           ${totalErrors}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

if (totalErrors === 0) {
    console.log('✅ Migration completed successfully!\n');
    console.log('📁 New folder structure:');
    console.log('   static/uploads/');
    console.log('   ├── speed-requests/');
    console.log(`   │   └── ${currentMonth}/`);
    console.log('   └── topup-requests/');
    console.log(`       └── ${currentMonth}/\n`);
    console.log('💡 Next: Restart bot to apply changes');
} else {
    console.log('⚠️  Migration completed with errors. Please check logs above.\n');
}
