/**
 * Header Doc
 * Purpose: Diagnosa SPESIFIK per-aplikasi untuk balasan "cek koneksi" — menggabungkan entitas app
 *          yang disebut pelanggan (lib/app-entity-extractor) dengan jalur upstream paket pelanggan
 *          (lib/upstream-path-resolver) dan pengukuran NYATA: sel matriks reachability TCP+TLS
 *          layanan itu di jalur itu (lib/service-reachability-prober) + kualitas jalur (loss/RTT,
 *          lib/upstream-quality-poller). Menghasilkan kalimat jujur ber-angka ("TikTok lewat jalur
 *          MNI kamu memang lagi lambat, buka ~640ms vs normal ~80ms — sudah kami tangani"),
 *          membandingkan dengan jalur tersehat, dan membedakan gangguan sisi-kami vs perangkat.
 *          Untuk game (tanpa probe langsung) memakai loss/RTT jalur + fakta routing WA/game→IH.
 *          READ-ONLY, best-effort, tidak pernah throw.
 * Caller: `message/handlers/connection-check-handler.js`.
 * Deps: `lib/upstream-path-resolver.resolvePathForIp`, lazy `lib/service-reachability-prober.
 *       buildServiceReport`, `lib/upstream-quality-poller.buildStatusReport`,
 *       `message/handlers/template-helpers.renderResponseTemplate`.
 * MainFuncs: `buildAppDiagnosis`.
 * SideEffects: Tidak ada (baca cache/DB via modul lain).
 */
"use strict";

const { resolvePathForIp } = require("./upstream-path-resolver");

const VERDICT_BAD = ["DOWN", "TERGANGGU", "LAMBAT"];

function fmt(n) {
    return n == null ? null : Math.round(Number(n));
}

function pathLabelFromReport(report, key) {
    const p = report && Array.isArray(report.paths) ? report.paths.find((x) => x.key === key) : null;
    return (p && p.label) || key;
}

/**
 * @param {object} args
 * @param {string} args.addr         IP remote PPPoE pelanggan (dari PPP active) → peta jalur
 * @param {object} args.appEntity    hasil app-entity-extractor.topAppEntity
 * @param {object} [deps]            override test: { getServiceReport, getStatusReport, renderResponseTemplate }
 * @returns {Promise<string>} seksi teks (diawali \n\n) atau "" bila tak ada yang bisa dikatakan spesifik.
 */
