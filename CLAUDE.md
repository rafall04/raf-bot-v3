# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

RAF Bot V2 is a single-process **monolithic Node.js app for ISP / RTRW-Net operations**. One codebase combines a WhatsApp bot (Baileys), a web/admin portal (PHP rendered through `php-express`), an internal JSON API, technician ticket workflows, billing + saldo (customer balance), vouchers, network monitoring (OLT/SNMP/MikroTik), and customer provisioning (GenieACS). Runtime is CommonJS Node.js; the timezone is forced to `Asia/Jakarta`.

**Language convention:** comments, documentation, log/error messages, and commit descriptions are written in **Indonesian**. Identifiers (variables, functions, classes) stay in English. Match this when editing.

## Essential reading before non-trivial work

**[SYSTEM_MAP.md](SYSTEM_MAP.md) and this file (`CLAUDE.md`) are the only canonical guides.** Read `SYSTEM_MAP.md` before tracing or changing cross-feature logic — it maps the entrypoint, the trigger→controller→service→repo→DB flow, DB locations, integration boundaries, and a running log of refactor ownership ("Boundary Refactor Baru"). **Keep it in sync when you change a flow.**

> Older rule files (`.cursorrules`, `AGENTS.md`, `PROJECT-RULES.md`, `PROMPTS.md`) were removed — they carried stale paths (e.g. a non-existent `lib/lid-handler.js`) and duplicated each other. Don't reintroduce that sprawl: durable guidance goes here or in `SYSTEM_MAP.md`.

## Commands

```bash
npm start            # nodemon index.js (auto-restart dev loop; nodemon sets NODE_ENV=production)
npm run dev          # alias of npm start
npm run start:prod   # node index.js (plain, no nodemon)
npm test             # jest --runInBand  (serial — global state + single WA conn make parallel unsafe)
npm run lint         # eslint .   (lenient: catches no-undef + unused vars; style is Prettier's job)
npm run lint:fix
npm run format       # prettier --write .
npm run format:check
```

Run a **single test** (do not parallelize — these suites share global state):

```bash
npx jest path/to/file.test.js          # one file
npx jest -t "substring of test name"   # by name across suites
```

Tests are co-located in `__tests__/` folders per layer (`lib`, `message`, `routes`, `services`, `repositories`, `controllers`, `views`, `static/js`) plus `*.test.js` siblings — ~230 suites. `jest.config.js` ignores `tmp/`, `dist/`, `.worktrees/`, etc.

**Production** runs under PM2 in fork mode: `pm2 start ecosystem.config.js` (app name `raf-dander-v3`). The app **must stay single-instance** — see Invariants below.

## First-time setup (after a fresh clone)

`config.json`, `.env`, `database/*` (SQLite + JSON), and `sessions/` are all gitignored, so a clone starts bare. Startup self-heals most of it:

1. **Config** — `lib/env-config.js` `loadConfig()` auto-bootstraps `config.json` from `config.example.json` on first run. Fill in real credentials there. Never read `process.env.*` directly in app code — go through `global.config` / the env-config helper.
2. **PHP binary** — admin & teknisi pages are `.php` served via `php-express`; without `php` on `PATH` those pages 500 (the JSON API still works). `index.js` prints a loud warning if `php` is missing.
3. **First admin** — `accounts.json` is gitignored, and the account-creation route requires an admin login (chicken-and-egg). Bootstrap one from the CLI:
   ```bash
   node scripts/create-admin.js <username> <password> [nama] [role]   # role: admin (default) | teknisi
   ```
4. **WhatsApp** — on first start the QR is printed to the terminal (and emitted over Socket.IO to the dashboard). Scan it; the session is saved under `sessions/<sessionName>/`. Databases auto-migrate on startup (backups land in `backups/`).

## Architecture

`index.js` is a thin **composition root**: it loads config, builds a shared runtime (`lib/app-runtime.js`), mounts HTTP middleware + routes (`lib/routes-registry.js`), starts Socket.IO, and owns the Baileys connection lifecycle. Request and message flow runs through these layers:

- **Bot layer** — `message/raf.js` is the WhatsApp router/interceptor: it builds actor context, runs global keyword/cancel guards, checks active conversation state, then dispatches an intent. Domain logic lives in `message/handlers/*`; intent routing is a map-based composer in `message/handlers/raf-intent-dispatch.js` + its `raf-intent-dispatch/` subfolder (one module per domain).
- **Web/API layer** — `routes/*.js` are thin HTTP controllers. Admin endpoints are assembled by the `routes/admin-router.js` composer (per-bounded-context registrars); legacy `routes/admin.js` paths that moved are now `410` stubs to prevent shadow ownership.
- **Service layer** — `services/*.service.js`, `lib/*.js`, and `lib/services/*` hold business rules, integration adapters, ticket state machines, auth, templating, and monitoring.
- **Repository layer** — `repositories/*.repository.js` are the emerging persistence owners per domain (users, voucher, saldo, ticket, payment, wifi, arrears, auto-outage…). `lib/database.js` is a compatibility facade over JSON/SQLite helpers; legacy callers still use it as a fallback.

