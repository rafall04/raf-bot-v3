/**
 * Header Doc
 * Purpose: Halaman legal/compliance publik untuk verifikasi merchant gateway pembayaran
 *   (iPaymu/Mayar) DAN kredibilitas usaha: FAQ, Kebijakan Pengembalian Dana, Syarat &
 *   Ketentuan, dan Kontak (wajib menampilkan email, telepon, alamat usaha). Konten diisi
 *   dinamis dari `global.config` (company, tanggal_isolir) dan daftar paket `global.packages`
 *   sehingga akurat dengan operasional nyata (harga paket, tanggal isolir, alur bot WA).
 * Caller: lib/routes-registry (mount di "/"). Path terdaftar di PUBLIC_PATHS (tanpa login).
 * Deps: express, global.config (company/nama/telfon/adminPhone/tanggal_isolir), global.packages.
 * MainFuncs: GET /faq, GET /refund-policy, GET /syarat-ketentuan, GET /kontak.
 * SideEffects: Tidak ada (render HTML dari config; read-only).
 */
"use strict";

const express = require("express");
const router = express.Router();

// Tanggal revisi dokumen legal (ubah manual saat konten diperbarui).
const LAST_UPDATED = "2 Juli 2026";

function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
}

function formatRupiah(value) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    return "Rp" + n.toLocaleString("id-ID");
}

// Info bisnis dari config. Fallback berlapis; abaikan nilai placeholder ("ISI_...").
function biz() {
    const cfg = global.config || {};
    const c = cfg.company || {};
    const clean = (v) => {
        const s = String(v == null ? "" : v).trim();
        return /^ISI_/i.test(s) || s === "" ? "" : s;
    };
    const phone = clean(c.phone) || clean(cfg.telfon) || clean(cfg.adminPhone);
    return {
        name: clean(c.name) || clean(cfg.nama) || "RAF NET",
        address: clean(c.address),
        phone,
        email: clean(c.email),
        website: clean(c.website),
        logo: clean(c.logoPath),
        isolirDay: parseInt(cfg.tanggal_isolir, 10) || 16,
    };
}

// Daftar paket publik (untuk FAQ harga) — buang voucher/whitelist/tak berharga.
function publicPackages() {
    const pkgs = Array.isArray(global.packages) ? global.packages : [];
    return pkgs
        .filter((p) => p && p.name && p.name !== "PAKET-VOUCHER" && p.whitelist !== true)
        .map((p) => ({ name: String(p.name), price: formatRupiah(p.price) }))
        .filter((p) => p.price)
        .slice(0, 12);
}

function waLink(phone) {
    const d = String(phone || "").replace(/\D/g, "");
    if (!d) return "";
    const intl = d.startsWith("0") ? `62${d.slice(1)}` : d.startsWith("62") ? d : `62${d}`;
    return `https://wa.me/${intl}`;
}

