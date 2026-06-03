#!/usr/bin/env node
/**
 * Register Agent PIN
 * Usage: node tools/register-agent-pin.js [agentId] [whatsappNumber] [pin]
 * Example: node tools/register-agent-pin.js AGT001 6285233047094 1234
 */

const agentTransactionManager = require('../lib/agent-transaction-manager');

const args = process.argv.slice(2);

if (args.length < 3) {
    console.error('❌ Usage: node register-agent-pin.js [agentId] [whatsappNumber] [pin]');
    console.error('   Example: node register-agent-pin.js AGT001 6285233047094 1234');
    process.exit(1);
}

const [agentId, whatsappNumber, pin] = args;

// Validate inputs
if (!agentId.startsWith('AGT')) {
    console.error('❌ Agent ID harus diawali dengan AGT (contoh: AGT001)');
    process.exit(1);
}

if (!whatsappNumber.match(/^628\d{9,12}$/)) {
    console.error('❌ WhatsApp number harus format: 628xxxxx');
    console.error('   Contoh: 6285233047094');
    process.exit(1);
}

if (pin.length < 4) {
    console.error('❌ PIN minimal 4 digit');
    process.exit(1);
}

console.log('🔄 Registering agent credentials...\n');
console.log(`Agent ID: ${agentId}`);
console.log(`WhatsApp: ${whatsappNumber}`);
console.log(`PIN: ${'*'.repeat(pin.length)}\n`);

try {
    // Add @s.whatsapp.net if not present
    const fullWhatsapp = whatsappNumber.includes('@') 
        ? whatsappNumber 
        : `${whatsappNumber}@s.whatsapp.net`;
    
    const result = agentTransactionManager.registerAgentCredentials(
        agentId,
        fullWhatsapp,
        pin
    );
    
    if (result.success) {
        console.log('✅ SUCCESS! Agent credentials registered.\n');
        console.log('📋 Details:');
        console.log(`   Agent ID: ${agentId}`);
        console.log(`   WhatsApp: ${fullWhatsapp}`);
        console.log(`   Status: Active\n`);
        console.log('🎉 Agent dapat mulai konfirmasi transaksi dengan command:');
        console.log(`   konfirmasi [TRANSACTION_ID] ${pin}\n`);
    } else {
        console.error('❌ FAILED:', result.message);
        process.exit(1);
    }
} catch (error) {
    console.error('❌ ERROR:', error.message);
    process.exit(1);
}
