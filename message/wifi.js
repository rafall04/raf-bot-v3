const fs = require('fs');
const path = require('path');
const convertRupiah = require('rupiah-format');
const { templatesCache } = require('../lib/templating'); // Import the live cache

/**
 * Replaces placeholders in a template string with provided data.
 * @param {string} template The template string.
 * @param {object} data An object where keys are placeholder names and values are their replacements.
 * @returns {string} The formatted string.
 */
const formatTemplate = (template, data) => {
    if (!template) return '';
    let formatted = template;
    for (const key in data) {
        const regex = new RegExp(`\\$\\{${key}\\}`, 'g');
        formatted = formatted.replace(regex, data[key]);
    }
    return formatted;
};

exports.wifimenu = (nama, namabot, pushname, sender) => {
    const template = templatesCache.wifiMenuTemplates?.wifimenu || '';
    // Support both old and new placeholder names for backward compatibility
    return formatTemplate(template, { 
        nama: nama,           // Backward compatibility
        nama_wifi: nama,      // Clear naming: WiFi provider name
        namabot: namabot,     // Backward compatibility
        nama_bot: namabot,    // Clear naming: Bot name
        pushname: pushname || 'Kak',  // WhatsApp display name with fallback
        sender: sender,       // Full sender ID
        phone: sender?.replace('@s.whatsapp.net', '') // Clean phone number
    });
};

// customermenu removed - now using menu_pelanggan from command_templates.json

exports.technicianmenu = (nama, namabot, pushname, sender) => {
    const template = templatesCache.wifiMenuTemplates?.technicianmenu || '';
    return formatTemplate(template, { 
        nama: nama,           // Backward compatibility
        nama_wifi: nama,      // Clear naming: WiFi provider name
        namabot: namabot,     // Backward compatibility
        nama_bot: namabot,    // Clear naming: Bot name
        pushname: pushname || 'Teknisi',  // WhatsApp display name with fallback
        sender: sender,       // Full sender ID
        phone: sender?.replace('@s.whatsapp.net', '') // Clean phone number
    });
};

exports.menubelivoucher = (nama, namabot, pushname, sender) => {
    const template = templatesCache.wifiMenuTemplates?.menubelivoucher || '';
    return formatTemplate(template, { 
        nama: nama,           // Backward compatibility
        nama_wifi: nama,      // Clear naming: WiFi provider name
        namabot: namabot,     // Backward compatibility
        nama_bot: namabot,    // Clear naming: Bot name
        pushname: pushname || 'Kak',  // WhatsApp display name with fallback
        sender: sender,       // Full sender ID
        phone: sender?.replace('@s.whatsapp.net', '') // Clean phone number
    });
};

exports.menuvoucher = (nama, namabot, pushname, sender) => {
    const template = templatesCache.wifiMenuTemplates?.menuvoucher || '';
    return formatTemplate(template, { 
        nama: nama,           // Backward compatibility
        nama_wifi: nama,      // Clear naming: WiFi provider name
        namabot: namabot,     // Backward compatibility
        nama_bot: namabot,    // Clear naming: Bot name
        pushname: pushname || 'Kak',  // WhatsApp display name with fallback
        sender: sender,       // Full sender ID
        phone: sender?.replace('@s.whatsapp.net', '') // Clean phone number
    });
};

exports.menupasang = (nama, namabot, pushname, sender) => {
    const template = templatesCache.wifiMenuTemplates?.menupasang || '';
    return formatTemplate(template, { 
        nama: nama,           // Backward compatibility
        nama_wifi: nama,      // Clear naming: WiFi provider name
        namabot: namabot,     // Backward compatibility
        nama_bot: namabot,    // Clear naming: Bot name
        pushname: pushname || 'Kak',  // WhatsApp display name with fallback
        sender: sender,       // Full sender ID
        phone: sender?.replace('@s.whatsapp.net', '') // Clean phone number
    });
};

exports.menuowner = (nama, namabot, pushname, sender) => {
    const template = templatesCache.wifiMenuTemplates?.menuowner || '';
    return formatTemplate(template, { 
        nama: nama,           // Backward compatibility
        nama_wifi: nama,      // Clear naming: WiFi provider name
        namabot: namabot,     // Backward compatibility
        nama_bot: namabot,    // Clear naming: Bot name
        pushname: pushname || 'Owner',  // WhatsApp display name with fallback
        sender: sender,       // Full sender ID
        phone: sender?.replace('@s.whatsapp.net', '') // Clean phone number
    });
};

exports.menupaket = (nama, namabot, pushname, sender) => {
    // Path to the packages.json file
    const packagesPath = path.join(__dirname, '../database/packages.json');
    let packages = [];

    try {
        const data = fs.readFileSync(packagesPath, 'utf8');
        packages = JSON.parse(data);
    } catch (error) {
        console.error("Error reading or parsing packages.json:", error);
        // Return a simple error message or a formatted one from a template if available
        return "Maaf, terjadi kesalahan saat memuat daftar paket. Silakan coba lagi nanti.";
    }

    // Filter packages that should be shown in monthly (showInMonthly !== false)
    const monthlyPackages = packages.filter(pkg => pkg.showInMonthly !== false);

    let packageList = '';
    if (monthlyPackages.length > 0) {
        packageList = monthlyPackages.map(pkg => {
            const formattedPrice = convertRupiah.convert(pkg.price);
            // Use displayProfile for customer-facing speed info, fallback to profile
            const displaySpeed = pkg.displayProfile || pkg.profile || '';
            // Use custom description if available
            const description = pkg.description || '';
            
            let packageInfo = `  • *${pkg.name}*`;
            if (displaySpeed) {
                packageInfo += `\n    🚀 ${displaySpeed}`;
            }
            if (description) {
                packageInfo += `\n    📝 ${description}`;
            }
            packageInfo += `\n    💰 ${formattedPrice} / bulan`;
            
            return packageInfo;
        }).join('\n\n');
    } else {
        packageList = 'Saat ini tidak ada paket bulanan yang tersedia.';
    }

    const template = templatesCache.wifiMenuTemplates?.menupaket || '';
    return formatTemplate(template, { 
        nama: nama,           // Backward compatibility
        nama_wifi: nama,      // Clear naming: WiFi provider name
        namabot: namabot,     // Backward compatibility
        nama_bot: namabot,    // Clear naming: Bot name
        pushname: pushname || 'Kak',  // WhatsApp display name with fallback
        sender: sender,       // Full sender ID
        phone: sender?.replace('@s.whatsapp.net', ''), // Clean phone number
        packageList: packageList
    });
};
