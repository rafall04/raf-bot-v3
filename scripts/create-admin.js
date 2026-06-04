#!/usr/bin/env node
/**
 * Header Doc
 * Purpose: Membuat akun admin/teknisi pertama langsung ke database/accounts.json.
 *          Mengatasi kebuntuan setelah git clone: accounts.json di-gitignore (kosong),
 *          sedangkan route pembuatan akun butuh login admin (chicken-and-egg).
 * Caller:  Operator via CLI -> `node scripts/create-admin.js <username> <password> [nama] [role]`
 * Deps:    `lib/json-store` (loadJSON/saveJSON), `lib/password` (hashPassword).
 * SideEffects: Menulis/menambah entri di database/accounts.json.
 */
"use strict";

const { loadJSON, saveJSON } = require("../lib/json-store");
const { hashPassword } = require("../lib/password");

function usage(msg) {
    if (msg) console.error(`\n[ERROR] ${msg}`);
    console.error(`
Penggunaan:
  node scripts/create-admin.js <username> <password> [nama] [role]

  role  : "admin" (default) atau "teknisi"
  nama  : opsional, default = username

Contoh:
  node scripts/create-admin.js owner RahasiaKuat123 "RAF NET" admin
`);
    process.exit(1);
}

async function main() {
    const [, , username, password, nama, roleArg] = process.argv;

    if (!username || !password) {
        usage("username dan password wajib diisi.");
    }
    if (password.length < 8) {
        usage("password minimal 8 karakter.");
    }

    const role = (roleArg || "admin").toLowerCase();
    if (!["admin", "teknisi"].includes(role)) {
        usage(`role harus "admin" atau "teknisi" (diberikan: "${roleArg}").`);
    }

    const accounts = loadJSON("accounts.json");
    if (!Array.isArray(accounts)) {
        console.error("[ERROR] accounts.json tidak berbentuk array. Periksa file secara manual.");
        process.exit(1);
    }

    if (accounts.some((acc) => acc && acc.username === username.trim())) {
        console.error(`[ERROR] Username "${username}" sudah ada. Gunakan username lain.`);
        process.exit(1);
    }

    const maxId = accounts.reduce((max, acc) => {
        const id = parseInt(acc && acc.id, 10) || 0;
        return id > max ? id : max;
    }, 0);

    const newAccount = {
        id: maxId + 1,
        username: username.trim(),
        password: await hashPassword(password),
        name: (nama && nama.trim()) || username.trim(),
        phone_number: "",
        role,
    };

    accounts.push(newAccount);
    saveJSON("accounts.json", accounts);

    console.log("\n[OK] Akun berhasil dibuat:");
    console.log(`     id       : ${newAccount.id}`);
    console.log(`     username : ${newAccount.username}`);
    console.log(`     nama     : ${newAccount.name}`);
    console.log(`     role     : ${newAccount.role}`);
    console.log("\nSilakan login ke panel web dengan kredensial di atas.\n");
}

main().catch((err) => {
    console.error("[ERROR] Gagal membuat akun:", err.message);
    process.exit(1);
});
