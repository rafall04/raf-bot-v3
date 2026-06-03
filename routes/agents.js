const express = require('express');
const router = express.Router();
const agentManager = require('../lib/agent-manager');
const agentTransactionManager = require('../lib/agent-transaction-manager');
const { logger } = require('../lib/logger');

// Middleware to check if user is logged in (JWT-based)
function isAuthenticated(req, res, next) {
    if (req.user) {
        return next();
    }
    res.status(401).json({ success: false, message: 'Unauthorized' });
}

// Get all agents
router.get('/list', isAuthenticated, (req, res) => {
    try {
        const activeOnly = req.query.active !== 'false';
        const agents = agentManager.getAllAgents(activeOnly);
        res.json({ success: true, data: agents });
    } catch (error) {
        logger.error('Error getting agents:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get agent by ID
router.get('/detail/:id', isAuthenticated, (req, res) => {
    try {
        const agent = agentManager.getAgentById(req.params.id);
        if (!agent) {
            return res.status(404).json({ success: false, message: 'Agent not found' });
        }
        res.json({ success: true, data: agent });
    } catch (error) {
        logger.error('Error getting agent detail:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Validate phone number format (server-side)
function validatePhoneNumber(phone) {
    if (!phone || typeof phone !== 'string' || phone.trim() === '') {
        return { valid: false, message: 'Nomor telepon tidak boleh kosong' };
    }
    
    // Remove spaces, dashes, parentheses
    const cleaned = phone.replace(/[\s\-\(\)]/g, '');
    
    // Check if contains only digits and optional + at start
    if (!/^\+?[0-9]+$/.test(cleaned)) {
        return { valid: false, message: 'Nomor telepon hanya boleh berisi angka' };
    }
    
    // Check length (minimum 10 digits, maximum 15 digits for international)
    const digits = cleaned.replace(/^\+/, '');
    if (digits.length < 10 || digits.length > 15) {
        return { valid: false, message: 'Nomor telepon harus 10-15 digit' };
    }
    
    return { valid: true, message: 'OK', normalized: cleaned };
}

// Validate coordinates (server-side)
function validateCoordinates(location) {
    if (!location) return { valid: true, message: 'OK' }; // Optional
    
    const lat = location.lat;
    const lng = location.lng;
    
    if (lat === undefined || lng === undefined) {
        return { valid: false, message: 'Koordinat harus memiliki latitude dan longitude' };
    }
    
    const latNum = typeof lat === 'number' ? lat : parseFloat(lat);
    const lngNum = typeof lng === 'number' ? lng : parseFloat(lng);
    
    if (isNaN(latNum) || isNaN(lngNum)) {
        return { valid: false, message: 'Koordinat harus berupa angka' };
    }
    
    if (latNum < -90 || latNum > 90) {
        return { valid: false, message: 'Latitude harus antara -90 sampai 90' };
    }
    
    if (lngNum < -180 || lngNum > 180) {
        return { valid: false, message: 'Longitude harus antara -180 sampai 180' };
    }
    
    return { valid: true, message: 'OK', lat: latNum, lng: lngNum };
}

// Add new agent
router.post('/add', isAuthenticated, (req, res) => {
    try {
        const { name, phone, address, area, services, operational_hours, location } = req.body;
        
        // Validate required fields
        if (!name || !phone || !address || !area) {
            return res.status(400).json({ 
                success: false, 
                message: 'Name, phone, address, and area are required' 
            });
        }
        
        // Validate phone number
        const phoneValidation = validatePhoneNumber(phone);
        if (!phoneValidation.valid) {
            return res.status(400).json({
                success: false,
                message: phoneValidation.message
            });
        }
        
        // Validate coordinates if provided
        const coordValidation = validateCoordinates(location);
        if (!coordValidation.valid) {
            return res.status(400).json({
                success: false,
                message: coordValidation.message
            });
        }
        
        // Prepare location data
        let locationData = null;
        if (location && coordValidation.valid) {
            locationData = {
                lat: coordValidation.lat,
                lng: coordValidation.lng
            };
        }
        
        const result = agentManager.addAgent({
            name: name.trim(),
            phone: phoneValidation.normalized,
            address: address.trim(),
            area: area.trim(),
            services: services || ['topup', 'voucher'],
            operational_hours: operational_hours || '08:00 - 20:00',
            location: locationData
        });
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.message
            });
        }
        
        logger.info('New agent added:', result.agent.id);
        res.json({ success: true, data: result.agent });
    } catch (error) {
        logger.error('Error adding agent:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Update agent
router.put('/update/:id', isAuthenticated, (req, res) => {
    try {
        const agentId = req.params.id;
        const updates = { ...req.body };
        
        // Validate phone number if provided
        if (updates.phone) {
            const phoneValidation = validatePhoneNumber(updates.phone);
            if (!phoneValidation.valid) {
                return res.status(400).json({
                    success: false,
                    message: phoneValidation.message
                });
            }
            updates.phone = phoneValidation.normalized;
        }
        
        // Validate coordinates if provided
        if (updates.location) {
            const coordValidation = validateCoordinates(updates.location);
            if (!coordValidation.valid) {
                return res.status(400).json({
                    success: false,
                    message: coordValidation.message
                });
            }
            updates.location = {
                lat: coordValidation.lat,
                lng: coordValidation.lng
            };
        }
        
        // Trim string fields
        if (updates.name) updates.name = updates.name.trim();
        if (updates.address) updates.address = updates.address.trim();
        if (updates.area) updates.area = updates.area.trim();
        
        const result = agentManager.updateAgent(agentId, updates);
        if (!result || !result.success) {
            return res.status(404).json({ 
                success: false, 
                message: result?.message || 'Agent not found' 
            });
        }
        
        logger.info('Agent updated:', agentId);
        res.json({ success: true, data: result.agent });
    } catch (error) {
        logger.error('Error updating agent:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Deactivate agent
router.delete('/delete/:id', isAuthenticated, (req, res) => {
    try {
        const agentId = req.params.id;
        const success = agentManager.deactivateAgent(agentId);
        
        if (!success) {
            return res.status(404).json({ success: false, message: 'Agent not found' });
        }
        
        logger.info('Agent deactivated:', agentId);
        res.json({ success: true, message: 'Agent deactivated successfully' });
    } catch (error) {
        logger.error('Error deactivating agent:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get agents by area
router.get('/area/:area', isAuthenticated, (req, res) => {
    try {
        const agents = agentManager.getAgentsByArea(req.params.area);
        res.json({ success: true, data: agents });
    } catch (error) {
        logger.error('Error getting agents by area:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get agent statistics
router.get('/statistics', isAuthenticated, (req, res) => {
    try {
        const stats = agentManager.getAgentStatistics();
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Error getting agent statistics:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Validate PIN format
function validatePin(pin) {
    if (!pin || typeof pin !== 'string' || pin.trim() === '') {
        return { valid: false, message: 'PIN tidak boleh kosong' };
    }
    
    // Check if contains only digits
    if (!/^[0-9]+$/.test(pin)) {
        return { valid: false, message: 'PIN hanya boleh berisi angka' };
    }
    
    // Check length (minimum 4 digits, maximum 6 digits)
    if (pin.length < 4 || pin.length > 6) {
        return { valid: false, message: 'PIN harus 4-6 digit' };
    }
    
    return { valid: true, message: 'OK' };
}

// Get agent PIN status
router.get('/:id/pin/status', isAuthenticated, async (req, res) => {
    try {
        const agentId = req.params.id;
        
        // Check if agent exists
        const agent = agentManager.getAgentById(agentId);
        if (!agent) {
            return res.status(404).json({ 
                success: false, 
                message: 'Agent not found' 
            });
        }
        
        const status = agentTransactionManager.getAgentPinStatus(agentId);
        res.json(status);
    } catch (error) {
        logger.error('Error getting agent PIN status:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Create agent PIN (admin only)
router.post('/:id/pin/create', isAuthenticated, async (req, res) => {
    try {
        const agentId = req.params.id;
        const { pin, whatsappNumber } = req.body;
        
        // Check if agent exists
        const agent = agentManager.getAgentById(agentId);
        if (!agent) {
            return res.status(404).json({ 
                success: false, 
                message: 'Agent not found' 
            });
        }
        
        // Validate PIN
        const pinValidation = validatePin(pin);
        if (!pinValidation.valid) {
            return res.status(400).json({
                success: false,
                message: pinValidation.message
            });
        }
        
        // Use provided WhatsApp number or agent's phone number
        const whatsappNum = whatsappNumber || agent.phone;
        if (!whatsappNum) {
            return res.status(400).json({
                success: false,
                message: 'WhatsApp number is required'
            });
        }
        
        // Check if agent already has PIN
        const existingStatus = agentTransactionManager.getAgentPinStatus(agentId);
        if (existingStatus.hasPin) {
            return res.status(400).json({
                success: false,
                message: 'Agent sudah memiliki PIN. Gunakan reset PIN untuk mengganti.'
            });
        }
        
        // Create PIN
        const result = await agentTransactionManager.registerAgentCredentials(
            agentId,
            whatsappNum,
            pin
        );
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.message
            });
        }
        
        logger.info('Agent PIN created by admin:', agentId);
        res.json({ 
            success: true, 
            message: 'PIN berhasil dibuat',
            data: {
                agentId: agentId,
                hasPin: true
            }
        });
    } catch (error) {
        logger.error('Error creating agent PIN:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Reset agent PIN (admin only - no old PIN required)
router.put('/:id/pin/reset', isAuthenticated, async (req, res) => {
    try {
        const agentId = req.params.id;
        const { pin } = req.body;
        
        // Check if agent exists
        const agent = agentManager.getAgentById(agentId);
        if (!agent) {
            return res.status(404).json({ 
                success: false, 
                message: 'Agent not found' 
            });
        }
        
        // Validate PIN
        const pinValidation = validatePin(pin);
        if (!pinValidation.valid) {
            return res.status(400).json({
                success: false,
                message: pinValidation.message
            });
        }
        
        // Check if agent has PIN
        const existingStatus = agentTransactionManager.getAgentPinStatus(agentId);
        if (!existingStatus.hasPin) {
            return res.status(400).json({
                success: false,
                message: 'Agent belum memiliki PIN. Gunakan create PIN untuk membuat PIN baru.'
            });
        }
        
        // Reset PIN
        const result = await agentTransactionManager.resetAgentPin(agentId, pin);
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.message
            });
        }
        
        logger.info('Agent PIN reset by admin:', agentId);
        res.json({ 
            success: true, 
            message: 'PIN berhasil direset'
        });
    } catch (error) {
        logger.error('Error resetting agent PIN:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Change agent PIN (requires old PIN)
router.put('/:id/pin/change', isAuthenticated, async (req, res) => {
    try {
        const agentId = req.params.id;
        const { oldPin, newPin, whatsappNumber } = req.body;
        
        // Check if agent exists
        const agent = agentManager.getAgentById(agentId);
        if (!agent) {
            return res.status(404).json({ 
                success: false, 
                message: 'Agent not found' 
            });
        }
        
        // Validate old PIN
        if (!oldPin) {
            return res.status(400).json({
                success: false,
                message: 'PIN lama wajib diisi'
            });
        }
        
        // Validate new PIN
        const pinValidation = validatePin(newPin);
        if (!pinValidation.valid) {
            return res.status(400).json({
                success: false,
                message: pinValidation.message
            });
        }
        
        // Use provided WhatsApp number or agent's phone number
        const whatsappNum = whatsappNumber || agent.phone;
        if (!whatsappNum) {
            return res.status(400).json({
                success: false,
                message: 'WhatsApp number is required'
            });
        }
        
        // Change PIN
        const result = await agentTransactionManager.updateAgentPin(
            agentId,
            whatsappNum,
            oldPin,
            newPin
        );
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.message
            });
        }
        
        logger.info('Agent PIN changed:', agentId);
        res.json({ 
            success: true, 
            message: 'PIN berhasil diubah'
        });
    } catch (error) {
        logger.error('Error changing agent PIN:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
