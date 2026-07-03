/**
 * Header Doc
 * Purpose: Router SITE PUBLIK (khusus listener publik port terpisah): landing page server-rendered
 *   dari data operasional nyata (paket/kontak di `global.config`+`global.packages`) sebagai etalase
 *   + pintu masuk ke registrasi self-service (Fase 4) & beli voucher (`/voucher`). SENGAJA tidak
 *   di-mount di app utama — `GET /` akan bentrok dengan dashboard staf.
 * Caller: `lib/public-site-app` (app publik). TIDAK di `lib/routes-registry` (app utama).
 * Deps: express, `lib/public-page-helper` (esc/getBusinessInfo/getPublicPackages/waLink).
 * MainFuncs: GET / (landing), GET /daftar (form registrasi), POST /api/public/register.
 * SideEffects: GET read-only; POST /api/public/register menyimpan lead PSB + notifikasi WA
 *   (delegasi ke lib/services/public-registration-service).
 */
"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const { esc, getBusinessInfo, getPublicPackages, waLink } = require("../lib/public-page-helper");
const { publicRegistrationValidation } = require("../lib/middleware/validation");
const { submitPublicRegistration } = require("../lib/services/public-registration-service");
const { asyncHandler } = require("../lib/error-handler");
const { sendSuccess, sendError } = require("../lib/response-helper");

const router = express.Router();

// Rate limit khusus registrasi publik: 5 submit / 15 menit / IP (anti-spam bot & flooding).
// Bukan authLimiter (yang skipSuccessfulRequests) — di sini submit SUKSES pun ikut dihitung.
const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { status: 429, message: "Terlalu banyak pendaftaran dari koneksi ini. Coba lagi dalam 15 menit." },
    standardHeaders: true,
    legacyHeaders: false
});

const LANDING_CSS = `
:root{--brand:#4338ca;--brand2:#6366f1;--ink:#0f172a;--body:#334155;--muted:#64748b;
--line:#e5e7eb;--bg:#f8fafc;--card:#fff;--radius:18px}
*{box-sizing:border-box}
body{margin:0;font-family:'Inter',system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
color:var(--body);background:var(--bg);line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px}
header.top{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.9);backdrop-filter:blur(10px);
border-bottom:1px solid var(--line)}
.top .wrap{display:flex;align-items:center;gap:16px;height:64px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;color:var(--ink);font-size:1.15rem;letter-spacing:-.02em}
.brand img{height:34px;width:auto;border-radius:8px}
.nav{margin-left:auto;display:flex;align-items:center;gap:22px;font-weight:600;font-size:.95rem}
.nav a{color:var(--muted)}.nav a:hover{color:var(--ink)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-weight:700;
border-radius:12px;padding:12px 22px;border:1px solid transparent;cursor:pointer;font-size:.98rem;transition:.15s}
.btn-primary{background:var(--brand);color:#fff}.btn-primary:hover{background:#3730a3}
.btn-ghost{background:#fff;color:var(--ink);border-color:var(--line)}.btn-ghost:hover{border-color:var(--brand2)}
.btn-wa{background:#059669;color:#fff}.btn-wa:hover{background:#047857}
.nav .btn{padding:9px 18px}
.hero{background:linear-gradient(135deg,#eef2ff 0%,#f8fafc 60%);border-bottom:1px solid var(--line)}
.hero .wrap{padding:72px 20px 64px;text-align:center}
.hero h1{font-size:clamp(2rem,5vw,3.25rem);line-height:1.1;letter-spacing:-.03em;color:var(--ink);
margin:0 0 18px;font-weight:800}
.hero p.lead{font-size:1.18rem;color:var(--muted);max-width:620px;margin:0 auto 30px}
.hero .cta{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
.section{padding:64px 0}
.section h2{font-size:1.9rem;letter-spacing:-.02em;color:var(--ink);margin:0 0 8px;font-weight:800;text-align:center}
.section .sub{color:var(--muted);text-align:center;margin:0 auto 40px;max-width:560px}
.pkg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:20px}
.pkg{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:28px 24px;
display:flex;flex-direction:column;gap:6px;transition:.18s}
.pkg:hover{transform:translateY(-4px);box-shadow:0 18px 40px -20px rgba(67,56,202,.35);border-color:var(--brand2)}
.pkg .name{font-weight:700;color:var(--muted);font-size:.95rem;text-transform:uppercase;letter-spacing:.04em}
.pkg .price{font-size:1.75rem;font-weight:800;color:var(--ink);letter-spacing:-.02em}
.pkg .price small{font-size:.9rem;font-weight:600;color:var(--muted)}
.pkg a.btn{margin-top:16px}
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px}
.feature{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:26px}
.feature .ic{width:44px;height:44px;border-radius:12px;background:#eef2ff;color:var(--brand);
display:flex;align-items:center;justify-content:center;margin-bottom:14px}
.feature h3{margin:0 0 6px;color:var(--ink);font-size:1.1rem}
.feature p{margin:0;color:var(--muted);font-size:.95rem}
.contact{background:var(--ink);color:#cbd5e1}
.contact .wrap{padding:56px 20px}
.contact h2{color:#fff;text-align:left;margin:0 0 24px}
.contact-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:22px}
.ci{display:flex;gap:12px;align-items:flex-start}
.ci .ic{color:var(--brand2);flex:none;margin-top:2px}
.ci .lb{font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;margin-bottom:2px}
.ci .vl{color:#e2e8f0;font-weight:600}
footer.foot{background:#0b1220;color:#64748b;text-align:center;padding:26px 20px;font-size:.9rem}
@media(max-width:640px){.nav a:not(.btn){display:none}.section{padding:48px 0}.hero .wrap{padding:56px 20px 48px}}
`;

