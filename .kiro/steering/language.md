# Bahasa & Komunikasi

## Aturan Bahasa
- Gunakan **Bahasa Indonesia** untuk semua respons dan penjelasan
- Kode tetap menggunakan bahasa Inggris (variabel, fungsi, komentar teknis)
- Pesan user-facing (notifikasi WhatsApp, UI admin) harus dalam Bahasa Indonesia

## Istilah Teknis
- `paid` = Status Pembayaran (Sudah Bayar / Belum Bayar)
- `subscription` = Paket Langganan
- `isolation` = Isolir (pembatasan akses internet)
- `tanggal_batas_bayar` = Tanggal Tagihan global dari config.json (tanggal jatuh tempo pembayaran, integer 1-31)
- `bulk` = SSID WiFi (bukan tanggal tagihan)

## Logika Metode Pembayaran

### CASH (Tunai)
- Pembayaran diterima langsung oleh **teknisi** di lapangan
- Digunakan otomatis ketika **teknisi** membuat request pembayaran
- Uang fisik diterima dari pelanggan ke teknisi

### TRANSFER_BANK (Transfer Bank)
- Pembayaran melalui transfer rekening bank
- Digunakan ketika **admin** memproses pembayaran langsung
- Admin dapat memilih metode ini saat approve request

### Alur Pembayaran:
1. **Teknisi di lapangan** → Terima uang tunai → Buat request dengan `payment_method: 'CASH'`
2. **Admin approve** → Sistem menggunakan metode dari request asli (CASH dari teknisi)
3. **Admin buat request sendiri** → Bisa pilih CASH atau TRANSFER_BANK
4. **Notifikasi ke pelanggan** → Menampilkan metode pembayaran dalam Bahasa Indonesia (Tunai/Transfer Bank)
