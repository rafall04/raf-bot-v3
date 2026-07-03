/**
 * Header Doc
 * Purpose: Router PORTAL PUBLIK TERPADU (khusus proses portal, port terpisah, satu-satunya yang
 *   diekspos ke internet). Menyajikan landing + form registrasi + halaman voucher dengan PEMILIH
 *   AREA, dan MEM-PROXY registrasi/voucher ke listener publik bot area (internal 127.0.0.1) via
 *   `lib/portal-areas`. Turnstile & rate-limit dilakukan DI PORTAL; bot backend internal-only.
 * Caller: `lib/portal-app` (app portal). TIDAK di app bot.
 * Deps: express, express-rate-limit, `lib/turnstile`, `lib/portal-areas`, `lib/public-page-helper`,
 *   `lib/error-handler` (asyncHandler), `lib/response-helper`.
 * MainFuncs: GET / (landing), GET /daftar (form), GET /voucher (halaman voucher),
 *   GET /api/areas, POST /api/register, GET /api/area/:area/:type/:id? (proxy).
 * SideEffects: Proxy HTTP ke bot area (loopback). TIDAK menyentuh saldo/WA/DB langsung.
 */
"use strict";

const express = require("express");
const path = require("path");
const rateLimit = require("express-rate-limit");
const { verifyTurnstile } = require("../lib/turnstile");
const { resolveArea, isAreaEnabled, listEnabledAreas, getReadyAreas, proxyJson, proxyBinary } = require("../lib/portal-areas");
const { esc } = require("../lib/public-page-helper");
const { asyncHandler } = require("../lib/error-handler");
const { sendError } = require("../lib/response-helper");

const router = express.Router();

// Jenis proxy yang DIIZINKAN (mirror kontrak bot `/app/:type`). Guard: jangan proxy path sembarang.
const PROXY_TYPES = ["packages", "voucher", "buy", "detailtrx", "statustrx", "qr"];

// Rate limit registrasi portal: 5 submit / 15 menit / IP-PEMBELI (throttle utama; bot backend
// internal-only & limiter-nya di-skip utk loopback). standardHeaders utk debugging.
const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { status: 429, message: "Terlalu banyak pendaftaran dari koneksi ini. Coba lagi dalam 15 menit." },
    standardHeaders: true,
    legacyHeaders: false
});

function getBrand() {
    const cfg = global.config || {};
    const b = (cfg.portal && cfg.portal.brand) || cfg.company || {};
    return { name: b.name || "RAF NET", logo: b.logoPath || b.logo || "" };
}

function getTurnstileSiteKey() {
    const t = (global.config && global.config.turnstile) || {};
    return t.enabled && t.siteKey && !/^ISI_/i.test(String(t.siteKey)) ? String(t.siteKey) : "";
}

