/**
 * Working Hours Helper
 * Calculate teknisi working hours and expected response time
 */

/**
 * Check if current time is within working hours
 * @returns {Object} { isWithinHours: boolean, nextWorkingTime: Date|null, dayType: string }
 */
function isWithinWorkingHours() {
    const config = global.config.teknisiWorkingHours;
    
    // If feature disabled, always return true (24/7 service)
    if (!config || !config.enabled) {
        return {
            isWithinHours: true,
            nextWorkingTime: null,
            dayType: 'everyday',
            message: 'Layanan 24/7'
        };
    }
    
    const now = new Date();
    const jakartaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    
    const day = jakartaTime.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const currentHour = jakartaTime.getHours();
    const currentMinute = jakartaTime.getMinutes();
    const currentTimeMinutes = currentHour * 60 + currentMinute;
    
    // Check if today is a holiday
    const todayStr = jakartaTime.toISOString().split('T')[0]; // YYYY-MM-DD
    if (config.holidays && config.holidays.includes(todayStr)) {
        const nextWorking = getNextWorkingDay(jakartaTime);
        return {
            isWithinHours: false,
            nextWorkingTime: nextWorking,
            dayType: 'holiday',
            message: config.holidayMessage || 'Hari libur'
        };
    }
    
    let schedule;
    let dayType;
    let dayName;
    
    // Map day number to day name and config
    const dayMap = {
        0: 'sunday',
        1: 'monday',
        2: 'tuesday',
        3: 'wednesday',
        4: 'thursday',
        5: 'friday',
        6: 'saturday'
    };
    
    dayName = dayMap[day];
    
    // Support both old and new config structure for backward compatibility
    if (config.days && config.days[dayName]) {
        // New per-day structure
        schedule = config.days[dayName];
        dayType = dayName;
        
        if (!schedule.enabled) {
            const nextWorking = getNextWorkingDay(jakartaTime);
            return {
                isWithinHours: false,
                nextWorkingTime: nextWorking,
                dayType: dayType,
                message: `Hari ${dayName.charAt(0).toUpperCase() + dayName.slice(1)} (libur)`
            };
        }
    } else {
        // Old structure fallback
        if (day === 0) { // Sunday
            if (!config.sunday || !config.sunday.enabled) {
                const nextWorking = getNextWorkingDay(jakartaTime);
                return {
                    isWithinHours: false,
                    nextWorkingTime: nextWorking,
                    dayType: 'sunday_off',
                    message: 'Hari Minggu (libur)'
                };
            }
            schedule = config.sunday;
            dayType = 'sunday';
        } else if (day === 6) { // Saturday
            schedule = config.saturday;
            dayType = 'saturday';
        } else { // Weekdays (Mon-Fri)
            schedule = config.weekdays;
            dayType = 'weekday';
        }
    }
    
    // Parse schedule time
    const [startHour, startMin] = schedule.start.split(':').map(Number);
    const [endHour, endMin] = schedule.end.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    
    // Check if within hours
    const isWithin = currentTimeMinutes >= startMinutes && currentTimeMinutes < endMinutes;
    
    if (isWithin) {
        return {
            isWithinHours: true,
            nextWorkingTime: null,
            dayType: dayType,
            message: `Jam kerja (${schedule.start}-${schedule.end})`
        };
    } else {
        // Calculate next working time
        let nextWorking;
        if (currentTimeMinutes < startMinutes) {
            // Before working hours today, next is today
            nextWorking = new Date(jakartaTime);
            nextWorking.setHours(startHour, startMin, 0, 0);
        } else {
            // After working hours, next is next working day
            nextWorking = getNextWorkingDay(jakartaTime);
        }
        
        return {
            isWithinHours: false,
            nextWorkingTime: nextWorking,
            dayType: dayType,
            message: `Di luar jam kerja (${schedule.start}-${schedule.end})`
        };
    }
}

/**
 * Get next working day start time
 * @param {Date} fromDate - Starting date
 * @returns {Date} Next working day
 */
function getNextWorkingDay(fromDate) {
    const config = global.config.teknisiWorkingHours;
    const nextDay = new Date(fromDate);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(0, 0, 0, 0);
    
    // Day mapping for use throughout the function
    const dayMap = {
        0: 'sunday',
        1: 'monday',
        2: 'tuesday',
        3: 'wednesday',
        4: 'thursday',
        5: 'friday',
        6: 'saturday'
    };
    
    // Find next working day
    for (let i = 0; i < 7; i++) {
        const day = nextDay.getDay();
        const dateStr = nextDay.toISOString().split('T')[0];
        
        // Check if holiday
        if (config.holidays && config.holidays.includes(dateStr)) {
            nextDay.setDate(nextDay.getDate() + 1);
            continue;
        }
        
        // Check if day is not enabled
        const dayName = dayMap[day];
        
        // Check with new structure first
        if (config.days && config.days[dayName]) {
            if (!config.days[dayName].enabled) {
                nextDay.setDate(nextDay.getDate() + 1);
                continue;
            }
        } else if (day === 0 && (!config.sunday || !config.sunday.enabled)) {
            // Old structure fallback for Sunday
            nextDay.setDate(nextDay.getDate() + 1);
            continue;
        }
        
        // Found working day, set to start time
        let schedule;
        
        // Support both new and old config structure
        if (config.days && config.days[dayName]) {
            schedule = config.days[dayName];
        } else {
            // Old structure fallback
            if (day === 0) {
                schedule = config.sunday;
            } else if (day === 6) {
                schedule = config.saturday;
            } else {
                schedule = config.weekdays;
            }
        }
        
        // Parse schedule based on type
        let startHour, startMin;
        if (typeof schedule === 'object' && schedule.start) {
            // New format: { start: "08:00", end: "17:00" }
            [startHour, startMin] = schedule.start.split(':').map(Number);
        } else if (typeof schedule === 'string' && schedule.includes('-')) {
            // Old format: "08:00-17:00"
            const [startTime] = schedule.split('-');
            [startHour, startMin] = startTime.split(':').map(Number);
        } else {
            // Fallback to default
            startHour = 8;
            startMin = 0;
        }
        nextDay.setHours(startHour, startMin, 0, 0);
        
        return nextDay;
    }
    
    // Fallback (should not happen)
    return nextDay;
}

