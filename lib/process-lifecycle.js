/**
 * Header Doc
 * Purpose: Memusatkan registrasi process lifecycle handler agar `index.js` hanya menjadi composition root tipis.
 * Caller: `index.js`.
 * Deps: Runtime aplikasi, `./activity-logger`, dan service background yang perlu shutdown teratur.
 * MainFuncs: `registerProcessLifecycleHandlers`.
 * SideEffects: Mendaftarkan handler `unhandledRejection`, `uncaughtException`, `uncaughtExceptionMonitor`, `SIGTERM`, dan `SIGINT`.
 */
"use strict";

function registerProcessLifecycleHandlers({ runtime, CustomerTrafficUsageService, closeLogsDatabase }) {
    process.on("unhandledRejection", (reason, promise) => {
        console.error("❌ Unhandled Rejection at:", promise);
        console.error("   Reason:", reason);
    });

    process.on("uncaughtExceptionMonitor", (error, origin) => {
        console.error("Uncaught Exception Monitor:", error);
        console.error("   Origin:", origin);
    });

    process.on("uncaughtException", (error) => {
        console.error("❌ Uncaught Exception:", error);
        console.error("   Stack:", error.stack);
        console.log("🔄 Restarting process due to uncaught exception...");
        process.exit(1);
    });

    process.on("SIGTERM", async () => {
        console.log("📴 SIGTERM received, shutting down gracefully...");

        try {
            try {
                const oltLogScraper = require("./olt-log-scraper");
                oltLogScraper.stopScraper();
                console.log("   Stopping OLT log scraper...");
            } catch (_error) {
                // Ignore if scraper belum diload.
            }

            try {
                const oltSyslog = require("./olt-syslog-receiver");
                oltSyslog.stopSyslogReceiver();
                console.log("   Stopping OLT syslog receiver...");
            } catch (_error) {
                // Ignore if receiver belum diload.
            }

            try {
                const oltRxPoller = require("./olt-rxpower-poller");
                oltRxPoller.stopRxPowerPoller();
                console.log("   Stopping OLT rxPower poller...");
            } catch (_error) {
                // Ignore if poller belum diload.
            }

            try {
                const oltSnmpLos = require("./olt-snmp-los-poller");
                oltSnmpLos.stopSnmpLosPoller();
                console.log("   Stopping OLT SNMP LOS poller...");
            } catch (_error) {
                // Ignore if poller belum diload.
            }

            if (global.sock && typeof global.sock.logout === "function") {
                console.log("   Closing WhatsApp connection...");
                await global.sock.logout();
            }

            const db = runtime && typeof runtime.getDb === "function" ? runtime.getDb() : global.db;
            if (db && typeof db.close === "function") {
                console.log("   Closing database connection...");
                if (CustomerTrafficUsageService && typeof CustomerTrafficUsageService.stopCollector === "function") {
                    CustomerTrafficUsageService.stopCollector();
                }
                await db.close();
            }

            if (typeof closeLogsDatabase === "function") {
                try {
                    await closeLogsDatabase();
                    console.log("   Closing logs database connection...");
                } catch (error) {
                    console.error("   Error closing logs database:", error);
                }
            }

            console.log("✅ Graceful shutdown complete");
            process.exit(0);
        } catch (error) {
            console.error("❌ Error during shutdown:", error);
            process.exit(1);
        }
    });

    process.on("SIGINT", async () => {
        console.log("\n📴 SIGINT received (Ctrl+C), shutting down...");

        try {
            if (global.sock && typeof global.sock.logout === "function") {
                await global.sock.logout();
            }
            process.exit(0);
        } catch (error) {
            console.error("❌ Error during shutdown:", error);
            process.exit(1);
        }
    });
}

module.exports = {
    registerProcessLifecycleHandlers
};