const IC = {
    bolt: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/></svg>',
    shield: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z"/></svg>',
    headset: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 13a8 8 0 0 1 16 0M4 13v3a2 2 0 0 0 2 2h1v-5H6a2 2 0 0 0-2 2Zm16 0v3a2 2 0 0 1-2 2h-1v-5h1a2 2 0 0 1 2 2Z"/></svg>',
    wa: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm5.8 14.15c-.24.68-1.42 1.32-1.95 1.36-.5.05-.97.24-3.27-.68-2.77-1.09-4.53-3.92-4.67-4.1-.14-.19-1.12-1.49-1.12-2.84 0-1.35.71-2.01.96-2.29.24-.27.53-.34.71-.34.18 0 .36 0 .51.01.16.01.38-.06.6.46.24.56.79 1.94.86 2.08.07.14.12.31.02.5-.28.56-.57.53-.42.79.72 1.24 1.53 1.9 2.6 2.33.27.14.44.12.6-.07.16-.19.68-.79.86-1.06.18-.27.36-.22.6-.13.24.09 1.53.72 1.79.85.27.14.44.2.51.31.07.11.07.64-.17 1.32z"/></svg>',
    mail: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
    globe: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/></svg>'
};

function renderPackages(pkgs) {
    if (!pkgs.length) return "";
    const cards = pkgs.map((p) => `
      <div class="pkg">
        <div class="name">${esc(p.name)}</div>
        <div class="price">${esc(p.price)}<small> /bulan</small></div>
        <a class="btn btn-primary" href="/daftar?paket=${encodeURIComponent(p.name)}">Pilih paket</a>
      </div>`).join("");
    return `
    <section class="section" id="paket">
      <div class="wrap">
        <h2>Pilihan Paket</h2>
        <p class="sub">Harga transparan, tanpa biaya tersembunyi. Pilih paket yang paling pas untuk kebutuhan Anda.</p>
        <div class="pkg-grid">${cards}</div>
      </div>
    </section>`;
}

