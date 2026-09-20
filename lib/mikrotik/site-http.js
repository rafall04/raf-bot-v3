/**
 * Header Doc
 * Purpose: Operasi MikroTik lewat helper HTTP `site_url_bot` (PHP lokal, BUKAN spawn) —
 *   voucher hotspot, IP binding, simple queue, dan status AP. Mayoritas NON-idempotent
 *   (username acak / nama unik) → retryable:false; mutasi dikunci per-key.
 * Caller: facade lib/mikrotik.js (konsumen: voucher flow, binding, queue steering, monitoring).
 * Deps: lib/mikrotik/core (getSiteUrl, getJsonOverHttp, createResult, withMikrotikRetry,
 *   withMikrotikKeyLock) + axios/http/https agents + lib/internal-service-token.
 * MainFuncs: statusap, getvoucher, addbinding, addqueue.
 * SideEffects: HTTP GET ke <siteUrl>/interface.php|adduserhotspot.php|addipbinding.php|
 *   addsimplequeue.php; create voucher/binding/queue di router.
 */
"use strict";

const axios = require('axios');
const { getInternalServiceToken, INTERNAL_SERVICE_HEADER } = require('../internal-service-token');
const {
    getSiteUrl,
    getJsonOverHttp,
    createResult,
    withMikrotikRetry,
    withMikrotikKeyLock,
    httpAgent,
    httpsAgent,
} = require('./core');

async function statusap(_context = {}) {
    return withMikrotikRetry(async () => {
        const siteUrl = getSiteUrl();
        if (typeof siteUrl !== 'string') {
            return siteUrl;
        }
        const startedAt = Date.now();
        try {
            const response = await axios.get(`${siteUrl}/interface.php`, {
                timeout: 15000,
                httpAgent,
                httpsAgent,
                headers: { [INTERNAL_SERVICE_HEADER]: getInternalServiceToken(global.config?.jwt) },
            });
            return createResult('statusap', {
                ok: true,
                data: response.data,
                message: 'Status access point berhasil diambil.',
                timingMs: Date.now() - startedAt,
                details: { httpStatus: response.status },
            });
        } catch (error) {
            return createResult('statusap', {
                message: error.response?.data?.message || error.message || 'Gagal mengambil status access point.',
                errorCode: error.code === 'ECONNABORTED' ? 'TIMEOUT_ERROR' : 'COMMAND_ERROR',
                timingMs: Date.now() - startedAt,
                details: { httpStatus: error.response?.status || null },
            });
        }
    }, { operation: 'statusap' });
}

async function getvoucher(profile, sender, context = {}) {
    const siteUrl = getSiteUrl();
    if (typeof siteUrl !== 'string') {
        return siteUrl;
    }
    // NON-IDEMPOTENT: PHP `adduserhotspot.php` generate random username tiap call.
    // Retry pada attempt-1 yang sukses tapi response hilang akan create voucher
    // ke-2 dengan username berbeda → MikroTik punya duplicate. Caller harus
    // toleran terhadap error transient di sini.
    return withMikrotikRetry(
        () => getJsonOverHttp('getvoucher', `${siteUrl}/adduserhotspot.php`, {
            params: { profil: profile, komen: sender },
            timeoutMs: 15000,
            context,
        }),
        { operation: 'getvoucher', retryable: false }
    );
}

async function addbinding(komen, ip, mac, context = {}) {
    const siteUrl = getSiteUrl();
    if (typeof siteUrl !== 'string') {
        return siteUrl;
    }
    // M9: lock per-(ip,mac). Tabel IP binding di MikroTik identitas uniknya
    // kombinasi IP+MAC, dua request paralel dengan kombo sama bisa create
    // duplicate row. PHP `addipbinding.php` belum confirmed idempotent —
    // main aman tidak retry, tapi lock tetap penting.
    return withMikrotikKeyLock(`binding:${ip}|${mac}`, () => withMikrotikRetry(
        () => getJsonOverHttp('addbinding', `${siteUrl}/addipbinding.php`, {
            params: { comment: komen, ip, mac },
            timeoutMs: 15000,
            context,
        }),
        { operation: 'addbinding', retryable: false }
    ));
}

async function addqueue(prof, komen, ip, parent, ceklimitat, cekmaxlimit, context = {}) {
    const siteUrl = getSiteUrl();
    if (typeof siteUrl !== 'string') {
        return siteUrl;
    }
    // M9: lock per-queue-name. RouterOS simple queue identitasnya `name`
    // (param `komen` di sini = `name` di PHP). Concurrent add dengan nama
    // sama bisa overwrite atau create duplicate; serialize aman.
    return withMikrotikKeyLock(`queue:${komen}`, () => withMikrotikRetry(
        () => getJsonOverHttp('addqueue', `${siteUrl}/addsimplequeue.php`, {
            params: { comment: prof, name: komen, target: ip, parent, limitat: ceklimitat, maxlimit: cekmaxlimit },
            timeoutMs: 15000,
            context,
        }),
        { operation: 'addqueue', retryable: false }
    ));
}

module.exports = {
    statusap,
    getvoucher,
    addbinding,
    addqueue,
};
