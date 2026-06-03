const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

class CommandManager {
    constructor() {
        this.commands = {};
        this.categories = {};
        this.settings = {};
        this.configPath = path.join(__dirname, '../config/commands.json');
        this.loadCommands();
        this.watchConfigFile();
    }

    /**
     * Load commands from config file
     */
    loadCommands() {
        try {
            const configData = fs.readFileSync(this.configPath, 'utf8');
            const config = JSON.parse(configData);
            
            this.commands = config.commands || {};
            this.categories = config.categories || {};
            this.settings = config.settings || {};
            
            // Build reverse lookup map for faster keyword matching
            this.keywordMap = {};
            for (const [cmdKey, cmd] of Object.entries(this.commands)) {
                if (cmd.keywords && Array.isArray(cmd.keywords)) {
                    for (const keyword of cmd.keywords) {
                        const normalizedKeyword = this.normalizeKeyword(keyword);
                        if (!this.keywordMap[normalizedKeyword]) {
                            this.keywordMap[normalizedKeyword] = [];
                        }
                        this.keywordMap[normalizedKeyword].push({
                            key: cmdKey,
                            intent: cmd.intent,
                            command: cmd,
                            originalKeyword: keyword
                        });
                    }
                }
            }
            
            logger.info('Commands loaded successfully', {
                totalCommands: Object.keys(this.commands).length,
                totalKeywords: Object.keys(this.keywordMap).length
            });
        } catch (error) {
            logger.error('Failed to load commands', error);
            // Use default minimal config if file doesn't exist
            this.commands = {};
            this.categories = {};
            this.settings = { caseSensitive: false };
        }
    }

    /**
     * Reload commands dengan retry mechanism untuk handle file yang masih dalam proses write
     * @param {number} retries - Jumlah retry yang tersisa
     * @param {number} delay - Delay dalam milliseconds sebelum retry
     */
    reloadCommandsWithRetry(retries = 3, delay = 100) {
        setTimeout(() => {
            try {
                this.loadCommands();
                logger.info('✅ Commands reloaded successfully');
            } catch (error) {
                // Jika error dan masih ada retry, coba lagi
                if (retries > 0) {
                    logger.warn(`⚠️ Error reloading commands (retry ${4 - retries}/3):`, error.message);
                    this.reloadCommandsWithRetry(retries - 1, delay * 2); // Exponential backoff
                } else {
                    logger.error('❌ Error reloading commands after 3 retries:', error.message);
                }
            }
        }, delay);
    }

    /**
     * Watch config file for changes dengan improved reliability
     * PERBAIKAN: Tambahkan delay dan retry mechanism untuk memastikan file sudah selesai ditulis
     * sebelum reload, karena fs.watchFile() di Windows mungkin tidak reliable
     */
    watchConfigFile() {
        // Skip watching in test environment to prevent stuck processes
        if (process.env.NODE_ENV === 'test' || process.env.DISABLE_FILE_WATCHERS === 'true') {
            return;
        }

        if (!fs.existsSync(this.configPath)) {
            logger.warn('⚠️ Commands config file tidak ditemukan, file watcher tidak aktif.');
            return;
        }

        let lastMtime = fs.statSync(this.configPath).mtime.getTime();
        
        fs.watchFile(this.configPath, { interval: 1000 }, (curr, prev) => {
            // Check jika file benar-benar berubah (mtime berbeda)
            const currMtime = curr.mtime ? curr.mtime.getTime() : 0;
            const prevMtime = prev.mtime ? prev.mtime.getTime() : 0;
            
            if (currMtime !== prevMtime && currMtime !== lastMtime) {
                lastMtime = currMtime;
                logger.info('🔄 Commands config file changed, reloading...');
                this.reloadCommandsWithRetry(3, 200);
            }
        });
        
        logger.info('✅ File watcher untuk commands.json aktif.');
    }

    /**
     * Normalize keyword for matching
     */
    normalizeKeyword(keyword) {
        if (!keyword) return '';
        let normalized = keyword.trim();
        if (!this.settings.caseSensitive) {
            normalized = normalized.toLowerCase();
        }
        return normalized;
    }