**Data** lives in `database/`: per-domain SQLite files (`users.sqlite`, `saldo.sqlite`, `activity_logs.sqlite`, `psb_database.sqlite`, `monitoring_metrics.sqlite`, `isolir_audit.sqlite`) plus many JSON stores. Resolve paths with `lib/env-config.js` `getDatabasePath(name)`; under `NODE_ENV=test` it returns `*_test.sqlite` so tests never touch prod data. Keep domains in **separate** SQLite files.

**WhatsApp runtime** is global: `global.conn` (the socket) and `global.whatsappConnectionState`. The socket shape is isolated behind `lib/whatsapp-gateway.js`, `lib/whatsapp.adapter.js`, `lib/whatsapp-bootstrap.js`, `lib/whatsapp-delivery-service.js`, and `message/handlers/reply-runtime.js`. **Do not import Baileys directly in handlers/services** — go through the adapter/gateway.

**Integrations:** Baileys (WhatsApp MD), MikroTik/PPPoE (`lib/mikrotik*`, RouterOS API classes under `views/`), iPaymu (payments/topup), SNMP/OLT (`lib/olt-*`, multi-brand driver pattern in `lib/olt-drivers/`), GenieACS (provisioning), Telegram (DB backup), Socket.IO (realtime portal status), Cloudflare Tunnel (HTTPS termination — local HTTPS enforcement is disabled).

## Invariants & conventions that will bite you

- **Single instance only.** One WhatsApp connection, in-memory `global.*` state, and scheduled cron mean a second instance causes doubled cron, conflicting WA sockets, and data corruption. PM2 is `fork` / `instances: 1` — never switch to cluster.
- **Header Doc on every file.** The codebase convention is a top-of-file block — `Purpose`, `Caller`, `Deps`, `MainFuncs`, `SideEffects` (see `index.js`, `lib/routes-registry.js`). Preserve and update it when you edit a file.
- **All user-facing WhatsApp text comes from templates**, never hardcoded. Templates live in `database/*_templates.json` (esp. `response_templates.json`) and are editable from the admin UI at `/api/templates`. Render via `renderResponseTemplate(key, fallback, data)` / `renderTemplate()` (`lib/templating.js`, `lib/response-template-helper.js`). New messages must be added as template keys.
- **sendMessage pattern is mandatory.** Always guard `global.whatsappConnectionState === 'open' && global.raf && global.raf.sendMessage`, wrap in try-catch, and never throw from a notification send (log and continue). Use `lib/whatsapp-notification-wrapper.js` for notifications; pass `{ skipDuplicateCheck: true }` for direct command replies (notifications keep dedup on).
- **Normalize JIDs before any saldo/DB op.** Convert `@lid` (e.g. `…@lid`) to the canonical `628xxx@s.whatsapp.net` via `normalizeJidForSaldo()` (`lib/jid-utils.js`). Never use `@lid` as a key or `sendMessage` target; if it can't be normalized, fail loudly. Never show `@lid` to users (prefer pushname > DB name > phone).
- **Saldo writes are guarded.** Never call `addSaldo()` / `addKoinUser()` with amount `0`/`undefined`. Read-only init uses `saldoManager.createUserSaldo(userId)` (idempotent); write paths validate `amount > 0` first.
- **Payment status source of truth** is the periodic ledger in `routes/payment-status.js` + `lib/payment-finance-service.js`. The dashboard's `users.paid` flag is a derived cache — don't write it as the final source from other routes.
- **Conversation state** goes through `conversation-handler` (`getUserState`/`setUserState`/`deleteUserState`), not raw `temp[sender]`. State auto-expires after 15 min, needs a `step` field, honors universal cancel words (`batal`/`cancel`/`ga jadi`), and some steps are "protected" from global-command interception.
- **Concurrency guard per sender.** Wrap message processing with `isProcessing`/`setProcessing`/`clearProcessing` (`lib/state-manager.js`); always `clearProcessing` in a `finally`.
- **Keep route handlers thin** — DB/business logic belongs in services/repositories, and Express controllers use the central `asyncHandler` (`lib/error-handler.js`) + global error middleware instead of repeating try-catch. Files: kebab-case; classes PascalCase; functions/vars camelCase; constants UPPER_SNAKE; 2-space indent.
