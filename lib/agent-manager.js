"use strict";

/**
 * Agent Manager
 * Manages agent/outlet data for topup and voucher sales
 */

const fs = require('fs');
const path = require('path');

// Database paths
const AGENTS_DB = path.join(__dirname, '../database/agents.json');

// Load data
let agents = [];

// Initialize database
function initDatabase() {
    try {
        // Load agents
        if (fs.existsSync(AGENTS_DB)) {
            agents = JSON.parse(fs.readFileSync(AGENTS_DB, 'utf8'));
        } else {
            fs.writeFileSync(AGENTS_DB, '[]');
        }
    } catch (error) {
        console.error('Error initializing agent database:', error);
    }
}

// Save agents
function saveAgents() {
    fs.writeFileSync(AGENTS_DB, JSON.stringify(agents, null, 2));
}

// Get all agents
function getAllAgents(activeOnly = true) {
    if (activeOnly) {
        return agents.filter(a => a.active);
    }
    return agents;
}

// Get agents by area
function getAgentsByArea(area) {
    return agents.filter(a => 
        a.active && 
        a.area && 
        a.area.toLowerCase().includes(area.toLowerCase())
    );
}

// Get agent by ID
function getAgentById(agentId) {
    return agents.find(a => a.id === agentId);
}

// Get agents by service
function getAgentsByService(service) {
    return agents.filter(a => 
        a.active && 
        a.services && 
        a.services.includes(service)
    );
}

// Normalize phone number for comparison
function normalizePhoneForComparison(phone) {
    if (!phone) return '';
    // Remove spaces, dashes, parentheses, and + sign
    return phone.replace(/[\s\-\(\)\+]/g, '');
}

// Check if phone number already exists (case-insensitive, normalized)
function isPhoneNumberExists(phone, excludeAgentId = null) {
    const normalized = normalizePhoneForComparison(phone);
    if (!normalized) return false;
    
    return agents.some(agent => {
        if (excludeAgentId && agent.id === excludeAgentId) return false;
        const agentNormalized = normalizePhoneForComparison(agent.phone);
        return agentNormalized === normalized;
    });
}

// Add new agent
function addAgent(agentData) {
    // Check for duplicate phone number
    if (isPhoneNumberExists(agentData.phone)) {
        return {
            success: false,
            message: `Nomor telepon ${agentData.phone} sudah terdaftar untuk agent lain`
        };
    }
    
    const newAgent = {
        id: `AGT${Date.now().toString().slice(-6)}`,
        name: agentData.name,
        phone: agentData.phone,
        address: agentData.address,
        area: agentData.area,
        services: agentData.services || ['topup', 'voucher'],
        operational_hours: agentData.operational_hours || '08:00 - 20:00',
        location: agentData.location || null,
        active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    
    agents.push(newAgent);
    saveAgents();
    return {
        success: true,
        agent: newAgent
    };
}

// Update agent
function updateAgent(agentId, updates) {
    const index = agents.findIndex(a => a.id === agentId);
    if (index === -1) {
        return {
            success: false,
            message: 'Agent not found'
        };
    }
    
    // Check for duplicate phone number if phone is being updated
    if (updates.phone && isPhoneNumberExists(updates.phone, agentId)) {
        return {
            success: false,
            message: `Nomor telepon ${updates.phone} sudah terdaftar untuk agent lain`
        };
    }
    
    agents[index] = {
        ...agents[index],
        ...updates,
        updated_at: new Date().toISOString()
    };
    
    saveAgents();
    return {
        success: true,
        agent: agents[index]
    };
}

// Delete/deactivate agent
function deactivateAgent(agentId) {
    const index = agents.findIndex(a => a.id === agentId);
    if (index === -1) return false;
    
    agents[index].active = false;
    agents[index].updated_at = new Date().toISOString();
    
    saveAgents();
    return true;
}

// Format agent info for WhatsApp
function formatAgentInfo(agent, includeServices = true, includeId = false) {
    let info = `📍 *${agent.name}*\n`;
    if (includeId) {
        info += `🆔 ID: ${agent.id}\n`;
    }
    info += `📱 Telp: ${agent.phone}\n`;
    info += `🏠 Alamat: ${agent.address}\n`;
    info += `🌍 Area: ${agent.area}\n`;
    info += `⏰ Jam Buka: ${agent.operational_hours}`;
    
    if (includeServices && agent.services) {
        info += `\n📦 Layanan: ${agent.services.map(s => {
            switch(s) {
                case 'topup': return 'Topup Saldo';
                case 'voucher': return 'Jual Voucher';
                case 'pembayaran': return 'Terima Pembayaran';
                default: return s;
            }
        }).join(', ')}`;
    }
    
    return info;
}

// Format agent list for WhatsApp
function formatAgentList(agentList, title = 'DAFTAR AGENT') {
    if (!agentList || agentList.length === 0) {
        return '❌ Tidak ada agent yang tersedia di area ini.';
    }
    
    let message = `📋 *${title}*\n`;
    message += `_Total: ${agentList.length} agent_\n\n`;
    
    agentList.forEach((agent, index) => {
        message += `${index + 1}. ${formatAgentInfo(agent, true, true)}\n\n`;
    });
    
    message += `💡 _Ketik *detail agent [ID]* untuk info lengkap_\n`;
    message += `📍 _Contoh: detail agent ${agentList[0]?.id || 'AGT001'}_`;
    
    return message;
}

/**
 * Calculate distance between two coordinates using Haversine formula
 * Returns distance in kilometers
 */
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth's radius in kilometers
    
    // Convert degrees to radians
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    
    // Haversine formula
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    
    return distance;
}

