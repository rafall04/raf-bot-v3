# PROMPTS & TEMPLATES

## 📝 1. Menambahkan Fitur Baru (New Feature)
**Prompt**: "Buatkan fitur [Nama Fitur] yang dapat [Deskripsi Fungsi]."

**Langkah Implementasi**:
1.  **Analisis**: Tentukan file dan database yang terdampak.
2.  **Schema Check**: Apakah perlu tabel/kolom baru di SQLite?
    - Jika ya, buat migration script atau update schema manual (dengan check `IF NOT EXISTS`).
3.  **Service Integration**:
    - Apakah perlu service baru di `lib/`? (e.g., `lib/new-feature-service.js`)
    - Atau tambahkan method ke existing service class.
4.  **Handler/Route**:
    - **WhatsApp**: Tambahkan handler di `message/handlers/`.
    - **Web**: Tambahkan route di `routes/` dan view template di `views/`.
5.  **Templates**: Tambahkan template pesan baru ke `database/message_templates.json`.
6.  **Code**: Tulis kode dengan comment Bahasa Indonesia.

## 🐛 2. Memperbaiki Bug (Bug Fix)
**Prompt**: "Fix bug [error message/behavior] di [lokasi/fitur]."

**Langkah Implementasi**:
1.  **Diagnosis**:
    - Cek log error (console/file log).
    - Reproduksi error jika mungkin.
    - Cek `PROJECT-RULES.md` untuk aturan yang dilanggar.
2.  **Fix**:
    - **Isolasi**: Pastikan fix tidak merusak fitur lain.
    - **Validasi Input**: Tambahkan validasi jika error disebabkan input user.
    - **Error Handling**: Bungkus `try-catch` jika belum ada.
3.  **Verifikasi**: Test fix dengan kasus edge case.

## 🛠️ 3. Refactoring Code
**Prompt**: "Refactor file [nama file] agar lebih clean/efficient."

**Langkah Implementasi**:
1.  **Review**: Identifikasi "Code Smells" (duplikasi, fungsi terlalu panjang, logic rumit).
2.  **Refactor**:
    - Extract Method: Pecah fungsi besar menjadi kecil.
    - Extract Class/Service: Pindahkan logic bisnis ke `lib/`.
    - DRY: Gunakan helper function yang sudah ada.
3.  **Consistency**: Hapus comment usang/redundant. Perbaiki naming convention.
    - Pastikan semua comment dalam Bahasa Indonesia.
4.  **Test**: Pastikan fungsi tidak berubah (output sama untuk input sama).

## 💬 4. Menambahkan WhatsApp Handler
**Prompt**: "Buat handler WA untuk command [!command]."

**Langkah Implementasi**:
1.  **Template**: Tambahkan key baru di `database/response_templates.json` atau `command_templates.json`.
2.  **Handler Logic**:
    - Buat file baru atau update existing handler di `message/handlers/`.
    - Gunakan `whatsapp-notification-wrapper` jika notifikasi.
    - Gunakan `skipDuplicateCheck: true` jika reply langsung.
3.  **JID Handling**:
    - Normalisasi sender JID (`normalizeJidForSaldo`).
    - Cek status koneksi WA (`global.whatsappConnectionState === 'open'`).
4.  **Error Handling**: Wrap dengan `try-catch` dan log error yang informatif.

---
**Catatan**: Gunakan template ini sebagai panduan mental saat mengerjakan task. Agent harus selalu merujuk ke `PROJECT-RULES.md` untuk detail teknis spesifik.
