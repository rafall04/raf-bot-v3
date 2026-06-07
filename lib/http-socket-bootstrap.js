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
 * Middleware auth Socket.IO: hanya akun staf (token JWT ber-`role`) yang boleh konek.
 * Menutup kebocoran broadcast (mis. QR WhatsApp via io.emit('qr')) ke klien anonim.
 */
function createSocketAuthMiddleware(config) {
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
            return next();
        } catch (_err) {
            return next(new Error("Unauthorized: token tidak valid."));
        }
    };
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
    io.use(createSocketAuthMiddleware(config));

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
    extractSocketToken
};