// ---------- shared CSS ----------
const CSS = `
:root{--brand:#4338ca;--brand2:#6366f1;--ink:#0f172a;--body:#334155;--muted:#64748b;
--line:#e5e7eb;--bg:#f8fafc;--card:#fff;--ok:#059669;--err:#dc2626;--radius:16px}
*{box-sizing:border-box}
body{margin:0;font-family:'Inter',system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
color:var(--body);background:var(--bg);line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
.wrap{max-width:960px;margin:0 auto;padding:0 20px}
.wrap-sm{max-width:560px;margin:0 auto;padding:0 20px}
header.top{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.92);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.top .wrap,.top .wrap-sm{display:flex;align-items:center;gap:12px;height:62px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;color:var(--ink);font-size:1.12rem}
.brand img{height:32px;width:auto;border-radius:8px}
.back{margin-left:auto;color:var(--muted);font-weight:600;font-size:.92rem}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-weight:700;border-radius:12px;
padding:13px 24px;border:1px solid transparent;cursor:pointer;font-size:1rem;transition:.15s}
.btn-primary{background:var(--brand);color:#fff}.btn-primary:hover{background:#3730a3}
.btn-ghost{background:#fff;color:var(--ink);border-color:var(--line)}.btn-ghost:hover{border-color:var(--brand2)}
.btn[disabled]{opacity:.5;cursor:not-allowed}
.hero{background:linear-gradient(135deg,#eef2ff,#f8fafc 60%);border-bottom:1px solid var(--line)}
.hero .wrap{padding:64px 20px 56px;text-align:center}
.hero h1{font-size:clamp(1.9rem,5vw,3rem);line-height:1.1;letter-spacing:-.03em;color:var(--ink);margin:0 0 16px;font-weight:800}
.hero p.lead{font-size:1.14rem;color:var(--muted);max-width:600px;margin:0 auto 26px}
.picker{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:22px;max-width:440px;margin:0 auto;
box-shadow:0 16px 40px -24px rgba(67,56,202,.4);text-align:left}
.picker label{display:block;font-weight:700;color:var(--ink);font-size:.9rem;margin-bottom:8px}
select,input,textarea{width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:11px;font:inherit;color:var(--ink);background:#fff;transition:.15s}
select:focus,input:focus,textarea:focus{outline:none;border-color:var(--brand2);box-shadow:0 0 0 3px rgba(99,102,241,.15)}
.picker .cta{display:flex;gap:12px;margin-top:16px}
.picker .cta .btn{flex:1;padding:12px}
.section{padding:52px 0}
.section h2{font-size:1.6rem;letter-spacing:-.02em;color:var(--ink);margin:0 0 6px;text-align:center;font-weight:800}
.section .sub{color:var(--muted);text-align:center;margin:0 auto 30px;max-width:520px}
.pkg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:18px}
.pkg{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:24px 22px;display:flex;flex-direction:column;gap:4px}
.pkg .name{font-weight:700;color:var(--muted);font-size:.9rem;text-transform:uppercase;letter-spacing:.04em}
.pkg .price{font-size:1.6rem;font-weight:800;color:var(--ink)}
.pkg .price small{font-size:.85rem;font-weight:600;color:var(--muted)}
.muted-note{color:var(--muted);text-align:center}
.field{margin-bottom:16px}
.field label{display:block;font-weight:600;color:var(--ink);font-size:.92rem;margin-bottom:6px}
.field label .opt{color:var(--muted);font-weight:500}
.hint{font-size:.82rem;color:var(--muted);margin-top:5px}
textarea{resize:vertical;min-height:76px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:26px 22px;box-shadow:0 10px 30px -22px rgba(15,23,42,.4)}
main{padding:34px 0 60px}
h1.page{font-size:1.7rem;letter-spacing:-.02em;color:var(--ink);margin:0 0 6px}
.lead2{color:var(--muted);margin:0 0 24px}
.msg{margin-top:14px;padding:12px 14px;border-radius:11px;font-weight:600;font-size:.92rem;display:none}
.msg.show{display:block}.msg.ok{background:#ecfdf5;color:var(--ok);border:1px solid #a7f3d0}.msg.err{background:#fef2f2;color:var(--err);border:1px solid #fecaca}
.cf-turnstile{margin:6px 0}
footer.foot{background:#0b1220;color:#64748b;text-align:center;padding:24px 20px;font-size:.9rem}
`;

function areaOptions(areas, selected) {
    return ['<option value="">— Pilih area —</option>']
        .concat(areas.map((a) => `<option value="${esc(a.id)}"${a.id === selected ? " selected" : ""}>${esc(a.label)}</option>`))
        .join("");
}

// ---------- Landing ----------
function renderLanding({ brand, areas }) {
    const logo = brand.logo ? `<img src="${esc(brand.logo)}" alt="${esc(brand.name)}">` : "";
    return `<!doctype html>
<html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(brand.name)} — Internet Cepat & Stabil</title>
<meta name="description" content="Layanan internet ${esc(brand.name)}. Pilih area, daftar pasang baru, atau beli voucher online.">
<style>${CSS}</style></head><body>
<header class="top"><div class="wrap"><a class="brand" href="/">${logo}<span>${esc(brand.name)}</span></a></div></header>
<section class="hero"><div class="wrap">
  <h1>Internet cepat &amp; stabil<br>untuk rumah &amp; usaha Anda</h1>
  <p class="lead">Pilih area layanan Anda, lalu daftar pasang baru atau beli voucher hotspot — semua online.</p>
  <div class="picker">
    <label for="area">Area layanan</label>
    <select id="area" name="area">${areaOptions(areas, "")}</select>
    <div class="cta">
      <a class="btn btn-primary" id="ctaDaftar" href="#" aria-disabled="true">Daftar Baru</a>
      <a class="btn btn-ghost" id="ctaVoucher" href="#" aria-disabled="true">Beli Voucher</a>
    </div>
    <p class="hint" id="pickHint">Pilih area dulu untuk melanjutkan.</p>
  </div>
</div></section>
<section class="section" id="paketSec" style="display:none"><div class="wrap">
  <h2>Paket Bulanan</h2><p class="sub">Harga transparan untuk area terpilih.</p>
  <div class="pkg-grid" id="pkgGrid"></div>
  <p class="muted-note" id="pkgNote" style="display:none"></p>
</div></section>
<footer class="foot">© ${esc(brand.name)}</footer>
<script>
(function(){
  var sel=document.getElementById('area'), d=document.getElementById('ctaDaftar'), v=document.getElementById('ctaVoucher'),
      hint=document.getElementById('pickHint'), sec=document.getElementById('paketSec'), grid=document.getElementById('pkgGrid'), note=document.getElementById('pkgNote');
  function rupiah(n){n=parseInt(n,10)||0;return 'Rp'+n.toLocaleString('id-ID');}
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function setEnabled(on,area){
    [d,v].forEach(function(a){ if(on){a.removeAttribute('aria-disabled');a.classList.remove('btn'); a.classList.add('btn'); } else {a.setAttribute('aria-disabled','true');} });
    d.href=on?('/daftar?area='+encodeURIComponent(area)):'#';
    v.href=on?('/voucher?area='+encodeURIComponent(area)):'#';
    hint.style.display=on?'none':'block';
  }
  [d,v].forEach(function(a){a.addEventListener('click',function(e){ if(a.getAttribute('aria-disabled')==='true'){e.preventDefault();} });});
  sel.addEventListener('change',function(){
    var area=sel.value;
    if(!area){ setEnabled(false,''); sec.style.display='none'; return; }
    setEnabled(true,area);
    sec.style.display='block'; grid.innerHTML=''; note.style.display='block'; note.textContent='Memuat paket…';
    fetch('/api/area/'+encodeURIComponent(area)+'/packages').then(function(r){return r.json();}).then(function(res){
      var list=(res&&res.data)||[]; if(!Array.isArray(list)||!list.length){ note.textContent='Belum ada paket untuk area ini.'; return; }
      note.style.display='none';
      grid.innerHTML=list.filter(function(p){return p&&p.name&&parseInt(p.price,10)>0;}).slice(0,12).map(function(p){
        return '<div class="pkg"><div class="name">'+esc(p.name)+'</div><div class="price">'+rupiah(p.price)+'<small> /bln</small></div></div>';
      }).join('');
    }).catch(function(){ note.textContent='Gagal memuat paket. Coba lagi.'; });
  });
})();
</script>
</body></html>`;
}

