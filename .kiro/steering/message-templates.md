# Message Templates Guidelines

## Aturan Umum
Setiap fitur baru yang mengirim notifikasi WhatsApp **WAJIB** menggunakan sistem template yang dapat dimodifikasi oleh admin.

## Lokasi Template
- File: `database/message-templates.json`
- Struktur: Object dengan key = nama template, value = object template

## Format Template

```json
{
  "template_name": {
    "id": "template_name",
    "name": "Nama Template (untuk UI)",
    "description": "Deskripsi kegunaan template",
    "category": "kategori (payment, discount, ticket, etc)",
    "content": "Isi pesan dengan {placeholder}",
    "placeholders": ["placeholder1", "placeholder2"],
    "enabled": true,
    "updated_at": "ISO date string"
  }
}
```

## Placeholder Format
- Gunakan format `{nama_placeholder}` (kurung kurawal)
- Nama placeholder harus deskriptif: `{customer_name}`, `{package_name}`, `{amount}`
- Dokumentasikan semua placeholder yang tersedia di field `placeholders`

## Placeholder Umum yang Tersedia
| Placeholder | Deskripsi |
|-------------|-----------|
| `{customer_name}` | Nama pelanggan |
| `{customer_id}` | ID pelanggan |
| `{customer_phone}` | Nomor telepon pelanggan |
| `{customer_address}` | Alamat pelanggan |
| `{package_name}` | Nama paket langganan |
| `{package_price}` | Harga paket (formatted: Rp X.XXX) |
| `{billing_date}` | Tanggal tagihan |
| `{current_date}` | Tanggal saat ini |
| `{current_time}` | Waktu saat ini |
| `{admin_name}` | Nama admin yang memproses |
| `{technician_name}` | Nama teknisi |
| `{company_name}` | Nama perusahaan (RAF NET) |

## Implementasi di Kode

### 1. Load Template
```javascript
const { loadJSON } = require('../lib/database');

function getMessageTemplate(templateId) {
    const templates = loadJSON('database/message-templates.json');
    return templates[templateId] || null;
}
```

### 2. Replace Placeholders
```javascript
function formatMessage(template, data) {
    if (!template || !template.content) return null;
    if (!template.enabled) return null;
    
    let message = template.content;
    for (const [key, value] of Object.entries(data)) {
        const placeholder = `{${key}}`;
        message = message.replace(new RegExp(placeholder, 'g'), value || '-');
    }
    return message;
}
```

### 3. Penggunaan
```javascript
const template = getMessageTemplate('discount_notification');
if (template) {
    const message = formatMessage(template, {
        customer_name: user.name,
        package_name: user.subscription,
        discount_amount: 'Rp 75.000',
        // ... placeholder lainnya
    });
    
    if (message) {
        await sendWhatsAppMessage(phoneJid, message);
    }
}
```

## Kategori Template
- `payment` - Notifikasi pembayaran
- `discount` - Notifikasi diskon
- `ticket` - Notifikasi tiket support
- `billing` - Tagihan dan invoice
- `kasbon` - Kasbon teknisi
- `package` - Perubahan paket
- `system` - Notifikasi sistem

## Best Practices
1. **Selalu cek `enabled`** - Template bisa dinonaktifkan oleh admin
2. **Fallback message** - Siapkan pesan default jika template tidak ditemukan
3. **Validasi placeholder** - Pastikan semua placeholder terisi sebelum kirim
4. **Log error** - Catat jika ada placeholder yang tidak terganti
5. **Gunakan helper** - Gunakan `lib/message-template-helper.js` untuk konsistensi

## API Endpoints untuk Manage Templates
- `GET /api/templates` - List semua template
- `GET /api/templates/:id` - Get template by ID
- `PUT /api/templates/:id` - Update template
- `POST /api/templates/:id/test` - Test template dengan sample data
