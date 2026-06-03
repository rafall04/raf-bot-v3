#!/usr/bin/env node
/**
 * List Agents Status
 * Shows all agents and their credential registration status
 */

const fs = require('fs');
const path = require('path');

console.log('📋 AGENT STATUS REPORT\n');
console.log('═'.repeat(70));
console.log('\n');

try {
    // Load agents
    const agentsPath = path.join(__dirname, '../database/agents.json');
    const agents = JSON.parse(fs.readFileSync(agentsPath, 'utf8'));
    
    // Load credentials
    const credPath = path.join(__dirname, '../database/agent_credentials.json');
    const credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    
    if (agents.length === 0) {
        console.log('⚠️  No agents found in database/agents.json');
        console.log('   Add agents via admin panel: /agent-management');
        console.log('\n');
        process.exit(0);
    }
    
    console.log(`Total Agents: ${agents.length}`);
    console.log(`Registered Credentials: ${credentials.length}\n`);
    console.log('═'.repeat(70));
    console.log('\n');
    
    agents.forEach((agent, index) => {
        const cred = credentials.find(c => c.agentId === agent.id);
        const hasTopupService = agent.services && agent.services.includes('topup');
        
        console.log(`${index + 1}. ${agent.name}`);
        console.log(`   ID: ${agent.id}`);
        console.log(`   Phone: ${agent.phone}`);
        console.log(`   Area: ${agent.area}`);
        console.log(`   Services: ${agent.services ? agent.services.join(', ') : 'none'}`);
        console.log(`   Status: ${agent.active ? '✅ Active' : '❌ Inactive'}`);
        
        if (!hasTopupService) {
            console.log(`   ⚠️  Warning: 'topup' not in services - cannot process topup`);
        }
        
        if (cred) {
            console.log(`   🔐 Credentials: ✅ Registered`);
            console.log(`      WhatsApp: ${cred.whatsappNumber}`);
            console.log(`      PIN: ${cred.pin ? '✅ Set' : '❌ Not set'}`);
            console.log(`      Active: ${cred.active ? '✅' : '❌'}`);
            
            if (!agent.active) {
                console.log(`   ⚠️  Agent inactive but has credentials`);
            }
        } else {
            console.log(`   🔐 Credentials: ❌ NOT REGISTERED`);
            console.log(`   💡 Register: node tools/register-agent-pin.js ${agent.id} 628... [PIN]`);
        }
        
        console.log('');
    });
    
    console.log('═'.repeat(70));
    console.log('\n');
    
    // Summary
    const activeAgents = agents.filter(a => a.active).length;
    const topupAgents = agents.filter(a => a.active && a.services && a.services.includes('topup')).length;
    const registeredAgents = agents.filter(a => credentials.find(c => c.agentId === a.id)).length;
    const readyAgents = agents.filter(a => {
        const cred = credentials.find(c => c.agentId === a.id);
        return a.active && cred && cred.active && a.services && a.services.includes('topup');
    }).length;
    
    console.log('📊 SUMMARY\n');
    console.log(`Active Agents:        ${activeAgents}/${agents.length}`);
    console.log(`Topup Service:        ${topupAgents}/${agents.length}`);
    console.log(`Credentials Reg:      ${registeredAgents}/${agents.length}`);
    console.log(`Ready for Topup:      ${readyAgents}/${agents.length}`);
    console.log('\n');
    
    if (readyAgents === 0) {
        console.log('⚠️  WARNING: No agents ready for topup transactions!');
        console.log('\n');
        console.log('📋 TODO:');
        
        agents.forEach(agent => {
            const cred = credentials.find(c => c.agentId === agent.id);
            const hasTopup = agent.services && agent.services.includes('topup');
            
            if (agent.active && hasTopup && !cred) {
                console.log(`   • Register ${agent.name}:`);
                console.log(`     node tools/register-agent-pin.js ${agent.id} 628... [PIN]`);
            }
        });
        console.log('\n');
    } else {
        console.log(`✅ ${readyAgents} agent(s) ready for topup transactions!`);
        console.log('\n');
    }
    
} catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
}
