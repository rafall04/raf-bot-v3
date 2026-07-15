# Blueprint: State & Diagnosa Modem OLT

> Dokumen acuan untuk membangun *state modem OLT yang tersimpan* (bukan sekadar log event),
> untuk dua tujuan sekaligus: **(1) analisa mendalam oleh admin** dan **(2) self-service pelanggan via bot WhatsApp** yang aman. Disusun 2026-07-15.
>
> ## Status implementasi (2026-07-15)
> **ENGINE CODE-COMPLETE + TERUJI (135 tes hijau), mode SHADOW (gated `config.oltModemState`, default aktif, tak menyentuh deteksi/broadcast LOS):**
> - ✅ **Fase 1** — `repositories/olt-incident.repository.js` (`olt_state.sqlite`: `olt_incidents` + `olt_modem_state`) + `lib/olt-incident-projector.js` (idempoten, waktu-server, inferensi reboot, reklasifikasi LOS→DG, tag area) + hook di `lib/olt-event-logger.recordOltEventSafe` (feeder syslog+scrape HIOSO).
> - ✅ **Fase 2** — `lib/olt-state-maintenance.js` (reconcile insiden nyangkut + prune + backfill/rebuild dari `olt_events`), di-wire di `lib/app-runtime.js`.
> - ✅ **Fase 3** — `lib/olt-modem-diagnostics.js` (metrik uptime/MTBF/MTTR + verdict pola: reboot terjadwal/listrik/LOS/flapping/area + 2 rendering).
> - ✅ **Fase 4 (inti)** — read API `routes/olt-state.js` (`/api/olt/modem-state|incidents|diagnosis`) + fusi pelanggan `lib/olt-customer-connection.js` (OLT+PPPoE+billing, konservatif, privat).
>
> **SISA (langkah berikutnya, building block sudah siap):**
> - ⏳ Halaman diagnosa per-pelanggan (admin/teknisi) — data sudah query-able via read API.
> - ⏳ Command WA self-service pelanggan (pakai `buildCustomerConnectionSummary`, wajib scope pengirim + baca cache).
> - ⏳ ZTE via SNMP `onuStateDetail` → funnel ke projector (kini hanya HIOSO log).
> - ⏳ Fase 5 aksi (usul tiket modem kronis).
> - ⏳ **KALIBRASI ambang (§14) dari telemetri shadow NYATA → baru AKTIFKAN konsumen.** Shadow harus jalan dulu kumpulkan data.

---

## 1. Tujuan & prinsip

**Masalah sekarang:** deteksi LOS/Dying-Gasp murni event-driven; tak ada satu pun store berisi *status terkini setiap modem* yang lengkap & query-able. Status "sekarang" selalu dihitung ulang live (scrape/SNMP/PPPoE) lalu dibuang — dan hilang tiap restart (7–13×/hari).

**Prinsip inti (jangan dilanggar):**

1. **3 lapis:** `Event (mentah) → Insiden (bersih, verified) → Verdict (diagnosa)`. Admin & pelanggan melihat Insiden/Verdict, **bukan** event mentah.
2. **State = cache turunan, WAJIB rebuildable.** Sumber kebenaran tetap: event log + OLT live. Kalau tabel state hilang → dibangun ulang dari event log + 1 scrape/poll.
3. **Status modem = LOG** (HIOSO: syslog push + scrape web-log) **/ SNMP-state** (ZTE) → dinormalkan ke **satu bentuk insiden yang sama**.
4. **SNMP HIOSO = REDAMAN saja** (dBm, on-demand), **tidak** dipakai untuk status online/LOS/DG. HIOSO SNMP tak bisa membedakan DG vs LOS.
5. **Jujur confidence** + **sadar-cluster** (gangguan area ≠ modem individu rusak).

---

## 2. Arsitektur data — 3 lapis, 3 tabel

### 2.1 Lapis 1 — Event mentah (SUDAH ADA)
`database/olt_events.sqlite` (`repositories/olt-event.repository.js`). Append-only, enriched pelanggan + pairing durasi. **Biarkan** sebagai sumber & audit. Prune 90 hari.