function renderContact(biz) {
    const items = [];
    if (biz.address) items.push(`<div class="ci"><span class="ic">${IC.pin}</span><div><div class="lb">Alamat</div><div class="vl">${esc(biz.address)}</div></div></div>`);
    if (biz.phone) items.push(`<div class="ci"><span class="ic">${IC.wa}</span><div><div class="lb">WhatsApp</div><div class="vl"><a href="${esc(waLink(biz.phone))}">${esc(biz.phone)}</a></div></div></div>`);
    if (biz.email) items.push(`<div class="ci"><span class="ic">${IC.mail}</span><div><div class="lb">Email</div><div class="vl">${esc(biz.email)}</div></div></div>`);
    if (biz.website) items.push(`<div class="ci"><span class="ic">${IC.globe}</span><div><div class="lb">Website</div><div class="vl">${esc(biz.website)}</div></div></div>`);
    if (!items.length) return "";
    return `
    <section class="contact" id="kontak">
      <div class="wrap">
        <h2>Hubungi Kami</h2>
        <div class="contact-grid">${items.join("")}</div>
      </div>
    </section>`;
}

function renderLandingPage({ biz, pkgs }) {
    const logo = biz.logo ? `<img src="${esc(biz.logo)}" alt="${esc(biz.name)}">` : "";
    const waBtn = biz.phone
        ? `<a class="btn btn-wa" href="${esc(waLink(biz.phone))}">${IC.wa} Chat WhatsApp</a>`
        : "";
    return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(biz.name)} — Internet Cepat & Stabil</title>
<meta name="description" content="Layanan internet rumah & usaha dari ${esc(biz.name)}. Daftar online, beli voucher, dan hubungi kami dengan mudah.">
<style>${LANDING_CSS}</style>
</head>
<body>
<header class="top">
  <div class="wrap">
    <a class="brand" href="/">${logo}<span>${esc(biz.name)}</span></a>
    <nav class="nav">
      <a href="#paket">Paket</a>
      <a href="/voucher">Beli Voucher</a>
      <a href="#kontak">Kontak</a>
      <a class="btn btn-primary" href="/daftar">Daftar</a>
    </nav>
  </div>
</header>

<section class="hero">
  <div class="wrap">
    <h1>Internet cepat &amp; stabil<br>untuk rumah &amp; usaha Anda</h1>
    <p class="lead">Pasang baru mudah, tagihan transparan, dukungan responsif. Daftar online sekarang atau beli voucher hotspot langsung dari sini.</p>
    <div class="cta">
      <a class="btn btn-primary" href="/daftar">Daftar Sekarang</a>
      <a class="btn btn-ghost" href="/voucher">Beli Voucher</a>
      ${waBtn}
    </div>
  </div>
</section>

${renderPackages(pkgs)}

<section class="section">
  <div class="wrap">
    <h2>Kenapa ${esc(biz.name)}?</h2>
    <p class="sub">Fokus kami: koneksi yang bisa diandalkan dan layanan yang gampang diurus.</p>
    <div class="features">
      <div class="feature"><div class="ic">${IC.bolt}</div><h3>Koneksi Stabil</h3><p>Jaringan fiber yang dipantau 24/7 supaya aktivitas Anda tidak terganggu.</p></div>
      <div class="feature"><div class="ic">${IC.shield}</div><h3>Tagihan Transparan</h3><p>Harga jelas di depan, notifikasi tagihan &amp; pembayaran otomatis lewat WhatsApp.</p></div>
      <div class="feature"><div class="ic">${IC.headset}</div><h3>Dukungan Responsif</h3><p>Lapor gangguan langsung dari WhatsApp, ditangani tim teknisi kami.</p></div>
    </div>
  </div>
</section>

${renderContact(biz)}

