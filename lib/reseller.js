/**
 * Header Doc
 * Purpose: Daftar reseller (`database/reseller.json`, array `_data`) — tambah/hapus/cek premium.
 * Caller: message/handlers reseller, routes voucher/reseller.
 * Deps: `lib/json-store` (saveJSON atomik).
 * MainFuncs: addReseller, delReseller, isPremium/cek.
 * SideEffects: Menulis `database/reseller.json` (ATOMIK).
 */
// #b345: tulis reseller.json lewat saveJSON (atomik). Sebelumnya writeFileSync polos cwd-relatif.
const { saveJSON } = require('./json-store')

/**
 * Add user to bannedList database
 * @param {String} userId
 * @param {String} expired
 * @param {Object} _data
 */
 const addReseller = (userId, _data) => {
    const obj = {id: userId}
    _data.push(obj)
    saveJSON('reseller.json', _data)
}
/**
 * Unbanned someone.
 * @param {String} userId 
 * @param {Object} _dir 
 * @returns {Number}
 */
 const unReseller = (userId, _data) => {
    let position = null
    Object.keys(_data).forEach((i) => {
        if (_data[i].id === userId) {
            position = i
        }
    })
    if (position !== null) {
        _data.splice(position, 1)
        saveJSON('reseller.json', _data)
    }
    return true
}
/**
 * Check user is premium.
 * @param {String} userId 
 * @param {Object} _dir 
 * @returns {Boolean}
 */
 const cekReseller = (userId, _dir) => {
    let status = false
    Object.keys(_dir).forEach((i) => {
        if (_dir[i].id === userId) {
            status = true
        }
    })
    return status
}

module.exports = {
    addReseller,
    unReseller,
    cekReseller
}