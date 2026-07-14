/**
 * Header Doc
 * Purpose: Menyediakan helper update kalkulasi port ODP/ODC yang terpisah dari facade database legacy.
 * Caller: `lib/database.js` dan modul aset jaringan.
 * Deps: Array aset jaringan aktif.
 * MainFuncs: `updateOdpPortUsage`, `updateOdcPortUsage`.
 * SideEffects: Memutasi array aset jaringan yang diberikan caller.
 */
"use strict";

function updateOdpPortUsage(odpId, increment = true, assetsArray = []) {
    const odpIndex = assetsArray.findIndex((asset) => String(asset.id) === String(odpId) && asset.type === "ODP");
    if (odpIndex === -1) {
        console.warn(`[ODP_PORT_UPDATE_WARN] ODP ID ${odpId} tidak ditemukan untuk update port.`);
        return false;
    }

    if (increment) {
        assetsArray[odpIndex].ports_used = (parseInt(assetsArray[odpIndex].ports_used, 10) || 0) + 1;
    } else {
        assetsArray[odpIndex].ports_used = Math.max(0, (parseInt(assetsArray[odpIndex].ports_used, 10) || 0) - 1);
    }
    return true;
}

function updateOdcPortUsage(odcId, assetsArray = []) {
    const odcIndex = assetsArray.findIndex((asset) => String(asset.id) === String(odcId) && asset.type === "ODC");
    if (odcIndex === -1) {
        console.warn(`[ODC_PORT_UPDATE_WARN] ODC ID ${odcId} tidak ditemukan untuk update port.`);
        return false;
    }

    // ODC.ports_used = jumlah ODP ANAK. Port ODC dipakai FEEDER menuju ODP, BUKAN oleh pelanggan.
    // DULU di sini: SUM(ports_used ODP anak) = jumlah PELANGGAN → ODC 8 port bisa terbaca "64/8"
    // (penuh 800%) dan maknanya berubah-ubah sampai restart, karena boot + route POST justru
    // menghitung jumlah ODP. Satu makna, satu tempat. Lihat lib/network-assets-service.js.
    const childOdps = assetsArray.filter((asset) => asset.type === "ODP" && String(asset.parent_odc_id) === String(odcId));
    assetsArray[odcIndex].ports_used = childOdps.length;
    return true;
}

module.exports = {
    updateOdpPortUsage,
    updateOdcPortUsage
};
