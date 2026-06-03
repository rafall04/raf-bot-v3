#!/usr/bin/env node
/**
 * Debug WhatsApp Number Format
 * Check format consistency between databases and understand WhatsApp sender format
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 DEBUGGING WHATSAPP NUMBER FORMAT\n');
console.log('═'.repeat(70));
console.log('\n');

// Read databases
const agentsPath = path.join(__dirname, '../database/agents.json');
const credentialsPath = path.join(__dirname, '../database/agent_credentials.json');

const agents = JSON.parse(fs.readFileSync(agentsPath, 'utf8'));
const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));

console.log('📊 DATABASE ANALYSIS:\n');

// Check agents.json
console.log('1️⃣ agents.json - Phone Numbers:\n');
agents.forEach(agent => {
    const phone = agent.phone;
    let format = 'UNKNOWN';
    
    if (phone.startsWith('628')) {
        format = '628xxx (CORRECT)';
    } else if (phone.startsWith('08')) {
        format = '08xxx (NEEDS FIX)';
    } else if (phone.startsWith('62')) {
        format = '62xxx (CHECK)';
    } else if (phone.startsWith('0')) {
        format = '0xxx (NEEDS FIX)';
    }
    
    console.log(`   ${agent.id}: ${phone}`);
    console.log(`   Format: ${format}`);
    console.log(`   Active: ${agent.active}\n`);
});

console.log('─'.repeat(70));
console.log('\n');

// Check agent_credentials.json
console.log('2️⃣ agent_credentials.json - WhatsApp Numbers:\n');
credentials.forEach(cred => {
    const wa = cred.whatsappNumber;
    let format = 'UNKNOWN';
    
    if (wa.includes('@s.whatsapp.net')) {
        const number = wa.split('@')[0];
        if (number.startsWith('628')) {
            format = '628xxx@s.whatsapp.net (CORRECT) ✅';
        } else if (number.startsWith('62')) {
            format = '62xxx@s.whatsapp.net (CHECK)';
        } else {
            format = 'INCORRECT FORMAT ❌';
        }
    } else {
        format = 'MISSING @s.whatsapp.net ❌';
    }
    
    console.log(`   ${cred.agentId}: ${wa}`);
    console.log(`   Format: ${format}`);
    console.log(`   Active: ${cred.active}\n`);
});

console.log('─'.repeat(70));
console.log('\n');

// Cross-check
console.log('3️⃣ CROSS-CHECK:\n');
agents.filter(a => a.active).forEach(agent => {
    const cred = credentials.find(c => c.agentId === agent.id);
    
    console.log(`   ${agent.id} (${agent.name}):`);
    console.log(`   agents.json:     ${agent.phone}`);
    
    if (cred) {
        const waNumber = cred.whatsappNumber.split('@')[0];
        console.log(`   credentials:     ${waNumber}`);
        
        // Normalize for comparison
        const phoneNormalized = agent.phone.startsWith('0') 
            ? '62' + agent.phone.substring(1) 
            : agent.phone;
        
        if (phoneNormalized === waNumber) {
            console.log(`   Match: ✅ GOOD\n`);
        } else {
            console.log(`   Match: ❌ MISMATCH!`);
            console.log(`   Normalized: ${phoneNormalized} vs ${waNumber}\n`);
        }
    } else {
        console.log(`   credentials:     ❌ NOT FOUND\n`);
    }
});

console.log('═'.repeat(70));
console.log('\n');

// Format explanation
console.log('📖 FORMAT EXPLANATION:\n');
console.log('WhatsApp uses format: 628xxxxxxxxxx@s.whatsapp.net');
console.log('Where:');
console.log('  • 62 = Country code (Indonesia)');
console.log('  • 8xxxxxxxxxx = Phone number without leading 0');
console.log('  • @s.whatsapp.net = WhatsApp suffix');
console.log('');
console.log('Examples:');
console.log('  • Phone: 085233047094');
console.log('  • WhatsApp: 6285233047094@s.whatsapp.net');
console.log('  • NOT: 085233047094@s.whatsapp.net ❌');
console.log('');
console.log('When bot receives message, sender format is:');
console.log('  • sender = "6285233047094@s.whatsapp.net"');
console.log('');

console.log('═'.repeat(70));
console.log('\n');

// Check for issues
console.log('⚠️  POTENTIAL ISSUES:\n');

let issuesFound = false;

// Issue 1: agents.json format inconsistency
const phoneFormats = agents.filter(a => a.active).map(a => {
    if (a.phone.startsWith('628')) return '628';
    if (a.phone.startsWith('08')) return '08';
    return 'OTHER';
});

const hasInconsistency = new Set(phoneFormats).size > 1;

if (hasInconsistency) {
    console.log('❌ ISSUE 1: Inconsistent phone format in agents.json');
    console.log('   Some numbers start with 628, others with 08');
    console.log('   Solution: Standardize all to 628xxx format\n');
    issuesFound = true;
}

// Issue 2: Missing credentials
agents.filter(a => a.active).forEach(agent => {
    const hasCred = credentials.some(c => c.agentId === agent.id);
    if (!hasCred) {
        console.log(`❌ ISSUE 2: Agent ${agent.id} has no credentials`);
        console.log(`   Solution: Run register-agent-pin.js\n`);
        issuesFound = true;
    }
});

// Issue 3: Format mismatch
agents.filter(a => a.active).forEach(agent => {
    const cred = credentials.find(c => c.agentId === agent.id);
    if (cred) {
        const waNumber = cred.whatsappNumber.split('@')[0];
        const phoneNormalized = agent.phone.startsWith('0') 
            ? '62' + agent.phone.substring(1) 
            : agent.phone;
        
        if (phoneNormalized !== waNumber) {
            console.log(`❌ ISSUE 3: Number mismatch for ${agent.id}`);
            console.log(`   agents.json: ${agent.phone}`);
            console.log(`   credentials: ${waNumber}`);
            console.log(`   Solution: Update agents.json to match credentials\n`);
            issuesFound = true;
        }
    }
});

if (!issuesFound) {
    console.log('✅ No issues found! All formats are correct.\n');
} else {
    console.log('─'.repeat(70));
    console.log('\n');
    console.log('🔧 RECOMMENDED FIX:\n');
    console.log('Update agents.json phone numbers to match credentials format:');
    credentials.forEach(cred => {
        const waNumber = cred.whatsappNumber.split('@')[0];
        const agent = agents.find(a => a.agentId === cred.agentId || a.id === cred.agentId);
        if (agent && agent.phone !== waNumber) {
            console.log(`  • ${cred.agentId}: "${agent.phone}" → "${waNumber}"`);
        }
    });
    console.log('');
}

console.log('═'.repeat(70));
console.log('\n');

console.log('💡 TESTING RECOMMENDATION:\n');
console.log('1. Fix format issues above (if any)');
console.log('2. Restart bot: npm start');
console.log('3. Test from agent WhatsApp number:');
console.log('   • Type: transaksi');
console.log('   • Check logs for "Transaksi command received"');
console.log('4. If still no response:');
console.log('   • Check logs: tail -f logs/app-*.log | grep transaksi');
console.log('   • Look for sender format in logs');
console.log('   • Verify sender matches database format exactly');
console.log('');
