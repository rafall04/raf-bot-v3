/**
 * Simple Tracking Service using WhatsApp Location
 * 100% FREE Implementation
 */

const fs = require('fs');
const path = require('path');

class SimpleTrackingService {
    constructor() {
        this.trackingData = new Map();
        this.trackingFile = path.join(__dirname, '../database/tracking.json');
        this.loadTrackingData();
    }

    /**
     * Load existing tracking data from file
     */
    loadTrackingData() {
        try {
            if (fs.existsSync(this.trackingFile)) {
                const data = JSON.parse(fs.readFileSync(this.trackingFile, 'utf8'));
                this.trackingData = new Map(Object.entries(data));
            }
        } catch (error) {
            console.error('Error loading tracking data:', error);
        }
    }

    /**
     * Save tracking data to file
     */
    saveTrackingData() {
        try {
            const data = Object.fromEntries(this.trackingData);
            fs.writeFileSync(this.trackingFile, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error saving tracking data:', error);
        }
    }

    /**
     * Update teknisi location from WhatsApp
     */
    async updateLocation(teknisiId, ticketId, location) {
        const tracking = {
            teknisiId,
            ticketId,
            latitude: location.degreesLatitude,
            longitude: location.degreesLongitude,
            accuracy: location.accuracyInMeters || null,
            timestamp: Date.now(),
            lastUpdate: new Date().toISOString()
        };

        // Calculate ETA if customer location exists
        const ticket = await this.getTicketInfo(ticketId);
        if (ticket && ticket.customerLocation) {
            const distance = this.calculateDistance(
                { lat: tracking.latitude, lng: tracking.longitude },
                ticket.customerLocation
            );
            
            // Estimate speed based on distance
            const avgSpeedKmh = distance > 5 ? 30 : 15; // Faster for longer distance
            tracking.distanceKm = distance;
            tracking.etaMinutes = Math.round((distance / avgSpeedKmh) * 60);
        }

        this.trackingData.set(ticketId, tracking);
        this.saveTrackingData();

        return tracking;
    }

    /**
     * Get current tracking info for a ticket
     */
    getTracking(ticketId) {
        return this.trackingData.get(ticketId) || null;
    }

    /**
     * Calculate distance between two points (Haversine formula)
     */
    calculateDistance(point1, point2) {
        const R = 6371; // Earth's radius in kilometers
        const dLat = this.toRad(point2.lat - point1.lat);
        const dLon = this.toRad(point2.lng - point1.lng);
        
        const a = 
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.toRad(point1.lat)) * 
            Math.cos(this.toRad(point2.lat)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Convert degrees to radians
     */
    toRad(degrees) {
        return degrees * (Math.PI / 180);
    }

    /**
     * Get ticket information (mock - replace with actual database query)
     */
    async getTicketInfo(ticketId) {
        // This should query your actual reports database
        const reports = require('../database/reports.json');
        const report = reports.find(r => r.ticketId === ticketId);
        
        if (report && report.pelangganAddress) {
            // You would need to geocode the address to get lat/lng
            // For now, return mock data
            return {
                ticketId,
                customerName: report.pelangganName,
                customerLocation: {
                    lat: -6.9175, // Default Bandung
                    lng: 107.6191
                }
            };
        }
        
        return null;
    }

    /**
     * Format tracking info for WhatsApp message
     */
    formatTrackingMessage(tracking) {
        if (!tracking) {
            return '❌ Belum ada update lokasi dari teknisi.';
        }

        const lastUpdate = new Date(tracking.timestamp);
        const now = new Date();
        const minutesAgo = Math.round((now - lastUpdate) / 60000);

        let message = `📍 *TRACKING TEKNISI*\n\n`;
        
        if (tracking.distanceKm !== undefined) {
            message += `📏 Jarak: ${tracking.distanceKm.toFixed(1)} km\n`;
            message += `⏱️ Estimasi Tiba: ${tracking.etaMinutes} menit\n`;
        }
        
        message += `🕐 Update Terakhir: ${minutesAgo} menit yang lalu\n`;
        
        // Add Google Maps link
        const mapsUrl = `https://www.google.com/maps?q=${tracking.latitude},${tracking.longitude}`;
        message += `\n📱 [Lihat di Maps](${mapsUrl})\n`;
        
        if (minutesAgo > 10) {
            message += `\n⚠️ _Data mungkin tidak akurat. Menunggu update lokasi terbaru._`;
        }
        
        return message;
    }

    /**
     * Check if tracking is still active (less than 30 minutes old)
     */
    isTrackingActive(ticketId) {
        const tracking = this.trackingData.get(ticketId);
        if (!tracking) return false;
        
        const age = Date.now() - tracking.timestamp;
        return age < 30 * 60 * 1000; // 30 minutes
    }

    /**
     * Clear old tracking data (older than 24 hours)
     */
    cleanupOldTracking() {
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        
        for (const [ticketId, tracking] of this.trackingData.entries()) {
            if (tracking.timestamp < oneDayAgo) {
                this.trackingData.delete(ticketId);
            }
        }
        
        this.saveTrackingData();
    }
}

module.exports = SimpleTrackingService;