### 2.2 Lapis 2 — `olt_incidents` (BARU) — "log state bersih"
Satu baris per gangguan (down→up), sudah diklasifikasi & diverifikasi.

```sql
CREATE TABLE olt_incidents (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  -- identitas fisik
  mac               TEXT NOT NULL,          -- ternormalisasi (hex lower, tanpa pemisah)
  olt_id            TEXT, slot TEXT, onu TEXT,
  -- identitas layanan (SNAPSHOT saat insiden → tahan rename/hapus/ganti-modem)
  customer_id       TEXT, customer_name TEXT, pppoe_username TEXT, phone TEXT, address TEXT,
  -- klasifikasi
  incident_type     TEXT NOT NULL,          -- los | dying_gasp | reboot | flapping | unknown
  -- WAKTU: server-time = patokan; OLT-time hanya referensi (lihat §5)
  started_at_ms     INTEGER NOT NULL,       -- diterima server saat down
  ended_at_ms       INTEGER,                -- NULL = masih down
  duration_ms       INTEGER,                -- NULL saat open
  olt_reported_ts   TEXT,                   -- jam versi OLT (bisa skew) — referensi saja
  -- status & sumber
  status            TEXT NOT NULL DEFAULT 'open',  -- open | resolved | assumed_recovered
  down_source       TEXT, up_source TEXT,   -- syslog | scrape | snmp
  -- kualitas / verifikasi
  confidence        REAL,                   -- 0..1
  verify_method     TEXT,                   -- dg_pair | scrape_confirmed | snmp_state | syslog_only | inferred_reboot
  identity_verified INTEGER DEFAULT 0,      -- 1 bila MAC→pelanggan tepercaya
  -- area/cluster
  is_area_event     INTEGER DEFAULT 0,
  cluster_id        TEXT,
  -- idempotensi (anti-dobel dari syslog + scraper, anti-reorder UDP)
  dedup_key         TEXT UNIQUE,            -- mac + jenis + bucket-waktu-down
  created_at_ms     INTEGER, updated_at_ms INTEGER
);
-- index: mac, pppoe_username, started_at_ms, incident_type, status, cluster_id
```

### 2.3 Lapis 3 — `olt_modem_state` (BARU) — status kini per modem
Satu baris per modem, untuk dashboard & self-service cepat.

```sql
CREATE TABLE olt_modem_state (
  mac               TEXT PRIMARY KEY,
  -- identitas KINI (bisa beda dari snapshot insiden lama)
  customer_id       TEXT, customer_name TEXT, pppoe_username TEXT,
  olt_id            TEXT, slot TEXT, onu TEXT,
  -- status
  current_state     TEXT,                   -- online | los | dying_gasp | rebooting | unknown
  state_since_ms    INTEGER,
  last_event_at_ms  INTEGER, last_source TEXT,
  open_incident_id  INTEGER,                -- FK insiden open (NULL = online)
  -- FRESHNESS (lihat §12) — cegah menyajikan data basi sebagai fakta
  stale             INTEGER DEFAULT 0,      -- 1 bila feeder telat / data tak segar
  -- cache analitik 30 hari (opsional; sumber tunggal = olt_incidents)
  inc_30d INTEGER, los_30d INTEGER, dg_30d INTEGER, reboot_30d INTEGER, downtime_ms_30d INTEGER,
  health            TEXT,                   -- ok | watch | chronic (turunan)
  updated_at_ms     INTEGER
);
```

### 2.4 Verdict / Pola — turunan (on-read atau periodik)
Bukan tabel wajib; dihitung dari `olt_incidents` (lihat §8). Boleh di-cache di `olt_modem_state.health`.

---

## 3. Sumber & normalisasi (HIOSO log vs ZTE SNMP → 1 bentuk)

**Feeders (semua bermuara ke projector yang sama, §6):**

