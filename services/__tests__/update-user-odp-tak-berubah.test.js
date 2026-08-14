/**
 * Header Doc
 * Purpose: Membuktikan update pelanggan yang TIDAK memindahkan ODP tak lagi memicu
 *          pemeriksaan kapasitas ODP.
 * Caller: Jest test runner.
 * Deps: `../api-users/update-user-by-id` (`updateUserById(deps, args)`).
 * MainFuncs: `jalankanUpdate`.
 * SideEffects: Tidak ada — seluruh dependensi ditiru.
 *
 * KENAPA ADA: `oldUserData` tak pernah memuat `connected_odp_id`, sedangkan `odpChanged`
 * membandingkan draft dengannya. Pembandingnya selalu `undefined` → `""`, jadi SETIAP update
 * pelanggan yang punya ODP dianggap "pindah ODP" dan menjalankan `assertOdpAssignable` —
 * yang bisa menolak update dengan "ODP penuh" padahal ODP-nya tak disentuh.
 *
 * CATATAN: tanda tangannya `updateUserById(deps, {...})` — BUKAN factory. Versi pertama tes ini
 * memakai `createUpdateUserById` yang tak ada, lalu "lolos" lewat cabang lewati. Karena itu
 * tes di bawah TIDAK punya jalur lewati: kalau bentuk modulnya berubah, tesnya merah.
 */
"use strict";

const { updateUserById } = require("../api-users/update-user-by-id");

function pelanggan(odpLama) {
    return {
        id: 7,
        name: "Budi",
        phone_number: "628111",
        subscription: "PAKET-110K",
        paid: 1,
        pppoe_username: "budi-dander",
        pppoe_password: "rahasia",
        connected_odp_id: odpLama,
    };
}

async function jalankanUpdate({ odpLama, odpBaru }) {
    const panggilanAssert = [];
    const user = pelanggan(odpLama);

    const deps = {
        repository: {
            findUserById: () => user,
            updateUserRecord: async () => ({ changes: 1 }),
            getUsersSnapshot: () => [user],
            replaceUsersSnapshot: () => {},
        },
        normalizeUserPaymentMethod: () => null,
        validatePhoneNumbers: () => ({ valid: true, duplicates: [] }),
        getDb: () => null,
        isMikrotikSyncEnabled: () => false,
        buildMikrotikSyncResult: (status, message, extra = {}) => ({ status, message, ...extra }),
        getProfileBySubscription: () => null,
        assertMikrotikResult: () => {},
        updatePPPoEProfile: async () => ({ ok: true }),
        deleteActivePPPoEUser: async () => ({ ok: true }),
        applyPaymentStatusChange: async () => ({ action: "no_change" }),
        handlePaidStatusChange: async () => {},
        getPeriodParts: () => ({ periodMonth: 8, periodYear: 2026 }),
        getEffectivePrice: () => 110000,
        logActivity: async () => {},
        logger: { info() {}, warn() {}, error() {} },
        assertOdpAssignable: (id, opts) => panggilanAssert.push({ id, opts }),
    };

    const hasil = await updateUserById(deps, {
        id: 7,
        userData: { name: "Budi Santoso", connected_odp_id: odpBaru },
        actor: { id: 1, username: "admin", role: "admin" },
        requestMeta: {},
    });

    return { panggilanAssert, hasil };
}

describe("update yang TIDAK memindahkan ODP", () => {
    test("tidak memicu pemeriksaan kapasitas ODP", async () => {
        const { panggilanAssert, hasil } = await jalankanUpdate({
            odpLama: "ODP-05",
            odpBaru: "ODP-05",
        });

        expect(panggilanAssert).toHaveLength(0);
        // Bukan sekadar "tak dipanggil" — update-nya juga harus benar-benar berhasil.
        expect(hasil.status).toBe(200);
    });
});

describe("perpindahan ODP yang NYATA", () => {
    test("tetap diperiksa, dan dirinya sendiri dikecualikan dari hitungan", async () => {
        const { panggilanAssert } = await jalankanUpdate({
            odpLama: "ODP-05",
            odpBaru: "ODP-09",
        });

        expect(panggilanAssert).toHaveLength(1);
        expect(panggilanAssert[0].id).toBe("ODP-09");
        expect(panggilanAssert[0].opts).toMatchObject({ excludeUserId: 7 });
    });

    test("pelanggan yang BARU dipasang ke ODP juga diperiksa", async () => {
        const { panggilanAssert } = await jalankanUpdate({ odpLama: null, odpBaru: "ODP-09" });

        expect(panggilanAssert).toHaveLength(1);
        expect(panggilanAssert[0].id).toBe("ODP-09");
    });

    test("melepas pelanggan dari ODP tidak perlu pemeriksaan kapasitas", async () => {
        const { panggilanAssert } = await jalankanUpdate({ odpLama: "ODP-05", odpBaru: "" });

        expect(panggilanAssert).toHaveLength(0);
    });
});
