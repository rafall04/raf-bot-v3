"use strict";

const jwt = require("jsonwebtoken");
const { normalizePhone } = require("../phone-validator");
const { sendMessage } = require("../whatsapp-delivery-service");
const { renderTemplate } = require("../templating");
const {
    buildCustomerTokenPayload,
    getCustomerTokenSignOptions
} = require("../customer-token");

function runDbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        global.db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
        });
    });
}

function runDbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        global.db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function runDb(sql, params = []) {
    return new Promise((resolve, reject) => {
        global.db.run(sql, params, function onRun(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function splitPhoneNumbers(phoneNumbers = "") {
    return String(phoneNumbers)
        .split("|")
        .map((phone) => phone.trim())
        .filter(Boolean);
}

function buildCustomerToken(user) {
    return jwt.sign(
        buildCustomerTokenPayload(user),
        global.config.jwt,
        getCustomerTokenSignOptions()
    );
}

class PublicAuthService {
    static async findUserByNormalizedPhone(phoneNumber) {
        const normalizedTarget = normalizePhone(phoneNumber);
        if (!normalizedTarget) return null;

        const rows = await runDbAll(
            "SELECT * FROM users WHERE phone_number IS NOT NULL AND phone_number != ''",
            []
        );

        const user = rows.find((candidate) => splitPhoneNumbers(candidate.phone_number)
            .some((phone) => normalizePhone(phone) === normalizedTarget));

        return user || null;
    }

    static async findUserByLoginIdentifier(identifier) {
        const isPhoneNumber = !/^[a-zA-Z0-9_]+$/.test(identifier);
        if (!isPhoneNumber) {
            return runDbGet("SELECT * FROM users WHERE username = ?", [identifier]);
        }
        return this.findUserByNormalizedPhone(identifier);
    }

    static syncUserCache(userId, updates) {
        if (!global.users || !Array.isArray(global.users)) return;
        const cachedUser = global.users.find((item) => item.id === userId);
        if (cachedUser) Object.assign(cachedUser, updates);
    }

    static async saveOtp(user, otp) {
        const otpTimestamp = Date.now();
        await runDb("UPDATE users SET otp = ?, otpTimestamp = ? WHERE id = ?", [otp, otpTimestamp, user.id]);
        this.syncUserCache(user.id, { otp, otpTimestamp });
        return otpTimestamp;
    }

    static async clearOtp(user) {
        await runDb("UPDATE users SET otp = ?, otpTimestamp = ? WHERE id = ?", [null, null, user.id]);
        this.syncUserCache(user.id, { otp: null, otpTimestamp: null });
    }

    static async sendOtp(phoneNumber, otp) {
        const message = renderTemplate("otp_code", { otp });
        return sendMessage(phoneNumber, { text: message }, { skipDuplicateCheck: true });
    }

    static buildAuthResponse(user) {
        const primaryPhoneNumber = splitPhoneNumbers(user.phone_number || "")[0] || null;
        return {
            token: buildCustomerToken(user),
            user: {
                id: user.id,
                name: user.name,
                phoneNumber: primaryPhoneNumber
            }
        };
    }
}

module.exports = {
    PublicAuthService,
    splitPhoneNumbers,
    buildCustomerToken
};
