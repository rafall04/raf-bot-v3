/**
 * Header Doc
 * Purpose: Memusatkan bootstrap HTTP server, Socket.IO, dan cleanup startup yang terkait runtime web/WA.
 * Caller: `index.js`.
 * Deps: `http`, `socket.io`, runtime aplikasi, helper JSON persistence, dan bootstrap WA.
 * MainFuncs: `createHttpSocketBootstrap`.
 * SideEffects: Membuat server HTTP, membuat instance Socket.IO, menyinkronkan runtime `io`, dan memicu cleanup request pending.
 */
"use strict";

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
    createHttpSocketBootstrap
};
