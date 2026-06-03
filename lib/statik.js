const fs = require('fs')
// const statik = JSON.parse(fs.readFileSync('./database/statik.json'))


const addStatik = (profstatik, limitat, maxlimit) => {
	const obj = {prof: profstatik, limitat : limitat, maxlimit : maxlimit}
    statik.push(obj)
    fs.writeFileSync('./database/statik.json', JSON.stringify(statik))
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
        fs.writeFileSync('./database/statik.json', JSON.stringify(statik))
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