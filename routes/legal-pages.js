/**
 * Header Doc
 * Purpose: Halaman legal/compliance publik yang diminta verifikasi merchant gateway pembayaran
 *   (iPaymu/Mayar): FAQ, Kebijakan Refund, Syarat & Ketentuan, dan Kontak (wajib menampilkan
 *   email, nomor telepon, dan alamat usaha). Konten diisi dinamis dari `global.config.company`.
 * Caller: lib/routes-registry (mount di "/"). Path terdaftar di PUBLIC_PATHS (tanpa login).
 * Deps: express, global.config (company/nama/telfon/adminPhone).
 * MainFuncs: GET /faq, GET /refund-policy, GET /syarat-ketentuan, GET /kontak.
 * SideEffects: Tidak ada (render HTML statis dari config).
 */
"use strict";

const express = require("express");
const router = express.Router();

function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
}

// Info bisnis dari config. Fallback berlapis; abaikan nilai placeholder ("ISI_...").
function biz() {
    const cfg = global.config || {};
    const c = cfg.company || {};
    const clean = (v) => {
        const s = String(v == null ? "" : v).trim();
        return /^ISI_/i.test(s) ? "" : s;
    };
    const phone = clean(c.phone) || clean(cfg.telfon) || clean(cfg.adminPhone);
    return {
        name: clean(c.name) || clean(cfg.nama) || "RAF NET",
        address: clean(c.address),
        phone,
        email: clean(c.email),
        website: clean(c.website),
    };
}

function waLink(phone) {
    const d = String(phone || "").replace(/\D/g, "");
    if (!d) return "";
    const intl = d.startsWith("0") ? `62${d.slice(1)}` : d.startsWith("62") ? d : `62${d}`;
    return `https://wa.me/${intl}`;
}

function layout(title, bodyHtml) {
    const b = biz();
    const year = new Date().getFullYear();
    const footerContact = [
        b.email ? `Email: <a href="mailto:${esc(b.email)}">${esc(b.email)}</a>` : "",
        b.phone ? `Telp/WA: ${esc(b.phone)}` : "",
        b.address ? esc(b.address) : "",
    ].filter(Boolean).join(" &middot; ");
    return `<!doctype html><html lang="id"><head><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>${esc(title)} — ${esc(b.name)}</title><style>` +
        `:root{--ink:#1e293b;--muted:#64748b;--line:#e2e8f0;--brand:#4f46e5}` +
        `*{box-sizing:border-box}body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;` +
        `margin:0;background:#f8fafc;color:var(--ink);line-height:1.7}` +
        `header{background:var(--brand);color:#fff;padding:20px 16px}` +
        `header .wrap{max-width:760px;margin:0 auto}header h1{margin:0;font-size:20px}` +
        `header .sub{opacity:.85;font-size:13px;margin-top:2px}` +
        `main{max-width:760px;margin:0 auto;padding:24px 16px}` +
        `h2{font-size:17px;margin:22px 0 8px}p,li{font-size:15px;color:#334155}` +
        `a{color:var(--brand)}.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:16px}` +
        `.contact-row{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)}` +
        `.contact-row:last-child{border-bottom:0}.contact-row .k{width:120px;color:var(--muted);flex:none}` +
        `nav{margin-top:14px;font-size:13px}nav a{margin-right:14px;color:#fff;text-decoration:underline;opacity:.9}` +
        `footer{max-width:760px;margin:0 auto;padding:18px 16px;color:var(--muted);font-size:13px;border-top:1px solid var(--line)}` +
        `</style></head><body>` +
        `<header><div class="wrap"><h1>${esc(b.name)}</h1>` +
        `<div class="sub">Layanan Internet / RTRW-Net${b.website ? ` &middot; ${esc(b.website)}` : ""}</div>` +
        `<nav><a href="/faq">FAQ</a><a href="/refund-policy">Kebijakan Refund</a>` +
        `<a href="/syarat-ketentuan">Syarat &amp; Ketentuan</a><a href="/kontak">Kontak</a></nav>` +
        `</div></header><main>${bodyHtml}</main>` +
        `<footer>${footerContact || esc(b.name)}<br>&copy; ${year} ${esc(b.name)}. Hak cipta dilindungi.</footer>` +
        `</body></html>`;
}

