const fs = require('fs');
const path = require('path');

const templatesPath = path.join(__dirname, '../database/wifi_templates.json');
let wifiTemplates = [];

// Function to load or reload templates from the JSON file
function loadWifiTemplates() {
    try {
        const templatesData = fs.readFileSync(templatesPath, 'utf8');
        wifiTemplates = JSON.parse(templatesData);
        // Templates loaded silently
    } catch (error) {
        console.error('[WiFi_Template_Handler] Error loading wifi_templates.json:', error);
        wifiTemplates = [];
    }
}

// Initial load of the templates
loadWifiTemplates();

// Watch for changes in the template file and reload it automatically
// Skip watching in test environment to prevent stuck processes
if (process.env.NODE_ENV !== 'test' && process.env.DISABLE_FILE_WATCHERS !== 'true') {
    fs.watchFile(templatesPath, (curr, prev) => {
        // Templates reloaded silently
        loadWifiTemplates();
    });
}

/**
 * Checks a user's message against a list of keywords to determine an intent.
 * @param {string} message - The incoming message text from the user.
 * @returns {object|null} Object with intent and matchedKeywordLength, or null if no match.
 */
function getIntentFromKeywords(message) {
    if (!message || message.trim() === '') {
        return null;
    }

    const lowerCaseMessage = message.toLowerCase().trim();
    let bestMatch = null;
    let longestKeywordLength = 0;

    // PHASE 2: Sort templates by longest keyword first (more specific templates checked first)
    // This ensures that templates with longer, more specific keywords are checked before generic ones
    const sortedTemplates = wifiTemplates.map(template => {
        // Calculate max keyword length for this template
        const maxKeywordLength = Math.max(
            ...template.keywords.map(keyword => keyword.trim().split(/\s+/).length),
            0
        );
        return {
            ...template,
            maxKeywordLength
        };
    }).sort((a, b) => {
        // Sort by max keyword length (longest first), then by template order as tiebreaker
        if (b.maxKeywordLength !== a.maxKeywordLength) {
            return b.maxKeywordLength - a.maxKeywordLength;
        }
        // If same length, maintain original order (first in array = higher priority)
        return 0;
    });

    // Collect all possible matches first
    for (const template of sortedTemplates) {
        // PHASE 2: Sort keywords within template by length (longest first)
        // This ensures longer, more specific keywords are checked before shorter ones
        const sortedKeywords = [...template.keywords].sort((a, b) => {
            const aWords = a.trim().split(/\s+/).length;
            const bWords = b.trim().split(/\s+/).length;
            return bWords - aWords; // Longest first
        });

        for (const keyword of sortedKeywords) {
            // CRITICAL: Only match keywords at START of message to prevent false positives
            // Example: "masmau konsultasi tentang topup" should NOT match "topup"
            // Only "topup 50000" or "topup" at start should match
            const escapedKeyword = keyword.toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const keywordRegex = new RegExp(`^${escapedKeyword}(?:\\s|$)`, 'i');
            
            if (keywordRegex.test(lowerCaseMessage)) {
                // Hitung jumlah kata dalam keyword yang cocok
                const matchedKeywordLength = keyword.trim().split(/\s+/).length;
                
                // Prioritize longer keywords (more specific matches)
                // Since we're already sorted, first match is likely the longest
                // But we still check all templates to ensure we get the absolute longest match
                if (matchedKeywordLength > longestKeywordLength) {
                    longestKeywordLength = matchedKeywordLength;
                    bestMatch = {
                        intent: template.intent,
                        matchedKeywordLength: matchedKeywordLength,
                        matchedKeyword: keyword
                    };
                    // Continue checking to ensure we have the absolute longest match
                    // (Even though sorted, we want to be thorough)
                }
            }
        }
    }

    // Return the best match (longest keyword)
    return bestMatch;
}

module.exports = {
    getIntentFromKeywords,
    loadWifiTemplates // Export function untuk manual reload
};
