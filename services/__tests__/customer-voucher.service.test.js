"use strict";

/**
 * Header Doc
 * Purpose: Unit test `services/customer-voucher.service.js` — gating fitur, read-model paket
 *   (tidak membocorkan harga reseller/margin), pembuatan transaksi (tag + prof + customerId
 *   tersimpan), dan yang paling kritis: SCOPING kepemilikan, supaya pelanggan tidak bisa membaca
 *   kode voucher pelanggan lain dengan menebak reff.
 * Caller: Jest (`npx jest services/__tests__/customer-voucher.service.test.js`).
 * Deps: `services/customer-voucher.service` (murni, semua dependensi disuntik).
 * MainFuncs: -
 * SideEffects: Tidak ada — iPaymu & addPayment di-stub.
 */

const { createCustomerVoucherService } = require("../customer-voucher.service");

const PROFILES = [
    { prof: "Paket-3Jam", namavc: "Paket 3 Jam", durasivc: "3 Jam", hargavc: "1000", hargaReseller: "800", margin: "200" },
    { prof: "Paket-1Hari", namavc: "Paket 1 Hari", durasivc: "1 Hari", hargavc: "3000", hargaReseller: "2400", margin: "600" },
    // Sengaja berharga SAMA dengan Paket-3Jam: membuktikan alur tidak bergantung pada harga→profil.
    { prof: "Paket-Promo", namavc: "Paket Promo", durasivc: "4 Jam", hargavc: "1000", hargaReseller: "700", margin: "300" }
];

const CUSTOMER = { id: 42, name: "Budi", phone_number: "081234567890" };
const OTHER_CUSTOMER = { id: 99, name: "Siti", phone_number: "081299998888" };

function build({ enabled = true, payImpl, payments = [] } = {}) {
    const added = [];
    const service = createCustomerVoucherService({
        getConfig: () => ({ customerVoucher: { enabled }, voucherFeatured: "Paket-1Hari" }),
        pay: payImpl || (async () => ({
            id: "TRX-1",
            qrString: "00020101021226",
            total: 1000,
            fee: 0,
            subTotal: 1000,
            exp: 3600
        })),
        addPayment: (reffId, trxId, sender, tag, amount, method, ket, opts) => {
            added.push({ reffId, trxId, sender, tag, amount, method, ket, ...opts });
            payments.push({ reffId, trxId, sender, tag, amount, method, ket, status: false, createdAt: Date.now(), ...opts });
        },
        checkhargavc: (prof) => (PROFILES.find((p) => p.prof === prof) || {}).hargavc,
        getVoucherProfiles: () => PROFILES,
        getPayments: () => payments,
        logger: { error: () => {}, warn: () => {}, log: () => {} }
    });
    return { service, added, payments };
}

describe("customer-voucher service — gating", () => {
    test("default OFF: isEnabled false dan pembelian ditolak 503", async () => {
        const { service } = build({ enabled: false });
        expect(service.isEnabled()).toBe(false);
        const result = await service.createPurchase({ customer: CUSTOMER, prof: "Paket-3Jam" });
        expect(result.ok).toBe(false);
        expect(result.status).toBe(503);
    });

    test("ON: isEnabled true", () => {
        expect(build({ enabled: true }).service.isEnabled()).toBe(true);
    });
});

describe("customer-voucher service — read-model paket", () => {
    test("tidak membocorkan hargaReseller / margin ke pelanggan", () => {
        const { service } = build();
        const packages = service.listPackages();
        expect(packages.length).toBe(3);
        packages.forEach((item) => {
            expect(item).not.toHaveProperty("hargaReseller");
            expect(item).not.toHaveProperty("margin");
            expect(Object.keys(item).sort()).toEqual(["duration", "featured", "name", "price", "prof"]);
        });
    });

    test("menandai paket unggulan dari config.voucherFeatured", () => {
        const { service } = build();
        const featured = service.listPackages().filter((item) => item.featured);
        expect(featured.map((item) => item.prof)).toEqual(["Paket-1Hari"]);
    });
});