| Feeder | Merk | Peran | Komponen existing |
|---|---|---|---|
| Syslog push | HIOSO | real-time (bisa drop paket) | `lib/olt-syslog-receiver.js` |
| Scrape web-log | HIOSO | durable buffer, kebal packet-loss, backfill | `lib/olt-log-scraper.js`, `lib/olt-los-verifier.js` |
| SNMP `onuStateDetail` | ZTE | state eksplisit (high-confidence) | `lib/olt-drivers/zte.js` |

**Aturan klasifikasi → `incident_type` (enum yang sama untuk semua sumber):**

HIOSO (dari pesan log — `lib/olt-event-classifier.js`):
| Sinyal | → jenis | confidence |
|---|---|---|
| `dying-gasp` + `Lost` (detik sama) | `dying_gasp` | 0.85 |
| `Lost` saja, bertahan > grace | `los` | 0.6 → **0.8 bila scrape konfirmasi tak ada DG** |
| `Lost`→`Discovery` < ~5 mnt, tanpa DG | `reboot` | 0.6 (inferensi) |
| ≥N insiden/jam pada 1 MAC | `flapping` | meta |

ZTE (SNMP `onuStateDetail`: 3=work, 1=LOS, 4=DG, 6=offline):
| Transisi | → jenis | confidence |
|---|---|---|
| work→LOS(1) | `los` | 0.9 |
| work→DyingGasp(4) | `dying_gasp` | 0.9 |
| work→Offline(6) balik cepat | `reboot` | 0.85 |

---

## 4. Verifikasi (2 lapis) + confidence + gerbang area

1. **Verifikasi klasifikasi** — HIOSO `Lost`-only → scrape web-log OLT (kebal paket hilang) untuk cek apakah sebenarnya DG. Kalau ketemu `dying-gasp` → reklasifikasi ke `dying_gasp`. (`olt-los-verifier` sudah ada.)
2. **Verifikasi identitas** — MAC→pelanggan via GenieACS + `device_id` (`lib/olt-genieacs-resolver.js`, `olt-customer-resolver.js`). Gagal → `identity_verified=0`, jangan dibebankan ke pelanggan mana pun.
3. **Gerbang area/cluster** — ≥`clusterThreshold` modem 1 OLT down serempak → `is_area_event=1` + `cluster_id` sama → **dikecualikan** dari skor "modem kronis" & verdict per-pelanggan.

---

## 5. Disiplin waktu (KOREKSI PENTING)

Syslog HIOSO (RFC3164) **tak punya tahun** & pakai **jam lokal OLT** yang bisa ngaco. Kalau jam OLT salah, pola "reboot tiap 15:00" jadi **bohong** — padahal itu inti fitur.

- **`started_at_ms`/`ended_at_ms` = WAKTU-TERIMA SERVER** (patokan resmi untuk urutan, durasi, pola).
- **`olt_reported_ts`** = jam versi OLT, **referensi saja** (jangan dipakai hitung durasi).
- Tangani year-rollover pada parse timestamp syslog.

---

## 6. Projector idempoten + state machine + penutupan insiden nyangkut

**State machine per modem:**
```
        Lost / DG                          Discovery / working
 ONLINE ───────────► DOWN (buka insiden) ───────────────────────► ONLINE
   ▲                    │ klasifikasi awal                          │ tutup insiden:
   │                    ▼ (los/dg/reboot)                           │ ended_at, durasi,
   └──── anti-flap (recoveryConfirmMs 60s) ◄────────────────────────┘ finalize jenis+confidence
              (banyak siklus pendek → tandai flapping)
```

**Projector (dipanggil tiap feeder, SETELAH recordEvent):**
- **DOWN** & belum ada insiden `open` untuk MAC → **buka** insiden (`dedup_key` = mac+jenis+bucket-waktu; UNIQUE → aman diulang & anti-dobel syslog+scrape).
- **UP** (discovery/working) & ada insiden `open` → **tutup**: `ended_at_ms`, `duration_ms`, finalisasi jenis, verifikasi, cek cluster.
- **Idempoten & tahan urutan-acak** (UDP bisa dobel/kebalik): grace-window di lapis insiden, bukan cuma di korelator event.
- Upsert `olt_modem_state` (current_state, since, counters).

