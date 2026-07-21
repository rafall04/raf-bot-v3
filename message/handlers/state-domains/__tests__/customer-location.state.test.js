/**
 * Header Doc
 * Purpose: Test wizard WA titik lokasi pelanggan — cari/borongan, tampilkan TITIK LAMA sebelum menimpa,
 *          terima pin/forward/link Maps, gerbang presisi, dan simpan hanya setelah konfirmasi.
 * Caller: Jest.
 * Deps: ../customer-location.state (dep di-inject).
 * SideEffects: tidak ada.
 */
"use strict";

const {
    startCustomerLocationSession,
    handleCustomerLocationState,
    parseLocationCommand,
    isCustomerLocationTrigger
} = require("../customer-location.state");

const STAFF = { id: 3, username: "davin", name: "Davin", role: "teknisi" };
const NOW = Date.parse("2026-07-21T10:00:00.000Z");
const RUMAH = { lat: -7.195085, lng: 111.8909083 };

const USERS = () => ([
    { id: 41, name: "Imam Ghozali", phone_number: "0852", dusun: "Ngitik" },
    { id: 96, name: "agus supriono", phone_number: "0856", dusun: "Karang", latitude: -7.1985798, longitude: 111.8869848, location_source: "psb_wizard", location_updated_at: "2026-07-13T09:42:02.000Z" },
    { id: 7, name: "Budi Santoso", phone_number: "0812", dusun: "Ngitik" },
    { id: 99, name: "CCTV Lapangan", phone_number: "-", account_type: "infrastruktur" }
]);

function harness(overrides = {}) {
    let state = null;
    const updateUserById = jest.fn(async () => ({ status: 200, body: { data: { id: 41 } } }));
    const base = {
        stateSender: "628999@s.whatsapp.net",
        staff: STAFF,
        reply: jest.fn(async () => {}),
        setUserState: jest.fn((k, s) => { state = s; }),
        deleteUserState: jest.fn(() => { state = null; }),
        usersService: { updateUserById },
        getUsers: () => USERS(),
        getAssets: () => ([{ id: "ODP-1", name: "ODP Ngitik-02", type: "ODP", latitude: -7.1955, longitude: 111.8915 }]),
        nowMs: NOW,
        logger: { error() {}, warn() {}, log() {} },
        ...overrides
    };
    return { base, getState: () => state, updateUserById: base.usersService.updateUserById };
}

const locMsg = (lat, lng) => ({ message: { locationMessage: { degreesLatitude: lat, degreesLongitude: lng } } });
const replies = (h) => h.base.reply.mock.calls.map((c) => c[0]).join("\n");
const step = (h, extra = {}) => ({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), ...extra });

describe("parseLocationCommand", () => {
    test("mengenali bentuk perintah, menolak yang lain", () => {
        expect(parseLocationCommand("lokasi")).toEqual({ query: "" });
        expect(parseLocationCommand("lokasi budi")).toEqual({ query: "budi" });
        expect(parseLocationCommand("titik pak imam")).toEqual({ query: "pak imam" });
        expect(parseLocationCommand("set lokasi budi")).toEqual({ query: "budi" });
        expect(parseLocationCommand("lokasinya mana")).toBeNull();
        expect(parseLocationCommand("cek koneksi")).toBeNull();
        expect(isCustomerLocationTrigger("lokasi")).toBe(true);
    });
});

