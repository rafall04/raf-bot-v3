/**
 * Header Doc
 * Purpose: Unit test penjaga teks ke pelanggan. Mengunci dua hal sekaligus: yang WAJIB tertangkap
 *          (jumlah pelanggan terdampak & identitas internal PPPoE/ODP/ODC) dan yang TIDAK BOLEH
 *          ikut tertahan (kalimat sapaan normal, nominal rupiah, tanggal) — penjaga yang terlalu
 *          galak akan dimatikan orang, dan begitu dimatikan ia tak menjaga apa pun.
 * Caller: Jest.
 * Deps: `lib/customer-text-guard`.
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */
"use strict";

const { findCustomerTextLeaks, describeLeaks } = require("../customer-text-guard");

function kinds(text) {
    return findCustomerTextLeaks(text).map((leak) => leak.kind);
}

describe("jumlah pelanggan terdampak tertangkap", () => {
    test("angka + pelanggan, bentuk yang sebenarnya pernah terkirim", () => {
        expect(kinds("Terdeteksi gangguan area — sekitar 96 pelanggan ikut terdampak.")).toContain("jumlah_pelanggan");
    });

    test("bentuk slot template, sebelum tersubstitusi jadi angka", () => {
        expect(kinds("Gangguan area, ${jumlah} pelanggan terdampak.")).toContain("jumlah_pelanggan");
        expect(kinds("Ada ${total_pelanggan} pelanggan yang kena.")).toContain("jumlah_pelanggan");
    });

    test("urutan terbalik (pelanggan ... terdampak ... angka)", () => {
        expect(kinds("Saat ini pelanggan terdampak ada 40 orang.")).toContain("jumlah_pelanggan");
    });

    test("variasi 'orang pelanggan'", () => {
        expect(kinds("Sekitar 12 orang pelanggan terganggu.")).toContain("jumlah_pelanggan");
    });
});

describe("identitas internal tertangkap", () => {
    test("slot nama PPPoE", () => {
        expect(kinds("Akun ${username_pppoe} terganggu.")).toContain("identitas_internal");
    });

    test("slot ODP/ODC", () => {
        expect(kinds("Gangguan di ODP ${odp}.")).toContain("identitas_internal");
        expect(kinds("Area ${odc} sedang diperbaiki.")).toContain("identitas_internal");
    });

    test("ODP yang sudah tercetak sebagai teks", () => {
        expect(kinds("Kabel di ODP MAWAR-03 putus.")).toContain("identitas_internal");
    });
});

describe("pesan wajar TIDAK ikut tertahan", () => {
    // Penjaga yang meloloskan kebocoran itu buruk; penjaga yang menahan pesan normal lebih buruk,
    // karena ia akan dimatikan dan berhenti menjaga apa pun.
    test.each([
        "Halo Kak Budi, saat ini sedang terjadi gangguan kabel fiber di area Anda. Tim teknisi sudah ditugaskan.",
        "Yth. Pelanggan, tagihan Anda periode Juli sebesar Rp250.000 jatuh tempo 10 Agustus.",
        "Terima kasih telah menjadi pelanggan setia kami.",
        "Maintenance terjadwal 2 Agustus pukul 01.00-03.00. Mohon pengertiannya.",
        "Paket Anda 20 Mbps aktif sampai 31 Agustus 2026.",
    ])("aman: %s", (text) => {
        expect(findCustomerTextLeaks(text)).toEqual([]);
    });

    test("teks kosong / bukan string aman", () => {
        expect(findCustomerTextLeaks("")).toEqual([]);
        expect(findCustomerTextLeaks(null)).toEqual([]);
        expect(findCustomerTextLeaks(undefined)).toEqual([]);
    });
});

describe("describeLeaks", () => {
    test("merangkai temuan jadi kalimat yang bisa dibaca admin", () => {
        const leaks = findCustomerTextLeaks("Gangguan area, 96 pelanggan terdampak di ODP MAWAR-03.");
        const text = describeLeaks(leaks);
        expect(text).toContain("96 pelanggan");
        expect(text).toContain("jumlah pelanggan");
        expect(describeLeaks([])).toBe("");
    });
});
