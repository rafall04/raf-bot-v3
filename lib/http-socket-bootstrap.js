/**
 * Header Doc
 * Purpose: Memusatkan bootstrap HTTP server, Socket.IO, dan cleanup startup yang terkait runtime web/WA.
 * Caller: `index.js`.
 * Deps: `http`, `socket.io`, runtime aplikasi, helper JSON persistence, dan bootstrap WA.
 * MainFuncs: `createHttpSocketBootstrap`.
 * SideEffects: Membuat server HTTP, membuat instance Socket.IO, menyinkronkan runtime `io`, dan memicu cleanup request pending.
 */
"use strict";

const jwt = require("jsonwebtoken");

// Role yang boleh menerima broadcast SENSITIF (QR link WhatsApp). Sama dgn allowlist admin di
// routes lain (accounts.js/admin-recipients.js). Teknisi/agen SENGAJA tak termasuk.
const ADMIN_ROLES = ["admin", "owner", "superadmin"];

/**
 * Ambil token JWT dari handshake Socket.IO: prioritas `auth.token`, lalu cookie `token`
 * (cookie httpOnly tetap dikirim browser pada handshake same-origin, jadi bisa dibaca di sini).
 */
function extractSocketToken(socket) {
    const authToken = socket && socket.handshake && socket.handshake.auth && socket.handshake.auth.token;
    if (authToken) {
        return authToken;
    }
    const cookieHeader = (socket && socket.handshake && socket.handshake.headers && socket.handshake.headers.cookie) || "";
    const match = cookieHeader.split(/;\s*/).find((part) => part.startsWith("token="));
    return match ? decodeURIComponent(match.slice("token=".length)) : null;
}

/**
 * Cari akun berdasarkan `decoded.id` dari sumber server-side (repository runtime lalu fallback
 * loadJSON accounts.json). #b348: role untuk scoping HARUS berasal dari AKUN, bukan klaim token —
 * lihat createSocketAuthMiddleware.
 */
function resolveAccountForSocket(decoded, deps = {}) {
    const { runtime, loadJSON } = deps;
    let accounts = [];
    try {
        const repo = runtime && typeof runtime.getRepository === "function" && runtime.getRepository("accounts");
        if (repo && typeof repo.getAll === "function") {
            const all = repo.getAll();
            if (Array.isArray(all)) accounts = all;
        }
    } catch (_e) { accounts = []; }

    let account = accounts.find((a) => a && String(a.id) === String(decoded.id)) || null;
    // Fallback: repo kosong/belum ter-hydrate (mis. boot dini) → baca disk segar.
    if (!account && typeof loadJSON === "function") {
        try {
            const fresh = loadJSON("accounts.json");
            if (Array.isArray(fresh)) account = fresh.find((a) => a && String(a.id) === String(decoded.id)) || null;
        } catch (_e) { /* abaikan — account tetap null → koneksi ditolak */ }
    }
    return account;
}

/**
 * Middleware auth Socket.IO: hanya akun staf (token JWT ber-`role`) yang boleh konek.
 * Menutup kebocoran broadcast (mis. QR WhatsApp via io.emit('qr')) ke klien anonim.
 *
 * #b348: role yang dipakai untuk ROOM-SCOPING di-derive dari AKUN (accounts.json) lewat
 * `decoded.id`, BUKAN dari klaim `decoded.role`. Token staf berumur 8 jam; bila owner mendemote
 * (admin→teknisi) atau menghapus akun (offboarding/kompromi), token lama MASIH valid & membawa
 * role='admin' basi. Tanpa re-derive, socket yang reconnect tetap masuk room 'admin' & menerima
 * QR WhatsApp → device pemegang token lama bisa scan = takeover (persis yang #b338 cegah, kini
 * bagi kelas user yang justru harus dikunci). Jalur HTTP (http-auth-bootstrap) sudah benar; socket
 * adalah jalur SAUDARA yang terlewat. Akun tak ditemukan → koneksi DITOLAK (fail-closed).
 */
function createSocketAuthMiddleware(config, deps = {}) {
    return function socketAuth(socket, next) {
        const token = extractSocketToken(socket);
        if (!token) {
            return next(new Error("Unauthorized: autentikasi diperlukan untuk koneksi realtime."));
        }
        try {
            const decoded = jwt.verify(token, config.jwt);
            // Token staf punya `role`; token customer punya `name` tanpa role -> tolak.
            if (!decoded || !decoded.role) {
                return next(new Error("Forbidden: koneksi realtime khusus staf."));
            }
            const account = resolveAccountForSocket(decoded, deps);
            if (!account) {
                // Akun dicabut/dihapus (atau id tak dikenal) → tolak walau token masih tervalidasi.
                return next(new Error("Forbidden: akun tidak ditemukan atau telah dicabut."));
            }
            // Simpan role AKUN (bukan token) di socket untuk ROOM-SCOPING (QR hanya ke room 'admin').
            socket.data = socket.data || {};
            socket.data.role = account.role;
            socket.data.accountId = account.id;
            return next();
        } catch (_err) {
            return next(new Error("Unauthorized: token tidak valid."));
        }
    };
}

