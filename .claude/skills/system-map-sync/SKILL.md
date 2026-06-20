---
name: system-map-sync
description: Jaga SYSTEM_MAP.md tetap sinkron dengan kode. WAJIB pakai skill ini setiap kali kamu mengubah alur lintas-fitur atau lintas-layer di RAF Bot V2 — menambah/memindah/menghapus route, handler, service, atau repository; mengubah jalur trigger→controller→service→repo→DB; memindahkan kepemilikan (ownership) sebuah domain ke owner baru; mengganti lokasi file DB; atau mengubah boundary integrasi eksternal. Picu skill ini SETELAH perubahan semacam itu meskipun user tidak menyebut dokumentasi, karena SYSTEM_MAP.md adalah peta kanonik yang dibaca sebelum tracing — entri basi menyesatkan pekerjaan berikutnya. Tidak perlu untuk perubahan yang murni lokal di dalam satu fungsi/file tanpa mengubah flow atau ownership.
---

# Sinkronisasi SYSTEM_MAP.md

`SYSTEM_MAP.md` (di root) + `CLAUDE.md` adalah **satu-satunya panduan kanonik** proyek ini. Aturan di `CLAUDE.md`: _"Keep it in sync when you change a flow."_ Skill ini memastikan itu benar-benar terjadi, dan menyeragamkan caranya.

**Kenapa penting:** agent/dev berikutnya membaca `SYSTEM_MAP.md` sebelum menyentuh logika lintas-fitur. Kalau peta menyebut owner/flow/path yang sudah berubah, mereka menelusuri tempat yang salah dan bisa membuat _shadow ownership_ (dua tempat mengaku memiliki domain yang sama). Dulu sudah pernah ada masalah file-rule basi (path tak ada lagi) — jangan ulangi.

## Kapan WAJIB update

Update `SYSTEM_MAP.md` kalau perubahanmu termasuk salah satu:

- Menambah / memindah / menghapus **route, handler, service, atau repository** yang mengubah siapa menangani apa.
- Mengubah **jalur** trigger→controller→service→repo→DB (mis. handler kini lewat service baru).
- Memindahkan kepemilikan domain ke **owner baru** (pola refactor boundary repo ini), atau menjadikan path lama sebagai stub `410` / fallback non-aktif.
- Menambah/menghapus **integrasi eksternal** atau mengubah boundary-nya (MikroTik, iPaymu, GenieACS, SNMP/OLT, Telegram, Socket.IO, Cloudflare Tunnel).
- Mengubah **lokasi/penambahan file DB** (SQLite domain baru, JSON store baru) atau resolver path-nya.

Kalau perubahanmu murni di dalam satu fungsi/file tanpa mengubah flow atau ownership, **tidak perlu** menyentuh peta.

## Bagian mana yang diperbarui

Buka `SYSTEM_MAP.md` dan ubah hanya bagian yang relevan:

- **Core Logic Flow** (WhatsApp / HTTP-API) — kalau urutan trigger→controller→service→repo→DB berubah.
- **DB Config / Locations** — kalau ada file DB baru/pindah atau perubahan resolver path.
- **Integrasi Eksternal** — kalau ada integrasi baru/berubah.
- **Direktori Inti** — kalau ada direktori peran baru.
- **Boundary Refactor Baru** — **log berjalan kepemilikan refactor.** Hampir semua perubahan ownership/boundary dicatat di sini sebagai satu butir baru. Inilah bagian yang paling sering kamu sentuh.

## Cara menulis entri "Boundary Refactor Baru"

Ikuti gaya butir yang sudah ada: sebutkan **file owner**, **apa yang dipindah/dimiliki sekarang**, dan **status path lama** (stub `410` / fallback / dihapus). Bahasa Indonesia, padat, faktual.

**Contoh pola:**
Input: Ekstrak logika voucher dari `routes/admin.js` ke service+repository baru, path lama dimatikan.
Output entri:

> `routes/api-voucher-routes.js` + `services/api-voucher.service.js` + `repositories/api-voucher.repository.js`: owner aktif domain voucher API untuk profile read-model, generate/send voucher, dan member-credential delivery; route mendelegasikan flow GET/POST utama ke service/repository owner, sementara helper file/PHP/delivery lama tetap dipakai sebagai adapter di bawah owner baru.

Catat juga bila kamu **menetralkan** path lama (mis. _"path legacy di `routes/admin.js` kini hanya menyisakan stub `410` agar tidak terjadi shadow ownership"_), supaya pembaca tahu sumber kebenaran tunggalnya.

## Disiplin & verifikasi

- **Jangan duplikasi.** Panduan durable hanya di `SYSTEM_MAP.md` atau `CLAUDE.md` — jangan menghidupkan lagi file rule terpisah yang gampang basi.
- **Header Doc** di puncak `SYSTEM_MAP.md` (`Purpose`/`Caller`/`Deps`/...) ikut diperbarui kalau dependensinya berubah.
- **Verifikasi setiap path yang kamu tulis benar-benar ada** (file/fungsi/flag) sebelum commit — entri yang menyebut path tak-ada justru lebih menyesatkan daripada tidak ada entri.
- Pastikan perubahan peta **konsisten** dengan invariant di `CLAUDE.md`; untuk jalur berisiko (saldo/WA/JID/template/state) cek juga skill `raf-invariants`.
