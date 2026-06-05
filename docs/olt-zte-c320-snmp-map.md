# Peta SNMP OLT ZTE C320 (discovery) — modal driver GPON Fase 2

Hasil discovery langsung dari OLT ZTE C320 asli (milik teman, Jember).
Device: **C320 Version V2.1.0**, enterprise **3902** (ZXAN), sysObjectID `1.3.6.1.4.1.3902.1082.1001.320.2.1`.
608 ONU terdaftar (~495 online). Probe READ-ONLY via `net-snmp`, community `onewanro`, port UDP 1601.

Skrip discovery: `scripts/olt-zte-probe.js`, `scripts/olt-zte-discovery.js`,
`scripts/olt-zte-columns.js`, `scripts/olt-zte-hist.js`. Dump mentah: `scripts/out/` (gitignored).

## Model index ONU

ONU di-key oleh `<ponIfIndex>.<onuId>`:
- `ponIfIndex` = ifIndex port GPON (besar, mis. `268566784`), nama port via `ifName` (`1.3.6.1.2.1.31.1.1.1.1.<ifIndex>` → `"gpon_1/2/1"`).
- `onuId` = nomor ONU di PON (1..N).
- Tabel DDM optik menambah sub-index `.1` → `<ponIfIndex>.<onuId>.1`.

## Tabel info ONU — `1.3.6.1.4.1.3902.1012.3.28.1.1.<col>.<pon>.<onu>`

| col | OID | Isi | Contoh |
|----|-----|-----|--------|
| 1 | `...3.28.1.1.1` | Model ONU | `F609` |
| **2** | `...3.28.1.1.2` | **Deskripsi ONU = username PPPoE pelanggan** | `caper@suwito`, `caper@lurah` |
| 3 | `...3.28.1.1.3` | Label port ONU | `ONU-1:1` |
| 4 | `...3.28.1.1.4` | Vendor id | `CZTE` |
| **5** | `...3.28.1.1.5` | **Serial Number GPON** (OctetString 8 byte: 4 ASCII `ZTEG` + 4 hex) | hex `5a544547d5d42874` → `ZTEGD5D42874` |

> **Matching pelanggan:** kolom 2 (deskripsi) berisi username PPPoE persis. Untuk ISP ini, match
> ONU→pelanggan paling andal lewat **`pppoe_username === onu.description`**, bukan MAC.
> Fallback: Serial (kolom 5). Sesuai keputusan "MAC-first fallback serial", di GPON urutannya
> jadi **description(pppoe) → serial**. (Belum ditemukan kolom MAC ONU di tabel ini.)

## Tabel status ONU — `1.3.6.1.4.1.3902.1012.3.28.2.1.<col>.<pon>.<onu>`

| col | OID | Isi | Distribusi (608 ONU) |
|----|-----|-----|----------------------|
| **3** | `...3.28.2.1.3` | **Phase state (online)** | `6×495, 0×113` → **6=online, 0=offline** |
| 4 | `...3.28.2.1.4` | Config state | `3×495` (3=working), 6/4/1 utk offline |
| 5 | `...3.28.2.1.5` | Waktu online terakhir | `"2004-06-09 09:50:54"` (jam OLT) |
| 6 | `...3.28.2.1.6` | Waktu offline terakhir | `"2004-06-09 09:48:53"` |
| **7** | `...3.28.2.1.7` | **Penyebab offline terakhir** | `9×455, 3×84, 1×67, 2×1, 5×1` |

> col7 = enum penyebab offline ZTE (`zxGponOnuLastOfflineCause`-ish). 9 ≈ normal/online.
> 1/2/3/5 = penyebab offline → **inilah pembeda LOS vs Dying Gasp** (ZTE bisa via SNMP, beda dari HIOSO).
> ⚠️ Mapping persis tiap kode BELUM dipastikan — perlu verifikasi (lihat bawah).

## Optik / DDM — `1.3.6.1.4.1.3902.1012.3.50.12.1.1.<col>.<pon>.<onu>.1`

Kolom `.10` = nilai bervariasi per-ONU, **n=528 (hanya online)** → **kandidat RX power**.
Contoh raw: `2593, 1276, 2841`.
Dugaan encoding: **dBm = −(raw / 100)** → −25.93 / −12.76 / −28.41 dBm (pas rentang GPON).
⚠️ Skala BELUM diverifikasi.

Tabel hardware ONU (bukan power): `...3.50.11.2.1.1`=vendor `ZTEG`, `...3.50.11.2.1.2`=versi `V9.0`.

## ⚠️ Yang WAJIB diverifikasi sebelum/saber integrasi (butuh akses CLI OLT)

1. **Skala RX power** kolom `.50.12.1.1.10`: ambil 1–2 ONU, bandingkan dengan
   `show gpon onu detail-info gpon-onu_1/x/x:y` (atau `show pon power onu-rx`) di OLT.
   Konfirmasi rumus `dBm = −(raw/100)` (atau cari faktor/offset sebenarnya, mungkin ada kolom TX juga).
2. **Enum `offlineReason` `.28.2.1.7`**: kode mana = LOS, mana = Dying Gasp (LCDG/power-off),
   mana = admin-down. Cross-check dgn `show gpon onu ... | offline-cause` atau MIB ZXAN.
3. **Konfirmasi kolom 2 (`.28.1.1.2`) memang = username PPPoE** untuk sample pelanggan nyata
   (cocokkan dengan `users.pppoe_username` di DB).

## Capabilities driver ZTE (rencana)

```
{ losViaSnmp: true, dyingGaspViaSnmp: true, needsWebScrape: false,
  needsSyslog: false, primaryIdentifier: 'pppoe-desc' (lalu serial) }
```
Tidak perlu web-scraper/syslog seperti HIOSO — status & penyebab offline tersedia native via SNMP.
