const fs = require('fs')
// const voucher = JSON.parse(fs.readFileSync('./database/voucher.json'))


const addvoucher = (profvoucher, namavc, durasivc, hargavc) => {
	const obj = {prof: profvoucher, namavc : namavc, durasivc : durasivc, hargavc : hargavc}
    voucher.push(obj)
    fs.writeFileSync('./database/voucher.json', JSON.stringify(voucher))
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
        fs.writeFileSync('./database/voucher.json', JSON.stringify(voucher))
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