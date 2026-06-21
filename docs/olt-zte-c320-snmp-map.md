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
| **4** | `...3.28.2.1.4` | **Phase-state LIVE (status saat ini)** | **3=working, 1=LOS, 4=DyingGasp, 6=OffLine** |
| 5 | `...3.28.2.1.5` | Waktu authpass/online terakhir | `"2004-06-26 22:54:10"` (⚠️ jam OLT = 2004) |
| 6 | `...3.28.2.1.6` | Waktu offline terakhir | `"2004-06-26 22:50:01"` (⚠️ jam OLT) |
| **7** | `...3.28.2.1.7` | **Penyebab offline TERAKHIR (persist)** | **1=none, 2=LOS, 3=LOSi, 5=SFi, 9=DyingGasp** |

> ✅ **DIVERIFIKASI live vs CLI `show gpon onu detail-info` (2026-06-22):** status SAAT INI diambil
> dari **col4** (baris "Phase state": working/LOS/DyingGasp/OffLine), BUKAN col7. **col7** = penyebab
> offline terakhir (cocok kolom "Cause" histori CLI), persist walau ONU sudah online lagi. ZTE
> membedakan LOS vs Dying Gasp NATIVE via SNMP (beda HIOSO yang butuh syslog). Driver `classifyStatus`
> memakai col4→status, col7→lastDownCause(label). ⚠️ Jam OLT = 2004 (belum NTP) → timestamp col5/col6
> absolut tak andal; pakai "Online Duration" dari detail-info bila perlu durasi.

## Optik / DDM — `1.3.6.1.4.1.3902.1012.3.50.12.1.1.<col>.<pon>.<onu>.1`

Kolom `.10` = ONU RX power (downstream), `.14` = ONU TX (upstream); sub-index `.1`.
✅ **DIVERIFIKASI vs CLI `show pon power onu-rx` (2026-06-22): `dBm = signed16(raw)/500 − 30`**
(mis. 1/2/1:1 SNMP −24.81 vs CLI −24.814, selisih ≤0.01 dB). raw 65535 = no-signal. Encoding lama
`−raw/100` SALAH. Atenuasi downstream ≈ launch 6.7 − rx. **Optik diambil via GET batch KONKUREN
(bukan walk DDM ~28s) hanya ONU online — lihat `fetchOpticsConcurrent` di `lib/olt-drivers/zte.js`.**

Tabel hardware ONU (bukan power): `...3.50.11.2.1.1`=vendor `ZTEG`, `...3.50.11.2.1.2`=versi `V9.0`.

## ✅ Verifikasi SELESAI (live SNMP + SSH, 2026-06-22)

1. ✅ **Skala RX power** `.50.12.1.1.10`: `dBm = signed16(raw)/500 − 30` (vs `show pon power onu-rx`,
   selisih ≤0.01 dB). Bukan `−raw/100`. Kolom `.14` = ONU TX.
2. ✅ **Status & penyebab**: status LIVE dari **col4** `.28.2.1.4` (3=working,1=LOS,4=DyingGasp,6=OffLine);
   **col7** `.28.2.1.7` = penyebab terakhir (1=none,2=LOS,3=LOSi,5=SFi,9=DyingGasp), cocok CLI detail-info.
   `classifyStatus` memetakan keduanya. Reboot/PowerOff tampil di CLI tapi kode SNMP-nya belum teramati
   live (tambahkan ke `ZTE_LAST_CAUSE` saat ketemu).
3. ✅ **Kolom 2 (`.28.1.1.2`) = username PPPoE** dikonfirmasi (`caper@suwito`, `kendung@ishaq`, dst).

> Dampak: poller `lib/olt-snmp-los-poller.js` (yang broadcast WA fiber-putus ke pelanggan) bergantung
> pada `status==='LOS'` dari driver. Sebelum fix ini driver TAK PERNAH mengembalikan 'LOS' (enum di
> kolom salah) → notifikasi LOS dorман. Sekarang aktif & akurat (DyingGasp/Offline sengaja tak di-broadcast).

## ✅ Hasil smoke test driver (live, 2026-06-05)

`node scripts/olt-zte-smoke.js <host> <community> <port>` → driver `lib/olt-drivers/zte.js`:
- `detectBrand → zte` (auto-deteksi enterprise 3902 jalan).
- **608 ONU ter-parse**, status: `Online 495, Offline 98, LOS 15` (cocok histogram phaseState).
- Serial ✓ (`ZTEGD5D42874`), **deskripsi = username PPPoE ✓** (`caper@suwito`, `caper@lurah`).
- RX power realistis ✓: −10.20 / −12.76 / −26.57 / −28.41 dBm (rentang GPON wajar → skala `−raw/100` makin yakin).
- Full walk 608 ONU ≈ 24 dtk (perlu cache seperti HIOSO untuk poll rutin).

### Refinement diketahui (belum kritis)
- **ponName**: `ifName[ponIfIndex]` malah menghasilkan `xgei_1/3/2` (bukan `gpon_…`). Lebih baik
  pakai kolom `.28.1.1.3` (`ONU-1:1`) sebagai label PON/ONU human. (Kosmetik; data inti benar.)
- **offlineReason enum** masih provisional (LOS=15 terdeteksi, tapi kode persis belum diverifikasi CLI).

## Capabilities driver ZTE (rencana)

```
{ losViaSnmp: true, dyingGaspViaSnmp: true, needsWebScrape: false,
  needsSyslog: false, primaryIdentifier: 'pppoe-desc' (lalu serial) }
```
Tidak perlu web-scraper/syslog seperti HIOSO — status & penyebab offline tersedia native via SNMP.
