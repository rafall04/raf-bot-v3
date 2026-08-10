"use strict";

/**
 * Header Doc
 * Purpose: Mengunci otorisasi massal sebagai pekerjaan LATAR. Yang dijaga bukan sekadar
 *   "prosesnya jalan", melainkan sifat-sifat yang membuatnya aman untuk uang pelanggan:
 *
 *   - Kegagalan satu pelanggan TIDAK menghentikan sisanya, dan alasannya tercatat per pelanggan.
 *   - Tak pernah ada DUA pekerjaan berjalan bersamaan (dua worker atas daftar yang sama adalah
 *     cara paling mudah memproses pelanggan dua kali).
 *   - Item yang TERPUTUS oleh restart TIDAK diulang otomatis: ia bisa saja sudah mencatat uang
 *     tapi belum sempat menutup pengajuannya, jadi pengulangan otomatis mempertaruhkan
 *     pencatatan ganda. Lebih baik satu baris merah yang meminta manusia memeriksa.
 *   - Ringkasan ke teknisi dikirim SEKALI di akhir, bukan per item.
 * Caller: Jest (`npx jest services/__tests__/bulk-approval-job.service.test.js`).
 * Deps: `services/bulk-approval-job.service`, `repositories/approval-job.repository`, fs/os/path.
 * MainFuncs: -
 * SideEffects: Membuat sqlite sementara lalu menghapusnya; tak menyentuh data nyata.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const repo = require("../../repositories/approval-job.repository");
const jobService = require("../bulk-approval-job.service");

const berkasUji = path.join(os.tmpdir(), "raf-approval-jobs-uji.sqlite");

function bersihkan() {
    for (const suffix of ["", "-wal", "-shm"]) {
        try {
            fs.unlinkSync(berkasUji + suffix);
        } catch (_e) {
            /* memang belum ada */
        }
    }
}

/** Pengganti jalur persetujuan asli — tak ada uang/router yang disentuh di tes. */
function serviceTiruan({ gagalUntuk = [], catat = [] } = {}) {
    return {
        __deps: { sendTechnicianBulkSummary: async (teknisiId, items) => catat.push({ teknisiId, jumlah: items.length }) },
        bulkApproveRequests: async ({ requestIds, skipTechnicianSummary }) => {
            const id = String(requestIds[0]);
            catat.push({ panggil: id, skipTechnicianSummary });
            if (gagalUntuk.includes(id)) {
                return { results: { approved: [], failed: [{ id, reason: "MikroTik tak terjangkau" }], notFound: [] } };
            }
            return { results: { approved: [{ id, userName: `Pelanggan ${id}`, teknisiId: 3 }], failed: [], notFound: [] } };
        }
    };
}

