const fs = require('fs')
// const uang = JSON.parse(fs.readFileSync('./database/payment.json'))


const addPayment = (reffId, trxId, sender, tag, amount, method, ket, opts = {}) => {
	const obj = {reffId, trxId, status: false, tag, sender, amount, method, ket, ...opts}
    payment.push(obj)
    fs.writeFileSync('./database/payment.json', JSON.stringify(payment))
}

const updateStatusPayment = (reffId, status) => {
    let position = false
    Object.keys(payment).forEach((i) => {
        if (payment[i].reffId === reffId) {
            position = i
        }
    })
    if (position !== false) {
        payment[position].status = status
        fs.writeFileSync('./database/payment.json', JSON.stringify(payment, null, 2))
    }
}

const updateKetPayment = (reffId, ket) => {
    let position = false
    Object.keys(payment).forEach((i) => {
        if (payment[i].reffId === reffId) {
            position = i
        }
    })
    if (position !== false) {
        payment[position].ket = ket
        fs.writeFileSync('./database/payment.json', JSON.stringify(payment, null, 2))
    }
}

const checkStatusPayment = (reffId) => {
    let position = false
    Object.keys(payment).forEach((i) => {
        if (payment[i].reffId === reffId) {
            position = i
        }
    })
    if (position !== false) {
        return payment[position].status
    }
}

const delPayment = (reffId) => {
    let position = null
    Object.keys(payment).forEach((i) => {
        if (payment[i].reffId === reffId) {
            position = i
        }
    })
    if (position !== null) {
        payment.splice(position, 1)
        fs.writeFileSync('./database/payment.json', JSON.stringify(payment))
    }
    return true
}

const checkIsPayOut = (reffId) => {
    let status = false
    Object.keys(payment).forEach((i) => {
        if (payment[i].id === reffId) {
            status = true
        }
    })
    return status
}


module.exports = {
	addPayment,
    updateStatusPayment,
    updateKetPayment,
    checkIsPayOut,
    checkStatusPayment,
    delPayment
}