# OLT Syslog Receiver — Setup & Operations

UDP syslog listener untuk OLT Hioso events realtime. Alternatif push-based ke
HTTP scrape (`lib/olt-log-scraper.js`) yang sebelumnya satu-satunya sumber
klasifikasi Dying Gasp vs LOS.

## GROUND TRUTH — tervalidasi tes fisik (OLT Hioso EPON, Jun 2026)

Dikonfirmasi dengan **mencabut langsung** di OLT produksi (192.168.11.2):

| Penyebab | Tanda tangan log | Penjelasan fisik |
|----------|------------------|------------------|
| **DG** (power adaptor cabut / PLN mati) | `dying-gasp` + `Lost` di **detik yang sama** | ONU pakai sisa kapasitor untuk kirim "dying-gasp" sebelum mati |
| **LOS** (fiber/FO cabut) | `Lost` **SAJA**, tanpa dying-gasp | ONU masih punya listrik → tidak sekarat → cuma diam. OLT kehilangan ONU |

Bukti LOS nyata: MAC `28:53:4E:D5:DB:B2` slot `0/1/1:22` saat fibernya dicabut
menghasilkan `Lost` tanpa dying-gasp — satu-satunya event seperti itu di antara
puluhan event DG yang semuanya berpasangan dying-gasp+Lost.

**Pembeda satu-satunya = kehadiran `dying-gasp` di log.** Ini dipakai sebagai
sumber kebenaran. Lihat test regresi `lib/__tests__/olt-event-classifier.test.js`
("ground truth regression").

### Kenapa BUKAN SNMP?

OLT Hioso EPON ini **tidak bisa deteksi dying-gasp via SNMP** (beda dengan OLT
GPON ZTE dll yang punya OID dying-gasp proper). OID `lastDownCause`
(`.1.3.6.1.4.1.25355.3.2.6.3.2.1.41`) **tidak membedakan** DG vs LOS — sudah
diverifikasi, nilainya tidak konsisten/tidak bermakna untuk tujuan ini. Jadi
SNMP resmi dicoret sebagai sumber klasifikasi; rxPower (lihat Phase 2) hanya
backup.

## Kenapa syslog (vs scrape)?

Scraper web UI sudah akurat untuk DG/LOS (baca log batch — dying-gasp & Lost
dua-duanya kelihatan). Syslog adalah upgrade keandalan & latensi:

Syslog lebih robust:

| Aspek | HTTP scrape | Syslog UDP |
|-------|-------------|------------|
| Latency event → bot | 0–60 detik (polling) | <1 detik (push) |
| Auth | Cookies + session web UI | Tidak perlu |
| Format dependency | Web UI format spesifik | RFC 3164 standar |
| Log rotation race | Possible miss | Tidak ada (push saat event) |
| Network direction | Bot ke OLT | OLT ke bot |

## Arsitektur

```
┌──────────────┐    UDP 5514     ┌────────────────────────────┐
│ OLT Hioso    │ ──────────────→ │ bot:                       │
│ syslog send  │  RFC 3164       │   lib/olt-syslog-receiver  │
└──────────────┘                 │   ↓                        │
                                 │   lib/olt-event-classifier │
                                 │   ↓                        │
                                 │   database/olt-events.json │
                                 └────────────────────────────┘
                                              ↑
                                         (sama file dengan
                                          scraper, source=syslog)
```

Classifier shared antara `olt-log-scraper.js` dan `olt-syslog-receiver.js` —
satu sumber kebenaran untuk regex parsing + DG correlation.

## Setup

### 1. Enable di bot

Edit `config.json` (atau via admin UI kalau sudah ada):

```json
{
  "oltSyslog": {
    "enabled": true,
    "port": 5514,
    "host": "0.0.0.0",
    "correlationWindowMs": 60000,
    "lostGraceMs": 4000
  }
}
```

- `port`: default `5514` supaya bisa run non-root. Standar syslog adalah `514`
  tapi butuh `CAP_NET_BIND_SERVICE` atau root.
- `host`: `0.0.0.0` listen di semua interface; ganti ke IP spesifik kalau perlu.
- `correlationWindowMs`: window untuk match DG → Lost. Default 60 detik.
- `lostGraceMs`: grace window untuk reorder-safety (lihat di bawah). Default 4 detik.

### Grace window — kenapa LOS ditahan ~4 detik

Data nyata: `dying-gasp` dan `Lost` datang di **detik yang sama**. Di syslog
(2 paket UDP terpisah), urutan tidak dijamin — kalau `Lost` diproses sebelum
`dying-gasp`, naif-nya kita salah vonis LOS padahal DG.

