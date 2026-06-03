const CryptoJs = require("crypto-js");

var apikey = "QbGcoO0Qds9sQFDmY0MWg1Tq.xtuh1";
var va = "1179000899";
var urlS = 'https://sandbox.ipaymu.com/api/v2/payment/direct';
var urlP = 'https://my.ipaymu.com/api/v2/payment/direct';

module.exports = async function pay(props) {
    let { amount, comment, reffId, name, phone, email } = props;
    amount = parseInt(amount);
    if (isNaN(amount) || !comment || !reffId || !name || !phone || !email) throw "[ !! ] Required: amount, comment, reffId, name, phone, email";
    if (!config.ipaymuCallback) throw "Callback belum di set!";
    if (config.ipaymuProduction) {
        if (!config.ipaymuSecret || !config.ipaymuVA) throw "[ !! ] Owner belum menyiapkan payment";
        va = config.ipaymuVA;
        apikey = config.ipaymuSecret;
    }
    var body = {
        name,
        phone,
        email,
        amount,
        comments: comment,
        feeDirection: 'BUYER',
        notifyUrl: config.ipaymuCallback,
        referenceId: reffId,
        paymentMethod: "qris",
        paymentChannel: "mpm",
    }
    var signature = CryptoJs.enc.Hex.stringify(CryptoJs.HmacSHA256(`POST:${va}:${CryptoJs.SHA256(JSON.stringify(body))}:${apikey}`, apikey));
    const result = await fetch(config.ipaymuProduction ? urlP : urlS, { 
        method: "POST", 
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            va: va,
            signature: signature,
            timestamp: Date.now(),
        },
        body: JSON.stringify(body)
    })
    .then((response) => response.json())
    .then(async res => {
        if (!res.Success) throw res.Message;
        return {
            id: res.Data?.TransactionId,
            reffId,
            subTotal: amount,
            fee: res.Data?.Fee,
            feeTo: res.Data?.FeeDirection,
            qrString: res.Data.QrString,
            gateway: 'ipaymu',
            exp: res.Data.Expired,
            total: res.Data?.Total,
        }
    })
    .catch(err => {
        if (typeof err === "string") throw err;
        throw err;
    });
    return result;
}