// ---------- Form registrasi ----------
function renderRegister({ brand, areas, siteKey, selectedArea }) {
    const logo = brand.logo ? `<img src="${esc(brand.logo)}" alt="${esc(brand.name)}">` : "";
    const tsScript = siteKey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : "";
    const tsWidget = siteKey ? `<div class="field"><div class="cf-turnstile" data-sitekey="${esc(siteKey)}"></div></div>` : "";
    return `<!doctype html>
<html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Daftar — ${esc(brand.name)}</title>
<style>${CSS}</style>${tsScript}</head><body>
<header class="top"><div class="wrap-sm"><a class="brand" href="/">${logo}<span>${esc(brand.name)}</span></a><a class="back" href="/">← Beranda</a></div></header>
<main class="wrap-sm">
  <h1 class="page">Daftar Pasang Baru</h1>
  <p class="lead2">Pilih area &amp; isi data. Tim kami akan menghubungi Anda untuk survei &amp; pemasangan.</p>
  <div class="card"><form id="regForm" novalidate>
    <div class="field"><label for="area">Area Layanan</label><select id="area" name="area" required>${areaOptions(areas, selectedArea)}</select></div>
    <div class="field"><label for="name">Nama Lengkap</label><input id="name" name="name" type="text" required maxlength="100" autocomplete="name"></div>
    <div class="field"><label for="phone">Nomor WhatsApp</label><input id="phone" name="phone" type="tel" required inputmode="numeric" placeholder="08xxxxxxxxxx" autocomplete="tel"><div class="hint">Nomor aktif yang bisa dihubungi via WhatsApp.</div></div>
    <div class="field"><label for="address">Alamat Pemasangan</label><textarea id="address" name="address" required maxlength="300" placeholder="Nama jalan, RT/RW, desa/kelurahan, patokan"></textarea></div>
    <div class="field"><label for="locationUrl">Link Lokasi Google Maps <span class="opt">(opsional)</span></label><input id="locationUrl" name="locationUrl" type="url" maxlength="500" placeholder="https://maps.app.goo.gl/..."></div>
    ${tsWidget}
    <button class="btn btn-primary" type="submit" style="width:100%">Kirim Pendaftaran</button>
    <div id="msg" class="msg"></div>
  </form></div>
</main>
<footer class="foot">© ${esc(brand.name)}</footer>
<script>
(function(){
  var form=document.getElementById('regForm'), msg=document.getElementById('msg'), btn=form.querySelector('button[type=submit]');
  function show(kind,text){msg.className='msg show'+(kind?' '+kind:'');msg.textContent=text;}
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var fd=new FormData(form);
    var payload={ area:fd.get('area')||'', name:(fd.get('name')||'').trim(), phone:(fd.get('phone')||'').trim(),
      address:(fd.get('address')||'').trim(), locationUrl:(fd.get('locationUrl')||'').trim(),
      turnstileToken:fd.get('cf-turnstile-response')||'' };
    if(!payload.area){show('err','Silakan pilih area layanan.');return;}
    if(!payload.name||!payload.phone||!payload.address){show('err','Nama, nomor HP, dan alamat wajib diisi.');return;}
    btn.disabled=true;show('','Mengirim…');
    fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
      .then(function(res){
        if(window.turnstile){try{window.turnstile.reset();}catch(_e){}}
        if(res.ok){form.reset();show('ok',(res.d&&res.d.message)||'Pendaftaran berhasil! Tim kami akan menghubungi Anda.');}
        else{show('err',(res.d&&res.d.message)||'Gagal mengirim. Coba lagi.');}
      })
      .catch(function(){show('err','Gagal terhubung ke server. Coba lagi.');})
      .then(function(){btn.disabled=false;});
  });
})();
</script>
</body></html>`;
}