Solusi: saat `Lost` tiba **tanpa** dying-gasp pending, korelator **menahan**
keputusan selama `lostGraceMs`. Kalau dying-gasp menyusul dalam grace → emit DG.
Kalau lewat grace tetap tidak ada → baru emit LOS. Prinsip **"tidak pernah emit
klasifikasi salah"** — penting kalau ada auto-dispatch teknisi pada LOS.

Catatan:
- Kasus normal (DG dulu baru Lost) **tidak kena delay** — langsung DG.
- Hanya kasus Lost-tanpa-DG (true LOS atau reorder) yang ditahan ~4 detik.
- Delay 4 detik untuk vonis LOS tidak berdampak operasional (ONU offline juga).
- Jalur **scraper TIDAK pakai grace** — dia baca log batch, dying-gasp & Lost
  pasti dua-duanya terlihat sekaligus. Grace hanya untuk syslog realtime.

Restart bot. Cek log:
```
[OLT-Syslog] Listening on 0.0.0.0:5514
```

### 2. Enable forwarding di OLT Hioso

**Via CLI** (kalau ada akses):
```
config
logging on
logging host <BOT_IP> port 5514
logging level info
exit
write
```

Adjust `BOT_IP` ke alamat server raf-bot. Beberapa firmware Hioso pakai
command yang sedikit beda, mis. `syslog-server`/`snmp-trap`. Cek manual
sesuai versi firmware.

**Via Web UI** (kalau CLI tidak accessible):
1. Login web admin OLT
2. Menu **Maintenance** atau **System Management** → **Log Configuration**
3. Enable "Remote Log Server" / "Syslog Forwarding"
4. Server IP: bot IP, Port: `5514`, Protocol: UDP, Level: `Info` atau `Notice`
5. Save & apply

### 3. Verify event masuk

Dari sisi bot, monitor log stdout:
```
[OLT-Syslog] DYING-GASP C0F6EC1EFFDA from 10.0.0.1 slot=1 onu=4
[OLT-Syslog] LOS AABBCCDDEEFF from 10.0.0.1 slot=1 onu=7
```

Atau cek file `database/olt-events.json` — entries dengan `"source": "syslog"`.

Test manual: cabut sebentar adaptor power salah satu ONT (skenario DG):
- Setelah <2 detik, OLT mestinya kirim packet
- Bot log harus tampilkan `DYING-GASP <MAC>`
- File events ter-update

Test LOS skenario: cabut fiber ONT:
- Bot log: `LOS <MAC>`
- `correlated_with_dg: false` di JSON

## Troubleshooting

### Bot start tapi `[OLT-Syslog] Disabled`

Config `oltSyslog.enabled` belum `true`. Edit config.json + restart.

### Bot start, listen log muncul, tapi tidak ada event

Verify:
1. Firewall bot — open UDP 5514 inbound dari OLT IP
2. OLT config — pastikan forwarding aktif, IP/port benar
3. Network — `tcpdump -i any -n 'udp port 5514' -A` di bot, lihat packet masuk
4. OLT severity level — kalau set ke `error`, mungkin DG/LOS events skip. Naikkan ke `info` atau `notice`

### Bind failed: EADDRINUSE

Port 5514 sudah dipakai proses lain. Pilih port lain di config (mis. 5515) +
update config di OLT.

### Bind failed: EACCES

Port < 1024 butuh root/CAP_NET_BIND_SERVICE. Pakai port ≥ 1024 (5514 default).

### Event masuk tapi semua jadi LOS (tidak ada DG correlation)

DG event mungkin tidak diforward — cek apakah OLT log severity termasuk debug-level
untuk dying-gasp messages. Naikkan log level kalau perlu.

Atau: window 60 detik terlalu pendek. Naikkan `correlationWindowMs`.

## Parallel run dengan scraper

Saat ini scraper + syslog jalan bersamaan. Kedua menulis ke `olt-events.json`
yang sama. Strategi:

- Event source `syslog` (push, faster) biasanya menang race karena tiba lebih awal
- Event source `scrape` (polling, slower) sebagai backup
- `persistEvent()` di syslog receiver pakai timestamp comparison — entry yang
  lebih baru menang

Setelah 1–2 minggu monitoring (ratio syslog vs scrape events seimbang, tidak ada
miss), boleh disable scraper dengan menonaktifkan `webEnabled` di OLT config.

## Phase 2: rxPower correlation (sudah diimplementasi)

Phase 2 menambah sinyal optik untuk memperkuat klasifikasi DG vs LOS. Saat
offline event tiba via syslog, sistem cek riwayat rxPower ONU tersebut sebelum
ia mati:

- **Healthy + stabil** (`≥ -25 dBm`) lalu mati mendadak → menguatkan **Dying Gasp**
  (sinyal optik bagus, yang mati cuma power adaptor)
- **Menurun** (tren melemah, slope `≤ -0.5 dBm/menit`) → menguatkan **LOS**
  (degradasi/putus fiber)
