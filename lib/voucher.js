/**
 * Header Doc
 * Purpose: Katalog profil voucher hotspot (`database/voucher.json`, array global `voucher`) —
 *          tambah/hapus/cek profil, harga, durasi, nama.
 * Caller: message/handlers voucher, routes voucher, lib/mikrotik (getvoucher).
 * Deps: `lib/json-store` (saveJSON atomik), array global `voucher` (bootstrap lib/database.js).
 * MainFuncs: addvoucher, delvoucher, checkhargavc, checkprofvc, checknamavc, checkdurasivc.
 * SideEffects: Menulis `database/voucher.json` (ATOMIK).
 */
// #b345: tulis voucher.json lewat saveJSON (atomik + path via database/). Sebelumnya writeFileSync
// polos cwd-relatif; voucher.json juga ditulis lib/voucher-manager.js (multi-writer) — kini kedua
// owner memakai jalur atomik yang sama.
const { saveJSON } = require('./json-store')


const addvoucher = (profvoucher, namavc, durasivc, hargavc) => {
	const obj = {prof: profvoucher, namavc : namavc, durasivc : durasivc, hargavc : hargavc}
    voucher.push(obj)
    saveJSON('voucher.json', voucher)
}

const checkprofvoucher = (profvoucher) => {
    let status = false
    Object.keys(voucher).forEach((i) => {
        if (voucher[i].prof === profvoucher) {
            status = true
        }
    })
    return status
}

const checkhargavoucher = (harga) => {
    let status = false
    Object.keys(voucher).forEach((i) => {
        if (voucher[i].hargavc === harga) {
            status = true
        }
    })
    return status
}

const checkprofvc = (harga) => {
    let position = false
    Object.keys(voucher).forEach((i) => {
        if (voucher[i].hargavc === harga) {
            position = i
        }
    })
    if (position !== false) {
        return voucher[position].prof
    }
}

const isprofvc = (prof) => {
    let position = false
    Object.keys(voucher).forEach((i) => {
        if (voucher[i].prof === prof) {
            position = i
        }
    })
    if (position !== false) {
        return voucher[position].prof
    }
}

const checknamavc = (profvoucher) => {
    let position = false
    Object.keys(voucher).forEach((i) => {
        if (voucher[i].prof === profvoucher) {
            position = i
        }
    })
    if (position !== false) {
        return voucher[position].namavc
    }
}

const checkdurasivc = (profvoucher) => {
    let position = false
    Object.keys(voucher).forEach((i) => {
        if (voucher[i].prof === profvoucher) {
            position = i
        }
    })
    if (position !== false) {
        return voucher[position].durasivc
    }
}

const checkhargavc = (profvoucher) => {
    let position = false
    Object.keys(voucher).forEach((i) => {
        if (voucher[i].prof === profvoucher) {
            position = i
        }
    })
    if (position !== false) {
        return voucher[position].hargavc
    }
}

const delvoucher = (profvoucher) => {
    let position = null
    Object.keys(voucher).forEach((i) => {
        if (voucher[i].prof === profvoucher) {
            position = i
        }
    })
    if (position !== null) {
        voucher.splice(position, 1)
        saveJSON('voucher.json', voucher)
    }
    return true
}

module.exports = {
	addvoucher,
    isprofvc,
    checkhargavc,
    checkprofvc,
    checkhargavoucher,
	checknamavc,
    checkdurasivc,
	checkprofvoucher,
    delvoucher
}