async function buildAppDiagnosis({ addr, appEntity }, deps = {}) {
    try {
        if (!appEntity) return "";
        const upCfg = global.config && global.config.upstreamMonitor;
        if (!upCfg || upCfg.enabled !== true) return "";
        if (!addr) return "";

        const resolved = resolvePathForIp(addr, upCfg);
        if (!resolved) return "";
        const pathKey = resolved.path;

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
                    const jalurLabel = pathLabelFromReport(report, pathKey);
                    // Jalur tersehat utk app ini (pembanding jujur).
                    const sehat = (svc.cells || [])
                        .filter((c) => c.path !== pathKey && c.verdict === "OK" && c.tls_ms != null);
                    const best = sehat.length ? sehat.reduce((m, c) => (c.tls_ms < m.tls_ms ? c : m)) : null;

                    if (VERDICT_BAD.includes(cell.verdict)) {
                        const ms = cell.tls_ms != null ? `${fmt(cell.tls_ms)}ms` : null;
                        const banding = best && best.tls_ms != null
                            ? ` (normalnya ±${fmt(best.tls_ms)}ms)` : "";
                        const detailBuka = ms ? `sekarang perlu ~${ms}${banding} untuk membuka` : "sedang terganggu";
                        return render(
                            "conncheck_app_issue",
                            `\n\n🎯 *Soal ${namaApp}:* betul Kak, *${namaApp}* lewat jalur internet paket Anda ` +
                            `(${jalurLabel}) memang sedang *${cell.verdict === "DOWN" ? "sulit diakses" : "lambat"}* — ${detailBuka}. ` +
                            `Ini dari sisi jaringan kami, *bukan perangkat Anda*, dan tim sudah menerima peringatan otomatis untuk menanganinya. 🙏`,
                            {
                                app: namaApp, jalur_label: jalurLabel, verdict: cell.verdict,
                                ms: ms || "-", normal_ms: best && best.tls_ms != null ? fmt(best.tls_ms) : "-"
                            }
                        );
                    }
                    // App-nya SEHAT di jalur pelanggan → jujur katakan, arahkan ke sisi perangkat.
                    return render(
                        "conncheck_app_ok",
                        `\n\n🎯 *Soal ${namaApp}:* dari sisi jaringan kami, *${namaApp}* lewat jalur Anda ` +
                        `(${jalurLabel}) terpantau *normal*${cell.tls_ms != null ? ` (buka ~${fmt(cell.tls_ms)}ms)` : ""}. ` +
                        `Kalau di perangkat Anda masih berat, coba tutup-buka ulang aplikasinya, atau restart WiFi/HP — ` +
                        `sering kali langsung membaik. Kalau tetap, balas *lapor* ya Kak. 🙏`,
                        { app: namaApp, jalur_label: jalurLabel, ms: cell.tls_ms != null ? fmt(cell.tls_ms) : "-" }
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
        const jalurLabel = entry.label || pathKey;

        // Game & realtime paling sensitif ke loss/RTT/jitter — ambil rata target jauh.
        const targets = Array.isArray(entry.targets) ? entry.targets.filter((t) => t.samples > 0) : [];
        const lossVals = targets.map((t) => t.loss_avg_pct).filter((v) => v != null);
        const rttVals = targets.map((t) => t.rtt_avg_ms).filter((v) => v != null);
        const loss = lossVals.length ? lossVals.reduce((a, b) => a + b, 0) / lossVals.length : null;
        const rtt = rttVals.length ? rttVals.reduce((a, b) => a + b, 0) / rttVals.length : null;

        if (["DEGRADASI", "GANGGUAN", "PUTUS"].includes(entry.status)) {
            return render(
                "conncheck_app_path_issue",
                `\n\n🎯 *Soal ${namaApp}:* untuk ${appEntity.kind === "game" ? "game online" : namaApp} yang butuh koneksi stabil, ` +
                `jalur internet paket Anda (${jalurLabel}) sekarang sedang *terganggu* ` +
                `(kehilangan paket ~${fmt(loss)}%${rtt != null ? `, respons ~${fmt(rtt)}ms` : ""}) — ` +
                `itu yang bikin ${appEntity.kind === "game" ? "ping naik/patah-patah" : "putus-putus"}. ` +
                `Dari sisi kami, bukan perangkat Anda; tim sudah menerima peringatan otomatis. 🙏`,
                { app: namaApp, jalur_label: jalurLabel, loss: fmt(loss), rtt: rtt != null ? fmt(rtt) : "-" }
            );
        }
        // Jalur sehat untuk game/streaming → arahkan ke sisi perangkat/WiFi.
        return render(
            "conncheck_app_path_ok",
            `\n\n🎯 *Soal ${namaApp}:* jalur internet Anda (${jalurLabel}) terpantau *stabil* saat ini ` +
            `(loss ~${fmt(loss)}%${rtt != null ? `, respons ~${fmt(rtt)}ms` : ""}). ` +
            `Untuk ${appEntity.kind === "game" ? "game" : namaApp}, coba dekatkan perangkat ke WiFi atau pakai kabel bila bisa; ` +
            `kalau masih terasa, balas *lapor* ya Kak. 🙏`,
            { app: namaApp, jalur_label: jalurLabel, loss: fmt(loss), rtt: rtt != null ? fmt(rtt) : "-" }
        );
    } catch (_e) {
        return "";
    }
}

module.exports = { buildAppDiagnosis };