- **Lemah** (`≤ -27 dBm`) → menguatkan **LOS**

Output event JSON sekarang punya field tambahan (additive, tidak break consumer lama):

```json
{
  "mac": "C0F6EC1EFFDA",
  "event_type": "los",
  "classification_confidence": 0.85,
  "signals": [
    { "source": "syslog", "indicator": "lost-without-dying-gasp", "hint": "los", "weight": 0 },
    { "source": "rxpower", "indicator": "...", "hint": "los", "weight": 0.25,
      "trend": "declining", "last_rx_before": -28.0,
      "reason": "rxPower menurun (-2.67 dBm/menit) sebelum offline — konsisten dengan LOS." }
  ],
  "source": "syslog",
  "correlated_with_dg": false
}
```

### Confidence model

`event_type` ditentukan oleh korelasi syslog (authoritative). `classification_confidence`
mengukur seberapa yakin label itu benar:

| event_type | Base confidence | Alasan |
|------------|-----------------|--------|
| `dying-gasp` | 0.85 | Pesan dying-gasp terlihat sebelum Lost |
| `los` | 0.60 | Lost tanpa DG — bisa jadi packet DG hilang di transit UDP |
| `discovery` | 1.00 | Recovery tidak ambigu |

rxPower yang **setuju** menaikkan confidence sebesar weight-nya; yang
**bertentangan** menurunkan setengah weight (flag ambiguitas, bukan override label).
Clamp `[0.3, 0.99]`.

Contoh nilai praktis:
- DG + rxPower healthy-stable → 0.85 + 0.15 = **0.99** (sangat yakin DG)
- DG + rxPower declining → 0.85 − 0.125 = **0.73** (mungkin fiber issue yang juga trigger DG sesaat)
- LOS + rxPower declining → 0.60 + 0.25 = **0.85** (yakin fiber)
- LOS + rxPower healthy → 0.60 − 0.075 = **0.53** (mungkin DG packet hilang — sebenarnya power outage)

Confidence rendah (< 0.6) = sinyal bertentangan → admin sebaiknya verifikasi manual.

### Enable Phase 2

```json
{
  "oltRxPowerHistory": {
    "enabled": true,
    "intervalMs": 60000
  }
}
```

- Poller SNMP berjalan tiap `intervalMs` (default 60 detik), sample rxPower
  semua ONU dari OLT enabled, simpan ring buffer 30 menit di memori.
- Tradeoff interval: lebih sering = resolusi korelasi lebih baik tapi beban SNMP
  lebih tinggi. 60 detik biasanya cukup.
- **Jam OLT tidak relevan**: setiap sample distempel jam server saat SNMP read,
  korelasi pakai jam server saat syslog diterima. Pipeline timing 100% independen
  dari jam OLT yang tidak sinkron.

Poller butuh OLT SNMP terkonfigurasi (`config.olt.devices[]` atau `config.olt`).
Cek status: lihat log `[OLT-rxPoller] Starting (interval: 60s)` saat boot.

## Catatan penting: independensi jam OLT

Jam OLT Hioso sering tidak sinkron (drift jauh). Seluruh pipeline DG/LOS
dirancang **tidak bergantung jam OLT sama sekali**:

| Tahap | Sumber waktu | Catatan |
|-------|--------------|---------|
| Syslog event diterima | `Date.now()` jam server saat packet tiba | Header timestamp OLT di-parse tapi **dibuang** untuk logika |
| Korelasi DG → Lost | Selisih jam server kedua packet | Bukan selisih jam OLT |
| rxPower sample | `Date.now()` saat SNMP read selesai | Ring buffer di-index jam server |
| Korelasi rxPower ↔ offline | `event.server_time` (jam server) | Tidak pernah pakai jam OLT |

Karena syslog & SNMP keduanya push/pull realtime (latency milidetik), jam server
saat terima ≈ waktu kejadian sebenarnya. Drift jam OLT tidak mempengaruhi apa pun.

## Future: Phase 3 (cluster detection) & Phase 4 (composite)

- **Phase 3** — PON-port + geografi clustering. N ONU offline simultan di area
  sama → mass-DG (PLN). 1 ONU isolated → LOS. Butuh customer location data
  (belum ada di DB current).

- **Phase 4** — Recommended action otomatis berdasar confidence + cluster:
  `{classification, confidence, signals[], recommended_action}`. Mis. "tunggu
  PLN restore" (mass-DG) vs "kirim teknisi cek fiber" (isolated LOS).

## LOS Auto-Broadcast ke Teknisi (sudah diimplementasi)

Realisasi sebagian Phase 3/4 untuk sisi LOS: saat event `los` (fiber putus, **bukan**
dying-gasp) terdeteksi, sistem otomatis broadcast WhatsApp ke seluruh teknisi.

