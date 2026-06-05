# OLT Syslog Receiver — Setup & Operations

UDP syslog listener untuk OLT Hioso events realtime. Alternatif push-based ke
HTTP scrape (`lib/olt-log-scraper.js`) yang sebelumnya satu-satunya sumber
klasifikasi Dying Gasp vs LOS.

## Kenapa syslog?

OLT Hioso firmware tidak expose OID SNMP yang membedakan **Dying Gasp** (DG —
adaptor mati/PLN outage) dari **LOS** (Loss of Signal — fiber putus). Keduanya
muncul sebagai `lastDownCause = 1` di OID `.1.3.6.1.4.1.25355.3.2.6.3.2.1.41`.

Workaround sebelumnya: scrape web UI log dengan polling 1 menit, regex parse
text, korelasi DG-then-Lost dalam window 60 detik.

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
    "correlationWindowMs": 60000
  }
}
```

- `port`: default `5514` supaya bisa run non-root. Standar syslog adalah `514`
  tapi butuh `CAP_NET_BIND_SERVICE` atau root.
- `host`: `0.0.0.0` listen di semua interface; ganti ke IP spesifik kalau perlu.
- `correlationWindowMs`: window untuk match DG → Lost. Default 60 detik.

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

## Future: Phase 2 (rxPower correlation) & Phase 3 (cluster detection)

Phase 1 ini cuma syslog dasar. Roadmap selanjutnya:

- **Phase 2** — Track rxPower trend per ONU (ring buffer 30 menit). Saat event
  offline tiba, lookup rxPower 60 detik sebelumnya:
  - Healthy (`> -25 dBm`) lalu langsung offline → DG hint
  - Declining trend lalu offline → LOS hint
  - Tambah `signals[]` ke event JSON dengan confidence weighted

- **Phase 3** — PON-port + geografi clustering. N ONU offline simultan di area
  sama → mass-DG (PLN). 1 ONU isolated → LOS. Butuh customer location data
  (belum ada di DB current).

- **Phase 4** — Confidence scoring composite dari semua sinyal (syslog +
  rxPower + cluster). Output `{classification, confidence, signals[], recommended_action}`.
