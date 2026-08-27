/**
 * Header Doc
 * Purpose: Endpoint GANTI MODEM untuk admin DAN teknisi. Tipis — seluruh aturannya milik
 *          `lib/modem-replacement-service`; di sini hanya HTTP, otorisasi, dan bentuk balasan.
 * Caller: `routes/admin-router.js` (registrar), dipakai halaman `/ganti-modem`.
 * Deps: `../lib/modem-replacement-service`, `../lib/error-handler` (asyncHandler).
 * MainFuncs: `registerAdminModemReplacementRoutes`.
 * SideEffects: lewat servisnya — menulis SSID/sandi ke modem baru, memperbarui users.device_id.
 *
 * CATATAN OTORISASI: jalurnya WAJIB didaftarkan di `routes/teknisi-izin-api.js`, kalau tidak
 * gerbang gagal-tertutup (#b253) menolak teknisi dengan 403. Ganti modem memang pekerjaan
 * teknisi di lapangan, jadi izinnya disengaja.
 */
"use strict";

const { asyncHandler } = require("../lib/error-handler");
const { gantiModem } = require("../lib/modem-replacement-service");

function registerAdminModemReplacementRoutes({ router, ensureAuthenticatedStaff }) {
    router.post(
        "/api/users/:id/ganti-modem",
        ensureAuthenticatedStaff,
        asyncHandler(async (req, res) => {
            const body = req.body || {};
            const hasil = await gantiModem({
                customerId: req.params.id,
                deviceIdBaru: body.deviceIdBaru || body.device_id_baru || body.newDeviceId,
                ssid: body.ssid,
                password: body.password,
                aktor: req.user || null,
            });

            // Butuh kredensial BUKAN kegagalan sistem — UI harus meminta teknisi mengisinya.
            // Dibedakan dari 400 biasa supaya UI tak menampilkannya sebagai error merah.
            const kode = hasil.ok ? 200 : (hasil.butuhKredensial ? 428 : 400);
            return res.status(kode).json({
                status: kode,
                message: hasil.pesan,
                butuhKredensial: !!hasil.butuhKredensial,
                langkah: hasil.langkah || [],
                data: hasil.ok ? { deviceLama: hasil.deviceLama, deviceBaru: hasil.deviceBaru } : null,
            });
        })
    );
}

module.exports = { registerAdminModemReplacementRoutes };