**Insiden nyangkut `open` (KOREKSI):** modem down lalu tak pernah kirim `Discovery` (paket pulih hilang / cabut permanen) → jangan biarkan `open` selamanya (merusak "sedang down" & MTTR).
- Reconcile sweep menutup via scrape/poll ("sudah up") **atau** timeout `max_open` → `status='assumed_recovered'` (confidence rendah).

---

## 7. Rekonsiliasi & rebuildability

- **HIOSO:** scrape web-log OLT berkala → isi transisi yang kelewat, tutup insiden yatim pasca-restart. (Buffer OLT tahan berhari-hari s/d berbulan → aman.)
- **ZTE:** SNMP poll `onuStateDetail` berkala → sinkron.
- **Rebuildable:** tabel `olt_incidents`/`olt_modem_state` hilang/rusak → replay `olt_events` + 1 scrape/poll → terbentuk lagi. State bukan sumber kebenaran.

---

## 8. Verdict per-pelanggan (pola → diagnosa) — DUA rendering

Hitung dari `olt_incidents` (30 hari, **area-events dikecualikan**). Tiap verdict bawa **confidence + insiden bukti**.

| Pola | Verdict | Dugaan penyebab |
|---|---|---|
| `reboot` ≥K & terpusat 1 jam (mis. tiap 15:00) | "Sering reboot terjadwal" | Listrik/adaptor/timer |
| `dying_gasp` sering (area) | "Sering mati listrik" | PLN area |
| `los` ≥K, **bukan** area | "Putus fiber berulang" | Konektor/splicing kendor |
| `flapping` | "Koneksi tidak stabil" | Splitter/kabel/redaman |
| >X% insiden = area-event | "Terdampak gangguan area" | Backbone/POP — **bukan** modem ini |
| 0–1 insiden | "Sehat" | — |

**DUA rendering (KOREKSI):**
- **Internal (teknis):** jenis + confidence + insiden mentah, untuk admin/teknisi.
- **Pelanggan (polos & menenangkan):** **hanya klaim confidence tinggi**. Jangan bilang "kabelmu rusak" kalau itu inferensi → cukup "terpantau 3× putus, teknisi akan cek".

---

## 9. Lapisan pelanggan (WA self-service) — KOREKSI besar

State OLT **≠** jawaban "kenapa internet saya mati". Modem bisa `online` di OLT tapi pelanggan tetap tanpa internet (PPPoE putus / isolir / belum bayar).

- **Fusi 3 lapis:** status OLT (fisik) **+** PPPoE MikroTik **+** status isolir/billing. Sudah ada di `message/telegram/command-handlers/cek-command.js` / cek-koneksi → state OLT jadi **input**, bukan pengganti.
- **Privasi:** pelanggan **hanya lihat modemnya sendiri** — resolve pengirim WA → pppoe/pelanggannya (normalisasi JID kanonik), jangan pernah bocor modem orang lain.
- **Baca cache, JANGAN live-poll OLT:** permukaan pelanggan **wajib** baca `olt_modem_state` (di-update background), **tak pernah** memicu scrape/SNMP ke OLT (cegah OLT kebanjiran / vektor abuse). *(Inilah alasan utama state table wajib ada — bikin self-service aman & murah.)*

---

## 10. Konsumen yang pindah baca ke state ini
Dashboard/cockpit kartu OLT · telegram `cek` · `/olt` · gate CCTV (`lib/cctv-power-outage-gate.js`) · **halaman diagnosa per-pelanggan (BARU)** · usul tiket teknisi (modem kronis) · AI assistant pelanggan · WA self-service (§9).

---

## 11. Retensi & longevity (KOREKSI)
- `olt_events` (mentah): prune **90 hari**.
- `olt_incidents`: **simpan nyaris selamanya** (kecil, emas untuk tren multi-tahun & "modem langganan-bermasalah").
- Rollup bulanan per modem/area: **simpan terus** (downsample, jangan hapus).
- `olt_modem_state`: live.

