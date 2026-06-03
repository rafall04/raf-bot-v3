#!/usr/bin/env node
/**
 * Demo Agent Setup
 * Quickly setup all agents with demo PINs for testing
 * WARNING: Use only for testing/demo purposes
 */

const fs = require('fs');
const path = require('path');
const agentTransactionManager = require('../lib/agent-transaction-manager');

console.log('🎭 DEMO AGENT SETUP\n');
console.log('═'.repeat(70));
console.log('\n');
console.log('⚠️  WARNING: This will register DEMO credentials for testing');
console.log('   For production, use individual registration with secure PINs\n');

// Load agents
const agentsPath = path.join(__dirname, '../database/agents.json');
const agents = JSON.parse(fs.readFileSync(agentsPath, 'utf8'));

// Filter active agents with topup service
const topupAgents = agents.filter(a => 
    a.active && 
    a.services && 
    a.services.includes('topup')
);

if (topupAgents.length === 0) {
    console.log('❌ No active agents with topup service found\n');
    process.exit(1);
}

console.log(`Found ${topupAgents.length} active agent(s) with topup service:\n`);

// Demo PINs (incremental for easy testing)
const demoPins = ['1234', '2345', '3456', '4567', '5678', '6789', '7890', '8901'];

async function setupAgents() {
    let registered = 0;
    let errors = 0;

    for (let index = 0; index < topupAgents.length; index++) {
        const agent = topupAgents[index];
        const pin = demoPins[index] || '1234';
        
        // Format phone number
        let phone = agent.phone.replace(/\D/g, ''); // Remove non-digits
        if (phone.startsWith('0')) {
            phone = '62' + phone.substring(1);
        } else if (!phone.startsWith('62')) {
            phone = '62' + phone;
        }
        const whatsappNumber = phone + '@s.whatsapp.net';
        
        console.log(`${index + 1}. ${agent.name}`);
        console.log(`   ID: ${agent.id}`);
        console.log(`   Phone: ${agent.phone} → ${whatsappNumber}`);
        console.log(`   PIN: ${pin}`);
        
        try {
            const result = await agentTransactionManager.registerAgentCredentials(
                agent.id,
                whatsappNumber,
                pin
            );
            
            if (result.success) {
                console.log(`   ✅ Registered successfully`);
                registered++;
            } else {
                console.log(`   ❌ Failed: ${result.message}`);
                errors++;
            }
        } catch (error) {
            console.log(`   ❌ Error: ${error.message}`);
            errors++;
        }
        
        console.log('');
    }
    
    return { registered, errors };
}

setupAgents().then(({ registered, errors }) => {

    console.log('═'.repeat(70));
    console.log('\n');

    console.log('📊 SUMMARY\n');
    console.log(`Total Agents: ${topupAgents.length}`);
    console.log(`Registered: ${registered}`);
    console.log(`Errors: ${errors}\n`);

    if (registered > 0) {
    console.log('✅ Demo setup complete!\n');
    console.log('📋 DEMO CREDENTIALS:\n');
    
    topupAgents.forEach((agent, index) => {
        const pin = demoPins[index] || '1234';
        console.log(`${agent.name}:`);
        console.log(`   Command: konfirmasi [ID] ${pin}\n`);
    });
    
    console.log('═'.repeat(70));
    console.log('\n');
    
    console.log('🎮 TESTING STEPS:\n');
    console.log('1. Start bot: npm start');
    console.log('2. Via WhatsApp: topup');
    console.log('3. Select: 2 (Cash)');
    console.log('4. Amount: 50000');
    console.log('5. Select agent: 1');
    console.log('6. Confirm: ya');
    console.log('7. Copy transaction ID from notification');
    console.log('8. As agent: konfirmasi [ID] [PIN]\n');
    
        console.log('💡 Check status:');
        console.log('   node tools/list-agents-status.js');
        console.log('   node tools/view-agent-transactions.js\n');
    } else {
        console.log('❌ Setup failed. Please check errors above.\n');
        process.exit(1);
    }
}).catch(error => {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
});
