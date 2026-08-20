/**
 * Header Doc
 * Purpose: Diagnosa SPESIFIK per-aplikasi untuk balasan "cek koneksi" — menggabungkan entitas app
 *          yang disebut pelanggan (lib/app-entity-extractor) dengan jalur upstream paket pelanggan
 *          (lib/customer-path-resolver — LIVE dari address-list router) dan pengukuran NYATA: sel matriks reachability TCP+TLS
 *          layanan itu di jalur itu (lib/service-reachability-prober) + kualitas jalur (loss/RTT,
 *          lib/upstream-quality-poller). Menghasilkan kalimat jujur ber-angka ("TikTok lewat jalur
 *          MNI kamu memang lagi lambat, buka ~640ms vs normal ~80ms — sudah kami tangani"),
 *          membandingkan dengan jalur tersehat, dan membedakan gangguan sisi-kami vs perangkat.
 *          Untuk game (tanpa probe langsung) memakai loss/RTT jalur + fakta routing WA/game→IH.
 *          READ-ONLY, best-effort, tidak pernah throw.
 * Caller: `message/handlers/connection-check-handler.js`.
 * Deps: `lib/customer-path-resolver.resolveCustomerPath` (LIVE address-list, bukan CIDR statis),
 *       lazy `lib/service-reachability-prober.
 *       buildServiceReport`, `lib/upstream-quality-poller.buildStatusReport`,
 *       `message/handlers/template-helpers.renderResponseTemplate`.
 * MainFuncs: `buildAppDiagnosis`.
 * SideEffects: Tidak ada (baca cache/DB via modul lain).
 *
 * STARVASI DATA — slot `jalur_label`/`ms`/`normal_ms`/`loss`/`rtt` SENGAJA tidak dioper ke
 * template pelanggan. Dulu dikirim "sbg var untuk owner/kustomisasi", dan itulah akar keluhan
 * pemilik: template TERSIMPAN mengalahkan fallback + template produksi di-merge-key, jadi teks
 * lama "TikTok lewat jalur paket Anda (MNI) bermasalah (butuh ~640ms, normalnya ~80ms)" tetap
 * hidup walau fallback di kode sudah disederhanakan.
 *
 * Nama jalur juga tak layak dipercaya untuk pelanggan: peta CIDR→jalur = snapshot recon router
 * 2026-07-07; terukur 13% pelanggan aktif tak terpetakan, dan subnet yang sama muncul di dua
 * address-list router sehingga "satu subnet = satu jalur" tidak lagi benar.
 */
"use strict";

const { resolveCustomerPath } = require("./customer-path-resolver");

const VERDICT_BAD = ["DOWN", "TERGANGGU", "LAMBAT"];


/**
 * @param {object} args
 * @param {string} args.addr         IP remote PPPoE pelanggan (dari PPP active) → peta jalur
 * @param {object} args.appEntity    hasil app-entity-extractor.topAppEntity
 * @param {object} [deps]            override test: { resolvePath, getServiceReport, getStatusReport, renderResponseTemplate }
 * @returns {Promise<string>} seksi teks (diawali \n\n) atau "" bila tak ada yang bisa dikatakan spesifik.
 */
