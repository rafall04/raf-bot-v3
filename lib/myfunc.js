"use strict";
const axios = require("axios");
const fs = require("fs");
const fetch = require('node-fetch')
const cheerio = require('cheerio');
const FormData = require('form-data')
const { default: Axios } = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const MD5 = require('crypto-js/md5');

exports.compareSign = (sign, str) => {
    const isSign = MD5(str);
    if (isSign == sign) return !0;
    return !1;
}

exports.html2Txt = (str) => {
    const outputString = str.replace(/<p>|<\/p>/g, match => {
        if (match === '<p>') {
            return '';
        } else {
            return '\n';
        }
    });
    return outputString; 
}

exports.convertGif = async (link) => {
     let ini_gif = await exports.getBuffer(link)
     let ini_name = exports.getRandom('.gif')
     fs.writeFileSync(ini_name, ini_gif)
     const bodyForm = new FormData();bodyForm.append('new-image-url', '');bodyForm.append('new-image', fs.createReadStream(ini_name))
     let gipy = await Axios({method: 'post',url: 'https://s6.ezgif.com/webp-to-mp4',data: bodyForm,headers: {'Content-Type': `multipart/form-data; boundary=${bodyForm._boundary}`}})
     let data = gipy.data
     fs.unlinkSync(ini_name)
     const bodyFormThen = new FormData();
     const $ = cheerio.load(data)
     const file = $('input[name="file"]').attr('value');const token = $('input[name="token"]').attr('value');const convert = $('input[name="file"]').attr('value');const gotdata = {file: file,token: token,convert: convert};bodyFormThen.append('file', gotdata.file);bodyFormThen.append('token', gotdata.token);bodyFormThen.append('convert', gotdata.convert);let gify = await Axios({method: 'post',url: 'https://ezgif.com/webp-to-mp4/' + gotdata.file,data: bodyFormThen,headers: {'Content-Type': `multipart/form-data; boundary=${bodyFormThen._boundary}`}})
     let nganu = gify.data
     const $$ = cheerio.load(nganu)
     let aqqp = await exports.getBuffer('https:' + $$('div#output > p.outfile > video > source').attr('src'))
     return aqqp
}

exports.getRandom = (ext) => {
    return `${Math.floor(Math.random() * 10000)}${ext}`
}

exports.convert = async (path, crop) => {
    return new Promise(async (resolve, reject) => {
    if (exports.url(path)) {
        let a = await exports.getBuffer(path)
        let b = exports.getRandom()
        fs.writeFileSync(b, a)
        let ran = exports.getRandom('.webp')
        ffmpeg(b)
        .addOutputOptions(crop ? ['-vcodec','libwebp','-vf',`crop=w='min(min(iw\,ih)\,500)':h='min(min(iw\,ih)\,500)',scale=500:500,fps=10`] : [`-vcodec`, `libwebp`, `-vf`, `scale='min(320,iw)':'min(320,ih)':force_original_aspect_ratio=decrease,fps=15, pad=320:320:-1:-1:color=white@0.0, split [a][b]; [a] palettegen=reserve_transparent=on:transparency_color=ffffff [p]; [b][p] paletteuse`])
        .toFormat('webp')
        .save(ran)
        .on('end', () => {
            fs.unlinkSync(b)
            resolve(ran)
        })
    } else {
        let ran = exports.getRandom('.webp')
        ffmpeg(path)
        .addOutputOptions(crop ? ['-vcodec','libwebp','-vf',`crop=w='min(min(iw\,ih)\,500)':h='min(min(iw\,ih)\,500)',scale=500:500,fps=10`] : [`-vcodec`, `libwebp`, `-vf`, `scale='min(320,iw)':'min(320,ih)':force_original_aspect_ratio=decrease,fps=15, pad=320:320:-1:-1:color=white@0.0, split [a][b]; [a] palettegen=reserve_transparent=on:transparency_color=ffffff [p]; [b][p] paletteuse`])
        .toFormat('webp')
        .save(ran)
        .on('end', () => resolve(ran))
    }
})
}

exports.getBuffer = async (url, options) => {
	try {
		options ? options : {}
		const res = await axios({
			method: "get",
			url,
			headers: {
				'DNT': 1,
				'Upgrade-Insecure-Request': 1
			},
			...options,
			responseType: 'arraybuffer'
		})
		return res.data
	} catch (e) {
		console.log(`Error : ${e}`)
	}
}

exports.fetchJson = (url, options) => new Promise(async(resolve, reject) => {
    fetch(url, options)
        .then(response => response.json())
        .then(json => {
            resolve(json)
        })
        .catch((err) => {
            reject(err)
        })
})


exports.fetchText = (url, options) => new Promise(async(resolve, reject) => {
    fetch(url, options)
        .then(response => response.text())
        .then(text => {
            resolve(text)
        })
        .catch((err) => {
            reject(err)
        })
})

exports.getGroupAdmins = function(participants){
    let admins = []
	for (let i of participants) {
		i.isAdmin ? admins.push(i.jid) : ''
	}
	return admins
}

exports.runtime = function(seconds) {
	seconds = Number(seconds);
	var d = Math.floor(seconds / (3600 * 24));
	var h = Math.floor(seconds % (3600 * 24) / 3600);
	var m = Math.floor(seconds % 3600 / 60);
	var s = Math.floor(seconds % 60);
	var dDisplay = d > 0 ? d + (d == 1 ? " day, " : " days, ") : "0 day, ";
	var hDisplay = h > 0 ? h + (h == 1 ? " hour, " : " hours, ") : "0 hour, ";
	var mDisplay = m > 0 ? m + (m == 1 ? " minute, " : " minutes, ") : "0 minute, ";
	var sDisplay = s > 0 ? s + (s == 1 ? " second" : " seconds") : "0 second ";
	return dDisplay + hDisplay + mDisplay + sDisplay;
}

exports.sleep = async (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
}

exports.url = (url) => {
return url.match(new RegExp(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%.+#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%+.#?&/=]*)/, 'gi'))
}

exports.getProfileBySubscription = (subscription) => {
    const matchedPackage = global.packages.find(pkg => pkg.name === subscription);
    return matchedPackage ? matchedPackage.profile : null;
}