// ---------- Routes: UI ----------
router.get("/", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.type("html").send(renderLanding({ brand: getBrand(), areas: listEnabledAreas() }));
});

router.get("/daftar", (req, res) => {
    const selectedArea = typeof req.query.area === "string" ? req.query.area : "";
    res.set("Cache-Control", "no-store");
    res.type("html").send(renderRegister({ brand: getBrand(), areas: listEnabledAreas(), siteKey: getTurnstileSiteKey(), selectedArea }));
});

router.get("/voucher", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "static", "portal-voucher.html"));
});

// ---------- Routes: API ----------
router.get("/api/areas", asyncHandler(async (req, res) => {
    const areas = await getReadyAreas();
    res.set("Cache-Control", "no-store");
    return res.status(200).json({ status: 200, data: areas });
}));

router.post("/api/register", registerLimiter, asyncHandler(async (req, res) => {
    const { area: areaId, name, phone, address, packageInterest, locationUrl, latitude, longitude, turnstileToken } = req.body || {};

    // Turnstile diverifikasi DI PORTAL (fail-closed). Bot backend Turnstile off (internal-only).
    const ts = await verifyTurnstile(turnstileToken, req.ip);
    if (!ts.ok) return sendError(res, "Verifikasi anti-bot gagal. Muat ulang halaman lalu coba lagi.", 403);

    const area = resolveArea(areaId);
    if (!area) return sendError(res, "Silakan pilih area layanan yang valid.", 400);
    if (!isAreaEnabled(area)) return sendError(res, "Area ini belum tersedia. Silakan pilih area lain.", 503);
    if (!name || !phone || !address) return sendError(res, "Nama, nomor HP, dan alamat wajib diisi.", 400);

    try {
        // Proxy ke listener publik bot area (loopback). Kirim TANPA turnstileToken (bot Turnstile off).
        const r = await proxyJson(area, "post", "/api/public/register", {
            body: { name, phone, address, packageInterest, locationUrl, latitude, longitude }
        });
        return res.status(r.status).json(r.data); // passthrough pesan/kode bot (Indonesia)
    } catch (e) {
        console.error(`[PORTAL_REGISTER] area=${area.id} gagal proxy:`, e.message);
        return sendError(res, "Pendaftaran gagal diproses. Coba lagi sebentar lagi.", 502);
    }
}));

// Proxy generik ke bot `/app/:type/:id?` — melayani katalog (packages/voucher), buy, detailtrx,
// statustrx, qr. Area & type di-whitelist (anti-SSRF; bukan path sembarang).
router.get("/api/area/:area/:type/:id?", asyncHandler(async (req, res) => {
    const area = resolveArea(req.params.area);
    if (!area) return sendError(res, "Area tidak dikenal.", 404);
    if (!isAreaEnabled(area)) return sendError(res, "Area ini belum tersedia.", 503);

    const type = req.params.type;
    if (!PROXY_TYPES.includes(type)) return sendError(res, "Endpoint tidak valid.", 400);

    const id = req.params.id;
    const botPath = `/app/${type}${id != null ? "/" + encodeURIComponent(id) : ""}`;

    try {
        if (type === "qr") {
            const r = await proxyBinary(area, botPath, { query: req.query });
            res.status(r.status);
            res.setHeader("Content-Type", r.contentType);
            res.setHeader("Cache-Control", "no-store");
            return res.end(r.buffer);
        }
        const r = await proxyJson(area, "get", botPath, { query: req.query, timeout: type === "buy" ? 30000 : 10000 });
        res.set("Cache-Control", "no-store");
        return res.status(r.status).json(r.data);
    } catch (e) {
        console.error(`[PORTAL_PROXY] area=${area.id} type=${type} gagal:`, e.message);
        return sendError(res, "Layanan area sedang bermasalah. Coba lagi sebentar.", 502);
    }
}));

module.exports = router;