async function buildAppDiagnosis({ addr, appEntity }, deps = {}) {
    try {
        if (!appEntity) return "";
        const upCfg = global.config && global.config.upstreamMonitor;
        if (!upCfg || upCfg.enabled !== true) return "";
        if (!addr) return "";

        // Jalur diambil dari resolver LIVE (address-list steering router), BUKAN peta CIDR statis.
        //
        // Terukur di produksi 2026-08-20 atas 62 pelanggan PPPoE aktif — peta statis
        // (`lib/upstream-path-resolver`, snapshot recon 2026-07-07) vs address-list LIVE:
        //     sepakat 41 · BEDA 13 (21%) · statis buta padahal live tahu 8 (13%)
        // Jadi 34% pelanggan mendapat jalur SALAH atau tak dapat jalur sama sekali. Akarnya
        // subnet 192.168.61.0/24 yang di peta statis tertulis "mni" padahal LIVE sudah masuk
        // `lokaldns` → "gmdp" (di-steer ulang di router setelah snapshot dibuat).
        //
        // Akibatnya bot menilai kesehatan JALUR YANG SALAH saat pelanggan mengeluh "YouTube
        // lemot" — vonis percaya diri di atas data yang bukan miliknya. Resolver LIVE tetap
        // memakai peta statis sebagai jaring terakhir, jadi tak ada cakupan yang hilang.
        // Fail-closed: router tak terbaca → null → bot diam soal app, bukan menebak.
        // Resolver ikut bisa di-inject (pola sama dgn getServiceReport/getStatusReport) supaya
        // test tak perlu menembak router. Tanpa injeksi, dipakai resolver LIVE sungguhan.
        const resolvePath = deps.resolvePath || resolveCustomerPath;
        const pathKey = await resolvePath(addr);
        if (!pathKey) return "";

        const render = deps.renderResponseTemplate
            || require("../message/handlers/template-helpers").renderResponseTemplate;
        const namaApp = appEntity.label;

        // ===== Kelas 1: app punya probe langsung (TikTok/YT/IG/FB/WA/Shopee/browsing→google) =====
        if (appEntity.serviceKey) {
            let report = null;
            try {
                const getReport = deps.getServiceReport
                    || (() => require("./service-reachability-prober").buildServiceReport());
                const smCfg = global.config && global.config.serviceMonitor;
                if (smCfg && smCfg.enabled === true) report = await getReport();
            } catch (_e) { report = null; }

            if (report && Array.isArray(report.services)) {
                const svc = report.services.find((s) => s.key === appEntity.serviceKey);
                const cell = svc && Array.isArray(svc.cells) ? svc.cells.find((c) => c.path === pathKey) : null;
                if (cell && cell.samples) {
                    // Loss/RTT/label jalur TIDAK lagi dihitung: vonisnya memakai verdict sel (dan `entry.status`
                    // di bawah), sedangkan angkanya tak pernah dibacakan ke pelanggan. Menghitungnya hanya
                    // menyisakan kode hantu yang mengundang dipakai lagi.
                    if (VERDICT_BAD.includes(cell.verdict)) {
                        return render(
                            "conncheck_app_issue",
                            `\n\n🎯 *Soal ${namaApp}:* betul Kak, akses ke *${namaApp}* memang sedang ada kendala ` +
                            `dari sisi jaringan kami saat ini — *bukan dari perangkat Anda*. ` +
                            `Tim kami sudah menerima peringatan otomatis dan sedang menanganinya. Mohon ditunggu ya 🙏`,
                            {
                                app: namaApp
                            }
                        );
                    }
                    // App-nya SEHAT di jalur pelanggan → jujur katakan, arahkan ke sisi perangkat.
                    return render(
                        "conncheck_app_ok",
                        `\n\n🎯 *Soal ${namaApp}:* dari sisi jaringan kami, akses ke *${namaApp}* terpantau *lancar* saat ini. ` +
                        `Kalau di perangkat Anda masih terasa berat, coba tutup lalu buka lagi aplikasinya, atau restart WiFi/HP ya Kak. ` +
                        `Kalau tetap, balas *lapor* 🙏`,
                        { app: namaApp }
                    );
                }
            }
            // Prober tak aktif/tak ada sampel → jatuh ke diagnosa berbasis kualitas jalur di bawah.
        }

        // ===== Kelas 2: game/streaming/call tanpa probe langsung → pakai kualitas jalur =====
        let statusReport = null;
        try {
            const getStatus = deps.getStatusReport
                || (() => require("./upstream-quality-poller").buildStatusReport());
            statusReport = await getStatus();
        } catch (_e) { statusReport = null; }
        const entry = statusReport && Array.isArray(statusReport.paths)
            ? statusReport.paths.find((p) => p.key === pathKey) : null;
        if (!entry) return "";

        if (["DEGRADASI", "GANGGUAN", "PUTUS"].includes(entry.status)) {
            return render(
                "conncheck_app_path_issue",
                `\n\n🎯 *Soal ${namaApp}:* jalur internet yang Anda pakai sedang ada kendala saat ini, ` +
                `jadi wajar kalau ${namaApp} terasa terganggu. Ini dari sisi jaringan kami — ` +
                `*bukan dari perangkat Anda* — dan tim sudah menerima peringatan otomatis. Mohon ditunggu ya 🙏`,
                { app: namaApp }
            );
        }
        // Jalur sehat untuk game/streaming → arahkan ke sisi perangkat/WiFi.
        return render(
            "conncheck_app_path_ok",
            `\n\n🎯 *Soal ${namaApp}:* jalur internet Anda terpantau *lancar* saat ini. ` +
            `Untuk ${namaApp}, coba dekatkan perangkat ke WiFi atau pakai kabel bila memungkinkan. ` +
            `Kalau masih terasa, balas *lapor* ya Kak 🙏`,
            { app: namaApp }
        );
    } catch (_e) {
        return "";
    }
}

module.exports = { buildAppDiagnosis };
