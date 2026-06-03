"use strict";

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { getDatabasePath } = require('../lib/env-config');
const {
    normalizePhoneNumber,
    normalizePhoneToJid
} = require('../lib/jid-utils');

const ROOT_DIR = path.join(__dirname, '..');
const DATABASE_DIR = path.join(ROOT_DIR, 'database');
const MAPPINGS_PATH = path.join(DATABASE_DIR, 'lid-mappings.json');
const TRANSACTIONS_PATH = path.join(DATABASE_DIR, 'saldo_transactions.json');
const TOPUP_REQUESTS_PATH = path.join(DATABASE_DIR, 'topup_requests.json');
const REPORTS_PATH = path.join(DATABASE_DIR, 'reports.json');
const USERS_DB_PATH = getDatabasePath('users.sqlite');
const LEGACY_USERS_DB_PATH = path.join(DATABASE_DIR, 'database.sqlite');
const SALDO_DB_PATH = getDatabasePath('saldo.sqlite');

const APPLY = process.argv.includes('--apply');

function readJson(filePath, fallback) {
    if (!fs.existsSync(filePath)) {
        return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getUserPhoneCandidates(user) {
    if (!user || !user.phone_number) return [];
    return user.phone_number
        .split('|')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => value.includes('@') ? value.split('@')[0].split(':')[0] : value)
        .map((value) => normalizePhoneNumber(value))
        .filter(Boolean);
}

function loadUsersFromDb(dbPath) {
    return new Promise((resolve) => {
        if (!fs.existsSync(dbPath)) {
            return resolve([]);
        }

        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (openErr) => {
            if (openErr) {
                return resolve([]);
            }
        });

        db.all("SELECT id, name, phone_number, lid FROM users", [], (err, rows) => {
            db.close(() => resolve(err ? [] : rows || []));
        });
    });
}

async function loadUsers() {
    const primary = await loadUsersFromDb(USERS_DB_PATH);
    if (primary.length > 0) return primary;
    return loadUsersFromDb(LEGACY_USERS_DB_PATH);
}

function buildCanonicalMap(users, mappings) {
    const result = new Map();

    for (const user of users) {
        const canonicalPhone = getUserPhoneCandidates(user)[0];
        if (!canonicalPhone) continue;
        const canonicalJid = normalizePhoneToJid(canonicalPhone);

        if (user.lid) {
            result.set(user.lid, canonicalJid);
        }
    }

    for (const [lidId, value] of Object.entries(mappings.mappings || {})) {
        const lidJid = `${lidId}@lid`;
        if (typeof value === 'string' && value.endsWith('@s.whatsapp.net')) {
            result.set(lidJid, value);
            continue;
        }

        const user = users.find((candidate) => String(candidate.id) === String(value));
        if (!user) continue;
        const canonicalPhone = getUserPhoneCandidates(user)[0];
        if (!canonicalPhone) continue;
        result.set(lidJid, normalizePhoneToJid(canonicalPhone));
    }

    return result;
}

function migrateJsonEntries(entries, mapKeyFields, canonicalMap) {
    const collisions = [];
    let mutated = false;
    const nextEntries = [...entries];

    for (const field of mapKeyFields) {
        for (const entry of nextEntries) {
            if (!entry || typeof entry[field] !== 'string' || !entry[field].endsWith('@lid')) continue;
            const canonicalJid = canonicalMap.get(entry[field]);
            if (!canonicalJid) continue;
            entry[field] = canonicalJid;
            mutated = true;
        }
    }

    if (mapKeyFields.includes('userId')) {
        const deduped = [];
        const seen = new Map();
        for (const entry of nextEntries) {
            const key = `${entry.userId || ''}:${entry.id || entry.created_at || ''}`;
            if (seen.has(key)) {
                collisions.push(key);
                continue;
            }
            seen.set(key, true);
            deduped.push(entry);
        }
        return { entries: deduped, mutated, collisions };
    }

    return { entries: nextEntries, mutated, collisions };
}

function runSql(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) return reject(err);
            resolve(this);
        });
    });
}

function allSql(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });
}

async function migrateSaldoSqlite(canonicalMap) {
    if (!fs.existsSync(SALDO_DB_PATH)) {
        return { updated: 0, merged: 0 };
    }

    const db = new sqlite3.Database(SALDO_DB_PATH);
    const rows = await allSql(db, "SELECT user_id, saldo, uang, pushname, created_at, updated_at FROM user_saldo WHERE user_id LIKE '%@lid'");
    let updated = 0;
    let merged = 0;

    for (const row of rows) {
        const canonicalJid = canonicalMap.get(row.user_id);
        if (!canonicalJid) continue;

        const existing = await allSql(db, "SELECT user_id FROM user_saldo WHERE user_id = ?", [canonicalJid]);
        if (APPLY) {
            if (existing.length > 0) {
                await runSql(
                    db,
                    "UPDATE user_saldo SET pushname = COALESCE(pushname, ?), updated_at = MAX(updated_at, ?) WHERE user_id = ?",
                    [row.pushname || null, row.updated_at || new Date().toISOString(), canonicalJid]
                );
                await runSql(db, "DELETE FROM user_saldo WHERE user_id = ?", [row.user_id]);
                merged += 1;
            } else {
                await runSql(db, "UPDATE user_saldo SET user_id = ? WHERE user_id = ?", [canonicalJid, row.user_id]);
                updated += 1;
            }
        } else if (existing.length > 0) {
            merged += 1;
        } else {
            updated += 1;
        }
    }

    await new Promise((resolve) => db.close(resolve));
    return { updated, merged };
}

async function main() {
    const users = await loadUsers();
    const mappings = readJson(MAPPINGS_PATH, { mappings: {} });
    const canonicalMap = buildCanonicalMap(users, mappings);

    const nextMappings = { ...mappings, mappings: {} };
    for (const [lidJid, canonicalJid] of canonicalMap.entries()) {
        nextMappings.mappings[lidJid.split('@')[0]] = canonicalJid;
    }

    const transactions = readJson(TRANSACTIONS_PATH, []);
    const topupRequests = readJson(TOPUP_REQUESTS_PATH, []);
    const reports = readJson(REPORTS_PATH, []);

    const migratedTransactions = migrateJsonEntries(transactions, ['userId'], canonicalMap);
    const migratedTopups = migrateJsonEntries(topupRequests, ['userId'], canonicalMap);
    const migratedReports = migrateJsonEntries(reports, ['pelangganId'], canonicalMap);
    const saldoMigration = await migrateSaldoSqlite(canonicalMap);

    if (APPLY) {
        writeJson(MAPPINGS_PATH, nextMappings);
        writeJson(TRANSACTIONS_PATH, migratedTransactions.entries);
        writeJson(TOPUP_REQUESTS_PATH, migratedTopups.entries);
        writeJson(REPORTS_PATH, migratedReports.entries);
    }

    console.log(JSON.stringify({
        apply: APPLY,
        usersLoaded: users.length,
        canonicalMappings: canonicalMap.size,
        saldo: saldoMigration,
        transactions: {
            updated: migratedTransactions.mutated,
            collisions: migratedTransactions.collisions.length
        },
        topupRequests: {
            updated: migratedTopups.mutated,
            collisions: migratedTopups.collisions.length
        },
        reports: {
            updated: migratedReports.mutated
        }
    }, null, 2));

    process.exit(0);
}

main().catch((error) => {
    console.error('[MIGRATE_LID_TO_CANONICAL] Failed:', error);
    process.exit(1);
});