describe("wizard titik lokasi", () => {
    test("`lokasi` polos → daftar pelanggan yang BELUM punya titik (akun infra dikecualikan)", async () => {
        const h = harness();
        await startCustomerLocationSession({ ...h.base, query: "" });
        const t = replies(h);
        expect(t).toMatch(/belum punya titik/i);
        expect(t).toMatch(/Imam Ghozali/);
        expect(t).toMatch(/Budi Santoso/);
        expect(t).not.toMatch(/agus supriono/); // sudah punya titik
        expect(t).not.toMatch(/CCTV/);          // akun infrastruktur
        expect(h.getState().step).toBe("CUSTLOC_PICK");
    });

    test("`lokasi <nama>` → hasil cari + status titik tiap baris", async () => {
        const h = harness();
        await startCustomerLocationSession({ ...h.base, query: "agus" });
        expect(replies(h)).toMatch(/agus supriono.*sudah ada titik/i);
    });

    test("pilih angka → TITIK LAMA ditampilkan sebelum minta pin baru", async () => {
        const h = harness();
        await startCustomerLocationSession({ ...h.base, query: "agus" });
        await handleCustomerLocationState(step(h, { type: "conversation", chats: "1" }));
        const t = replies(h);
        expect(t).toMatch(/Titik LAMA yang tersimpan/i);
        expect(t).toMatch(/-7\.1985798/);
        expect(t).toMatch(/sumber: psb_wizard/);
        expect(t).toMatch(/akan MENIMPA/i);
        expect(h.getState().step).toBe("CUSTLOC_WAIT_PIN");
    });

    test("pelanggan tanpa titik → dinyatakan belum punya, bukan mengarang", async () => {
        const h = harness();
        await startCustomerLocationSession({ ...h.base, query: "imam" });
        await handleCustomerLocationState(step(h, { type: "conversation", chats: "1" }));
        expect(replies(h)).toMatch(/belum punya titik sama sekali/i);
    });

    test("kirim pin → konfirmasi berisi jarak ke tetangga & ODP → YA menyimpan dgn sumber teknisi_wa", async () => {
        const h = harness();
        await startCustomerLocationSession({ ...h.base, query: "imam" });
        await handleCustomerLocationState(step(h, { type: "conversation", chats: "1" }));
        await handleCustomerLocationState(step(h, { type: "locationMessage", msg: locMsg(RUMAH.lat, RUMAH.lng) }));

        const t = replies(h);
        expect(t).toMatch(/CEK DULU sebelum disimpan/i);
        expect(t).toMatch(/dari rumah agus supriono/);
        expect(t).toMatch(/ODP Ngitik-02/);
        expect(h.getState().step).toBe("CUSTLOC_CONFIRM");
        expect(h.updateUserById).not.toHaveBeenCalled(); // belum ada yang ditulis sebelum YA

        await handleCustomerLocationState(step(h, { type: "conversation", chats: "YA" }));
        expect(h.updateUserById).toHaveBeenCalledWith(expect.objectContaining({
            id: 41,
            userData: expect.objectContaining({
                latitude: RUMAH.lat,
                longitude: RUMAH.lng,
                location_source: "teknisi_wa"
            })
        }));
        expect(replies(h)).toMatch(/tersimpan/i);
    });

    test("tempel link Google Maps juga diterima (padanan 'teruskan sharelok')", async () => {
        const h = harness();
        await startCustomerLocationSession({ ...h.base, query: "imam" });
        await handleCustomerLocationState(step(h, { type: "conversation", chats: "1" }));
        await handleCustomerLocationState(step(h, { type: "conversation", chats: "https://maps.google.com/?q=-7.195085,111.890908" }));
        expect(h.getState().step).toBe("CUSTLOC_CONFIRM");
        expect(h.getState().context.point).toEqual({ lat: -7.195085, lng: 111.890908 });
    });

    test("titik DEFAULT basecamp ditolak keras, state tetap menunggu pin", async () => {
        const h = harness();
        await startCustomerLocationSession({ ...h.base, query: "imam" });
        await handleCustomerLocationState(step(h, { type: "conversation", chats: "1" }));
        await handleCustomerLocationState(step(h, { type: "locationMessage", msg: locMsg(-7.24139, 111.83833) }));
        expect(replies(h)).toMatch(/basecamp|default/i);
        expect(h.getState().step).toBe("CUSTLOC_WAIT_PIN");
        expect(h.updateUserById).not.toHaveBeenCalled();
    });

    test("titik sama dgn pelanggan lain yang BARU disimpan → peringatan ikut tampil", async () => {
        const h = harness({
            getUsers: () => ([
                { id: 41, name: "Imam Ghozali", phone_number: "0852" },
                { id: 96, name: "agus supriono", latitude: RUMAH.lat, longitude: RUMAH.lng, location_updated_at: new Date(NOW - 60000).toISOString() }
            ])
        });
        await startCustomerLocationSession({ ...h.base, query: "imam" });
        await handleCustomerLocationState(step(h, { type: "conversation", chats: "1" }));
        await handleCustomerLocationState(step(h, { type: "locationMessage", msg: locMsg(RUMAH.lat, RUMAH.lng) }));
        expect(replies(h)).toMatch(/SAMA dengan yang baru saja disimpan/i);
        expect(replies(h)).toMatch(/agus supriono/);
    });

    test("BATAL di titik mana pun → tak ada yang tersimpan", async () => {
        const h = harness();
        await startCustomerLocationSession({ ...h.base, query: "imam" });
        await handleCustomerLocationState(step(h, { type: "conversation", chats: "1" }));
        await handleCustomerLocationState(step(h, { type: "locationMessage", msg: locMsg(RUMAH.lat, RUMAH.lng) }));
        await handleCustomerLocationState(step(h, { type: "conversation", chats: "batal" }));
        expect(h.updateUserById).not.toHaveBeenCalled();
        expect(h.getState()).toBeNull();
    });

    test("TIDAK di layar konfirmasi → kembali minta pin, bukan batal total", async () => {
        const h = harness();
        await startCustomerLocationSession({ ...h.base, query: "imam" });
        await handleCustomerLocationState(step(h, { type: "conversation", chats: "1" }));
        await handleCustomerLocationState(step(h, { type: "locationMessage", msg: locMsg(RUMAH.lat, RUMAH.lng) }));
        await handleCustomerLocationState(step(h, { type: "conversation", chats: "TIDAK" }));
        expect(h.getState().step).toBe("CUSTLOC_WAIT_PIN");
        expect(h.updateUserById).not.toHaveBeenCalled();
    });

    test("mode borongan: sesudah simpan langsung menyodorkan sisa yang belum bertitik", async () => {
        const h = harness();
        await startCustomerLocationSession({ ...h.base, query: "" });
        await handleCustomerLocationState(step(h, { type: "conversation", chats: "1" }));
        await handleCustomerLocationState(step(h, { type: "locationMessage", msg: locMsg(RUMAH.lat, RUMAH.lng) }));
        await handleCustomerLocationState(step(h, { type: "conversation", chats: "YA" }));
        // daftar disodorkan lagi tanpa perlu mengetik perintah
        expect(replies(h).match(/belum punya titik/gi).length).toBeGreaterThanOrEqual(2);
    });

    test("pesan bukan lokasi saat menunggu pin → dituntun, tak dianggap koordinat", async () => {
        const h = harness();
        await startCustomerLocationSession({ ...h.base, query: "imam" });
        await handleCustomerLocationState(step(h, { type: "conversation", chats: "1" }));
        await handleCustomerLocationState(step(h, { type: "conversation", chats: "sebentar ya" }));
        expect(replies(h)).toMatch(/Belum ada titik yang terbaca/i);
        expect(h.getState().step).toBe("CUSTLOC_WAIT_PIN");
    });
});
