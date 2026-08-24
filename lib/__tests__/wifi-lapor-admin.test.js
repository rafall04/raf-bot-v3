/**
 * Header Doc
 * Purpose : Membuktikan laporan kegagalan WiFi BENAR-BENAR terkirim ke admin (#b268/#b269).
 *           Tes lama hanya membuktikan fungsinya tak melempar — sementara impor pengirimnya
 *           salah, sehingga janji "Tim kami sudah mendapat pemberitahuannya" tak pernah ditepati.
 * Caller  : jest
 * Deps    : lib/wifi-failure-reason, pengirim & daftar admin di-mock
 * MainFuncs: -
 * SideEffects: tidak ada
 */
jest.mock("../whatsapp-critical-delivery", () => ({ sendCritical: jest.fn() }));
jest.mock("../admin-recipients", () => ({ getAdminJids: jest.fn() }));

const { sendCritical } = require("../whatsapp-critical-delivery");
const { getAdminJids } = require("../admin-recipients");
const wfr = require("../wifi-failure-reason");
const { laporkanKegagalanWifiKeAdmin, bacaSebabGagalWifi } = wfr;

describe("#b269 — laporan kegagalan WiFi sampai ke admin", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        wfr._resetJedaUntukTest();
        getAdminJids.mockReturnValue(["6281@s.whatsapp.net", "6282@s.whatsapp.net"]);
        sendCritical.mockResolvedValue({ delivered: true, attempts: 1 });
    });

    test("sebab SISI KAMI → benar-benar mengirim ke setiap admin", async () => {
        const sebab = bacaSebabGagalWifi(new Error("connect ECONNREFUSED"));
        expect(sebab.pihak).toBe("kami");
        const r = await laporkanKegagalanWifiKeAdmin(sebab, "ganti sandi WiFi", { customer: { name: "Budi" } });
        expect(sendCritical).toHaveBeenCalledTimes(2);
        expect(r.dilaporkan).toBe(true);
        expect(r.terkirim).toBe(2);
    });

    test("sebab MODEM DIAM → tidak mengirim (itu bukan gangguan kita)", async () => {
        await laporkanKegagalanWifiKeAdmin(bacaSebabGagalWifi({ errorCode: "DEVICE_UNREACHABLE" }), "ganti sandi WiFi", {});
        expect(sendCritical).not.toHaveBeenCalled();
    });

    test("ber-jeda: gangguan yang sama tak jadi puluhan pesan", async () => {
        const sebab = bacaSebabGagalWifi(new Error("connect ECONNREFUSED"));
        await laporkanKegagalanWifiKeAdmin(sebab, "ganti sandi WiFi", {});
        await laporkanKegagalanWifiKeAdmin(sebab, "ganti sandi WiFi", {});
        expect(sendCritical).toHaveBeenCalledTimes(2); // hanya ronde pertama
    });

    test("!! kalau TAK ADA yang terkirim, jeda TIDAK dipasang — gangguan berjalan jangan dibungkam", async () => {
        sendCritical.mockResolvedValue({ delivered: false, errorCode: "WHATSAPP_NOT_CONNECTED" });
        const sebab = bacaSebabGagalWifi(new Error("connect ECONNREFUSED"));
        const r1 = await laporkanKegagalanWifiKeAdmin(sebab, "ganti sandi WiFi", {});
        expect(r1.dilaporkan).toBe(false);
        sendCritical.mockResolvedValue({ delivered: true });
        const r2 = await laporkanKegagalanWifiKeAdmin(sebab, "ganti sandi WiFi", {});
        expect(r2.dilaporkan).toBe(true);   // percobaan kedua TIDAK diblokir jeda
    });

    test("pengirim meledak → tetap tidak melempar ke pemanggil", async () => {
        sendCritical.mockRejectedValue(new Error("boom"));
        await expect(
            laporkanKegagalanWifiKeAdmin(bacaSebabGagalWifi(new Error("connect ECONNREFUSED")), "ganti sandi WiFi", {})
        ).resolves.toBeDefined();
    });

    test("tak ada admin terdaftar → tidak melempar, tidak mengirim", async () => {
        getAdminJids.mockReturnValue([]);
        const r = await laporkanKegagalanWifiKeAdmin(bacaSebabGagalWifi(new Error("connect ECONNREFUSED")), "ganti sandi WiFi", {});
        expect(sendCritical).not.toHaveBeenCalled();
        expect(r.dilaporkan).toBe(false);
    });
});