**Modul:** `lib/olt-los-broadcaster.js` — di-hook dari:
- `olt-syslog-receiver.emitEvent()` (jalur utama, push, sudah ber-confidence).
- `olt-log-scraper.scrapeOltLog()` secara **edge-triggered** (hanya saat transisi
  LOS baru muncul / pulih), supaya meniru semantik push & broadcast sekali per insiden.

**Presisi (anti salah-panggil teknisi):**
1. **Confirmation window** (default 3 menit) — LOS ditahan; kalau ONU pulih
   (Discovery) dalam window → **batal** (anggap flap/kedip, bukan putus).
2. **Confidence gate** (default ≥ 0.6) — LOS confidence rendah → dicatat
   `low_confidence`, tidak broadcast.
3. **Cluster aggregation** — beberapa LOS terkonfirmasi dalam satu OLT digabung jadi
   1 pesan; bila ≥ `clusterThreshold` (default 3) → framing **"dugaan gangguan area/uplink"**.
4. **Dedup + cooldown** — 1 broadcast per insiden; MAC sama tidak di-broadcast ulang
   dalam `rebroadcastCooldownMs` (default 30 menit).

**Robust:** kirim via `sendCritical` (retry + dead-letter); insiden dipersist ke
`database/los-incidents.json` untuk audit + halaman admin.

**Penerima:** seluruh akun `role === 'teknisi'` yang punya `phone_number`.

**Catatan jam:** semua timer pakai `Date.now()` jam server (lihat bagian independensi
jam OLT di atas). Timer in-memory & ber-`unref()`; bila proses restart saat window
berjalan, insiden tetap tercatat untuk review manual.

### Config (`config.json`)

```json
{
  "oltLosBroadcast": {
    "enabled": true,
    "confidenceThreshold": 0.6,
    "confirmationWindowMs": 180000,
    "clusterFlushMs": 20000,
    "clusterThreshold": 3,
    "rebroadcastCooldownMs": 1800000,
    "notifyCustomer": {
      "enabled": false,
      "delayMs": 3600000,
      "onlyIfStillDown": true,
      "messageTemplate": ""
    }
  }
}
```

Default **OFF** (`enabled: false`). Aktifkan + atur via halaman admin **LOS Broadcast
(Fiber)** di menu Komunikasi (`/los-broadcast`), atau API `/api/admin/los-broadcast/*`.

### Arti `confidenceThreshold` (0–1)

Tiap LOS diberi skor keyakinan (`classification_confidence`) oleh classifier +
rxPower: **1.0** = sangat yakin fiber putus, **0.6** = cukup yakin (LOS tanpa
dying-gasp), **< threshold** → tidak auto-broadcast (dicatat `low_confidence`).
Naikkan untuk lebih hati-hati; turunkan untuk lebih sensitif.

### `rebroadcastCooldownMs` = anti-kedip (BUKAN pengulangan)

**1 insiden = 1 broadcast.** Sekali LOS sebuah modem di-broadcast, modem itu masuk
daftar *insiden aktif* dan TIDAK di-broadcast lagi sampai pulih (Discovery).
`rebroadcastCooldownMs` hanya mencegah modem yang *turun-naik-turun cepat* (flapping)
memicu alert baru berulang dalam jeda tersebut. Map `lastBroadcast` di-prune otomatis
saat membengkak (anti memory-leak).

### Notifikasi pelanggan otomatis (`notifyCustomer`)

Opsional. Setelah teknisi diberi tahu, jadwalkan info ke **pelanggan** bahwa
koneksinya terdeteksi putus:
- `enabled` — default OFF.
- `delayMs` — jeda setelah teknisi diberi tahu (default 1 jam).
- `onlyIfStillDown` — bila `true` (disarankan), batal kirim jika modem sudah pulih
  sebelum jeda berakhir.
- `messageTemplate` — placeholder: `{customer_name}`, `{address}`, `{mac}`, `{slot}`,
  `{onu}`, `{company_name}`. Kosong → pakai template default.

Pelanggan hanya bisa dinotifikasi bila MAC ONU bisa dipetakan ke data pelanggan
(resolver best-effort/offline berbasis field MAC di record user, atau resolver custom
yang di-inject). Bila tak teridentifikasi → insiden ditandai `customer_unresolved`.

### Beda dengan Auto Outage

| | LOS Broadcast (ini) | Auto Outage |
|---|---|---|
| Sumber | OLT (layer optik) | MikroTik PPPoE |
| Pemicu | Event LOS, segera | Ambang waktu offline (~jam) |
| Bisa bedakan DG vs LOS? | **Ya** | Tidak |
| Tujuan | Teknisi (dispatch fiber) | Pelanggan / tiket |