router.get("/faq", (req, res) => {
    const b = biz();
    const html = layout("FAQ", `<h1 style="font-size:22px;margin:0 0 6px">Pertanyaan yang Sering Diajukan (FAQ)</h1>` +
        `<div class="card">` +
        `<h2>Apa layanan yang ${esc(b.name)} sediakan?</h2>` +
        `<p>Kami menyediakan layanan akses internet berlangganan bulanan (RTRW-Net/ISP lokal) untuk rumah dan usaha di area jangkauan kami.</p>` +
        `<h2>Bagaimana cara berlangganan?</h2>` +
        `<p>Hubungi kami melalui WhatsApp/telepon${b.phone ? ` di <b>${esc(b.phone)}</b>` : ""}. Tim kami akan mengecek ketersediaan jaringan di lokasi Anda dan menjadwalkan pemasangan.</p>` +
        `<h2>Bagaimana cara membayar tagihan?</h2>` +
        `<p>Tagihan dibayar bulanan. Anda dapat membayar melalui tautan pembayaran resmi yang kami kirimkan via WhatsApp (mendukung QRIS, Virtual Account bank, dan gerai retail), atau tunai kepada petugas kami.</p>` +
        `<h2>Kapan tagihan jatuh tempo?</h2>` +
        `<p>Tagihan terbit di awal bulan. Jika belum dibayar hingga tanggal jatuh tempo, layanan dapat dinonaktifkan sementara sampai pembayaran diterima.</p>` +
        `<h2>Bagaimana jika internet saya bermasalah?</h2>` +
        `<p>Laporkan gangguan melalui WhatsApp${b.phone ? ` (<b>${esc(b.phone)}</b>)` : ""} atau bot layanan kami. Tim teknisi akan menindaklanjuti secepatnya.</p>` +
        `<h2>Bagaimana kebijakan pengembalian dana?</h2>` +
        `<p>Silakan baca <a href="/refund-policy">Kebijakan Refund</a> kami.</p>` +
        `</div>`);
    res.send(html);
});

router.get("/refund-policy", (req, res) => {
    const b = biz();
    const html = layout("Kebijakan Refund", `<h1 style="font-size:22px;margin:0 0 6px">Kebijakan Pengembalian Dana (Refund)</h1>` +
        `<div class="card">` +
        `<p>Kebijakan ini mengatur pengembalian dana atas pembayaran layanan internet ${esc(b.name)}.</p>` +
        `<h2>1. Sifat Layanan</h2>` +
        `<p>Layanan kami bersifat langganan berkala (bulanan). Biaya yang telah dibayarkan digunakan untuk penyediaan akses internet pada periode berjalan.</p>` +
        `<h2>2. Kelebihan / Salah Bayar</h2>` +
        `<p>Jika terjadi pembayaran ganda atau kelebihan nominal akibat kesalahan teknis, dana akan dikembalikan penuh atau dijadikan saldo/kredit tagihan periode berikutnya, sesuai preferensi pelanggan.</p>` +
        `<h2>3. Pembatalan Sebelum Aktivasi</h2>` +
        `<p>Jika pembayaran dilakukan namun layanan belum diaktifkan sama sekali, pelanggan berhak atas pengembalian dana penuh setelah dikurangi biaya administrasi yang telah timbul (jika ada).</p>` +
        `<h2>4. Layanan yang Sudah Berjalan</h2>` +
        `<p>Biaya untuk periode yang layanannya telah aktif/terpakai pada dasarnya tidak dapat dikembalikan. Untuk kendala kualitas layanan, kami mengutamakan penyelesaian teknis atau kompensasi masa layanan.</p>` +
        `<h2>5. Cara Mengajukan Refund</h2>` +
        `<p>Ajukan permohonan melalui kontak resmi kami dengan menyertakan bukti pembayaran. Permohonan yang valid diproses dalam <b>3–14 hari kerja</b> ke metode pembayaran asal.</p>` +
        `<p style="color:#64748b;font-size:14px">Untuk pertanyaan, hubungi kami melalui halaman <a href="/kontak">Kontak</a>.</p>` +
        `</div>`);
    res.send(html);
});

