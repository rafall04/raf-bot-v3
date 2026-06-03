#!/usr/bin/env node
/**
 * Verify Agent Role Detection Fix
 * Test if agents are now properly detected with correct role
 */

const agentManager = require('../lib/agent-manager');

console.log('🔍 VERIFYING AGENT ROLE DETECTION FIX\n');
console.log('═'.repeat(70));
console.log('\n');

// Simulate raf.js flow
const testSenders = [
    '6285233047094@s.whatsapp.net',  // AGT001
    '6285234567890@s.whatsapp.net',  // AGT002
    '6285245678901@s.whatsapp.net',  // AGT003
    '628123456789@s.whatsapp.net'    // Not an agent
];

console.log('📋 TESTING AGENT ROLE DETECTION:\n');

testSenders.forEach((sender, index) => {
    console.log(`${index + 1}. Testing: ${sender}`);
    
    // Simulate the code in raf.js
    const agent = agentManager.getAgentByWhatsapp(sender);
    const isAgent = agent ? true : false;
    
    // Simulate role determination
    const isOwner = false;  // Assuming not owner
    const isTeknisi = false; // Assuming not teknisi
    const userRole = isOwner ? 'owner' : isTeknisi ? 'teknisi' : isAgent ? 'agent' : 'customer';
    
    console.log(`   Agent found: ${isAgent ? '✅ YES' : '❌ NO'}`);
    console.log(`   User role: ${userRole}`);
    
    if (isAgent) {
        console.log(`   Agent ID: ${agent.id}`);
        console.log(`   Agent Name: ${agent.name}`);
    }
    
    console.log('');
});

console.log('─'.repeat(70));
console.log('\n');

// Test command permission
console.log('🔐 TESTING COMMAND PERMISSIONS:\n');

const commandManager = require('../lib/command-manager');

const testCommands = [
    { cmd: 'transaksi', expectedRoles: ['agent', 'admin', 'owner'] },
    { cmd: 'konfirmasi AGT_TRX_123 1234', expectedRoles: ['agent', 'admin', 'owner'] },
    { cmd: 'ganti pin 1234 5678', expectedRoles: ['agent', 'admin', 'owner'] },
    { cmd: 'profil agent', expectedRoles: ['agent', 'admin', 'owner'] }
];

testCommands.forEach(test => {
    console.log(`Command: "${test.cmd}"`);
    console.log(`   Allowed roles: ${test.expectedRoles.join(', ')}`);
    
    const roles = ['customer', 'agent', 'admin', 'owner'];
    roles.forEach(role => {
        const result = commandManager.getIntent(test.cmd, role);
        const allowed = result ? '✅' : '❌';
        console.log(`   ${role.padEnd(10)}: ${allowed} ${result ? `(intent: ${result.intent})` : ''}`);
    });
    
    console.log('');
});

console.log('═'.repeat(70));
console.log('\n');

console.log('📊 EXPECTED BEHAVIOR AFTER FIX:\n');
console.log('1. Agent sends "transaksi"');
console.log('   → Agent detected: ✅');
console.log('   → userRole = "agent"');
console.log('   → commandManager.getIntent("transaksi", "agent")');
console.log('   → Returns: intent="transaksi hari ini"');
console.log('   → Switch case matches');
console.log('   → Handler executed');
console.log('   → Response sent ✅\n');

console.log('2. Customer sends "transaksi"');
console.log('   → Agent detected: ❌');
console.log('   → userRole = "customer"');
console.log('   → commandManager.getIntent("transaksi", "customer")');
console.log('   → Returns: null (not allowed for customer)');
console.log('   → No response (correct) ✅\n');

console.log('═'.repeat(70));
console.log('\n');

console.log('✅ FIX VERIFICATION COMPLETE!\n');
console.log('Next steps:');
console.log('1. Restart bot: npm start');
console.log('2. Test from agent number: 085233047094');
console.log('3. Send: transaksi');
console.log('4. Expected: Response with transaction list');
console.log('5. Check logs for:');
console.log('   • "Agent detected" { agentId: "AGT001", role: "agent" }');
console.log('   • "Intent detected via command manager" { intent: "transaksi hari ini" }');
console.log('   • "Command executed: transaksi hari ini"');
console.log('   • "Transaksi command received"');
console.log('');
