/**
 * Header Doc
 * Purpose: Memisahkan operasi SQLite untuk tabel `connection_waypoints` dari facade database legacy.
 * Caller: `lib/database.js`.
 * Deps: `sqlite3`, `path`, `lib/json-store.js`, dan `lib/sqlite-pragmas.js` (applySqlitePragmas — di-require module-load time, bukan lazy).
 * MainFuncs: `initializeConnectionWaypointsTable`, `getConnectionWaypoints`, `saveConnectionWaypoints`, `deleteConnectionWaypoints`, `getAllConnectionWaypoints`.
 * SideEffects: Membuka koneksi SQLite ke `database/users.sqlite` dan membaca/menulis tabel waypoint.
 */
"use strict";

const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const { dbBasePath } = require("./json-store");
// Hoisted ke module-load time (BUKAN lazy require di dalam open-callback async).
// Lihat lib/saldo/shared.js: require lazy di dalam callback sqlite3 bisa fire setelah
// Jest tear-down → modul kosong → applySqlitePragmas undefined → throw uncaught → crash.
const { applySqlitePragmas } = require("./sqlite-pragmas");

function getWaypointsDatabasePath() {
    return path.join(dbBasePath, "users.sqlite");
}

function withWaypointsDatabase(handler) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(getWaypointsDatabasePath(), (err) => {
            if (err) {
                console.error("[WAYPOINTS_DB] Error opening database:", err.message);
                reject(err);
                return;
            }

            applySqlitePragmas(db)
                .catch((pragmaErr) => {
                    console.warn(`[WAYPOINTS_DB_PRAGMA_WARN] ${pragmaErr.message}`);
                })
                .then(() => Promise.resolve(handler(db)))
                .then((result) => {
                    db.close((closeError) => {
                        if (closeError) {
                            reject(closeError);
                            return;
                        }
                        resolve(result);
                    });
                })
                .catch((error) => {
                    db.close(() => reject(error));
                });
        });
    });
}

function initializeConnectionWaypointsTable() {
    return withWaypointsDatabase((db) => new Promise((resolve, reject) => {
        const createTableSql = `
            CREATE TABLE IF NOT EXISTS connection_waypoints (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                connection_type TEXT NOT NULL,
                source_id TEXT NOT NULL,
                target_id TEXT NOT NULL,
                waypoints TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                created_by TEXT,
                updated_by TEXT,
                UNIQUE(connection_type, source_id, target_id)
            )
        `;

        const createIndexesSql = [
            "CREATE INDEX IF NOT EXISTS idx_waypoints_connection ON connection_waypoints(connection_type, source_id, target_id)",
            "CREATE INDEX IF NOT EXISTS idx_waypoints_source ON connection_waypoints(source_id)",
            "CREATE INDEX IF NOT EXISTS idx_waypoints_target ON connection_waypoints(target_id)"
        ];

        db.serialize(() => {
            db.run(createTableSql, (err) => {
                if (err) {
                    console.error("[WAYPOINTS_DB] Error creating table:", err.message);
                    reject(err);
                    return;
                }

                let indexCount = 0;
                createIndexesSql.forEach((sql) => {
                    db.run(sql, (indexError) => {
                        if (indexError) {
                            console.warn("[WAYPOINTS_DB] Error creating index:", indexError.message);
                        }
                        indexCount += 1;
                        if (indexCount === createIndexesSql.length) {
                            resolve();
                        }
                    });
                });
            });
        });
    }));
}

function getConnectionWaypoints(connectionType, sourceId, targetId) {
    return withWaypointsDatabase((db) => new Promise((resolve, reject) => {
        db.get(
            "SELECT waypoints FROM connection_waypoints WHERE connection_type = ? AND source_id = ? AND target_id = ?",
            [connectionType, String(sourceId), String(targetId)],
            (err, row) => {
                if (err) {
                    console.error("[WAYPOINTS_DB] Error getting waypoints:", err.message);
                    reject(err);
                    return;
                }

                if (!row || !row.waypoints) {
                    resolve(null);
                    return;
                }

                try {
                    const waypoints = JSON.parse(row.waypoints);
                    resolve(Array.isArray(waypoints) ? waypoints : null);
                } catch (parseError) {
                    console.error("[WAYPOINTS_DB] Error parsing waypoints JSON:", parseError);
                    resolve(null);
                }
            }
        );
    }));
}

function saveConnectionWaypoints(connectionType, sourceId, targetId, waypoints, userId = null) {
    return withWaypointsDatabase((db) => new Promise((resolve, reject) => {
        db.run(
            `INSERT OR REPLACE INTO connection_waypoints
            (connection_type, source_id, target_id, waypoints, updated_at, updated_by)
            VALUES (?, ?, ?, ?, datetime('now'), ?)`,
            [connectionType, String(sourceId), String(targetId), JSON.stringify(waypoints), userId],
            (err) => {
                if (err) {
                    console.error("[WAYPOINTS_DB] Error saving waypoints:", err.message);
                    reject(err);
                    return;
                }
                resolve(true);
            }
        );
    }));
}

function deleteConnectionWaypoints(connectionType, sourceId, targetId) {
    return withWaypointsDatabase((db) => new Promise((resolve, reject) => {
        db.run(
            "DELETE FROM connection_waypoints WHERE connection_type = ? AND source_id = ? AND target_id = ?",
            [connectionType, String(sourceId), String(targetId)],
            (err) => {
                if (err) {
                    console.error("[WAYPOINTS_DB] Error deleting waypoints:", err.message);
                    reject(err);
                    return;
                }
                resolve(true);
            }
        );
    }));
}

function getAllConnectionWaypoints() {
    return withWaypointsDatabase((db) => new Promise((resolve, reject) => {
        db.all(
            "SELECT * FROM connection_waypoints ORDER BY updated_at DESC",
            [],
            (err, rows) => {
                if (err) {
                    console.error("[WAYPOINTS_DB] Error getting all waypoints:", err.message);
                    reject(err);
                    return;
                }

                resolve(rows.map((row) => {
                    try {
                        return {
                            ...row,
                            waypoints: JSON.parse(row.waypoints)
                        };
                    } catch (parseError) {
                        console.error("[WAYPOINTS_DB] Error parsing waypoints JSON:", parseError);
                        return {
                            ...row,
                            waypoints: []
                        };
                    }
                }));
            }
        );
    }));
}

module.exports = {
    initializeConnectionWaypointsTable,
    getConnectionWaypoints,
    saveConnectionWaypoints,
    deleteConnectionWaypoints,
    getAllConnectionWaypoints
};