router.get("/syarat-ketentuan", (req, res) => {
    const b = biz();
    const html = layout("Syarat & Ketentuan", `<h1 style="font-size:22px;margin:0 0 6px">Syarat &amp; Ketentuan Layanan</h1>` +
        `<div class="card">` +
        `<p>Dengan berlangganan dan/atau melakukan pembayaran, pelanggan dianggap menyetujui syarat dan ketentuan layanan ${esc(b.name)} berikut.</p>` +
        `<h2>1. Layanan</h2>` +
        `<p>${esc(b.name)} menyediakan akses internet berlangganan. Kecepatan dan kuota mengikuti paket yang dipilih pelanggan.</p>` +
        `<h2>2. Pembayaran & Tagihan</h2>` +
        `<p>Tagihan dibayar di muka setiap bulan. Keterlambatan pembayaran dapat mengakibatkan penonaktifan layanan sementara hingga tagihan dilunasi.</p>` +
        `<h2>3. Penggunaan yang Wajar</h2>` +
        `<p>Pelanggan setuju untuk tidak menggunakan layanan untuk aktivitas melanggar hukum, mengganggu jaringan, atau merugikan pihak lain.</p>` +
        `<h2>4. Perangkat</h2>` +
        `<p>Perangkat yang dipinjamkan (jika ada) tetap milik ${esc(b.name)} dan wajib dikembalikan saat berhenti berlangganan dalam kondisi baik.</p>` +
        `<h2>5. Gangguan & Pemeliharaan</h2>` +
        `<p>Kami berupaya menjaga kualitas layanan, namun dapat terjadi gangguan atau pemeliharaan terjadwal. Gangguan berat akan diberikan kompensasi masa layanan yang wajar.</p>` +
        `<h2>6. Perubahan Ketentuan</h2>` +
        `<p>${esc(b.name)} dapat memperbarui ketentuan ini sewaktu-waktu. Perubahan penting akan diinformasikan melalui kanal resmi kami.</p>` +
        `<p style="color:#64748b;font-size:14px">Pertanyaan mengenai ketentuan ini dapat diajukan melalui halaman <a href="/kontak">Kontak</a>.</p>` +
        `</div>`);
    res.send(html);
});

router.get("/kontak", (req, res) => {
    const b = biz();
    const wa = waLink(b.phone);
    const rows = [
        b.email ? `<div class="contact-row"><div class="k">Email</div><div><a href="mailto:${esc(b.email)}">${esc(b.email)}</a></div></div>` : "",
        b.phone ? `<div class="contact-row"><div class="k">Telepon / WA</div><div>${wa ? `<a href="${esc(wa)}">${esc(b.phone)}</a>` : esc(b.phone)}</div></div>` : "",
        b.address ? `<div class="contact-row"><div class="k">Alamat Usaha</div><div>${esc(b.address)}</div></div>` : "",
        b.website ? `<div class="contact-row"><div class="k">Website</div><div><a href="${esc(b.website)}">${esc(b.website)}</a></div></div>` : "",
        `<div class="contact-row"><div class="k">Jam Layanan</div><div>Setiap hari, 08.00–21.00 WIB</div></div>`,
    ].filter(Boolean).join("");
    const html = layout("Kontak", `<h1 style="font-size:22px;margin:0 0 6px">Hubungi Kami</h1>` +
        `<div class="card"><p>Kami siap membantu pertanyaan seputar layanan, tagihan, dan gangguan.</p>${rows}</div>`);
    res.send(html);
});

module.exports = router;