const ICON = {
    wa: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm5.8 14.15c-.24.68-1.42 1.32-1.95 1.36-.5.05-.97.24-3.27-.68-2.77-1.09-4.53-3.92-4.67-4.1-.14-.19-1.12-1.49-1.12-2.84 0-1.35.71-2.01.96-2.29.24-.27.53-.34.71-.34.18 0 .36.002.51.01.16.007.38-.06.6.46.24.56.79 1.94.86 2.08.07.14.12.31.02.5-.09.19-.14.31-.28.48-.14.16-.29.36-.42.48-.14.14-.28.29-.12.56.16.27.71 1.17 1.53 1.9 1.05.94 1.94 1.23 2.21 1.37.27.14.43.12.59-.07.16-.19.68-.79.86-1.06.18-.27.36-.22.6-.13.24.09 1.53.72 1.79.85.27.14.44.2.51.31.07.11.07.64-.17 1.32z"/></svg>`,
    mail: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>`,
    pin: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`,
    globe: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/></svg>`,
    clock: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
};

const CSS = `
:root{--brand:#4338ca;--brand2:#6366f1;--ink:#0f172a;--body:#334155;--muted:#64748b;
--line:#e5e7eb;--bg:#f1f5f9;--card:#fff;--ok:#059669;--warn:#b45309;--radius:16px;
--shadow:0 1px 2px rgba(15,23,42,.05),0 12px 28px -16px rgba(15,23,42,.18)}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
background:var(--bg);color:var(--body);line-height:1.75;font-size:16px;-webkit-font-smoothing:antialiased}
a{color:var(--brand);text-decoration:none}a:hover{text-decoration:underline}
.site-header{background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff;
box-shadow:0 10px 30px -18px rgba(67,56,202,.9)}
.bar{max-width:920px;margin:0 auto;padding:20px}
.brand{display:flex;align-items:center;gap:13px}
.brand .logo{width:46px;height:46px;border-radius:12px;background:#fff;color:var(--brand);
display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;overflow:hidden;flex:none;
box-shadow:0 4px 12px rgba(0,0,0,.15)}
.brand .logo img{width:100%;height:100%;object-fit:cover}
.brand h1{font-size:20px;margin:0;font-weight:800;letter-spacing:-.01em}
.brand .tag{font-size:12.5px;opacity:.9;margin-top:1px}
.nav{display:flex;flex-wrap:wrap;gap:6px;margin-top:16px}
.nav a{color:#fff;font-size:13.5px;padding:7px 13px;border-radius:999px;opacity:.92;
background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.16)}
.nav a:hover{background:rgba(255,255,255,.22);text-decoration:none;opacity:1}
.nav a.active{background:#fff;color:var(--brand);font-weight:600;opacity:1}
.wrap{max-width:920px;margin:0 auto;padding:30px 20px 44px}
.page-title{font-size:27px;color:var(--ink);margin:2px 0 4px;font-weight:800;letter-spacing:-.02em;line-height:1.2}
.page-sub{color:var(--muted);margin:0 0 8px;font-size:15px}
.updated{color:var(--muted);font-size:12.5px;margin:0 0 24px}
.updated b{color:var(--body);font-weight:600}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
box-shadow:var(--shadow);padding:26px 28px;margin-bottom:22px}
.card.tight{padding:10px 12px}
.lead{font-size:16px;color:var(--body)}
h2.sec{font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:var(--brand);
margin:0 0 14px;font-weight:700}
.card h3{font-size:17px;color:var(--ink);margin:22px 0 6px;font-weight:700}
.card h3:first-child{margin-top:4px}
p{margin:0 0 12px}ul{margin:0 0 14px;padding-left:20px}li{margin:6px 0}
.muted{color:var(--muted)}.small{font-size:14px}
/* FAQ accordion */
details.qa{border:1px solid var(--line);border-radius:12px;margin:10px 0;overflow:hidden;background:#fff;transition:border-color .15s}
details.qa[open]{border-color:#c7d2fe;box-shadow:0 6px 18px -14px rgba(67,56,202,.6)}
details.qa>summary{cursor:pointer;list-style:none;padding:15px 18px;font-weight:600;color:var(--ink);
display:flex;justify-content:space-between;gap:14px;align-items:center;font-size:15.5px}
details.qa>summary::-webkit-details-marker{display:none}
details.qa>summary::after{content:"+";font-size:20px;color:var(--brand);font-weight:700;flex:none;transition:transform .2s}
details.qa[open]>summary::after{transform:rotate(45deg)}
details.qa .a{padding:0 18px 16px;color:var(--body)}
.cat{margin:26px 0 6px;font-size:15px;font-weight:800;color:var(--ink);display:flex;align-items:center;gap:9px}
.cat:first-child{margin-top:4px}
.cat .n{width:26px;height:26px;border-radius:8px;background:#eef2ff;color:var(--brand);
display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex:none}
/* price table */
.pkg{width:100%;border-collapse:collapse;margin:6px 0 2px;font-size:15px}
.pkg th,.pkg td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line)}
.pkg th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.pkg td.price{text-align:right;font-weight:700;color:var(--ink);white-space:nowrap}
/* TOC */
.toc{background:#f8fafc;border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin-bottom:22px}
.toc b{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:8px}
.toc ol{margin:0;padding-left:20px;columns:2;column-gap:26px}
.toc li{margin:4px 0;font-size:14px}
.legal h3{scroll-margin-top:20px}
.legal h3 .no{color:var(--brand)}
/* contact */
.cgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.citem{display:flex;gap:13px;align-items:flex-start;padding:16px;border:1px solid var(--line);
border-radius:13px;background:#fff}
.citem .ic{width:40px;height:40px;border-radius:10px;background:#eef2ff;color:var(--brand);
display:flex;align-items:center;justify-content:center;flex:none}
.citem .k{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:3px}
.citem .v{color:var(--ink);font-weight:600;font-size:15px;word-break:break-word}
.citem .v a{font-weight:600}
.cta{display:inline-flex;align-items:center;gap:9px;background:#25d366;color:#fff;font-weight:700;
padding:13px 22px;border-radius:12px;margin-top:6px;font-size:15px}
.cta:hover{background:#1eb658;text-decoration:none;color:#fff}
.dept{display:grid;grid-template-columns:1fr;gap:10px;margin-top:8px}
.dept .row{display:flex;gap:12px;padding:12px 14px;background:#f8fafc;border:1px solid var(--line);border-radius:11px}
.dept .row b{color:var(--ink)}
.note{background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:11px;padding:13px 16px;font-size:14px;margin-top:16px}
footer{border-top:1px solid var(--line);background:#fff}
.foot{max-width:920px;margin:0 auto;padding:26px 20px;display:flex;flex-wrap:wrap;gap:24px;justify-content:space-between}
.foot .col b{color:var(--ink);font-size:14px;display:block;margin-bottom:8px}
.foot .col{font-size:13.5px;color:var(--muted);max-width:320px}
.foot .col a{color:var(--muted)}.foot .flinks a{display:inline-block;margin:0 12px 6px 0}
.copy{border-top:1px solid var(--line);text-align:center;padding:16px;color:var(--muted);font-size:12.5px}
@media(max-width:640px){.cgrid,.toc ol{grid-template-columns:1fr;columns:1}.card{padding:20px}.page-title{font-size:23px}}
`;

function header(active) {
    const b = biz();
    const logoInner = b.logo
        ? `<img src="${esc(b.logo)}" alt="${esc(b.name)}" onerror="this.style.display='none';this.parentNode.textContent='${esc(b.name.charAt(0))}'">`
        : esc(b.name.charAt(0) || "R");
    const nav = [
        ["/faq", "FAQ"],
        ["/refund-policy", "Kebijakan Refund"],
        ["/syarat-ketentuan", "Syarat & Ketentuan"],
        ["/kontak", "Kontak"],
    ].map(([href, label]) => `<a href="${href}"${href === active ? ' class="active"' : ""}>${label}</a>`).join("");
    return `<header class="site-header"><div class="bar">` +
        `<div class="brand"><div class="logo">${logoInner}</div>` +
        `<div><h1>${esc(b.name)}</h1><div class="tag">Penyelenggara Layanan Internet Lokal / RTRW-Net` +
        `${b.website ? ` &middot; ${esc(b.website.replace(/^https?:\/\//, ""))}` : ""}</div></div></div>` +
        `<nav class="nav">${nav}</nav></div></header>`;
}

function footer() {
    const b = biz();
    const wa = waLink(b.phone);
    const contactLines = [
        b.address ? esc(b.address) : "",
        b.phone ? `Telp/WA: ${esc(b.phone)}` : "",
        b.email ? `Email: <a href="mailto:${esc(b.email)}">${esc(b.email)}</a>` : "",
    ].filter(Boolean).join("<br>");
    return `<footer><div class="foot">` +
        `<div class="col"><b>${esc(b.name)}</b>${contactLines || esc(b.name)}<br>Jam layanan: setiap hari 08.00–16.00 WIB` +
        `${wa ? `<br><br><a href="${esc(wa)}">Hubungi via WhatsApp →</a>` : ""}</div>` +
        `<div class="col flinks"><b>Informasi</b>` +
        `<a href="/faq">FAQ</a><a href="/refund-policy">Kebijakan Refund</a>` +
        `<a href="/syarat-ketentuan">Syarat &amp; Ketentuan</a><a href="/kontak">Kontak</a>` +
        `${b.website ? `<a href="${esc(b.website)}">Website Utama</a>` : ""}</div>` +
        `</div><div class="copy">&copy; ${new Date().getFullYear()} ${esc(b.name)}. Seluruh hak cipta dilindungi. &middot; Dokumen diperbarui ${esc(LAST_UPDATED)}</div></footer>`;
}

function page(active, title, description, contentHtml) {
    const b = biz();
    return `<!doctype html><html lang="id"><head><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<meta name="description" content="${esc(description)}">` +
        `<meta name="robots" content="index,follow">` +
        `<title>${esc(title)} — ${esc(b.name)}</title>` +
        `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` +
        `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">` +
        `<style>${CSS}</style></head><body>` +
        header(active) + `<main class="wrap">${contentHtml}</main>` + footer() + `</body></html>`;
}

function qa(q, a) {
    return `<details class="qa"><summary>${q}</summary><div class="a">${a}</div></details>`;
}

// ---------------------------------------------------------------- FAQ
router.get("/faq", (req, res) => {
    const b = biz();
    const wa = waLink(b.phone);
    const waHtml = b.phone ? `<b>${esc(b.phone)}</b>` : "kanal resmi kami";
    const pkgs = publicPackages();
    const pkgTable = pkgs.length
        ? `<table class="pkg"><thead><tr><th>Paket</th><th style="text-align:right">Biaya / bulan</th></tr></thead><tbody>` +
            pkgs.map((p) => `<tr><td>${esc(p.name)}</td><td class="price">${esc(p.price)}</td></tr>`).join("") +
            `</tbody></table><p class="small muted">Harga dapat berubah sewaktu-waktu; daftar paket terbaru dapat dikonfirmasi melalui ${waHtml}.</p>`
        : `<p>Silakan hubungi ${waHtml} untuk daftar paket dan tarif terbaru yang tersedia di lokasi Anda.</p>`;

    const content =
        `<h1 class="page-title">Pertanyaan yang Sering Diajukan</h1>` +
        `<p class="page-sub">Panduan lengkap seputar layanan, pemasangan, tagihan, pembayaran, dan bantuan teknis ${esc(b.name)}.</p>` +
        `<p class="updated">Terakhir diperbarui: <b>${esc(LAST_UPDATED)}</b></p>` +

        `<div class="card tight">` +
        `<div class="cat"><span class="n">A</span> Layanan &amp; Pemasangan</div>` +
        qa("Layanan apa yang disediakan " + esc(b.name) + "?",
            `<p>Kami adalah penyelenggara layanan akses internet lokal (RTRW-Net) yang menyediakan koneksi internet berlangganan bulanan berbasis kabel fiber/nirkabel untuk kebutuhan rumah tangga dan usaha di area jangkauan kami.</p>`) +
        qa("Apakah lokasi saya terjangkau?",
            `<p>Ketersediaan bergantung pada jangkauan jaringan di wilayah Anda. Kirimkan titik lokasi/alamat Anda melalui WhatsApp ke ${waHtml} — tim kami akan melakukan survei kelayakan sinyal dan mengonfirmasi ketersediaan.</p>`) +
        qa("Bagaimana cara berlangganan?",
            `<p>Prosesnya sederhana:</p><ul>` +
            `<li>Hubungi kami melalui WhatsApp/telepon di ${waHtml}.</li>` +
            `<li>Tim melakukan survei kelayakan jaringan di lokasi Anda.</li>` +
            `<li>Setelah disetujui, dijadwalkan pemasangan perangkat oleh teknisi.</li>` +
            `<li>Layanan aktif dan Anda menerima data akun serta informasi tagihan.</li></ul>`) +
        qa("Berapa biaya dan berapa lama pemasangan?",
            `<p>Biaya pemasangan (jika ada) dan estimasi waktu akan diinformasikan saat survei, karena bergantung pada jarak, perangkat, dan kondisi lokasi. Pada umumnya pemasangan dijadwalkan dalam beberapa hari kerja setelah kesepakatan.</p>`) +
        qa("Apa saja paket dan tarifnya?", pkgTable) +

        `<div class="cat"><span class="n">B</span> Tagihan &amp; Pembayaran</div>` +
        qa("Kapan tagihan terbit dan jatuh tempo?",
            `<p>Layanan bersifat <b>prabayar bulanan</b>. Tagihan periode berjalan terbit di awal bulan. Kami menyarankan pembayaran sebelum tanggal <b>${b.isolirDay}</b> setiap bulan untuk menghindari penonaktifan layanan.</p>`) +
        qa("Bagaimana cara membayar tagihan?",
            `<p>Tersedia beberapa metode:</p><ul>` +
            `<li><b>Pembayaran online</b> melalui tautan resmi yang kami kirimkan via WhatsApp — mendukung QRIS, Virtual Account bank, dan gerai retail (Alfamart/Indomaret). Layanan otomatis aktif kembali setelah pembayaran terverifikasi.</li>` +
            `<li><b>Tunai</b> kepada petugas resmi kami.</li></ul>` +
            `<p class="small muted">Pastikan pembayaran dilakukan melalui tautan resmi atau petugas resmi ${esc(b.name)} yang dikirimkan lewat nomor resmi kami.</p>`) +
        qa("Bagaimana cara mengecek status tagihan saya?",
            `<p>Kirim pesan ke bot WhatsApp resmi kami${b.phone ? ` (${esc(b.phone)})` : ""} dengan kata kunci <b>cek tagihan</b>. Anda akan menerima status tagihan beserta tautan pembayaran bila belum lunas.</p>`) +
        qa("Apa yang terjadi jika saya terlambat membayar?",
            `<p>Jika tagihan belum dilunasi hingga melewati masa tenggang, layanan akan <b>dinonaktifkan sementara (isolir)</b> secara otomatis pada sekitar tanggal <b>${b.isolirDay}</b>. Layanan akan aktif kembali otomatis setelah pembayaran diterima dan terverifikasi.</p>`) +
        qa("Bisakah saya membayar di muka untuk beberapa bulan?",
            `<p>Bisa. Silakan sampaikan kepada petugas/admin kami untuk mencatat pembayaran di muka beberapa bulan sekaligus, agar Anda terhindar dari risiko lupa bayar dan penonaktifan.</p>`) +
        qa("Apakah saya mendapat bukti/struk pembayaran?",
            `<p>Ya. Setelah pembayaran terverifikasi, struk digital dikirimkan otomatis ke WhatsApp Anda sebagai bukti sah pembayaran. Simpan struk tersebut untuk keperluan administrasi.</p>`) +

        `<div class="cat"><span class="n">C</span> Gangguan &amp; Bantuan</div>` +
        qa("Internet saya lambat atau mati, apa yang harus dilakukan?",
            `<p>Langkah awal yang disarankan:</p><ul>` +
            `<li>Periksa lampu indikator pada perangkat/modem Anda.</li>` +
            `<li>Coba matikan perangkat 30 detik lalu nyalakan kembali (restart).</li>` +
            `<li>Pastikan tagihan dalam keadaan lunas.</li>` +
            `<li>Jika masih bermasalah, laporkan ke ${waHtml}.</li></ul>`) +
        qa("Bagaimana cara melaporkan gangguan?",
            `<p>Laporkan melalui WhatsApp resmi kami di ${waHtml}. Sertakan nama pelanggan dan kendala yang dialami agar tim teknisi dapat menindaklanjuti dengan cepat.</p>`) +
        qa("Kapan jam layanan dan berapa lama respons pengaduan?",
            `<p>Kami melayani setiap hari pukul <b>08.00–16.00 WIB</b>. Pengaduan gangguan ditindaklanjuti secepatnya sesuai antrean dan tingkat kendala; gangguan besar/masal menjadi prioritas.</p>`) +
        qa("Apakah ada kompensasi jika terjadi gangguan lama?",
            `<p>Untuk gangguan yang berkepanjangan dan menjadi tanggung jawab kami, kami memberikan <b>kompensasi berupa perpanjangan/kredit masa layanan</b> yang wajar. Detail selengkapnya ada pada <a href="/refund-policy">Kebijakan Pengembalian Dana</a>.</p>`) +

        `<div class="cat"><span class="n">D</span> Akun &amp; Pengaturan Langganan</div>` +
        qa("Bagaimana cara mengganti nama atau kata sandi WiFi?",
            `<p>Anda dapat mengubahnya mandiri melalui bot WhatsApp resmi kami menggunakan menu pengaturan WiFi, atau meminta bantuan petugas kami.</p>`) +
        qa("Bagaimana cara berganti paket (upgrade/downgrade)?",
            `<p>Ajukan permintaan perubahan paket melalui bot WhatsApp atau hubungi admin. Perubahan diproses oleh admin dan berlaku sesuai ketentuan periode tagihan.</p>`) +
        qa("Saya pindah rumah, apakah layanan bisa dipindahkan?",
            `<p>Pemindahan layanan bergantung pada ketersediaan jaringan di lokasi baru. Hubungi kami untuk survei lokasi baru dan penjadwalan pemindahan perangkat.</p>`) +
        qa("Bagaimana cara berhenti berlangganan?",
            `<p>Sampaikan permohonan berhenti kepada admin kami. Pastikan seluruh tagihan berjalan telah dilunasi dan perangkat pinjaman (jika ada) dikembalikan. Lihat juga <a href="/refund-policy">Kebijakan Pengembalian Dana</a> untuk pembayaran yang belum terpakai.</p>`) +
        qa("Bagaimana kebijakan pengembalian dana?",
            `<p>Ketentuan lengkap tersedia pada halaman <a href="/refund-policy">Kebijakan Pengembalian Dana</a>.</p>`) +
        `</div>` +

        `<div class="card"><h2 class="sec">Masih ada pertanyaan?</h2>` +
        `<p>Tim kami siap membantu setiap hari pukul 08.00–16.00 WIB.</p>` +
        (wa ? `<a class="cta" href="${esc(wa)}">${ICON.wa} Hubungi Kami via WhatsApp</a>` :
            `<p>Hubungi kami melalui halaman <a href="/kontak">Kontak</a>.</p>`) +
        `</div>`;

    res.send(page("/faq", "FAQ",
        `Pertanyaan yang sering diajukan seputar layanan internet, pemasangan, tagihan, pembayaran, dan bantuan teknis ${b.name}.`,
        content));
});

// ---------------------------------------------------------------- REFUND
router.get("/refund-policy", (req, res) => {
    const b = biz();
    const content =
        `<h1 class="page-title">Kebijakan Pengembalian Dana</h1>` +
        `<p class="page-sub">Ketentuan pengembalian dana (refund) atas pembayaran layanan internet ${esc(b.name)}.</p>` +
        `<p class="updated">Terakhir diperbarui: <b>${esc(LAST_UPDATED)}</b></p>` +
        `<div class="card legal">` +
        `<p class="lead">Kebijakan ini menjelaskan kondisi dan tata cara pengembalian dana. Dengan melakukan pembayaran, pelanggan dianggap memahami dan menyetujui ketentuan berikut.</p>` +

        `<h3><span class="no">1.</span> Sifat Layanan</h3>` +
        `<p>Layanan kami bersifat langganan <b>prabayar</b> yang dibayarkan di muka untuk setiap periode bulanan. Biaya yang dibayarkan digunakan untuk penyediaan dan pemeliharaan akses internet pada periode berjalan.</p>` +

        `<h3><span class="no">2.</span> Pembayaran Ganda atau Kelebihan Bayar</h3>` +
        `<p>Apabila terjadi pembayaran ganda atau kelebihan nominal akibat kesalahan sistem/teknis, pelanggan berhak atas <b>pengembalian penuh</b> atas selisih tersebut, atau — atas persetujuan pelanggan — dikonversi menjadi <b>kredit/saldo</b> untuk tagihan periode berikutnya.</p>` +

        `<h3><span class="no">3.</span> Pembatalan Sebelum Aktivasi Layanan</h3>` +
        `<p>Jika pembayaran telah dilakukan namun layanan <b>belum diaktifkan sama sekali</b> dan pelanggan membatalkan pemasangan, dana dikembalikan setelah dikurangi biaya administrasi/survei/material yang benar-benar telah timbul (apabila ada), dengan rincian yang transparan.</p>` +

        `<h3><span class="no">4.</span> Layanan yang Sudah Aktif atau Terpakai</h3>` +
        `<p>Biaya untuk periode yang layanannya telah aktif dan/atau telah digunakan pada dasarnya <b>tidak dapat dikembalikan</b>, karena layanan telah diberikan. Untuk kendala kualitas layanan, kami mengutamakan penyelesaian teknis atau pemberian kompensasi masa layanan.</p>` +

        `<h3><span class="no">5.</span> Kompensasi atas Gangguan</h3>` +
        `<p>Untuk gangguan berkepanjangan yang menjadi tanggung jawab kami, pelanggan berhak atas <b>kompensasi berupa perpanjangan masa aktif atau kredit tagihan</b> yang proporsional dengan lama gangguan, sebagai pengganti pengembalian tunai.</p>` +

        `<h3><span class="no">6.</span> Penghentian Langganan di Tengah Periode</h3>` +
        `<p>Penghentian langganan yang dilakukan pelanggan di tengah periode yang sudah dibayar tidak menimbulkan pengembalian atas sisa hari periode berjalan, kecuali diatur lain berdasarkan kesepakatan tertulis.</p>` +

        `<h3><span class="no">7.</span> Cara Mengajukan Pengembalian Dana</h3>` +
        `<p>Ajukan permohonan melalui kontak resmi kami dengan menyertakan:</p><ul>` +
        `<li>Nama pelanggan dan nomor/ID langganan;</li>` +
        `<li>Bukti pembayaran (struk/screenshot transaksi);</li>` +
        `<li>Alasan pengajuan dan nomor rekening/tujuan pengembalian.</li></ul>` +

        `<h3><span class="no">8.</span> Proses dan Jangka Waktu</h3>` +
        `<p>Permohonan yang valid diverifikasi terlebih dahulu, lalu diproses dalam <b>3–14 hari kerja</b> sejak disetujui. Pengembalian dilakukan ke metode/rekening asal atau tujuan yang disepakati. Waktu pengkreditan dapat bergantung pada bank/penyedia pembayaran.</p>` +

        `<h3><span class="no">9.</span> Hubungi Kami</h3>` +
        `<p>Pertanyaan mengenai kebijakan ini dapat diajukan melalui halaman <a href="/kontak">Kontak</a>` +
        `${b.email ? ` atau email <a href="mailto:${esc(b.email)}">${esc(b.email)}</a>` : ""}.</p>` +
        `<div class="note">Kami berkomitmen menangani setiap permohonan pengembalian dana secara adil, transparan, dan sesuai ketentuan yang berlaku.</div>` +
        `</div>`;

    res.send(page("/refund-policy", "Kebijakan Pengembalian Dana",
        `Ketentuan dan tata cara pengembalian dana (refund) layanan internet ${b.name}.`,
        content));
});

// ---------------------------------------------------------------- TERMS
router.get("/syarat-ketentuan", (req, res) => {
    const b = biz();
    const sections = [
        ["definisi", "Definisi",
            `<p>Dalam dokumen ini: <b>"Kami/Penyedia"</b> merujuk pada ${esc(b.name)}; <b>"Pelanggan/Anda"</b> merujuk pada pihak yang berlangganan layanan; <b>"Layanan"</b> merujuk pada akses internet yang kami sediakan beserta perangkat dan dukungannya.</p>`],
        ["penerimaan", "Penerimaan Ketentuan",
            `<p>Dengan mendaftar, melakukan pemasangan, dan/atau melakukan pembayaran, Pelanggan dinyatakan telah membaca, memahami, dan menyetujui seluruh Syarat &amp; Ketentuan ini.</p>`],
        ["layanan", "Layanan yang Disediakan",
            `<p>Kami menyediakan akses internet berlangganan. Kecepatan, kuota, dan cakupan mengikuti paket yang dipilih Pelanggan. Kecepatan yang tertera bersifat <b>"hingga" (up to)</b> dan dapat dipengaruhi kondisi jaringan, perangkat, serta pemakaian bersama.</p>`],
        ["pendaftaran", "Pendaftaran &amp; Kelayakan",
            `<p>Pelanggan wajib memberikan data yang benar dan lengkap saat pendaftaran. Layanan hanya dapat diaktifkan apabila lokasi Pelanggan terjangkau jaringan kami berdasarkan hasil survei.</p>`],
        ["perangkat", "Pemasangan &amp; Perangkat",
            `<p>Pemasangan dilakukan oleh teknisi resmi kami. Perangkat yang dipinjamkan (mis. modem/router/ONT) tetap menjadi <b>milik ${esc(b.name)}</b> dan wajib dijaga serta dikembalikan dalam kondisi baik saat berhenti berlangganan. Kerusakan/kehilangan akibat kelalaian dapat dikenakan biaya penggantian.</p>`],
        ["tagihan", "Tagihan &amp; Pembayaran",
            `<p>Layanan bersifat prabayar bulanan. Tagihan terbit di awal periode dan wajib dibayar sesuai nominal paket melalui kanal resmi (tautan pembayaran online atau petugas resmi). Bukti pembayaran sah berupa struk digital yang kami terbitkan.</p>`],
        ["keterlambatan", "Keterlambatan &amp; Penonaktifan Sementara",
            `<p>Apabila tagihan belum dilunasi hingga melewati masa tenggang, Layanan akan <b>dinonaktifkan sementara (isolir)</b> secara otomatis pada sekitar tanggal <b>${b.isolirDay}</b> setiap bulan. Layanan diaktifkan kembali otomatis setelah pembayaran terverifikasi. Kami tidak bertanggung jawab atas kerugian akibat penonaktifan karena keterlambatan pembayaran.</p>`],
        ["fair-use", "Kebijakan Penggunaan Wajar (Fair Usage)",
            `<p>Untuk menjaga kualitas layanan bersama, penggunaan yang tidak wajar atau di luar peruntukan (mis. penyalahgunaan bandwidth, penjualan ulang tanpa izin) dapat dikenakan pembatasan sesuai kebijakan yang berlaku.</p>`],
        ["larangan", "Larangan Penggunaan",
            `<p>Pelanggan dilarang menggunakan Layanan untuk:</p><ul>` +
            `<li>Aktivitas yang melanggar hukum yang berlaku di Republik Indonesia;</li>` +
            `<li>Penyebaran malware, spam, peretasan, atau serangan jaringan;</li>` +
            `<li>Tindakan yang mengganggu jaringan, pelanggan lain, atau pihak ketiga;</li>` +
            `<li>Menjual kembali (reseller) layanan tanpa persetujuan tertulis dari kami.</li></ul>` +
            `<p>Pelanggaran dapat mengakibatkan penangguhan atau penghentian layanan.</p>`],
        ["ketersediaan", "Ketersediaan Layanan &amp; Pemeliharaan",
            `<p>Kami berupaya menjaga layanan tetap tersedia sebaik mungkin, namun tidak menjamin layanan bebas gangguan 100%. Dapat terjadi pemeliharaan terjadwal maupun gangguan di luar kendali kami (mis. cuaca ekstrem, gangguan penyedia hulu, listrik padam).</p>`],
        ["kompensasi", "Gangguan &amp; Kompensasi",
            `<p>Untuk gangguan berkepanjangan yang menjadi tanggung jawab kami, diberikan kompensasi berupa perpanjangan masa aktif/kredit tagihan yang wajar. Ketentuan pengembalian dana diatur pada <a href="/refund-policy">Kebijakan Pengembalian Dana</a>.</p>`],
        ["tanggung-jawab", "Batasan Tanggung Jawab",
            `<p>Tanggung jawab kami terbatas pada penyediaan layanan sesuai paket. Kami tidak bertanggung jawab atas kerugian tidak langsung (mis. kehilangan pendapatan/data) akibat gangguan, penonaktifan karena keterlambatan bayar, atau hal di luar kendali wajar kami.</p>`],
        ["privasi", "Privasi &amp; Data Pelanggan",
            `<p>Data pribadi Pelanggan (nama, kontak, alamat) digunakan semata untuk keperluan administrasi, penagihan, dan dukungan layanan. Kami tidak memperjualbelikan data Pelanggan dan menjaga kerahasiaannya sesuai peraturan yang berlaku.</p>`],
        ["penghentian", "Penghentian Layanan",
            `<p>Pelanggan dapat berhenti berlangganan dengan memberitahukan kami dan melunasi kewajiban yang tersisa. Kami berhak menghentikan layanan apabila terjadi pelanggaran ketentuan, penyalahgunaan, atau tunggakan yang tidak diselesaikan.</p>`],
        ["perubahan", "Perubahan Ketentuan",
            `<p>Kami dapat memperbarui Syarat &amp; Ketentuan ini sewaktu-waktu. Perubahan penting akan diinformasikan melalui kanal resmi. Penggunaan layanan yang berlanjut setelah perubahan berarti persetujuan atas ketentuan terbaru.</p>`],
        ["hukum", "Hukum yang Berlaku &amp; Penyelesaian Sengketa",
            `<p>Ketentuan ini tunduk pada hukum Republik Indonesia. Setiap perselisihan diupayakan diselesaikan secara <b>musyawarah untuk mufakat</b> terlebih dahulu sebelum menempuh jalur hukum yang berlaku.</p>`],
        ["kontak", "Kontak",
            `<p>Pertanyaan mengenai ketentuan ini dapat diajukan melalui halaman <a href="/kontak">Kontak</a>${b.email ? ` atau email <a href="mailto:${esc(b.email)}">${esc(b.email)}</a>` : ""}.</p>`],
    ];

    const toc = `<div class="toc"><b>Daftar Isi</b><ol>` +
        sections.map((s) => `<li><a href="#${s[0]}">${s[1]}</a></li>`).join("") + `</ol></div>`;
    const body = sections.map((s, i) =>
        `<h3 id="${s[0]}"><span class="no">${i + 1}.</span> ${s[1]}</h3>${s[2]}`).join("");

    const content =
        `<h1 class="page-title">Syarat &amp; Ketentuan Layanan</h1>` +
        `<p class="page-sub">Ketentuan penggunaan layanan internet ${esc(b.name)}.</p>` +
        `<p class="updated">Terakhir diperbarui: <b>${esc(LAST_UPDATED)}</b></p>` +
        toc +
        `<div class="card legal">` +
        `<p class="lead">Mohon baca Syarat &amp; Ketentuan berikut dengan saksama. Dengan berlangganan dan/atau melakukan pembayaran, Anda menyetujui seluruh ketentuan ini.</p>` +
        body + `</div>`;

    res.send(page("/syarat-ketentuan", "Syarat & Ketentuan",
        `Syarat dan ketentuan lengkap penggunaan layanan internet ${b.name}: layanan, tagihan, penonaktifan, penggunaan wajar, dan lainnya.`,
        content));
});

// ---------------------------------------------------------------- KONTAK
router.get("/kontak", (req, res) => {
    const b = biz();
    const wa = waLink(b.phone);
    const citem = (icon, k, v) => `<div class="citem"><div class="ic">${icon}</div><div><div class="k">${k}</div><div class="v">${v}</div></div></div>`;
    const items = [
        b.phone ? citem(ICON.wa, "WhatsApp / Telepon", wa ? `<a href="${esc(wa)}">${esc(b.phone)}</a>` : esc(b.phone)) : "",
        b.email ? citem(ICON.mail, "Email", `<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`) : "",
        b.address ? citem(ICON.pin, "Alamat Usaha", esc(b.address)) : "",
        b.website ? citem(ICON.globe, "Website", `<a href="${esc(b.website)}">${esc(b.website.replace(/^https?:\/\//, ""))}</a>`) : "",
        citem(ICON.clock, "Jam Layanan", "Setiap hari, 08.00–16.00 WIB"),
    ].filter(Boolean).join("");

    const content =
        `<h1 class="page-title">Hubungi Kami</h1>` +
        `<p class="page-sub">Kami siap membantu pertanyaan seputar layanan, tagihan, pembayaran, dan gangguan teknis.</p>` +
        `<p class="updated">Terakhir diperbarui: <b>${esc(LAST_UPDATED)}</b></p>` +

        `<div class="card"><h2 class="sec">Informasi Kontak Resmi</h2>` +
        `<div class="cgrid">${items}</div>` +
        (wa ? `<div style="margin-top:18px"><a class="cta" href="${esc(wa)}">${ICON.wa} Chat WhatsApp Sekarang</a></div>` : "") +
        `</div>` +

        `<div class="card"><h2 class="sec">Hubungi Kami Sesuai Kebutuhan</h2>` +
        `<div class="dept">` +
        `<div class="row"><div><b>Tagihan &amp; Pembayaran</b><br><span class="small muted">Cek tagihan, konfirmasi pembayaran, pembayaran di muka, struk.</span></div></div>` +
        `<div class="row"><div><b>Gangguan Teknis</b><br><span class="small muted">Internet lambat/mati, perangkat bermasalah, pengaduan layanan.</span></div></div>` +
        `<div class="row"><div><b>Pendaftaran &amp; Umum</b><br><span class="small muted">Berlangganan baru, ketersediaan area, ganti paket, pindah lokasi.</span></div></div>` +
        `</div>` +
        `<div class="note">Waktu respons: pesan yang masuk pada jam layanan umumnya ditanggapi secepatnya sesuai antrean. Gangguan besar/masal menjadi prioritas penanganan.</div>` +
        `</div>` +

        `<div class="card"><h2 class="sec">Catatan Keamanan</h2>` +
        `<p class="small">Demi keamanan Anda, gunakan hanya kontak resmi dan informasi pembayaran yang kami kirimkan melalui nomor resmi ${esc(b.name)}. Jangan pernah membagikan kata sandi atau kode OTP Anda kepada siapa pun.</p></div>`;

    res.send(page("/kontak", "Kontak",
        `Kontak resmi ${b.name}: WhatsApp/telepon${b.phone ? ` ${b.phone}` : ""}${b.email ? `, email ${b.email}` : ""}${b.address ? `, alamat ${b.address}` : ""}.`,
        content));
});

module.exports = router;