    /**
     * Get command intent from message
     * IMPORTANT: Only matches commands at START of message to prevent spam
     */
    getIntent(message, userRole = 'all') {
        if (!message || typeof message !== 'string') {
            return null;
        }

        const normalizedMessage = this.normalizeKeyword(message);
        let bestMatch = null;
        let longestMatchLength = 0;

        // Try exact match first
        if (this.keywordMap[normalizedMessage]) {
            const matches = this.keywordMap[normalizedMessage];
            for (const match of matches) {
                if (this.hasPermission(match.command, userRole)) {
                    return {
                        intent: match.intent,
                        command: match.command,
                        matchedKeyword: match.originalKeyword,
                        exactMatch: true
                    };
                }
            }
        }

        // Sort keywords by length (longest first) to prioritize multi-word commands
        // Example: "cek topup" should be checked before "topup"
        const sortedKeywords = Object.entries(this.keywordMap).sort((a, b) => {
            return b[0].length - a[0].length;
        });

        // Try partial matches (for multi-word keywords)
        // CRITICAL: Only match at START of message to prevent false positives
        for (const [keyword, matches] of sortedKeywords) {
            // Check if message STARTS with this keyword (followed by space or end of string)
            // This prevents "hari ini saya mau topup" from matching "topup"
            const regex = new RegExp(`^${this.escapeRegex(keyword)}(?:\\s|$)`, 'i');
            
            if (regex.test(normalizedMessage)) {
                const keywordLength = keyword.split(/\s+/).length;
                
                for (const match of matches) {
                    if (this.hasPermission(match.command, userRole) && keywordLength > longestMatchLength) {
                        longestMatchLength = keywordLength;
                        bestMatch = {
                            intent: match.intent,
                            command: match.command,
                            matchedKeyword: match.originalKeyword,
                            exactMatch: false
                        };
                    }
                }
                
                // If we found a match, return immediately (longest keyword wins)
                if (bestMatch) {
                    return bestMatch;
                }
            }
        }

        return bestMatch;
    }

    /**
     * Check if user has permission for command
     */
    hasPermission(command, userRole) {
        if (!command.roles || command.roles.length === 0) {
            return true;
        }
        
        if (command.roles.includes('all')) {
            return true;
        }

        // Map common role names
        const roleMap = {
            'customer': ['customer', 'pelanggan'],
            'teknisi': ['teknisi', 'technician'],
            'admin': ['admin', 'administrator'],
            'owner': ['owner', 'superadmin']
        };

        const normalizedRole = userRole.toLowerCase();
        
        for (const allowedRole of command.roles) {
            const allowedRoleLower = allowedRole.toLowerCase();
            if (allowedRoleLower === normalizedRole) {
                return true;
            }
            
            // Check role mappings
            for (const [key, aliases] of Object.entries(roleMap)) {
                if (aliases.includes(normalizedRole) && allowedRoleLower === key) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Get command by key
     */
    getCommand(key) {
        return this.commands[key] || null;
    }

    /**
     * Get commands by category
     */
    getCommandsByCategory(category) {
        const commands = [];
        for (const [key, cmd] of Object.entries(this.commands)) {
            if (cmd.category === category) {
                commands.push({ key, ...cmd });
            }
        }
        return commands;
    }

    /**
     * Get available commands for user role
     */
    getAvailableCommands(userRole) {
        const available = {};
        for (const [key, cmd] of Object.entries(this.commands)) {
            if (this.hasPermission(cmd, userRole)) {
                if (!available[cmd.category]) {
                    available[cmd.category] = [];
                }
                available[cmd.category].push({
                    key,
                    keywords: cmd.keywords,
                    description: cmd.description,
                    intent: cmd.intent
                });
            }
        }
        return available;
    }

    /**
     * Add or update command (for runtime modifications)
     */
    addCommand(key, command) {
        this.commands[key] = command;
        
        // Update keyword map
        if (command.keywords && Array.isArray(command.keywords)) {
            for (const keyword of command.keywords) {
                const normalizedKeyword = this.normalizeKeyword(keyword);
                if (!this.keywordMap[normalizedKeyword]) {
                    this.keywordMap[normalizedKeyword] = [];
                }
                
                // Remove existing entry for this key if exists
                this.keywordMap[normalizedKeyword] = this.keywordMap[normalizedKeyword].filter(
                    m => m.key !== key
                );
                
                // Add new entry
                this.keywordMap[normalizedKeyword].push({
                    key,
                    intent: command.intent,
                    command,
                    originalKeyword: keyword
                });
            }
        }
        
        logger.debug('Command added/updated', { key, intent: command.intent });
    }

    /**
     * Remove command
     */
    removeCommand(key) {
        const command = this.commands[key];
        if (!command) return false;

        // Remove from keyword map
        if (command.keywords) {
            for (const keyword of command.keywords) {
                const normalizedKeyword = this.normalizeKeyword(keyword);
                if (this.keywordMap[normalizedKeyword]) {
                    this.keywordMap[normalizedKeyword] = this.keywordMap[normalizedKeyword].filter(
                        m => m.key !== key
                    );
                    if (this.keywordMap[normalizedKeyword].length === 0) {
                        delete this.keywordMap[normalizedKeyword];
                    }
                }
            }
        }

        delete this.commands[key];
        logger.debug('Command removed', { key });
        return true;
    }

    /**
     * Save commands to config file
     */
    saveCommands() {
        try {
            const config = {
                commands: this.commands,
                categories: this.categories,
                settings: this.settings
            };
            
            fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf8');
            logger.info('Commands saved to config file');
            return true;
        } catch (error) {
            logger.error('Failed to save commands', error);
            return false;
        }
    }

    /**
     * Escape regex special characters
     */
    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Get category info
     */
    getCategory(categoryKey) {
        return this.categories[categoryKey] || null;
    }

    /**
     * Get all categories
     */
    getAllCategories() {
        return this.categories;
    }
}

// Create singleton instance
const commandManager = new CommandManager();

module.exports = commandManager;