/**
 * Masukkan socket ke room sesuai role. Room 'admin' menerima broadcast SENSITIF (QR link WhatsApp).
 * Teknisi/agen BOLEH konek (butuh event tiket/pembayaran realtime) tapi TIDAK masuk 'admin' —
 * jalur HTTP pun menolak mereka melihat QR (routes/pages.js redirect teknisi/agen). Tanpa scoping
 * ini, `io.emit('qr')` mem-broadcast ke SEMUA staf → teknisi/agen bisa membaca frame QR & memindainya
 * → device mereka ter-link ke bot = TAKEOVER WhatsApp penuh. Dipanggil dari `io.on('connection')`.
 */
function joinRoomsForRole(socket) {
    const role = socket && socket.data && socket.data.role;
    if (ADMIN_ROLES.includes(role) && socket && typeof socket.join === "function") {
        socket.join("admin");
    }
}

function createHttpSocketBootstrap({
    app,
    createServer,
    SocketIOServer,
    runtime,
    port,
    config,
    loadJSON,
    saveJSON,
    startWhatsApp
}) {
    const server = createServer(app);
    const io = new SocketIOServer(server);

    // Auth Socket.IO: hanya staf terautentikasi yang boleh konek. Sebelumnya tanpa auth —
    // klien anonim bisa menerima broadcast io.emit (terutama QR WhatsApp -> risiko hijack sesi).
    // #b348: oper runtime+loadJSON supaya role di-derive dari AKUN (bukan klaim token basi).
    io.use(createSocketAuthMiddleware(config, { runtime, loadJSON }));

    // Room-scoping per role: hanya admin/owner/superadmin masuk room 'admin' yang menerima QR.
    // index.js memakai io.to('admin').emit('qr', ...) — bukan lagi io.emit('qr', ...) global.
    io.on("connection", joinRoomsForRole);

    runtime.setIo(io);

    function cleanupOldPendingRequests() {
        try {
            const allRequests = loadJSON("database/requests.json");
            const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
            let cleanedCount = 0;
            const usersRepo = runtime.getRepository("users");

            allRequests.forEach((request) => {
                if (request.status !== "pending") {
                    return;
                }

                const requestAge = Date.now() - new Date(request.created_at).getTime();
                if (requestAge > sevenDaysInMs) {
                    request.status = "cancelled_by_system";
                    request.updated_at = new Date().toISOString();
                    request.updated_by = "system";
                    request.cancel_reason = "Request expired (>7 hari)";
                    cleanedCount++;
                    return;
                }

                const user = usersRepo.getAll().find((item) => String(item.id) === String(request.userId));
                if (user && user.paid === request.newStatus) {
                    request.status = "cancelled_by_system";
                    request.updated_at = new Date().toISOString();
                    request.updated_by = "system";
                    request.cancel_reason = "Status pelanggan sudah sesuai dengan pengajuan";
                    cleanedCount++;
                }
            });

            if (cleanedCount > 0) {
                saveJSON("database/requests.json", allRequests);
                console.log(`[CLEANUP] Total ${cleanedCount} pending requests dibersihkan.`);
            } else {
                console.log("[CLEANUP] Tidak ada pending requests yang perlu dibersihkan.");
            }
        } catch (error) {
            console.error("[CLEANUP_ERROR] Error cleaning up old requests:", error);
        }
    }

    function startHttpServer(connect) {
        server.listen(port, async () => {
            console.log(`[SERVER] Listening on port ${port}`);

            const sessionPath = require("path").resolve(process.cwd(), "sessions", config.sessionName);
            if (require("fs").existsSync(sessionPath)) {
                startWhatsApp(runtime, connect);
            } else {
                console.log("[WA] No session found - scan QR code to connect");
                global.whatsappConnectionState = "logged_out";
            }
        });
    }

    return {
        server,
        io,
        cleanupOldPendingRequests,
        startHttpServer
    };
}

module.exports = {
    createHttpSocketBootstrap,
    createSocketAuthMiddleware,
    resolveAccountForSocket,
    extractSocketToken,
    joinRoomsForRole,
    ADMIN_ROLES
};