// Get nearest agents (using Haversine formula for accurate distance)
function getNearestAgents(lat, lng, limit = 3) {
    // Validate coordinates
    if (typeof lat !== 'number' || typeof lng !== 'number' || 
        isNaN(lat) || isNaN(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return [];
    }
    
    const agentsWithDistance = agents
        .filter(a => {
            // Filter active agents with valid location
            if (!a.active || !a.location) return false;
            
            // Validate agent coordinates
            const agentLat = a.location.lat;
            const agentLng = a.location.lng;
            if (typeof agentLat !== 'number' || typeof agentLng !== 'number' ||
                isNaN(agentLat) || isNaN(agentLng) ||
                agentLat < -90 || agentLat > 90 || agentLng < -180 || agentLng > 180) {
                return false;
            }
            
            return true;
        })
        .map(agent => {
            // Calculate distance using Haversine formula (in kilometers)
            const distance = calculateDistance(
                lat, lng,
                agent.location.lat, agent.location.lng
            );
            return { ...agent, distance };
        })
        .sort((a, b) => a.distance - b.distance);
    
    return agentsWithDistance.slice(0, limit);
}

// Search agents
function searchAgents(query) {
    const lowerQuery = query.toLowerCase();
    return agents.filter(a => 
        a.active && (
            a.name.toLowerCase().includes(lowerQuery) ||
            a.area.toLowerCase().includes(lowerQuery) ||
            a.address.toLowerCase().includes(lowerQuery)
        )
    );
}

// Get statistics
function getAgentStatistics() {
    const total = agents.length;
    const active = agents.filter(a => a.active).length;
    const byArea = {};
    const byService = {};
    
    agents.forEach(agent => {
        if (agent.active) {
            // Count by area
            if (agent.area) {
                byArea[agent.area] = (byArea[agent.area] || 0) + 1;
            }
            
            // Count by service
            if (agent.services) {
                agent.services.forEach(service => {
                    byService[service] = (byService[service] || 0) + 1;
                });
            }
        }
    });
    
    return {
        total,
        active,
        inactive: total - active,
        byArea,
        byService
    };
}

// Normalize WhatsApp number to phone number for matching
function normalizeWhatsappToPhone(whatsappNumber) {
    if (!whatsappNumber) return null;
    
    // Remove @s.whatsapp.net or @lid suffix
    let phone = whatsappNumber.split('@')[0];
    
    // Remove non-digit characters
    phone = phone.replace(/\D/g, '');
    
    // Normalize to standard format (remove leading 62 if exists, keep as-is)
    // We'll try multiple formats for matching
    return {
        original: phone,
        with62: phone.startsWith('62') ? phone : `62${phone}`,
        without62: phone.startsWith('62') ? phone.substring(2) : phone,
        with0: phone.startsWith('62') ? `0${phone.substring(2)}` : (phone.startsWith('0') ? phone : `0${phone}`)
    };
}

// Get agent by WhatsApp number (for agent confirmation)
// FIXED: Now searches by phone number in agents.json as fallback if no credentials found
function getAgentByWhatsapp(whatsappNumber) {
    // Import agent transaction manager for credentials lookup
    const agentTransactionManager = require('./agent-transaction-manager');
    
    // First, try to get credentials from agent transaction manager
    const credentials = agentTransactionManager.getAgentByWhatsapp(whatsappNumber);
    
    if (credentials) {
        // Get full agent data
        const agent = getAgentById(credentials.agentId);
        
        if (agent) {
            // Return agent with credential info
            return {
                ...agent,
                whatsappNumber: credentials.whatsappNumber,
                isRegistered: true,
                hasCredentials: true,
                lastLogin: credentials.lastLogin
            };
        }
    }
    
    // FALLBACK: If no credentials found, search by phone number in agents.json
    // This allows agents to use commands even if they haven't registered PIN yet
    const normalized = normalizeWhatsappToPhone(whatsappNumber);
    
    if (!normalized) {
        return null;
    }
    
    // Try to find agent by matching phone number in various formats
    const agent = agents.find(a => {
        if (!a.phone || !a.active) return false;
        
        const agentPhoneNormalized = normalizePhoneForComparison(a.phone);
        
        // Try matching with different formats
        return agentPhoneNormalized === normalized.original ||
               agentPhoneNormalized === normalized.with62 ||
               agentPhoneNormalized === normalized.without62 ||
               agentPhoneNormalized === normalized.with0 ||
               normalizePhoneForComparison(normalized.original) === agentPhoneNormalized ||
               normalizePhoneForComparison(normalized.with62) === agentPhoneNormalized ||
               normalizePhoneForComparison(normalized.without62) === agentPhoneNormalized ||
               normalizePhoneForComparison(normalized.with0) === agentPhoneNormalized;
    });
    
    if (agent) {
        // Return agent without credentials (not registered with PIN yet)
        return {
            ...agent,
            whatsappNumber: whatsappNumber,
            isRegistered: false,
            hasCredentials: false,
            lastLogin: null
        };
    }
    
    return null;
}

// Check if agent is registered
function isAgentRegistered(agentId) {
    const agentTransactionManager = require('./agent-transaction-manager');
    const allCredentials = agentTransactionManager.getAllCredentials?.() || [];
    return allCredentials.some(c => c.agentId === agentId && c.active);
}

// Format agent list for selection (numbered list)
function formatAgentForSelection(agentList) {
    if (!agentList || agentList.length === 0) {
        return null;
    }
    
    let message = `📍 *PILIH AGENT*\n\n`;
    message += `Silakan pilih agent terdekat:\n\n`;
    
    agentList.forEach((agent, index) => {
        const icon = index === 0 ? '⭐' : '📍';
        
        message += `${index + 1}. ${icon} *${agent.name}*\n`;
        message += `   📍 ${agent.area}\n`;
        message += `   📱 ${agent.phone}\n`;
        message += `   🏠 ${agent.address}\n`;
        message += `   ⏰ ${agent.operational_hours}\n`;
        
        // Add operational status
        const status = checkAgentOperationalStatus(agent);
        message += `   ${status.isOpen ? '🟢 Buka sekarang' : '🔴 Tutup sekarang'}\n`;
        
        // Add Google Maps link if location available
        if (agent.location) {
            message += `   🗺️ Google Maps\n`;
        }
        
        message += `\n`;
    });
    
    message += `Balas dengan nomor agent pilihan Anda (1-${agentList.length})\n`;
    message += `Ketik *batal* untuk membatalkan`;
    
    return message;
}

// Check if agent is currently open
function checkAgentOperationalStatus(agent) {
    if (!agent.operational_hours) {
        return { isOpen: true, reason: 'No hours specified' };
    }
    
    try {
        // Parse operational hours (format: "08:00 - 20:00")
        const [start, end] = agent.operational_hours.split('-').map(t => t.trim());
        const [startHour, startMin] = start.split(':').map(Number);
        const [endHour, endMin] = end.split(':').map(Number);
        
        // Get current time in Indonesia timezone (WIB = UTC+7)
        // Use Asia/Jakarta timezone for accurate time
        const now = new Date();
        const indonesiaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
        const currentHour = indonesiaTime.getHours();
        const currentMin = indonesiaTime.getMinutes();
        const currentTime = currentHour * 60 + currentMin;
        
        // Calculate start and end in minutes
        const startTime = startHour * 60 + startMin;
        const endTime = endHour * 60 + endMin;
        
        const isOpen = currentTime >= startTime && currentTime <= endTime;
        
        return {
            isOpen,
            reason: isOpen ? 'Within operational hours' : 'Outside operational hours',
            openTime: start,
            closeTime: end,
            currentTime: `${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`,
            timezone: 'Asia/Jakarta (WIB)'
        };
    } catch (error) {
        // If parsing fails, assume open
        return { isOpen: true, reason: 'Parse error, assume open' };
    }
}

// Get all unique areas
function getAllAreas() {
    const areas = new Set();
    agents.forEach(agent => {
        if (agent.active && agent.area) {
            areas.add(agent.area);
        }
    });
    return Array.from(areas).sort();
}

// Get agent count by area
function getAgentCountByArea(area) {
    return agents.filter(a => 
        a.active && 
        a.area && 
        a.area.toLowerCase() === area.toLowerCase()
    ).length;
}

// Initialize on load
initDatabase();

module.exports = {
    // Agent management
    getAllAgents,
    getAgentsByArea,
    getAgentById,
    getAgentsByService,
    addAgent,
    updateAgent,
    deactivateAgent,
    
    // Search and filter
    searchAgents,
    getNearestAgents,
    getAllAreas,
    getAgentCountByArea,
    
    // Formatting
    formatAgentInfo,
    formatAgentList,
    formatAgentForSelection,
    
    // Agent credentials (for transaction system)
    getAgentByWhatsapp,
    isAgentRegistered,
    
    // Operational status
    checkAgentOperationalStatus,
    
    // Statistics
    getAgentStatistics,
    
    // Database
    saveAgents
};
