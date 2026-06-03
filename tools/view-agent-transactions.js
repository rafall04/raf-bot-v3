#!/usr/bin/env node
/**
 * View Agent Transactions
 * Shows transaction history and statistics
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const agentId = args[0];
const period = args[1] || 'all'; // all, today, week, month

console.log('💳 AGENT TRANSACTIONS VIEWER\n');
console.log('═'.repeat(70));
console.log('\n');

try {
    // Load transactions
    const transPath = path.join(__dirname, '../database/agent_transactions.json');
    const transactions = JSON.parse(fs.readFileSync(transPath, 'utf8'));
    
    // Load agents for names
    const agentsPath = path.join(__dirname, '../database/agents.json');
    const agents = JSON.parse(fs.readFileSync(agentsPath, 'utf8'));
    
    if (transactions.length === 0) {
        console.log('ℹ️  No transactions found yet.');
        console.log('   Transactions will appear here after customers use topup via agent.\n');
        process.exit(0);
    }
    
    // Filter by agent if specified
    let filtered = transactions;
    if (agentId) {
        filtered = transactions.filter(t => t.agentId === agentId);
        const agent = agents.find(a => a.id === agentId);
        console.log(`Agent: ${agent ? agent.name : agentId}\n`);
    }
    
    // Filter by period
    const now = new Date();
    if (period === 'today') {
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        filtered = filtered.filter(t => new Date(t.created_at) >= today);
    } else if (period === 'week') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        filtered = filtered.filter(t => new Date(t.created_at) >= weekAgo);
    } else if (period === 'month') {
        const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        filtered = filtered.filter(t => new Date(t.created_at) >= monthAgo);
    }
    
    if (filtered.length === 0) {
        console.log(`ℹ️  No transactions found for period: ${period}\n`);
        process.exit(0);
    }
    
    console.log(`Showing ${filtered.length} transaction(s) - Period: ${period}\n`);
    console.log('═'.repeat(70));
    console.log('\n');
    
    // Group by status
    const byStatus = {
        pending: filtered.filter(t => t.status === 'pending'),
        confirmed: filtered.filter(t => t.status === 'confirmed'),
        completed: filtered.filter(t => t.status === 'completed'),
        cancelled: filtered.filter(t => t.status === 'cancelled')
    };
    
    // Show transactions
    ['pending', 'confirmed', 'completed', 'cancelled'].forEach(status => {
        if (byStatus[status].length > 0) {
            const icon = {
                pending: '⏳',
                confirmed: '🔄',
                completed: '✅',
                cancelled: '❌'
            }[status];
            
            console.log(`${icon} ${status.toUpperCase()} (${byStatus[status].length})\n`);
            
            byStatus[status].forEach(trx => {
                const date = new Date(trx.created_at).toLocaleString('id-ID', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                
                console.log(`   ${date}`);
                console.log(`   ID: ${trx.id}`);
                console.log(`   Customer: ${trx.customerName}`);
                console.log(`   Agent: ${trx.agentName}`);
                console.log(`   Amount: Rp ${trx.amount.toLocaleString('id-ID')}`);
                
                if (trx.confirmedAt) {
                    const confirmDate = new Date(trx.confirmedAt).toLocaleString('id-ID', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    console.log(`   Confirmed: ${confirmDate}`);
                    console.log(`   By: ${trx.confirmedBy || 'unknown'}`);
                }
                
                console.log('');
            });
        }
    });
    
    console.log('═'.repeat(70));
    console.log('\n');
    
    // Statistics
    const totalAmount = filtered.reduce((sum, t) => {
        return t.status === 'completed' ? sum + t.amount : sum;
    }, 0);
    
    const pendingAmount = filtered.reduce((sum, t) => {
        return t.status === 'pending' ? sum + t.amount : sum;
    }, 0);
    
    console.log('📊 STATISTICS\n');
    console.log(`Total Transactions:   ${filtered.length}`);
    console.log(`Pending:             ${byStatus.pending.length}`);
    console.log(`Confirmed:           ${byStatus.confirmed.length}`);
    console.log(`Completed:           ${byStatus.completed.length}`);
    console.log(`Cancelled:           ${byStatus.cancelled.length}\n`);
    console.log(`Total Amount:        Rp ${totalAmount.toLocaleString('id-ID')}`);
    console.log(`Pending Amount:      Rp ${pendingAmount.toLocaleString('id-ID')}`);
    console.log('\n');
    
} catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
}

console.log('💡 USAGE:');
console.log('   node tools/view-agent-transactions.js [agentId] [period]');
console.log('   Periods: all (default), today, week, month');
console.log('\n');
