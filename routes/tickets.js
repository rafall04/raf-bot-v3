/**
 * Header Doc
 * Purpose: Composer router tiket gangguan — thin index yang menggabungkan sub-router by audience/auth tier (list, workflow staff, photo upload, admin-only, customer placeholder). Pemecahan ini mempertahankan path mount semula (`/api/tickets`, `/api/admin/tickets`, `/api/ticket/...`, `/api/admin/ticket/...`) sehingga tidak ada perubahan kontrak API ke konsumen.
 * Caller: `lib/routes-registry.js` (mount via `app.use('/api', ticketsRouter)`).
 * Deps: `./tickets-list-routes`, `./tickets-workflow-routes`, `./tickets-photo-routes`, `./tickets-admin-routes`, `./tickets-customer-routes`, dan secara transitive `./tickets-shared`.
 * MainFuncs: Mount sub-router pada path root `/` agar prefix endpoint asli (`/tickets`, `/ticket/...`, `/admin/...`) terjaga.
 * SideEffects: Tidak ada di level composer — semua side-effect ada di sub-router masing-masing.
 *
 * BOUNDARY MAP:
 *   tickets-shared.js              : Helpers + middleware + 2 multer storage (private)
 *   tickets-list-routes.js         : GET /tickets, GET /admin/tickets (read mixed staff/admin)
 *   tickets-workflow-routes.js     : POST /ticket/process,/otw,/arrived,/verify-otp,/complete,/resolve,/create (staff write)
 *   tickets-photo-routes.js        : POST /ticket/upload-photo, /ticket/create/upload-photo (staff upload)
 *   tickets-admin-routes.js        : POST /admin/ticket/create, /admin/ticket/cancel (admin only)
 *   tickets-customer-routes.js     : Placeholder kosong untuk endpoint customer self-service di masa depan
 */
"use strict";

const express = require('express');

const ticketsListRoutes = require('./tickets-list-routes');
const ticketsWorkflowRoutes = require('./tickets-workflow-routes');
const ticketsPhotoRoutes = require('./tickets-photo-routes');
const ticketsAdminRoutes = require('./tickets-admin-routes');
const ticketsCustomerRoutes = require('./tickets-customer-routes');

const router = express.Router();

// Mount semua sub-router di root '/' supaya prefix endpoint asli (/tickets, /ticket/..., /admin/...) tidak berubah
router.use('/', ticketsListRoutes);
router.use('/', ticketsWorkflowRoutes);
router.use('/', ticketsPhotoRoutes);
router.use('/', ticketsAdminRoutes);
router.use('/', ticketsCustomerRoutes);

module.exports = router;
