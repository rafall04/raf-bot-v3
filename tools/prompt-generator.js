#!/usr/bin/env node

/**
 * AI Prompt Generator Tool
 * Converts simple prompts into detailed, structured prompts
 * 
 * Usage: node tools/prompt-generator.js "simple prompt"
 * Example: node tools/prompt-generator.js "fix wifi log"
 */

const fs = require('fs');
const path = require('path');

class PromptGenerator {
    constructor() {
        this.rootDir = path.join(__dirname, '..');
        this.templates = this.loadTemplates();
    }

    loadTemplates() {
        return {
            fix: {
                keywords: ['fix', 'perbaiki', 'repair', 'solve', 'debug'],
                template: `# 🔧 FIX REQUEST: {ISSUE}

## 📋 PREREQUISITES
1. Read AI_MAINTENANCE_GUIDE.md for system architecture
2. Check existing error logs and patterns
3. Understand the module dependencies

## 🔴 PROBLEM STATEMENT
{PROBLEM_DETAIL}

## 📊 CURRENT BEHAVIOR
- **What happens:** {CURRENT}
- **Expected behavior:** {EXPECTED}
- **Error messages:** {ERRORS}

## 🔍 INVESTIGATION STEPS
1. Locate the affected files
2. Check for common patterns
3. Review recent changes
4. Test related functionality

## ✅ SOLUTION REQUIREMENTS
1. Fix must not break existing functionality
2. Follow existing code patterns
3. Add proper error handling
4. Update documentation if needed

## 📁 FILES TO CHECK
{FILES}

## 🧪 TESTING
After fix, test with:
{TEST_COMMANDS}

## ⚠️ IMPORTANT
- Make atomic commits
- Test each change
- Update AI_MAINTENANCE_GUIDE.md if architecture changes`
            },
            
            create: {
                keywords: ['create', 'buat', 'add', 'tambah', 'new'],
                template: `# ✨ CREATE REQUEST: {FEATURE}

## 📋 PREREQUISITES
1. Understand existing system architecture
2. Check for similar implementations
3. Follow project conventions

## 🎯 OBJECTIVE
{OBJECTIVE}

## 📊 REQUIREMENTS
### Functional Requirements:
{FUNCTIONAL}

### Technical Requirements:
{TECHNICAL}

## 🏗️ IMPLEMENTATION PLAN
1. Create necessary files
2. Add required functions
3. Integrate with existing system
4. Add error handling
5. Create tests

## 📁 FILES TO CREATE/MODIFY
{FILES}

## 🔗 INTEGRATION POINTS
{INTEGRATION}

## 🧪 ACCEPTANCE CRITERIA
{CRITERIA}

## 📝 DOCUMENTATION
Update these docs:
- AI_MAINTENANCE_GUIDE.md
- README.md (if needed)
- Add inline comments`
            },
            
            analyze: {
                keywords: ['analyze', 'analisis', 'check', 'review', 'audit'],
                template: `# 🔍 ANALYSIS REQUEST: {TOPIC}

## 📋 SCOPE
{SCOPE}

## 🎯 OBJECTIVES
1. Understand current implementation
2. Identify issues and bottlenecks
3. Find improvement opportunities
4. Document findings

## 📊 AREAS TO ANALYZE
{AREAS}

## 🔍 ANALYSIS METHODOLOGY
1. Code review
2. Performance testing
3. Error log analysis
4. Dependency check
5. Security audit

## 📁 FILES TO EXAMINE
{FILES}

## 🔴 KNOWN ISSUES
{ISSUES}

## 📈 METRICS TO COLLECT
{METRICS}

## 📝 DELIVERABLES
1. Analysis report
2. Issue list with priorities
3. Recommendations
4. Implementation roadmap`
            },
            
            optimize: {
                keywords: ['optimize', 'improve', 'enhance', 'refactor'],
                template: `# ⚡ OPTIMIZATION REQUEST: {TARGET}

## 📋 CURRENT STATE
{CURRENT_STATE}

## 🎯 OPTIMIZATION GOALS
{GOALS}

## 📊 PERFORMANCE METRICS
### Before:
{METRICS_BEFORE}

### Target:
{METRICS_TARGET}

## 🔧 OPTIMIZATION STRATEGIES
{STRATEGIES}

## 📁 FILES TO OPTIMIZE
{FILES}

## ⚠️ CONSTRAINTS
{CONSTRAINTS}

## 🧪 TESTING PLAN
{TESTING}

## 📈 SUCCESS CRITERIA
{SUCCESS}`
            }
        };
    }

    detectIntent(prompt) {
        const lowerPrompt = prompt.toLowerCase();
        
        for (const [intent, config] of Object.entries(this.templates)) {
            for (const keyword of config.keywords) {
                if (lowerPrompt.includes(keyword)) {
                    return intent;
                }
            }
        }
        
        return 'fix'; // Default to fix
    }

    analyzeContext(prompt) {
        const context = {
            isWiFi: /wifi|ssid|password|sandi|nama wifi/i.test(prompt),
            isDatabase: /database|db|sqlite|users/i.test(prompt),
            isLogging: /log|logging|history|riwayat/i.test(prompt),
            isHandler: /handler|state|conversation/i.test(prompt),
            isError: /error|bug|crash|tidak berfungsi|not working/i.test(prompt),
            isUI: /ui|interface|tampilan|view|admin/i.test(prompt)
        };
        
        return context;
    }