<footer class="foot">© ${esc(biz.name)} — Semua hak dilindungi.</footer>
</body>
</html>`;
}

// GET / — landing page publik (etalase paket + pintu ke registrasi & voucher).
router.get("/", (req, res) => {
    const biz = getBusinessInfo();
    const pkgs = getPublicPackages();
    res.set("Cache-Control", "public, max-age=120");
    res.type("html").send(renderLandingPage({ biz, pkgs }));
});

const REGISTER_CSS = `
:root{--brand:#4338ca;--brand2:#6366f1;--ink:#0f172a;--body:#334155;--muted:#64748b;
--line:#e5e7eb;--bg:#f8fafc;--card:#fff;--ok:#059669;--err:#dc2626;--radius:16px}
*{box-sizing:border-box}
body{margin:0;font-family:'Inter',system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
color:var(--body);background:var(--bg);line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
.wrap{max-width:560px;margin:0 auto;padding:0 20px}
header.top{border-bottom:1px solid var(--line);background:#fff}
.top .wrap{display:flex;align-items:center;gap:10px;height:60px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;color:var(--ink);font-size:1.1rem}
.brand img{height:30px;width:auto;border-radius:7px}
.back{margin-left:auto;color:var(--muted);font-weight:600;font-size:.92rem}
main{padding:36px 0 60px}
h1{font-size:1.7rem;letter-spacing:-.02em;color:var(--ink);margin:0 0 6px}
.lead{color:var(--muted);margin:0 0 26px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:26px 22px;
box-shadow:0 10px 30px -22px rgba(15,23,42,.4)}
.field{margin-bottom:16px}
label{display:block;font-weight:600;color:var(--ink);font-size:.92rem;margin-bottom:6px}
label .opt{color:var(--muted);font-weight:500}
input,textarea,select{width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:11px;
font:inherit;color:var(--ink);background:#fff;transition:.15s}
input:focus,textarea:focus,select:focus{outline:none;border-color:var(--brand2);box-shadow:0 0 0 3px rgba(99,102,241,.15)}
textarea{resize:vertical;min-height:76px}
.hint{font-size:.82rem;color:var(--muted);margin-top:5px}
.btn{width:100%;margin-top:6px;background:var(--brand);color:#fff;border:0;border-radius:12px;
padding:14px;font-weight:700;font-size:1rem;cursor:pointer;transition:.15s}
.btn:hover{background:#3730a3}.btn:disabled{opacity:.6;cursor:not-allowed}
.msg{margin-top:14px;padding:12px 14px;border-radius:11px;font-weight:600;font-size:.92rem;display:none}
.msg.show{display:block}
.msg.ok{background:#ecfdf5;color:var(--ok);border:1px solid #a7f3d0}
.msg.err{background:#fef2f2;color:var(--err);border:1px solid #fecaca}
.cf-turnstile{margin:6px 0 4px}
footer{text-align:center;color:var(--muted);font-size:.85rem;padding:20px}
`;

function renderRegisterPage({ biz, pkgs, siteKey, selectedPkg }) {
    const logo = biz.logo ? `<img src="${esc(biz.logo)}" alt="${esc(biz.name)}">` : "";
    const options = ['<option value="">— Pilih paket —</option>']
        .concat(pkgs.map((p) => `<option value="${esc(p.name)}"${p.name === selectedPkg ? " selected" : ""}>${esc(p.name)} — ${esc(p.price)}/bln</option>`))
        .join("");
    const turnstileScript = siteKey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : "";
    const turnstileWidget = siteKey ? `<div class="field"><div class="cf-turnstile" data-sitekey="${esc(siteKey)}"></div></div>` : "";
    return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Daftar — ${esc(biz.name)}</title>
<meta name="description" content="Daftar pasang baru internet ${esc(biz.name)} secara online.">
<style>${REGISTER_CSS}</style>
${turnstileScript}
</head>
<body>
<header class="top"><div class="wrap"><a class="brand" href="/">${logo}<span>${esc(biz.name)}</span></a><a class="back" href="/">← Beranda</a></div></header>
<main class="wrap">
  <h1>Daftar Pasang Baru</h1>
  <p class="lead">Isi data di bawah ini. Tim kami akan menghubungi Anda untuk survei &amp; pemasangan.</p>
  <div class="card">
    <form id="regForm" novalidate>
      <div class="field"><label for="name">Nama Lengkap</label><input id="name" name="name" type="text" required maxlength="100" autocomplete="name"></div>
      <div class="field"><label for="phone">Nomor WhatsApp</label><input id="phone" name="phone" type="tel" required inputmode="numeric" placeholder="08xxxxxxxxxx" autocomplete="tel"><div class="hint">Nomor aktif yang bisa dihubungi via WhatsApp.</div></div>
      <div class="field"><label for="address">Alamat Pemasangan</label><textarea id="address" name="address" required maxlength="300" placeholder="Nama jalan, RT/RW, desa/kelurahan, patokan"></textarea></div>
      <div class="field"><label for="packageInterest">Paket Diminati <span class="opt">(opsional)</span></label><select id="packageInterest" name="packageInterest">${options}</select></div>
      <div class="field"><label for="locationUrl">Link Lokasi Google Maps <span class="opt">(opsional)</span></label><input id="locationUrl" name="locationUrl" type="url" maxlength="500" placeholder="https://maps.app.goo.gl/..."><div class="hint">Membantu teknisi menemukan lokasi Anda lebih cepat.</div></div>
      ${turnstileWidget}
      <button class="btn" type="submit">Kirim Pendaftaran</button>
      <div id="msg" class="msg"></div>
    </form>
  </div>
</main>
<footer>© ${esc(biz.name)}</footer>
<script>
(function(){
  var form=document.getElementById('regForm');
  var msg=document.getElementById('msg');
  var btn=form.querySelector('button[type=submit]');
  function show(kind,text){msg.className='msg show'+(kind?' '+kind:'');msg.textContent=text;}
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var fd=new FormData(form);
    var payload={
      name:(fd.get('name')||'').trim(),
      phone:(fd.get('phone')||'').trim(),
      address:(fd.get('address')||'').trim(),
      packageInterest:fd.get('packageInterest')||'',
      locationUrl:(fd.get('locationUrl')||'').trim(),
      turnstileToken:fd.get('cf-turnstile-response')||''
    };
    if(!payload.name||!payload.phone||!payload.address){show('err','Nama, nomor HP, dan alamat wajib diisi.');return;}
    btn.disabled=true;show('','Mengirim...');
    fetch('/api/public/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
      .then(function(res){
        if(res.ok){form.reset();if(window.turnstile){try{window.turnstile.reset();}catch(_e){}}show('ok',(res.d&&res.d.message)||'Pendaftaran berhasil! Tim kami akan menghubungi Anda.');}
        else{show('err',(res.d&&res.d.message)||'Gagal mengirim. Coba lagi.');if(window.turnstile){try{window.turnstile.reset();}catch(_e){}}}
      })
      .catch(function(){show('err','Gagal terhubung ke server. Coba lagi.');})
      .then(function(){btn.disabled=false;});
  });
})();
</script>
</body>
</html>`;
}

// GET /daftar — form registrasi self-service. Server-rendered agar bisa inject siteKey Turnstile
// + daftar paket + prefill paket terpilih dari query (?paket=).
router.get("/daftar", (req, res) => {
    const biz = getBusinessInfo();
    const pkgs = getPublicPackages();
    const cfg = (global.config && global.config.turnstile) || {};
    const siteKey = cfg.enabled && cfg.siteKey && !/^ISI_/i.test(String(cfg.siteKey)) ? String(cfg.siteKey) : "";
    const selectedPkg = typeof req.query.paket === "string" ? req.query.paket : "";
    res.set("Cache-Control", "no-store");
    res.type("html").send(renderRegisterPage({ biz, pkgs, siteKey, selectedPkg }));
});

// POST /api/public/register — simpan lead PSB terkarantina + notifikasi. Dijaga rate-limit + validasi
// input + verifikasi Turnstile (di service). Hanya tersedia di listener publik (bukan app utama).
router.post("/api/public/register", registerLimiter, publicRegistrationValidation, asyncHandler(async (req, res) => {
    const { name, phone, address, packageInterest, locationUrl, latitude, longitude, turnstileToken } = req.body;
    const result = await submitPublicRegistration({
        name,
        phone,
        address,
        packageInterest,
        locationUrl,
        latitude,
        longitude,
        turnstileToken,
        requestMeta: {
            ipAddress: req.ip || req.headers["x-forwarded-for"] || null,
            userAgent: req.headers["user-agent"] || null
        }
    });
    if (!result.ok) {
        const code = result.code === "TURNSTILE_FAILED" ? 403 : result.code === "INVALID_INPUT" ? 400 : 500;
        return sendError(res, result.message || "Pendaftaran gagal diproses.", code);
    }
    return sendSuccess(res, { id: result.customerId }, "Pendaftaran berhasil! Tim kami akan segera menghubungi Anda.", 201);
}));

module.exports = router;