/**
 * Get expected response time message based on priority and working hours
 * @param {string} priority - 'HIGH', 'MEDIUM', or 'LOW'
 * @returns {string} Response time message
 */
function getResponseTimeMessage(priority) {
    const config = global.config.teknisiWorkingHours;
    
    // Updated default messages to match user requirements
    // HIGH: 2-4 jam, MEDIUM: 6-12 jam, LOW: 1-2 hari
    if (!config || !config.enabled) {
        if (priority === 'HIGH') {
            return '2-4 jam';
        } else if (priority === 'MEDIUM') {
            return '6-12 jam';
        } else if (priority === 'LOW') {
            return '1-2 hari';
        } else {
            return '6-12 jam'; // Default to medium
        }
    }
    
    const workingStatus = isWithinWorkingHours();
    
    if (priority === 'HIGH') {
        if (workingStatus.isWithinHours) {
            // Within hours: use configured time (default: 2-4 jam)
            return (config.responseTime && config.responseTime.high && config.responseTime.high.withinHours) || 
                   config.responseTime?.high_priority_within_hours || 
                   '2-4 jam';
        } else {
            // Outside hours: next working day
            const configuredMessage = (config.responseTime && config.responseTime.high && config.responseTime.high.outsideHours) || 
                                     config.responseTime?.high_priority_outside_hours || 
                                     'keesokan hari jam kerja';
            
            const nextTime = workingStatus.nextWorkingTime;
            if (nextTime && !configuredMessage.includes('hari')) {
                const options = { 
                    weekday: 'long', 
                    hour: '2-digit', 
                    minute: '2-digit',
                    timeZone: 'Asia/Jakarta'
                };
                const timeStr = nextTime.toLocaleString('id-ID', options);
                return `pada ${timeStr}`;
            }
            return configuredMessage;
        }
    } else if (priority === 'MEDIUM') {
        // Medium priority time (default: 6-12 jam)
        return (config.responseTime && config.responseTime.medium && config.responseTime.medium.always) || 
               config.responseTime?.medium_priority || 
               '6-12 jam';
    } else if (priority === 'LOW') {
        // Low priority time (default: 1-2 hari)
        return (config.responseTime && config.responseTime.low && config.responseTime.low.always) || 
               config.responseTime?.low_priority || 
               '1-2 hari';
    } else {
        // Default to medium priority
        return (config.responseTime && config.responseTime.medium && config.responseTime.medium.always) || 
               config.responseTime?.medium_priority || 
               '6-12 jam';
    }
}

/**
 * Get detailed working hours info for display
 * @returns {string} Formatted working hours message
 */
function getWorkingHoursInfo() {
    const config = global.config.teknisiWorkingHours;
    
    if (!config || !config.enabled) {
        return '⏰ *Jam Layanan:* 24/7 (Selalu Siap)';
    }
    
    let info = '⏰ *Jam Kerja Teknisi:*\n';
    
    // Support both new per-day and old structure
    if (config.days) {
        // New per-day structure
        const dayNames = {
            monday: 'Senin',
            tuesday: 'Selasa',
            wednesday: 'Rabu',
            thursday: 'Kamis',
            friday: 'Jumat',
            saturday: 'Sabtu',
            sunday: 'Minggu'
        };
        
        const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        
        for (const dayKey of dayOrder) {
            const day = config.days[dayKey];
            if (day) {
                if (day.enabled) {
                    info += `📅 ${dayNames[dayKey]}: ${day.start} - ${day.end} WIB\n`;
                } else {
                    info += `📅 ${dayNames[dayKey]}: Libur\n`;
                }
            }
        }
    } else {
        // Old structure fallback
        info += `📅 Senin - Jumat: ${config.weekdays.start} - ${config.weekdays.end} WIB\n`;
        info += `📅 Sabtu: ${config.saturday.start} - ${config.saturday.end} WIB\n`;
        
        if (config.sunday && config.sunday.enabled) {
            info += `📅 Minggu: ${config.sunday.start} - ${config.sunday.end} WIB\n`;
        } else {
            info += `📅 Minggu: Libur\n`;
        }
    }
    
    if (config.holidays && config.holidays.length > 0) {
        info += `\n🎉 Hari libur: ${config.holidays.length} hari terdaftar`;
    }
    
    return info.trim();
}

/**
 * Format next available time for user-friendly display
 * @returns {string} Next available message
 */
function getNextAvailableMessage() {
    const workingStatus = isWithinWorkingHours();
    
    if (workingStatus.isWithinHours) {
        return '✅ Teknisi sedang dalam jam kerja';
    }
    
    if (workingStatus.nextWorkingTime) {
        const options = { 
            weekday: 'long', 
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit', 
            minute: '2-digit',
            timeZone: 'Asia/Jakarta'
        };
        const timeStr = workingStatus.nextWorkingTime.toLocaleString('id-ID', options);
        return `⏰ Teknisi akan tersedia pada: ${timeStr}`;
    }
    
    return '⏰ Teknisi akan segera tersedia';
}

module.exports = {
    isWithinWorkingHours,
    getResponseTimeMessage,
    getWorkingHoursInfo,
    getNextAvailableMessage,
    getNextWorkingDay
};