    suggestFiles(prompt, context) {
        const files = [];
        
        if (context.isWiFi) {
            files.push(
                'message/handlers/wifi-management-handler.js',
                'message/handlers/states/wifi-name-state-handler.js',
                'message/handlers/states/wifi-password-state-handler.js',
                'lib/wifi.js',
                'lib/wifi-logger.js'
            );
        }
        
        if (context.isDatabase) {
            files.push(
                'lib/database.js',
                'database/database.sqlite',
                'database/accounts.json'
            );
        }
        
        if (context.isLogging) {
            files.push(
                'lib/wifi-logger.js',
                'database/wifi_change_logs.json',
                'message/handlers/wifi-history-handler.js'
            );
        }
        
        if (context.isHandler) {
            files.push(
                'message/handlers/conversation-state-handler.js',
                'message/raf.js'
            );
        }
        
        return files.length > 0 ? files : ['Check relevant files based on the issue'];
    }

    generateDetailedPrompt(simplePrompt) {
        const intent = this.detectIntent(simplePrompt);
        const context = this.analyzeContext(simplePrompt);
        const template = this.templates[intent].template;
        const files = this.suggestFiles(simplePrompt, context);
        
        // Parse the simple prompt for key information
        const issue = simplePrompt;
        
        // Build detailed prompt based on template
        let detailedPrompt = template
            .replace('{ISSUE}', issue.toUpperCase())
            .replace('{FEATURE}', issue.toUpperCase())
            .replace('{TOPIC}', issue.toUpperCase())
            .replace('{TARGET}', issue.toUpperCase());
        
        // Add context-specific details
        if (intent === 'fix') {
            detailedPrompt = detailedPrompt
                .replace('{PROBLEM_DETAIL}', this.generateProblemDetail(simplePrompt, context))
                .replace('{CURRENT}', 'Describe what currently happens')
                .replace('{EXPECTED}', 'Describe what should happen')
                .replace('{ERRORS}', 'Include any error messages')
                .replace('{FILES}', files.map(f => `- ${f}`).join('\n'))
                .replace('{TEST_COMMANDS}', this.generateTestCommands(context));
        }
        
        return detailedPrompt;
    }

    generateProblemDetail(prompt, context) {
        let detail = `The user reports an issue with: ${prompt}\n\n`;
        
        detail += 'Context Analysis:\n';
        if (context.isWiFi) detail += '- WiFi subsystem involved\n';
        if (context.isDatabase) detail += '- Database operations involved\n';
        if (context.isLogging) detail += '- Logging system involved\n';
        if (context.isError) detail += '- System error or bug reported\n';
        
        detail += '\nPossible causes:\n';
        detail += '1. Code logic error\n';
        detail += '2. Missing or incorrect imports\n';
        detail += '3. Data structure mismatch\n';
        detail += '4. Async/await issues\n';
        detail += '5. Configuration problems\n';
        
        return detail;
    }

    generateTestCommands(context) {
        const commands = [];
        
        if (context.isWiFi) {
            commands.push(
                '1. Test: "ganti nama TestWiFi"',
                '2. Test: "ganti password Test1234"',
                '3. Test: "history wifi"',
                '4. Check logs in database/wifi_change_logs.json'
            );
        }
        
        if (context.isDatabase) {
            commands.push(
                '1. Run: node test/test-sqlite-users.js',
                '2. Check database.sqlite integrity',
                '3. Verify user records'
            );
        }
        
        return commands.length > 0 ? commands.join('\n') : '1. Create appropriate test cases\n2. Run system health check';
    }

    savePrompt(prompt, filename) {
        const outputDir = path.join(this.rootDir, 'prompts');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir);
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outputFile = filename || `prompt_${timestamp}.md`;
        const outputPath = path.join(outputDir, outputFile);
        
        fs.writeFileSync(outputPath, prompt);
        return outputPath;
    }
}

// Interactive mode
async function interactiveMode() {
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    const generator = new PromptGenerator();
    
    console.log('\n🤖 AI PROMPT GENERATOR');
    console.log('=' .repeat(50));
    console.log('Enter simple prompt (or "exit" to quit):\n');
    
    rl.on('line', (input) => {
        if (input.toLowerCase() === 'exit') {
            console.log('Goodbye!');
            rl.close();
            process.exit(0);
        }
        
        console.log('\n📝 Generating detailed prompt...\n');
        
        const detailedPrompt = generator.generateDetailedPrompt(input);
        const savedPath = generator.savePrompt(detailedPrompt);
        
        console.log('=' .repeat(70));
        console.log(detailedPrompt);
        console.log('=' .repeat(70));
        console.log(`\n✅ Prompt saved to: ${savedPath}`);
        console.log('\nEnter another prompt (or "exit" to quit):\n');
    });
}

// CLI mode
function cliMode(args) {
    if (args.length === 0) {
        console.log('Usage: node prompt-generator.js "your simple prompt"');
        console.log('Or run without arguments for interactive mode');
        interactiveMode();
        return;
    }
    
    const generator = new PromptGenerator();
    const simplePrompt = args.join(' ');
    
    console.log('\n📝 Simple Prompt:', simplePrompt);
    console.log('\n✨ Generating detailed prompt...\n');
    
    const detailedPrompt = generator.generateDetailedPrompt(simplePrompt);
    const savedPath = generator.savePrompt(detailedPrompt);
    
    console.log('=' .repeat(70));
    console.log(detailedPrompt);
    console.log('=' .repeat(70));
    console.log(`\n✅ Prompt saved to: ${savedPath}`);
}

// Main execution
const args = process.argv.slice(2);
cliMode(args);
