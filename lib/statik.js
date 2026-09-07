/**
 * Header Doc
 * Purpose: Katalog profil statik/IP (`database/statik.json`, array global `statik`) — tambah/hapus/cek.
 * Caller: message/handlers voucher-statik, routes voucher.
 * Deps: `lib/json-store` (saveJSON atomik), array global `statik` (bootstrap lib/database.js).
 * MainFuncs: addStatik, delStatik, checkprofstatik, dll.
 * SideEffects: Menulis `database/statik.json` (ATOMIK).
 */
// #b345: tulis statik.json lewat saveJSON (atomik). Sebelumnya writeFileSync polos cwd-relatif.
const { saveJSON } = require('./json-store')


const addStatik = (profstatik, limitat, maxlimit) => {
	const obj = {prof: profstatik, limitat : limitat, maxlimit : maxlimit}
    statik.push(obj)
    saveJSON('statik.json', statik)
}

const checkLimitAt = (profstatik) => {
    let position = false
    Object.keys(statik).forEach((i) => {
        if (statik[i].prof === profstatik) {
            position = i
        }
    })
    if (position !== false) {
        return statik[position].limitat
    }
}

const checkMaxLimit = (profstatik) => {
    let position = false
    Object.keys(statik).forEach((i) => {
        if (statik[i].prof === profstatik) {
            position = i
        }
    })
    if (position !== false) {
        return statik[position].maxlimit
    }
}

const checkStatik = (profstatik) => {
    let status = false
    Object.keys(statik).forEach((i) => {
        if (statik[i].prof === profstatik) {
            status = true
        }
    })
    return status
}

const delStatik = (profstatik) => {
    let position = null
    Object.keys(statik).forEach((i) => {
        if (statik[i].prof === profstatik) {
            position = i
        }
    })
    if (position !== null) {
        statik.splice(position, 1)
        saveJSON('statik.json', statik)
    }
    return true
}

module.exports = {
	addStatik,
    checkLimitAt,
	checkMaxLimit,
	checkStatik,
    delStatik
}