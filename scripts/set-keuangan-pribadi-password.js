#!/usr/bin/env node
/**
 * Header Doc
 * Purpose: Menyiapkan / mengganti kredensial login halaman KEUANGAN PRIBADI. Wajib lewat CLI
 *          karena ayam-telur: halamannya butuh login, dan loginnya butuh kredensial yang belum
 *          ada. Sengaja TIDAK ada endpoint web untuk ini — membuat kredensial dompet dari web
 *          berarti sesi admin bisa mencetak kunci dompet, yang justru menghapus pemisahannya.
 * Caller: manual di server —
 *   node scripts/set-keuangan-pribadi-password.js <username> <sandi> [--putus-sesi]
 * Deps: `lib/personal-finance-auth`.
 * MainFuncs: `main`.
 * SideEffects: Menulis `database/personal_finance_auth.json` (hash bcrypt + rahasia sesi).
 */
"use strict";

const pfAuth = require("../lib/personal-finance-auth");

function usage(pesan) {
    if (pesan) console.error(`\n❌ ${pesan}`);
    console.error(`
Pakai:
  node scripts/set-keuangan-pribadi-password.js <username> <sandi> [--putus-sesi]

Contoh:
  node scripts/set-keuangan-pribadi-password.js aldi "sandi-rahasia-saya"

Catatan:
  • Kredensial ini TERPISAH dari akun admin — sengaja, supaya sesi admin tidak
    bisa membuka dompet pribadi.
  • Sandi minimal 8 karakter.
  • --putus-sesi  : ganti juga rahasia sesi, sehingga SEMUA sesi dompet yang
                    sedang aktif langsung logout. Pakai kalau sandi lama bocor.
`);
    process.exit(1);
}

async function main() {
    const argv = process.argv.slice(2);
    const putusSesi = argv.includes("--putus-sesi");
    const [username, sandi] = argv.filter((a) => !a.startsWith("--"));

    if (!username || !sandi) usage("username dan sandi wajib diisi.");

    const sudahAda = pfAuth.hasCredential();
    try {
        const hasil = await pfAuth.setCredential(username, sandi, { rotateSecret: putusSesi });
        console.log(`\n✅ Kredensial dompet ${sudahAda ? "DIPERBARUI" : "DIBUAT"} untuk "${hasil.username}".`);
        console.log(`   Berkas : ${pfAuth.authFilePath()}`);
        if (hasil.secretRotated) {
            console.log("   Rahasia sesi di-generate ulang → semua sesi dompet yang aktif kini logout.");
        }
        console.log("\n   Masuk lewat: /keuangan-pribadi/login");
        console.log("   (BUKAN /login — halaman dompet tidak memakai akun admin.)\n");
    } catch (e) {
        usage(e.message);
    }
}

main();
