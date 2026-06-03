/**
 * Header Doc
 * Purpose: Composer/factory `createApiUsersService(overrides)` — thin facade yang menggabungkan sub-modul method users API (list-users-integrity, update-user-payment-status, delete-user-by-id, delete-all-users, create-user orchestrator + 3 phase, update-user-by-id, users Excel template/export/import) plus default deps blueprint. Mempertahankan kontrak factory output persis sama dengan versi monolitik sambil menambah 3 method Excel: `buildUsersExcelTemplate`, `exportUsersToExcel`, dan `importUsersFromExcel`.
 * Caller: `routes/api-users-routes.js` (production), `services/__tests__/api-users.service.test.js` (test).
 * Deps: `./api-users/default-deps`, `./api-users/list-users-integrity`, `./api-users/update-user-payment-status`, `./api-users/delete-user-by-id`, `./api-users/delete-all-users`, `./api-users/create-user`, `./api-users/update-user-by-id`, `./api-users/users-excel-template`, `./api-users/export-users-excel`, `./api-users/import-users-excel`.
 * MainFuncs: `createApiUsersService(overrides = {})` — factory yang merge defaults dengan overrides, return service object.
 * SideEffects: Tidak ada di level composer; semua side-effect ada di sub-modul saat method dipanggil.
 *
 * BOUNDARY MAP (services/api-users/):
 *   default-deps.js                            : Default 30 deps keys blueprint
 *   list-users-integrity.js                    : listUsersWithIntegrityCheck
 *   update-user-payment-status.js              : updateUserPaymentStatus
 *   delete-user-by-id.js                       : deleteUserById
 *   delete-all-users.js                        : deleteAllUsers
 *   create-user.js                             : upsertUserFromAdminPanel orchestrator (3-phase pipeline)
 *   create-user-validate.js                    : Phase 1+2 (validate, generate ID/credentials, prepare newUser)
 *   create-user-mikrotik-sync.js               : Phase 3 (mikrotik sync per registration mode)
 *   create-user-persist.js                     : Phase 4-8 (persist + paid status + activity log + welcome msg)
 *   update-user-by-id.js                       : updateUserById
 *   users-excel-schema.js                      : Source-of-truth schema workbook import/export pelanggan
 *   users-excel-template.js                    : Builder workbook template + shared workbook layout
 *   export-users-excel.js                      : Export workbook pelanggan runtime snapshot
 *   import-users-excel.js                      : Preview validate + commit import pelanggan via owner service
 */
"use strict";

const { defaultDeps } = require('./api-users/default-deps');
const { listUsersWithIntegrityCheck } = require('./api-users/list-users-integrity');
const { updateUserPaymentStatus } = require('./api-users/update-user-payment-status');
const { deleteUserById } = require('./api-users/delete-user-by-id');
const { deleteAllUsers } = require('./api-users/delete-all-users');
const { upsertUserFromAdminPanel } = require('./api-users/create-user');
const { updateUserById } = require('./api-users/update-user-by-id');
const { buildUsersExcelTemplate } = require('./api-users/users-excel-template');
const { exportUsersToExcel } = require('./api-users/export-users-excel');
const { importUsersFromExcel } = require('./api-users/import-users-excel');

function createApiUsersService(overrides = {}) {
    const deps = {
        ...defaultDeps(),
        ...overrides
    };

    const service = {
        deps,
        async listUsersWithIntegrityCheck() {
            return listUsersWithIntegrityCheck(deps);
        },
        async updateUserPaymentStatus(args) {
            return updateUserPaymentStatus(deps, args);
        },
        async deleteUserById(args) {
            return deleteUserById(deps, args);
        },
        async deleteAllUsers(args) {
            return deleteAllUsers(deps, args);
        },
        async upsertUserFromAdminPanel(args) {
            return upsertUserFromAdminPanel(deps, service, args);
        },
        async updateUserById(args) {
            return updateUserById(deps, args);
        },
        async buildUsersExcelTemplate() {
            return buildUsersExcelTemplate();
        },
        async exportUsersToExcel() {
            return exportUsersToExcel(deps);
        },
        async importUsersFromExcel(args) {
            return importUsersFromExcel(deps, service, args);
        }
    };

    return service;
}

module.exports = {
    createApiUsersService
};