describe("otorisasi massal sebagai pekerjaan latar", () => {
    beforeAll(() => {
        bersihkan();
        repo.setDbPathForTest(berkasUji);
        global.config = { bulkApprovalJob: { enabled: true, tickMs: 5000, itemDelayMs: 0, maxItemsPerJob: 500 } };
        global.users = [
            { id: 1, name: "Budi" },
            { id: 2, name: "Sari" },
            { id: 3, name: "Joko" }
        ];
    });

    afterAll(bersihkan);

    const permintaan = [
        { id: "R1", userId: 1, status: "pending" },
        { id: "R2", userId: 2, status: "pending" },
        { id: "R3", userId: 3, status: "approved" }
    ];
    const loadJSON = () => permintaan;

    test("mengantre SEMUA pending sekaligus — tak ada lagi batas 20", async () => {
        const hasil = await jobService.enqueueBulkApproval({
            requestIds: ["R1", "R2", "R3"],
            actor: { username: "raf" },
            deps: { loadJSON }
        });
        expect(hasil.ok).toBe(true);
        expect(hasil.total).toBe(3);
        // R3 sudah approved → dilewati sejak awal, bukan diproses lalu gagal.
        expect(hasil.antre).toBe(2);
    });

    test("pekerjaan KEDUA ditolak selama yang pertama masih hidup", async () => {
        const kedua = await jobService.enqueueBulkApproval({
            requestIds: ["R1"],
            actor: { username: "raf" },
            deps: { loadJSON }
        });
        expect(kedua.ok).toBe(false);
        expect(kedua.reason).toBe("sedang_berjalan");
    });

    test("satu pelanggan gagal TIDAK menghentikan sisanya, dan alasannya tercatat", async () => {
        const catat = [];
        const hasil = await jobService.tickOnce({ approvalService: serviceTiruan({ gagalUntuk: ["R2"], catat }) });
        expect(hasil.ok).toBe(true);

        const job = await repo.getLatestJob();
        expect(job.status).toBe("done");
        expect(job.ok_count).toBe(1);
        expect(job.failed_count).toBe(1);
        expect(job.skipped_count).toBe(1);
        expect(job.done_count).toBe(job.total_items);

        const items = await repo.getJobItems(job.id);
        const gagal = items.find((i) => i.status === "failed");
        expect(gagal.user_name).toBe("Sari");
        expect(gagal.message).toMatch(/MikroTik/);
        // Nama pelanggan ikut tercatat supaya log terbaca tanpa membuka data lain.
        expect(items.every((i) => i.user_name || i.status === "skipped")).toBe(true);
    });

    test("ringkasan teknisi dimatikan per item — dikirim sekali di akhir", async () => {
        const catat = [];
        bersihkan();
        repo.setDbPathForTest(berkasUji);
        await jobService.enqueueBulkApproval({ requestIds: ["R1", "R2"], actor: { username: "raf" }, deps: { loadJSON } });
        global.config.paymentRequestDigest = { enabled: true };

        await jobService.tickOnce({ approvalService: serviceTiruan({ catat }) });

        // Tiap panggilan per item WAJIB meminta ringkasannya dilewati.
        const panggilan = catat.filter((c) => c.panggil);
        expect(panggilan.length).toBe(2);
        expect(panggilan.every((c) => c.skipTechnicianSummary === true)).toBe(true);

        // Dan ringkasannya dikirim SEKALI untuk teknisi itu, bukan dua kali.
        const ringkasan = catat.filter((c) => c.teknisiId);
        expect(ringkasan).toHaveLength(1);
        expect(ringkasan[0].jumlah).toBe(2);
    });

    test("item yang TERPUTUS ditandai perlu diperiksa, BUKAN diulang otomatis", async () => {
        bersihkan();
        repo.setDbPathForTest(berkasUji);
        await repo.createJob({ id: "BAJ-uji", actorUsername: "raf", items: [{ requestId: "R9", userName: "Budi", status: "pending" }] });
        const item = await repo.nextPendingItem("BAJ-uji");
        await repo.markItemProcessing(item.id);

        // Proses mati di sini. Saat hidup lagi:
        const n = await repo.markInterruptedItems();
        expect(n).toBe(1);

        const items = await repo.getJobItems("BAJ-uji");
        expect(items[0].status).toBe("failed");
        expect(items[0].message).toMatch(/TERPUTUS/);
        expect(items[0].message).toMatch(/periksa manual/i);

        // Dan ia tak akan diambil lagi sebagai pekerjaan pending.
        expect(await repo.nextPendingItem("BAJ-uji")).toBeNull();
    });
});

describe("batas & gerbang", () => {
    const baca = (...p) => fs.readFileSync(path.join(__dirname, "..", "..", ...p), "utf8");

    test("gate config default MATI — deploy gelap", () => {
        const contoh = JSON.parse(baca("config.example.json"));
        expect(contoh.bulkApprovalJob.enabled).toBe(false);
    });

    test("worker TIDAK memparalelkan panggilan router", () => {
        // Tiap item menyentuh router yang sama dan mencatat uang; percepatannya datang dari
        // operator yang tak menunggu, bukan dari menembak router berbarengan.
        const src = baca("services", "bulk-approval-job.service.js");
        const kode = src.split(/\r?\n/).filter((b) => !/^\s*(\*|\/\*|\/\/)/.test(b)).join("\n");
        expect(kode).not.toMatch(/Promise\.all/);
        expect(kode).toMatch(/for \(;;\)/);
    });

    test("route mengantre lalu balas 202, bukan menunggu", () => {
        const route = baca("routes", "requests.js");
        expect(route).toMatch(/enqueueBulkApproval/);
        expect(route).toMatch(/status\(202\)/);
        expect(route).toMatch(/bulk-approve\/log/);
    });

    test("halaman punya kartu lognya", () => {
        const php = baca("views", "sb-admin", "pembayaran", "otorisasi.php");
        const js = baca("static", "js", "otorisasi.js");
        expect(php).toMatch(/id="kartuLogOtorisasi"/);
        expect(js).toMatch(/pantauLogOtorisasi/);
    });
});
