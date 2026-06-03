#!/usr/bin/env node

/**
 * RAF Bot Command Center
 * Central management tool for development and maintenance
 */

const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m'
};

class CommandCenter {
    constructor() {
        this.rootDir = path.join(__dirname, '..');
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    clearScreen() {
        process.stdout.write('\x1Bc');
    }

    printHeader() {
        this.clearScreen();
        console.log(`${colors.cyan}${'═'.repeat(60)}${colors.reset}`);
        console.log(`${colors.cyan}║${colors.bright}         RAF BOT V2 - COMMAND CENTER           ${colors.cyan}║${colors.reset}`);
        console.log(`${colors.cyan}${'═'.repeat(60)}${colors.reset}\n`);
    }

    printMenu() {
        console.log(`${colors.yellow}📋 MAIN MENU${colors.reset}`);
        console.log(`${colors.cyan}${'─'.repeat(40)}${colors.reset}`);
        
        const menuItems = [
            { key: '1', label: 'System Health Check', icon: '🏥' },
            { key: '2', label: 'Generate AI Prompt', icon: '🤖' },
            { key: '3', label: 'WiFi System Tools', icon: '📡' },
            { key: '4', label: 'Database Tools', icon: '🗄️' },
            { key: '5', label: 'View Logs', icon: '📜' },
            { key: '6', label: 'Run Tests', icon: '🧪' },
            { key: '7', label: 'Fix Common Issues', icon: '🔧' },
            { key: '8', label: 'Documentation', icon: '📚' },
            { key: '9', label: 'Start Bot', icon: '▶️' },
            { key: '0', label: 'Exit', icon: '🚪' }
        ];

        menuItems.forEach(item => {
            console.log(`${item.icon}  ${colors.bright}[${item.key}]${colors.reset} ${item.label}`);
        });
        
        console.log(`\n${colors.cyan}${'─'.repeat(40)}${colors.reset}`);
    }

    async promptUser(question) {
        return new Promise(resolve => {
            this.rl.question(`${colors.yellow}${question}${colors.reset} `, answer => {
                resolve(answer.trim());
            });
        });
    }

    runCommand(command, args = []) {
        return new Promise((resolve, reject) => {
            const child = spawn(command, args, {
                cwd: this.rootDir,
                shell: true,
                stdio: 'inherit'
            });

            child.on('exit', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Command failed with code ${code}`));
                }
            });

            child.on('error', reject);
        });
    }

    async systemHealthCheck() {
        console.log(`\n${colors.green}Running System Health Check...${colors.reset}\n`);
        
        const options = await this.promptUser('Options: [1] Full Check, [2] WiFi Only, [3] Database Only');
        
        let args = ['tools/system-health-check.js'];
        switch(options) {
            case '1': args.push('--full'); break;
            case '2': args.push('--wifi'); break;
            case '3': args.push('--db'); break;
            default: args.push('--full');
        }
        
        await this.runCommand('node', args);
        await this.promptUser('\nPress Enter to continue...');
    }

    async generatePrompt() {
        console.log(`\n${colors.green}AI Prompt Generator${colors.reset}\n`);
        
        const simplePrompt = await this.promptUser('Enter simple prompt');
        
        if (simplePrompt) {
            await this.runCommand('node', ['tools/prompt-generator.js', simplePrompt]);
        }
        
        await this.promptUser('\nPress Enter to continue...');
    }

    async wifiTools() {
        console.log(`\n${colors.green}WiFi System Tools${colors.reset}\n`);
        console.log('[1] Check WiFi Handlers');
        console.log('[2] View WiFi Logs');
        console.log('[3] Clear WiFi Logs');
        console.log('[4] Test WiFi Commands');
        console.log('[5] Back to Main Menu');
        
        const choice = await this.promptUser('Select option');
        
        switch(choice) {
            case '1':
                await this.checkWiFiHandlers();
                break;
            case '2':
                await this.viewWiFiLogs();
                break;
            case '3':
                await this.clearWiFiLogs();
                break;
            case '4':
                await this.testWiFiCommands();
                break;
        }
        
        if (choice !== '5') {
            await this.promptUser('\nPress Enter to continue...');
        }
    }

    async checkWiFiHandlers() {
        const handlers = [
            'message/handlers/wifi-management-handler.js',
            'message/handlers/states/wifi-name-state-handler.js',
            'message/handlers/states/wifi-password-state-handler.js',
            'message/handlers/wifi-history-handler.js'
        ];

        console.log('\nChecking WiFi Handlers:');
        handlers.forEach(handler => {
            const fullPath = path.join(this.rootDir, handler);
            if (fs.existsSync(fullPath)) {
                const stats = fs.statSync(fullPath);
                const size = (stats.size / 1024).toFixed(2);
                console.log(`${colors.green}✓${colors.reset} ${handler} (${size} KB)`);
            } else {
                console.log(`${colors.red}✗${colors.reset} ${handler} - NOT FOUND`);
            }
        });
    }

    async viewWiFiLogs() {
        const logsPath = path.join(this.rootDir, 'database/wifi_change_logs.json');
        
        if (fs.existsSync(logsPath)) {
            const logs = JSON.parse(fs.readFileSync(logsPath, 'utf8'));
            console.log(`\nTotal WiFi Logs: ${logs.length}`);
            
            if (logs.length > 0) {
                console.log('\nLast 5 entries:');
                logs.slice(-5).forEach((log, index) => {
                    console.log(`\n${colors.cyan}Entry ${index + 1}:${colors.reset}`);
                    console.log(`  Timestamp: ${log.timestamp}`);
                    console.log(`  Type: ${log.changeType}`);
                    console.log(`  User: ${log.customerName}`);
                });
            }
        } else {
            console.log(`${colors.red}No WiFi logs found${colors.reset}`);
        }
    }

    async clearWiFiLogs() {
        const confirm = await this.promptUser('Are you sure you want to clear WiFi logs? (yes/no)');
        
        if (confirm.toLowerCase() === 'yes') {
            const logsPath = path.join(this.rootDir, 'database/wifi_change_logs.json');
            fs.writeFileSync(logsPath, '[]');
            console.log(`${colors.green}WiFi logs cleared${colors.reset}`);
        }
    }

    async testWiFiCommands() {
        console.log('\n[INFO] Test files have been removed for production cleanup.');
        console.log('WiFi tools functionality is available through the main application.');
        await this.promptUser('\nPress Enter to continue...');
    }

    async databaseTools() {
        console.log(`\n${colors.green}Database Tools${colors.reset}\n`);
        console.log('[1] Check Database Status');
        console.log('[2] View Users');
        console.log('[3] View Accounts');
        console.log('[4] Backup Database');
        console.log('[5] Back to Main Menu');
        
        const choice = await this.promptUser('Select option');
        
        switch(choice) {
            case '1':
                await this.checkDatabaseStatus();
                break;
            case '2':
                await this.viewUsers();
                break;
            case '3':
                await this.viewAccounts();
                break;
            case '4':
                await this.backupDatabase();
                break;
        }
        
        if (choice !== '5') {
            await this.promptUser('\nPress Enter to continue...');
        }
    }

    async checkDatabaseStatus() {
        const dbPath = path.join(this.rootDir, 'database', 'database.sqlite');
        
        if (fs.existsSync(dbPath)) {
            const stats = fs.statSync(dbPath);
            console.log(`\n${colors.green}Database Status:${colors.reset}`);
            console.log(`  Path: ${dbPath}`);
            console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
            console.log(`  Modified: ${stats.mtime}`);
        } else {
            console.log(`${colors.red}Database not found${colors.reset}`);
        }
    }

    async viewUsers() {
        console.log('[INFO] Test files have been removed for production cleanup.');
        console.log('Use the main application to view users.');
    }

    async viewAccounts() {
        const accountsPath = path.join(this.rootDir, 'database/accounts.json');
        
        if (fs.existsSync(accountsPath)) {
            const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
            console.log(`\nTotal Accounts: ${accounts.length}`);
            
            accounts.forEach(account => {
                const icon = account.role === 'owner' ? '👑' : account.role === 'teknisi' ? '🔧' : '👤';
                console.log(`${icon} ${account.name} (${account.role}) - ${account.phone_number}`);
            });
        }
    }

    async backupDatabase() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDir = path.join(this.rootDir, 'backups');
        
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir);
        }
        
        // All databases stored in database/ folder
        const dbPath = path.join(this.rootDir, 'database', 'database.sqlite');
        const backupPath = path.join(backupDir, `database_${timestamp}.sqlite`);
        
        fs.copyFileSync(dbPath, backupPath);
        console.log(`${colors.green}Database backed up to: ${backupPath}${colors.reset}`);
    }

    async viewLogs() {
        console.log(`\n${colors.green}View Logs${colors.reset}\n`);
        console.log('[1] System Logs');
        console.log('[2] WiFi Change Logs');
        console.log('[3] Error Logs');
        console.log('[4] Health Check Report');
        
        const choice = await this.promptUser('Select log type');
        
        const logFiles = {
            '1': 'logs/system.log',
            '2': 'database/wifi_change_logs.json',
            '3': 'logs/error.log',
            '4': 'health-check-report.json'
        };
        
        if (logFiles[choice]) {
            const logPath = path.join(this.rootDir, logFiles[choice]);
            if (fs.existsSync(logPath)) {
                const content = fs.readFileSync(logPath, 'utf8');
                console.log('\n' + content.slice(-2000)); // Last 2000 chars
            } else {
                console.log(`${colors.red}Log file not found${colors.reset}`);
            }
        }
        
        await this.promptUser('\nPress Enter to continue...');
    }

    async runTests() {
        console.log(`\n${colors.green}Run Tests${colors.reset}\n`);
        console.log('[INFO] Test files have been removed for production cleanup.');
        console.log('Use the main application features for functionality testing.');
        console.log('For unit testing, use: npm test (Jest framework)');
        
        await this.promptUser('\nPress Enter to continue...');
    }

    async fixCommonIssues() {
        console.log(`\n${colors.green}Fix Common Issues${colors.reset}\n`);
        console.log('[1] Fix [object Object] in logs');
        console.log('[2] Fix missing imports');
        console.log('[3] Fix password logging');
        console.log('[4] Clear corrupted data');
        console.log('[5] Reset configurations');
        
        const choice = await this.promptUser('Select issue to fix');
        
        console.log(`\n${colors.yellow}Fixing issue ${choice}...${colors.reset}`);
        
        // Here you would implement actual fixes
        console.log('Please run the appropriate fix script or follow the documentation.');
        
        await this.promptUser('\nPress Enter to continue...');
    }

    async viewDocumentation() {
        console.log(`\n${colors.green}Documentation${colors.reset}\n`);
        console.log('[1] AI Maintenance Guide');
        console.log('[2] README');
        console.log('[3] Recent Fix Summaries');
        console.log('[4] WiFi Documentation');
        
        const choice = await this.promptUser('Select document');
        
        const docs = {
            '1': 'AI_MAINTENANCE_GUIDE.md',
            '2': 'README.md',
            '3': 'WIFI_COMPLETE_FIX_SUMMARY.md',
            '4': 'PROMPT_LENGKAP_FIX_WIFI_COMPREHENSIVE.md'
        };
        
        if (docs[choice]) {
            const docPath = path.join(this.rootDir, docs[choice]);
            if (fs.existsSync(docPath)) {
                const content = fs.readFileSync(docPath, 'utf8');
                console.log('\n' + content.slice(0, 2000) + '\n...'); // First 2000 chars
                console.log(`\n${colors.cyan}Full document: ${docs[choice]}${colors.reset}`);
            }
        }
        
        await this.promptUser('\nPress Enter to continue...');
    }

    async startBot() {
        console.log(`\n${colors.green}Starting RAF Bot...${colors.reset}\n`);
        
        const choice = await this.promptUser('[1] Normal Start, [2] Debug Mode, [3] Cancel');
        
        if (choice === '1') {
            console.log('Starting bot...');
            spawn('npm', ['start'], {
                cwd: this.rootDir,
                stdio: 'inherit',
                shell: true,
                detached: false
            });
        } else if (choice === '2') {
            console.log('Starting bot in debug mode...');
            spawn('npm', ['run', 'dev'], {
                cwd: this.rootDir,
                stdio: 'inherit',
                shell: true,
                detached: false
            });
        }
    }

    async run() {
        while (true) {
            this.printHeader();
            this.printMenu();
            
            const choice = await this.promptUser('Select option');
            
            switch(choice) {
                case '1':
                    await this.systemHealthCheck();
                    break;
                case '2':
                    await this.generatePrompt();
                    break;
                case '3':
                    await this.wifiTools();
                    break;
                case '4':
                    await this.databaseTools();
                    break;
                case '5':
                    await this.viewLogs();
                    break;
                case '6':
                    await this.runTests();
                    break;
                case '7':
                    await this.fixCommonIssues();
                    break;
                case '8':
                    await this.viewDocumentation();
                    break;
                case '9':
                    await this.startBot();
                    break;
                case '0':
                    console.log(`\n${colors.green}Goodbye!${colors.reset}`);
                    this.rl.close();
                    process.exit(0);
                default:
                    console.log(`${colors.red}Invalid option${colors.reset}`);
                    await this.promptUser('Press Enter to continue...');
            }
        }
    }
}

// Start Command Center
const center = new CommandCenter();
center.run().catch(error => {
    console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
    process.exit(1);
});
