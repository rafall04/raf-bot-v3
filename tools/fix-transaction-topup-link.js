/**
 * Script to fix old transactions missing topupRequestId
 * Links transactions to topup requests based on userId, amount, and timestamp
 */

const fs = require('fs');
const path = require('path');

const TRANSACTIONS_FILE = path.join(__dirname, '../database/saldo_transactions.json');
const TOPUP_REQUESTS_FILE = path.join(__dirname, '../database/topup_requests.json');

function main() {
    console.log('Loading data...');
    
    // Load data
    const transactions = JSON.parse(fs.readFileSync(TRANSACTIONS_FILE, 'utf8'));
    const topupRequests = JSON.parse(fs.readFileSync(TOPUP_REQUESTS_FILE, 'utf8'));
    
    console.log(`Found ${transactions.length} transactions`);
    console.log(`Found ${topupRequests.length} topup requests`);
    
    // Find transactions that need fixing
    let fixedCount = 0;
    let notFoundCount = 0;
    
    transactions.forEach(tx => {
        // Skip if already has topupRequestId
        if (tx.topupRequestId) {
            return;
        }
        
        // Only process topup transactions (credit type with "Topup verified" description)
        if (tx.type !== 'credit' || !tx.description.includes('Topup verified')) {
            return;
        }
        
        // Find matching topup request
        // Match by: userId, amount, and timestamp within 5 seconds
        const txTime = new Date(tx.created_at).getTime();
        
        const matchingRequest = topupRequests.find(req => {
            if (req.userId !== tx.userId) return false;
            if (req.amount !== tx.amount) return false;
            if (req.status !== 'verified') return false;
            
            // Check if verifiedAt is within 5 seconds of transaction created_at
            const reqTime = new Date(req.verifiedAt).getTime();
            const timeDiff = Math.abs(txTime - reqTime);
            
            return timeDiff < 5000; // Within 5 seconds
        });
        
        if (matchingRequest) {
            tx.topupRequestId = matchingRequest.id;
            fixedCount++;
            console.log(`✓ Fixed: ${tx.id} → ${matchingRequest.id}`);
        } else {
            notFoundCount++;
            console.log(`✗ No match: ${tx.id} (${tx.userId}, ${tx.amount}, ${tx.created_at})`);
        }
    });
    
    if (fixedCount > 0) {
        // Save backup
        const backupFile = TRANSACTIONS_FILE + '.backup-' + Date.now();
        fs.writeFileSync(backupFile, JSON.stringify(transactions, null, 2));
        console.log(`\nBackup saved: ${backupFile}`);
        
        // Save updated transactions
        fs.writeFileSync(TRANSACTIONS_FILE, JSON.stringify(transactions, null, 2));
        console.log(`\nUpdated transactions saved: ${TRANSACTIONS_FILE}`);
    }
    
    console.log('\n=== SUMMARY ===');
    console.log(`Fixed: ${fixedCount} transactions`);
    console.log(`Not found: ${notFoundCount} transactions`);
    console.log(`Total processed: ${fixedCount + notFoundCount}`);
    
    if (fixedCount > 0) {
        console.log('\n✅ SUCCESS! Please restart the server to reload the data.');
    }
}

try {
    main();
} catch (error) {
    console.error('Error:', error);
    process.exit(1);
}
