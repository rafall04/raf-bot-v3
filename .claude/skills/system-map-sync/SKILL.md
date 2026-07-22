---
name: system-map-sync
description: Jaga SYSTEM_MAP.md tetap sinkron dengan kode. WAJIB pakai skill ini setiap kali kamu mengubah alur lintas-fitur atau lintas-layer di RAF Bot V2 — menambah/memindah/menghapus route, handler, service, atau repository; mengubah jalur trigger→controller→service→repo→DB; memindahkan kepemilikan (ownership) sebuah domain ke owner baru; mengganti lokasi file DB; atau mengubah boundary integrasi eksternal. Picu skill ini SETELAH perubahan semacam itu meskipun user tidak menyebut dokumentasi, karena SYSTEM_MAP.md adalah peta kanonik yang dibaca sebelum tracing — entri basi menyesatkan pekerjaan berikutnya. Tidak perlu untuk perubahan yang murni lokal di dalam satu fungsi/file tanpa mengubah flow atau ownership.
---

# Sinkronisasi SYSTEM_MAP.md + boundary-log

Pembagian peran tiga dokumen (jangan dicampur):

- **`SYSTEM_MAP.md`** — peta KEADAAN SEKARANG: flow, lokasi DB, integrasi, plus **indeks satu-baris** ke sejarah boundary. Dibaca tiap sesi → wajib tetap ringkas.
- **`docs/boundary-log.md`** — CHANGELOG kepemilikan per-fitur. Ditulis sekali per perubahan, dibaca hanya per-anchor. Di sinilah detail tinggal.
- **`CLAUDE.md`** — aturan & invariant, bukan peta.

**Kenapa penting:** agent/dev berikutnya membaca peta sebelum menyentuh logika lintas-fitur. Peta yang menyebut owner/flow/path usang membuatnya menelusuri tempat yang salah dan bisa menciptakan _shadow ownership_ (dua tempat mengaku memiliki domain yang sama). Dan indeks pernah MEMBUSUK balik jadi paragraf-paragraf ratusan kata + anchor dobel (b128, b166) karena entri ditulis langsung di peta — disiplin di bawah ini yang mencegahnya kambuh.

## Kapan WAJIB update

Update kalau perubahanmu termasuk salah satu:

- Menambah / memindah / menghapus **route, handler, service, atau repository** yang mengubah siapa menangani apa.
- Mengubah **jalur** trigger→controller→service→repo→DB (mis. handler kini lewat service baru).
- Memindahkan kepemilikan domain ke **owner baru**, atau menjadikan path lama stub `410` / fallback non-aktif.
- Menambah/menghapus **integrasi eksternal** atau mengubah boundary-nya (MikroTik, iPaymu, GenieACS, SNMP/OLT, Telegram, Socket.IO, Cloudflare Tunnel).
- Mengubah **lokasi/penambahan file DB** (SQLite domain baru, JSON store baru) atau resolver path-nya.

Perubahan murni di dalam satu fungsi/file tanpa mengubah flow atau ownership → **tidak perlu** menyentuh peta.

## Bagian SYSTEM_MAP.md yang diperbarui

Ubah hanya bagian yang relevan: **Core Logic Flow** (urutan jalur berubah), **DB Config / Locations** (file DB baru/pindah), **Integrasi Eksternal**, **Direktori Inti**, dan **Header Doc** puncak file bila dependensinya berubah. Perubahan ownership dicatat sebagai entri boundary — lihat di bawah, ini yang paling sering kamu lakukan.

## Cara mencatat perubahan boundary (2 langkah, keduanya wajib)

**Langkah 1 — badan entri → `docs/boundary-log.md`, append di AKHIR file:**

1. Cari nomor tertinggi: `grep -o 'id="b[0-9]*"' docs/boundary-log.md | sort -V | tail -1` → nomor entri barumu = itu + 1. Anchor `<a id="bNNN"></a>` **wajib unik** — jangan pernah memakai ulang nomor.
2. Heading `### Feat|Fix YYYY-MM-DD (judul singkat yang berdiri sendiri)` — heading ini dipakai apa adanya sebagai teks link di indeks, jadi tulis jelas tanpa perlu konteks.
3. Badan **maksimal 8 baris bullet**: file **owner** + apa yang kini dimilikinya, **status path lama** (`410` stub / fallback / dihapus), **config gate**, **tes**. Baris AKAR/GOTCHA hanya bila benar-benar non-obvious. Entri panjang adalah alasan file ini dulu harus dipisah — jangan ulangi.

**Langkah 2 — indeks → `SYSTEM_MAP.md` seksi "Boundary Refactor Baru (indeks)":**

SATU baris di urutan paling akhir, teks link = heading entri:

```
- [Feat 2026-07-25 (Voucher: rekap penjualan harian ke grup owner)](docs/boundary-log.md#b173)
```

**JANGAN** menulis ringkasan fitur / daftar file / gotcha di baris indeks — semua itu milik badan entri. Pembaca yang butuh konteks membuka entrinya.

**Contoh badan entri (Langkah 1):**

```markdown
<a id="b173"></a>

### Feat 2026-07-25 (Voucher: rekap penjualan harian ke grup owner)

- **Owner:** `lib/cron/jobs/voucher-daily-recap.js` (BARU) + `repositories/voucher.repository.getDailySales`.
- **Status path lama:** rekap manual di `menuowner` tetap ada (paritas); tak ada path yang dimatikan.
- **Gate:** `config.voucherRecap.enabled` (default OFF). **Tes:** cron job 4, repo 2.
```

## Verifikasi sebelum commit

1. **Jalankan guard:** `node scripts/check-boundary-index.js` — memastikan anchor unik, link indeks valid dua arah, dan baris indeks tetap ringkas. Guard yang sama jalan di `npm test` (`scripts/__tests__/boundary-index.test.js`), jadi indeks rusak = suite merah.
2. **Verifikasi setiap path yang kamu tulis benar-benar ada** (file/fungsi/flag) — entri yang menyebut path tak-ada lebih menyesatkan daripada tidak ada entri.
3. **Jangan duplikasi.** Panduan durable hanya di `CLAUDE.md` / `SYSTEM_MAP.md` (+ sejarah di `boundary-log.md`) — jangan menghidupkan file rule terpisah yang gampang basi.
4. Untuk jalur berisiko (saldo/WA/JID/template/state) cek juga skill `raf-invariants`.