describe("customer-voucher service — pembuatan transaksi", () => {
    test("paket tidak dikenal → 404, tidak memanggil gateway", async () => {
        let called = false;
        const { service } = build({ payImpl: async () => { called = true; return {}; } });
        const result = await service.createPurchase({ customer: CUSTOMER, prof: "Paket-Hantu" });
        expect(result.status).toBe(404);
        expect(called).toBe(false);
    });

    test("nomor HP akun tidak valid → 422, tidak memanggil gateway", async () => {
        let called = false;
        const { service } = build({ payImpl: async () => { called = true; return {}; } });
        const result = await service.createPurchase({
            customer: { id: 7, name: "X", phone_number: "-" },
            prof: "Paket-3Jam"
        });
        expect(result.status).toBe(422);
        expect(called).toBe(false);
    });

    test("phone_number KOSONG → 422 dengan pesan yang bisa ditindaklanjuti pelanggan", async () => {
        // 6 dari 59 pelanggan DANDER kosong nomornya (login username/password). Mereka bisa
        // memperbaiki sendiri di Pengaturan, jadi pesannya harus mengatakan itu.
        const { service } = build();
        const result = await service.createPurchase({
            customer: { id: 8, name: "Y", phone_number: "" },
            prof: "Paket-3Jam"
        });
        expect(result.status).toBe(422);
        expect(result.message).toMatch(/belum punya nomor HP/i);
        expect(result.message).toMatch(/Pengaturan/);
    });

    test("phone_number BERISI BANYAK NOMOR (dipisah '|') → pakai nomor PERTAMA, bukan gabungan", async () => {
        // Regresi: `phone_number` adalah daftar dipisah '|'. Menyapu non-digit dari seluruh
        // string menggabungkan semuanya jadi angka 26-39 digit yang lolos cek panjang dan
        // terkirim ke iPaymu sebagai nomor sampah. 10 dari 59 pelanggan DANDER berbentuk ini.
        let seenPhone = null;
        const { service, added } = build({
            payImpl: async (props) => {
                seenPhone = props.phone;
                return { id: "TRX-9", qrString: "QR", total: 1000, fee: 0, subTotal: 1000, exp: 3600 };
            }
        });

        const result = await service.createPurchase({
            customer: { id: 9, name: "Z", phone_number: "081234567890|081298765432|085711112222" },
            prof: "Paket-3Jam"
        });

        expect(result.ok).toBe(true);
        expect(String(seenPhone)).toBe("81234567890");
        expect(String(seenPhone).length).toBeLessThan(14);
        // sender yang tersimpan juga harus nomor tunggal, karena callback memakainya untuk kirim WA
        expect(added[0].sender).toBe("081234567890");
    });

    test("spasi di sekitar pemisah '|' tidak ikut terbawa", async () => {
        let seenPhone = null;
        const { service } = build({
            payImpl: async (props) => {
                seenPhone = props.phone;
                return { id: "TRX-10", qrString: "QR", total: 1000, fee: 0, subTotal: 1000, exp: 3600 };
            }
        });
        await service.createPurchase({
            customer: { id: 10, name: "W", phone_number: "  | 081234567890 | 081298765432" },
            prof: "Paket-3Jam"
        });
        expect(String(seenPhone)).toBe("81234567890");
    });

    test("gateway melempar → 502, bukan 500 bocor ke pelanggan", async () => {
        const { service } = build({ payImpl: async () => { throw "iPaymu tidak mengembalikan QrString."; } });
        const result = await service.createPurchase({ customer: CUSTOMER, prof: "Paket-3Jam" });
        expect(result.ok).toBe(false);
        expect(result.status).toBe(502);
    });

    test("sukses: menyimpan tag buynowpanel, prof eksplisit, dan customerId", async () => {
        const { service, added } = build();
        const result = await service.createPurchase({ customer: CUSTOMER, prof: "Paket-Promo" });
        expect(result.ok).toBe(true);
        expect(result.status).toBe(201);
        expect(added).toHaveLength(1);
        expect(added[0].tag).toBe("buynowpanel");
        // Paket-Promo seharga sama dengan Paket-3Jam — prof harus tersimpan apa adanya,
        // supaya callback tidak salah menerbitkan paket lain.
        expect(added[0].prof).toBe("Paket-Promo");
        expect(added[0].customerId).toBe("42");
        expect(added[0].sender).toBe("081234567890");
        expect(added[0].method).toBe("QRIS");
    });

    test("sukses: mengembalikan qrString untuk ditampilkan panel", async () => {
        const { service } = build();
        const result = await service.createPurchase({ customer: CUSTOMER, prof: "Paket-3Jam" });
        expect(result.data.qrString).toBe("00020101021226");
        expect(result.data.amount).toBe(1000);
    });
});

