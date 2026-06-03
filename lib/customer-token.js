"use strict";

const CUSTOMER_TOKEN_ISSUER =
    process.env.CUSTOMER_TOKEN_ISSUER || "raf-bot-v2";
const CUSTOMER_TOKEN_AUDIENCE =
    process.env.CUSTOMER_TOKEN_AUDIENCE || "raff-panel-2";
const CUSTOMER_TOKEN_TTL = process.env.CUSTOMER_TOKEN_TTL || "12h";
const CUSTOMER_TOKEN_VERSION = 1;

function buildCustomerTokenPayload(user) {
    return {
        sub: String(user.id),
        id: user.id,
        name: user.name,
        tokenType: "customer",
        ver: CUSTOMER_TOKEN_VERSION,
        iat: Math.floor(Date.now() / 1000)
    };
}

function getCustomerTokenSignOptions() {
    return {
        expiresIn: CUSTOMER_TOKEN_TTL,
        algorithm: "HS256",
        issuer: CUSTOMER_TOKEN_ISSUER,
        audience: CUSTOMER_TOKEN_AUDIENCE
    };
}

function getCustomerTokenVerifyOptions() {
    return {
        algorithms: ["HS256"],
        issuer: CUSTOMER_TOKEN_ISSUER,
        audience: CUSTOMER_TOKEN_AUDIENCE
    };
}

module.exports = {
    CUSTOMER_TOKEN_AUDIENCE,
    CUSTOMER_TOKEN_ISSUER,
    CUSTOMER_TOKEN_TTL,
    CUSTOMER_TOKEN_VERSION,
    buildCustomerTokenPayload,
    getCustomerTokenSignOptions,
    getCustomerTokenVerifyOptions
};
