/**
 * Header Doc
 * Purpose: Registrar route admin untuk operasi database runtime, backup, restore, migration schema, dan utility database admin.
 * Caller: `routes/admin-router.js`.
 * Deps: Router Express, middleware auth staf, fs/path/exec/sqlite3, helper reload database, dan `services/admin-database-ops.service`.
 * MainFuncs: `registerAdminDatabaseRoutes`.
 * SideEffects: Membaca/menulis file database, menjalankan script migrasi, dan me-reload state runtime.
 */
"use strict";

const multer = require("multer");
const { asyncHandler, createError, ErrorTypes } = require("../lib/error-handler");
const { createAdminDatabaseOpsService } = require("../services/admin-database-ops.service");

function registerAdminDatabaseRoutes(router, deps) {
    const {
        ensureAuthenticatedStaff,
        fs,
        path,
        exec,
        sqlite3
    } = deps;
    const adminDatabaseOpsService = createAdminDatabaseOpsService({ fs, sqlite3 });

    function requireAdmin(req) {
        if (!req.user || !["admin", "owner", "superadmin"].includes(req.user.role)) {
            throw createError(ErrorTypes.AUTHORIZATION_ERROR, "Akses ditolak.", 403);
        }
    }

    /**
     * Jalankan migrasi database lengkap untuk users.sqlite:
     *  1) Comprehensive column-adder (scripts/migrate-database.js) -> pastikan semua kolom `users` ada.
     *  2) Version-based migration (DatabaseMigrationManager) -> buat tabel turunan seperti `payment_history`.
     * Keduanya idempoten & aman dipanggil berulang. Mengembalikan ringkasan hasil tanpa pernah
     * memanggil process.exit (berbeda dengan scripts/auto-migrate-on-startup yang exit saat dijalankan langsung).
     */
    async function runDatabaseMigrations() {
        // Step 1: Comprehensive column-adder (menarget users.sqlite, fallback database.sqlite)
        const scriptPath = path.join(__dirname, "..", "scripts", "migrate-database.js");
        const columnResult = await new Promise((resolve) => {
            if (!fs.existsSync(scriptPath)) {
                resolve({ ran: false, error: null, stdout: "", stderr: "" });
                return;
            }
            exec(`node "${scriptPath}"`, { cwd: path.join(__dirname, "..") }, (error, stdout, stderr) => {
                resolve({
                    ran: true,
                    error: error ? error.message : null,
                    stdout: stdout ? stdout.toString() : "",
                    stderr: stderr ? stderr.toString() : ""
                });
            });
        });

        // Step 2: Version-based migration (membuat payment_history + index, dll.)
        let versionResults = null;
        let versionError = null;
        try {
            const DatabaseMigrationManager = require("../lib/database-migration-manager");
            const manager = new DatabaseMigrationManager();
            versionResults = await manager.migrateAll();
        } catch (versionErr) {
            versionError = versionErr.message;
        }

        return { columnResult, versionResults, versionError };
    }

    router.get("/api/database/info", ensureAuthenticatedStaff, asyncHandler(async (_req, res) => {
        try {
            const dbPath = path.join(__dirname, "..", "database", "users.sqlite");
            const stats = fs.statSync(dbPath);
            const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
            const info = await new Promise((resolve) => {
                const result = {
                    size: `${(stats.size / 1024).toFixed(1)} KB`,
                    lastModified: new Date(stats.mtime).toLocaleString(),
                    totalUsers: 0,
                    totalColumns: 0
                };
                db.get("SELECT COUNT(*) as count FROM users", [], (countErr, row) => {
                    result.totalUsers = countErr ? "N/A" : row.count;
                    db.all("PRAGMA table_info(users)", [], (columnsErr, columns) => {
                        result.totalColumns = columnsErr ? "N/A" : columns.length;
                        db.close();
                        resolve(result);
                    });
                });
            });

            res.status(200).json({ status: 200, message: "Database info retrieved", data: info });
        } catch (error) {
            console.error("[DB_INFO] Error:", error);
            res.status(500).json({ status: 500, message: "Error getting database info", data: null });
        }
    }));

    router.get("/api/database/backups", ensureAuthenticatedStaff, (_req, res) => {
        try {
            const rootDir = path.join(__dirname, "..");
            const backupsDir = path.join(rootDir, "backups");
            if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
            const backupFiles = fs.existsSync(backupsDir)
                ? fs.readdirSync(backupsDir).filter((file) => file.startsWith("database.backup.") && file.endsWith(".sqlite"))
                : [];
            const backups = backupFiles.map((filename) => {
                const filePath = path.join(backupsDir, filename);
                const stats = fs.statSync(filePath);
                const timestamp = parseInt(filename.match(/database\.backup\.(\d+)\.sqlite/)[1]);
                return {
                    filename,
                    created: new Date(timestamp).toLocaleString(),
                    size: `${(stats.size / 1024).toFixed(1)} KB`,
                    timestamp
                };
            }).sort((a, b) => b.timestamp - a.timestamp);
            res.status(200).json({ status: 200, message: "Backup list retrieved", data: backups });
        } catch (error) {
            console.error("[DB_BACKUPS] Error:", error);
            res.status(500).json({ status: 500, message: "Error getting backup list", data: [] });
        }
    });

    router.post("/api/database/check-schema", ensureAuthenticatedStaff, asyncHandler(async (_req, res) => {
        try {
            const expectedColumns = [
                "id", "name", "username", "password", "phone_number", "address", "latitude", "longitude",
                "subscription", "device_id", "status", "paid", "send_invoice", "is_corporate", "corporate_name",
                "corporate_address", "corporate_npwp", "corporate_pic_name", "corporate_pic_phone", "corporate_pic_email",
                "pppoe_username", "pppoe_password", "connected_odp_id", "bulk", "created_at", "updated_at", "otp",
                "otpTimestamp", "subscription_price", "payment_due_date", "is_paid", "auto_isolir", "odc", "odp",
                "olt", "maps_url", "registration_date", "last_login", "last_payment_date", "reminder_sent",
                "isolir_sent", "compensation_minutes", "email", "alternative_phone", "notes"
            ];
            let dbPath = path.join(__dirname, "..", "database", "users.sqlite");
            if (!fs.existsSync(dbPath)) dbPath = path.join(__dirname, "..", "database", "database.sqlite");
            if (!fs.existsSync(dbPath)) {
                return res.status(404).json({ status: 404, message: "Database file not found (users.sqlite or database.sqlite)", data: null });
            }
            const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
            const result = await new Promise((resolve, reject) => {
                db.all("PRAGMA table_info(users)", [], (err, columns) => {
                    if (err) return reject(err);
                    const existingColumns = columns.map((column) => column.name);
                    db.close();
                    resolve({
                        existingColumns,
                        missingColumns: expectedColumns.filter((column) => !existingColumns.includes(column)),
                        totalExpected: expectedColumns.length,
                        totalExisting: existingColumns.length
                    });
                });
            });
            res.status(200).json({ status: 200, message: "Schema check complete", data: result });
        } catch (error) {
            console.error("[DB_CHECK_SCHEMA] Error:", error);
            res.status(500).json({ status: 500, message: "Error checking schema: " + error.message, data: null });
        }
    }));

    router.post("/api/database/migrate-schema", ensureAuthenticatedStaff, asyncHandler(async (_req, res) => {
        try {
            const { columnResult, versionResults, versionError } = await runDatabaseMigrations();

            if (columnResult.error) {
                console.error("[DB_MIGRATE] Column migration error:", columnResult.error);
                console.error("[DB_MIGRATE] Stderr:", columnResult.stderr);
                return res.status(500).json({ status: 500, message: "Migration failed: " + columnResult.error, data: null });
            }

            const output = columnResult.stdout || "";
            let backupFile = null;
            let addedColumns = [];
            let backupMatch = output.match(/\[SUCCESS\].*Backup created: ([^\n]+)/);
            if (!backupMatch) backupMatch = output.match(/Creating backup: ([^\n]+)/);
            if (backupMatch) backupFile = path.basename(backupMatch[1].trim());
            const columnMatches = output.match(/\[SUCCESS\].*Added field:.*?(\w+)/g);
            if (columnMatches) {
                addedColumns = columnMatches.map((match) => {
                    const fieldMatch = match.match(/Added field:.*?(\w+)/);
                    return fieldMatch ? fieldMatch[1] : match;
                });
            }
            const upToDate = (output.includes("All required fields already exist!") || output.includes("Database schema is already up to date!")) && addedColumns.length === 0;

            if (versionError) {
                console.error("[DB_MIGRATE] Version migration error:", versionError);
            }

            const { reloadUsersFromDatabase } = require("../lib/database-reload");
            try {
                const reloadResult = await reloadUsersFromDatabase();
                res.status(200).json({
                    status: 200,
                    message: upToDate ? "Database already up to date" : "Migration completed successfully. No restart needed!",
                    data: { backupFile, addedColumns, upToDate, output, versionResults, versionError, reloadResult, restartRequired: false }
                });
            } catch (reloadErr) {
                res.status(200).json({
                    status: 200,
                    message: upToDate ? "Database already up to date" : "Migration completed. Please restart for changes to take effect.",
                    data: { backupFile, addedColumns, upToDate, output, versionResults, versionError, reloadError: reloadErr.message, restartRequired: true }
                });
            }
        } catch (error) {
            console.error("[DB_MIGRATE] Error:", error);
            res.status(500).json({ status: 500, message: "Error starting migration: " + error.message, data: null });
        }
    }));

    router.post("/api/database/upload", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        try {
            const multer = require("multer");
            const upload = multer({
                dest: path.join(__dirname, "..", "temp"),
                limits: { fileSize: 50 * 1024 * 1024 },
                fileFilter: (_uploadReq, file, cb) => {
                    const ext = path.extname(file.originalname).toLowerCase();
                    if ([".sqlite", ".db", ".sqlite3"].includes(ext)) cb(null, true);
                    else cb(new Error("Invalid file type. Only SQLite files are allowed."));
                }
            }).single("database");

            upload(req, res, async (err) => {
                if (err) return res.status(400).json({ status: 400, message: err.message || "Upload failed", data: null });
                if (!req.file) return res.status(400).json({ status: 400, message: "No file uploaded", data: null });
                const uploadedPath = req.file.path;
                const dbPath = path.join(__dirname, "..", "database", "users.sqlite");
                const autoMigrate = req.body.autoMigrate === "true";
                const sqlite3Test = require("sqlite3").verbose();
                const testDb = new sqlite3Test.Database(uploadedPath, sqlite3Test.OPEN_READONLY, (testErr) => {
                    if (testErr) {
                        try { if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath); } catch (__cleanupErr) {}
                        return res.status(400).json({ status: 400, message: "File is not a valid SQLite database", data: null });
                    }
                    testDb.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'", [], async (checkErr, row) => {
                        await new Promise((resolve) => testDb.close(() => resolve()));
                        if (checkErr || !row) {
                            try { if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath); } catch (__cleanupErr) {}
                            return res.status(400).json({ status: 400, message: "Database does not contain users table", data: null });
                        }
                        const timestamp = Date.now();
                        const backupsDir = path.join(__dirname, "..", "backups");
                        if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
                        const backupPath = path.join(backupsDir, `database.backup.${timestamp}.sqlite`);
                        try {
                            if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, backupPath);
                            fs.copyFileSync(uploadedPath, dbPath);
                            try { if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath); } catch (__cleanupErr) {}
                            let migrationResult = null;
                            if (autoMigrate) {
                                const { columnResult, versionResults, versionError } = await runDatabaseMigrations();
                                const migrationOutput = columnResult.stdout || "";
                                let addedColumns = [];
                                const columnMatches = migrationOutput.match(/\[SUCCESS\].*Added field:.*?(\w+)/g);
                                if (columnMatches) {
                                    addedColumns = columnMatches.map((match) => {
                                        const fieldMatch = match.match(/Added field:.*?(\w+)/);
                                        return fieldMatch ? fieldMatch[1] : match;
                                    });
                                }
                                migrationResult = {
                                    success: !columnResult.error && !versionError,
                                    error: columnResult.error || versionError || null,
                                    addedColumns,
                                    upToDate: migrationOutput.includes("All required fields already exist!") && addedColumns.length === 0,
                                    versionResults
                                };
                            }
                            const { reloadUsersFromDatabase } = require("../lib/database-reload");
                            try {
                                const reloadResult = await reloadUsersFromDatabase();
                                res.status(200).json({
                                    status: 200,
                                    message: "Database uploaded and replaced successfully. No restart needed!",
                                    data: { originalName: req.file.originalname, backupFile: path.basename(backupPath), migrationResult, reloadResult, restartRequired: false }
                                });
                            } catch (reloadErr) {
                                res.status(200).json({
                                    status: 200,
                                    message: "Database uploaded successfully. Please restart the application for changes to take effect.",
                                    data: { originalName: req.file.originalname, backupFile: path.basename(backupPath), migrationResult, reloadError: reloadErr.message, restartRequired: true }
                                });
                            }
                        } catch (replaceErr) {
                            try { if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath); } catch (__cleanupErr) {}
                            res.status(500).json({ status: 500, message: "Error replacing database: " + replaceErr.message, data: null });
                        }
                    });
                });
            });
        } catch (error) {
            console.error("[DB_UPLOAD] Error:", error);
            res.status(500).json({ status: 500, message: "Error processing upload: " + error.message, data: null });
        }
    }));

    router.post("/api/database/reload", ensureAuthenticatedStaff, asyncHandler(async (_req, res) => {
        try {
            const { reloadUsersFromDatabase } = require("../lib/database-reload");
            const result = await reloadUsersFromDatabase();
            res.status(200).json({
                status: 200,
                message: "Database reloaded successfully from disk to memory",
                data: {
                    oldCount: result.oldCount,
                    newCount: result.newCount,
                    oldColumns: result.oldColumns,
                    newColumns: result.newColumns,
                    message: result.message
                }
            });
        } catch (error) {
            console.error("[DB_RELOAD_API] Error:", error);
            res.status(500).json({ status: 500, message: "Error reloading database: " + error.message, data: null });
        }
    }));

    router.post("/api/database/restore", ensureAuthenticatedStaff, (req, res) => {
        try {
            const { filename } = req.body;
            if (!filename) return res.status(400).json({ status: 400, message: "Filename is required", data: null });
            if (!filename.match(/^database\.backup\.\d+\.sqlite$/)) {
                return res.status(400).json({ status: 400, message: "Invalid backup filename", data: null });
            }
            const backupsDir = path.join(__dirname, "..", "backups");
            const backupPath = path.join(backupsDir, filename);
            const dbPath = path.join(__dirname, "..", "database", "users.sqlite");
            if (!fs.existsSync(backupPath)) return res.status(404).json({ status: 404, message: "Backup file not found", data: null });
            const timestamp = Date.now();
            const currentBackupPath = path.join(backupsDir, `database.backup.${timestamp}.sqlite`);
            fs.copyFileSync(dbPath, currentBackupPath);
            fs.copyFileSync(backupPath, dbPath);
            res.status(200).json({
                status: 200,
                message: "Database restored successfully",
                data: { restoredFrom: filename, currentBackup: path.basename(currentBackupPath) }
            });
        } catch (error) {
            console.error("[DB_RESTORE] Error:", error);
            res.status(500).json({ status: 500, message: "Error restoring database: " + error.message, data: null });
        }
    });

    router.get("/api/debug/database", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        requireAdmin(req);
        const result = await adminDatabaseOpsService.getDatabaseDiagnostics();
        return res.status(result.status).json(result);
    }));

    router.post("/api/migrate-users", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        requireAdmin(req);

        const tempDir = path.join(__dirname, "..", "temp");
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const upload = multer({
            dest: tempDir,
            limits: { fileSize: 10 * 1024 * 1024 },
            fileFilter: (_uploadReq, file, cb) => {
                const ext = path.extname(file.originalname).toLowerCase();
                if (ext === ".json") {
                    cb(null, true);
                } else {
                    cb(new Error("Invalid file type. Only JSON files are allowed."));
                }
            }
        }).single("usersFile");

        await new Promise((resolve, reject) => {
            upload(req, res, (err) => {
                if (err) {
                    reject(createError(ErrorTypes.VALIDATION_ERROR, err.message || "Upload failed", 400));
                    return;
                }
                resolve();
            });
        });

        if (!req.file) {
            throw createError(ErrorTypes.VALIDATION_ERROR, "File users.json harus diupload.", 400);
        }

        const result = await adminDatabaseOpsService.migrateUsersFromJsonUpload({
            filePath: req.file.path,
            originalName: req.file.originalname
        });
        return res.status(result.status).json(result);
    }));
}

module.exports = {
    registerAdminDatabaseRoutes
};