describe("customer-voucher service — scoping kepemilikan (KEAMANAN)", () => {
    test("pelanggan lain TIDAK bisa membaca status/kode dengan menebak reff", async () => {
        const payments = [];
        const { service } = build({ payments });
        const created = await service.createPurchase({ customer: CUSTOMER, prof: "Paket-3Jam" });
        const reff = created.data.reff;

        // Voucher sudah terbit untuk pemiliknya.
        payments[0].status = true;
        payments[0].ket = "kode-rahasia-123";

        const asOwner = service.getPurchaseStatus({ customer: CUSTOMER, reff });
        expect(asOwner.ok).toBe(true);
        expect(asOwner.data.voucherCode).toBe("kode-rahasia-123");

        const asOther = service.getPurchaseStatus({ customer: OTHER_CUSTOMER, reff });
        expect(asOther.ok).toBe(false);
        expect(asOther.status).toBe(404);
        expect(JSON.stringify(asOther)).not.toContain("kode-rahasia-123");
    });

    test("sesi tanpa id ditolak, tidak cocok dengan record tanpa customerId", () => {
        const payments = [
            { reffId: "abc", tag: "buynowpanel", amount: 1000, status: true, ket: "kode-lama", createdAt: 1 }
        ];
        const { service } = build({ payments });
        expect(service.getPurchaseStatus({ customer: {}, reff: "abc" }).ok).toBe(false);
        expect(service.getPurchaseStatus({ customer: { id: 42 }, reff: "abc" }).ok).toBe(false);
    });

    test("record dengan tag lain (buynowweb) tidak bisa dibaca lewat endpoint panel", () => {
        const payments = [
            { reffId: "web1", tag: "buynowweb", amount: 1000, status: true, ket: "kode-web", customerId: "42", createdAt: 1 }
        ];
        const { service } = build({ payments });
        expect(service.getPurchaseStatus({ customer: CUSTOMER, reff: "web1" }).ok).toBe(false);
    });
});

describe("customer-voucher service — status & riwayat", () => {
    const base = { tag: "buynowpanel", customerId: "42", amount: 1000, prof: "Paket-3Jam" };

    test("state pending menyertakan qrString; state selesai tidak lagi", () => {
        const payments = [
            { ...base, reffId: "r1", status: false, ket: "", qrStr: "QR-PENDING", createdAt: 2 },
            { ...base, reffId: "r2", status: true, ket: "kode-ok", qrStr: "QR-LAMA", createdAt: 1 }
        ];
        const { service } = build({ payments });
        const pending = service.getPurchaseStatus({ customer: CUSTOMER, reff: "r1" }).data;
        expect(pending.state).toBe("pending");
        expect(pending.qrString).toBe("QR-PENDING");

        const done = service.getPurchaseStatus({ customer: CUSTOMER, reff: "r2" }).data;
        expect(done.state).toBe("completed");
        expect(done.qrString).toBeNull();
        expect(done.voucherCode).toBe("kode-ok");
    });

    test("ket berprefix GAGAL → state failed, tanpa kode", () => {
        const payments = [{ ...base, reffId: "r3", status: true, ket: "GAGAL voucher: profil habis", createdAt: 1 }];
        const { service } = build({ payments });
        const view = service.getPurchaseStatus({ customer: CUSTOMER, reff: "r3" }).data;
        expect(view.state).toBe("failed");
        expect(view.voucherCode).toBeNull();
    });

    test("riwayat hanya milik pelanggan sendiri, terbaru dulu", () => {
        const payments = [
            { ...base, reffId: "a", status: true, ket: "k1", createdAt: 10 },
            { ...base, reffId: "b", status: true, ket: "k2", createdAt: 30 },
            { ...base, customerId: "99", reffId: "c", status: true, ket: "punya-orang", createdAt: 20 }
        ];
        const { service } = build({ payments });
        const rows = service.listHistory({ customer: CUSTOMER }).data;
        expect(rows.map((r) => r.reff)).toEqual(["b", "a"]);
        expect(JSON.stringify(rows)).not.toContain("punya-orang");
    });

    test("limit dibatasi maksimum 100 walau diminta lebih", () => {
        const payments = Array.from({ length: 150 }, (_, i) => ({
            ...base, reffId: `r${i}`, status: true, ket: `k${i}`, createdAt: i
        }));
        const { service } = build({ payments });
        expect(service.listHistory({ customer: CUSTOMER, limit: 9999 }).data).toHaveLength(100);
        expect(service.listHistory({ customer: CUSTOMER }).data).toHaveLength(20);
    });
});
