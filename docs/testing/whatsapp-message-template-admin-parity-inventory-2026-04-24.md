# Header Doc
- Purpose: Inventory parity halaman admin `/templates` terhadap kategori template WhatsApp runtime.
- Caller: Pengembang/agent saat audit template admin dan runtime bot.
- Deps: `views/sb-admin/templates.php`, `routes/admin-content-routes.js`, `routes/message-templates.js`, `lib/template-service.js`, `lib/templating.js`, `lib/message-manager.js`.
- MainFuncs: Mendokumentasikan kategori editable, source runtime, compat route, dan residual hardcoded/fallback.
- SideEffects: Tidak ada; dokumentasi statis.

# WhatsApp Message Template Admin Parity Inventory - 2026-04-24

## Editable From `/templates`

Halaman admin full editor memakai `GET/POST /api/templates` dan sekarang mengedit kategori berikut:

- `notificationTemplates` via tab Notifications, Payment, dan Tickets.
- `wifiMenuTemplates` via tab WiFi Menu.
- `responseTemplates` via tab Bot Responses, Customer, Payment, dan Tickets.
- `commandTemplates` via tab Template Teks Bot.
- `errorTemplates` via tab Errors.
- `successTemplates` via tab Success.
- `systemTemplates` via tab System Messages.
- `menuTemplates` via tab Menu.
- `reportTemplates` via tab Laporan.

## Runtime Readers

- `lib/templating.js` membaca template notification, system, menu, dan report lewat `lib/template-service.js`.
- `lib/message-manager.js` membaca response-style template untuk flow general/customer/wifi/ticket/payment/speed/admin/teknisi/notification.
- `routes/admin-content-routes.js` adalah owner full editor `/api/templates`.
- `routes/message-templates.js` tetap compat API `/api/message-templates` untuk notification templates lama.

## Metadata Safety

Save dari UI mempertahankan metadata object existing dengan pola:

- spread object existing;
- pertahankan `name` existing bila ada;
- override hanya `template` sesuai textarea;
- string-backed WiFi template tetap disimpan sebagai string.

Metadata seperti `description`, `category`, `enabled`, `placeholders`, dan `updated_at` tidak lagi hilang untuk kategori object-backed.

## Residual Non-Blocking

- Tidak semua pesan WhatsApp sudah template-backed; sebagian handler masih punya fallback hardcoded.
- Fallback hardcoded masih benar untuk resilience runtime, tetapi membuat admin tidak selalu bisa mengubah setiap kalimat bot dari `/templates`.
- Fase berikutnya yang rasional adalah audit/migrasi hardcoded reply prioritas ke key template yang sudah ada, bukan mengubah semua handler sekaligus.