---

## 12. Observability / freshness feeder (KOREKSI)
Kalau syslog diam-diam mati, state jadi basi & semua orang percaya data basi.
- Simpan `last_event_received_at` per feeder (`olt-syslog-receiver` sudah punya `stats.last_packet_at`).
- Tandai `olt_modem_state.stale=1` bila feeder telat > ambang → UI/bot menandai "data mungkin tak terkini", jangan sajikan basi sebagai fakta.

---

## 13. Dual-key: MAC (fisik) + pppoe/pelanggan (layanan) (KOREKSI)
MAC berubah saat ganti modem. Kalau history cuma by-MAC, riwayat pelanggan **putus** pas modem diganti.
- `olt_incidents` simpan **dua-duanya** (mac + pppoe_username/customer_id) → analitik bisa dipivot **fisik** (per MAC) maupun **layanan** (per pelanggan, lintas ganti-modem).

---

## 14. Kalibrasi ambang (bukan tebak)
Ambang `K/N/X/grace/max_open/clusterThreshold` di dokumen ini **placeholder**. Sesuai aturan proyek (*CLAUDE.md*: "kalibrasi ambang terhadap telemetri terukur, jangan intuisi") — **wajib dikalibrasi dari data insiden nyata** dulu, lalu dikunci + ditulis di test. (Preseden: window 7-menit dulu ternyata cuma cocok 7% modem.)

---

## 15. Rambu (jangan dilanggar)
- **Sadar-cluster** — mati listrik area = 1 insiden area, bukan "50 modem rusak".
- **Identitas dulu** — verdict salah kalau MAC→pelanggan salah.
- **Jujur confidence** — "reboot" HIOSO itu inferensi; tandai, jangan divonis pasti ke pelanggan.
- **Waktu server, bukan OLT** — untuk durasi/pola.
- **Baca cache untuk pelanggan** — jangan live-poll OLT dari permukaan pelanggan.

---

## 16. Komponen existing yang dipakai/disambung
`repositories/olt-event.repository.js` (event log) · `lib/olt-event-classifier.js` (LOS/DG) · `lib/olt-syslog-receiver.js` (syslog) · `lib/olt-log-scraper.js` + `lib/olt-los-verifier.js` (scrape+verify) · `lib/olt-los-broadcaster.js` (incident/recovery/cluster + `database/los-incidents.json`) · `lib/olt-genieacs-resolver.js` / `olt-customer-resolver.js` (MAC→pelanggan) · `lib/olt-drivers/zte.js` (ZTE SNMP) · `message/telegram/command-handlers/cek-command.js` (fusi pelanggan) · `lib/cctv-power-outage-gate.js` (konsumen cluster). Pola preseden: `auto_outage_states` (`repositories/auto-outage.repository.js`) — tabel status-kini per-pelanggan yang di-upsert.

---

## 17. Rencana fase implementasi (baru mulai ngoding saat di-ACC)
- **Fase 1 — Fondasi state.** Tabel `olt_incidents` + `olt_modem_state` + projector idempoten disambung ke feeder yang SUDAH ada (syslog/scrape/ZTE). Waktu-server, dedup, penutupan insiden nyangkut, rebuildable dari `olt_events`. + test.
- **Fase 2 — Freshness & rekonsiliasi.** Reconcile sweep + penanda `stale`. Backfill dari `olt_events` historis.
- **Fase 3 — Analitik & verdict.** Metrik (uptime/MTBF/MTTR), verdict per-pelanggan (2 rendering), korelasi area/ODP.
- **Fase 4 — Permukaan.** Halaman diagnosa per-pelanggan (admin) + WA self-service pelanggan (fusi OLT+PPPoE+billing, privat, baca-cache, konservatif).
- **Fase 5 — Aksi.** Usul tiket teknisi otomatis (modem kronis) + maintenance prediktif (modem memburuk).
