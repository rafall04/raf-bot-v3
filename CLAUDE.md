# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

RAF Bot V2 is a single-process **monolithic Node.js app for ISP / RTRW-Net operations**. One codebase combines a WhatsApp bot (Baileys), a web/admin portal (PHP rendered through `php-express`), an internal JSON API, technician ticket workflows, billing + saldo (customer balance), vouchers, network monitoring (OLT/SNMP/MikroTik), and customer provisioning (GenieACS). Runtime is CommonJS Node.js; the timezone is forced to `Asia/Jakarta`.

**Language convention:** comments, documentation, log/error messages, and commit descriptions are written in **Indonesian**. Identifiers (variables, functions, classes) stay in English. Match this when editing.

## Essential reading before non-trivial work

**[SYSTEM_MAP.md](SYSTEM_MAP.md) and this file (`CLAUDE.md`) are the only canonical guides.** Read `SYSTEM_MAP.md` before tracing or changing cross-feature logic — it maps the entrypoint, the trigger→controller→service→repo→DB flow, DB locations, and integration boundaries. **Keep it in sync when you change a flow** — skill `system-map-sync` has the exact procedure.

**[docs/boundary-log.md](docs/boundary-log.md) is a CHANGELOG, not a map — do not read it whole** (170+ entries). `SYSTEM_MAP.md` carries only a one-line index; open the single anchor you need (e.g. `#b169`). Reading the whole log used to cost ~24k tokens every session for information almost never needed.

### Where a rule lives (never duplicate across layers)

| Layer | Location | Role |
|---|---|---|
| Rules & invariants | `CLAUDE.md` (this file) | Constraints + the "why"; read every session |
| Current-state map | `SYSTEM_MAP.md` | Flows, DB locations, integrations, one-line boundary index |
| Ownership history | `docs/boundary-log.md` | Append-only changelog; read per-anchor only |
| Pre-flight checklists | skills `raf-invariants`, `system-map-sync` (`.claude/skills/`) | Step-by-step procedure for risky paths / map sync |
| Early warning | `.claude/hooks/invariant-lint.js` (PostToolUse, non-blocking) | Heuristic warnings right after an edit (Baileys import, raw `sendMessage`, saldo amount 0, hardcoded text, `process.env`) |
| Hard enforcement | guard tests — `message/__tests__/wa-forbidden-imports.test.js`, `message/__tests__/response-template-key-integrity.test.js`, `scripts/__tests__/boundary-index.test.js`, `npm run check:theme` | Violation = red suite; guards scan the repo, never a manual list |

A durable rule lives in **one** layer (usually this file); skills/hook/tests point back to it. Same guidance written twice with different wording is how docs rot.

**Writing a new boundary entry:** body (**max 8 lines**: owner, what it now owns, status of the old path `410`/fallback/deleted, config gate, tests) appended to `docs/boundary-log.md` under a **unique** anchor `<a id="bNNN"></a>` where NNN = current highest + 1, then ONE index line in `SYSTEM_MAP.md`. Verify with `node scripts/check-boundary-index.js` (same check runs in `npm test`). Full procedure + example: skill `system-map-sync`.

> Older rule files (`.cursorrules`, `AGENTS.md`, `PROJECT-RULES.md`, `PROMPTS.md`, `.kiro/`, `.sisyphus/`) were removed — they carried stale paths and even described a template system that no longer exists (`message-templates.json` with `{placeholder}` vs the real `response_templates.json` with `${slot}`). Don't reintroduce that sprawl: durable guidance goes here or in `SYSTEM_MAP.md`.

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
npm run check:theme  # guard token tema (CSS role harus pakai var semantik, bukan warna primitif tetap)
```

Run a **single test** (do not parallelize — these suites share global state):

```bash
npx jest path/to/file.test.js          # one file
npx jest -t "substring of test name"   # by name across suites
```

Tests are co-located in `__tests__/` folders per layer (`lib`, `message`, `routes`, `services`, `repositories`, `controllers`, `views`, `static/js`, `scripts`) plus `*.test.js` siblings — hundreds of suites. `jest.config.js` ignores `tmp/`, `dist/`, `.worktrees/`, etc.

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

## Adding a feature / changing a flow — the standard path

Every shipped feature here follows the same shape (the boundary log is 170+ repetitions of it). Deviating is what creates shadow ownership and orphan code:

1. **Locate ownership first.** `SYSTEM_MAP.md` + the relevant boundary anchor tell you who owns the domain today. If a legacy path exists, the new owner **replaces** it (old path → `410` stub / dead fallback) — never a second parallel implementation.
2. **Risky path? Pre-flight first.** Anything touching saldo/payments, WA sending, JID/`@lid`, templates, or conversation state → skill `raf-invariants` **before** writing code.
3. **Build in the layer that matches the surface.** WA command → intent module in `message/handlers/raf-intent-dispatch/<domain>.js`; multi-step dialog → a state domain `message/handlers/state-domains/<domain>.state.js` with its own step prefix, registered in `conversation-state-owner-map.js`; HTTP/admin → thin route (registered via the composer) + logic in services + persistence in a repository.
4. **Gate it.** New behavior ships behind `config.<feature>.enabled`, default **OFF** (= inert, "deploy gelap"), documented in `config.example.json`. Turning it on is an ops decision, not a deploy side effect.
5. **Customer-visible text = template keys** in `database/response_templates.json`, added **in the same commit** as the code (a stored template overrides your fallback — see Standards below).
6. **Tests + Header Doc** for every file touched; run the touched suites (`npx jest <path>`, serial) and `npm run lint`.
7. **Record it:** boundary entry + one index line (skill `system-map-sync`), then `node scripts/check-boundary-index.js`.

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
- **Keep route handlers thin** — DB/business logic belongs in services/repositories, and Express controllers use the central `asyncHandler` (`lib/error-handler.js`) + global error middleware instead of repeating try-catch. Files: kebab-case; classes PascalCase; functions/vars camelCase; constants UPPER_SNAKE; 4-space indent (per `.prettierrc.json` / `.editorconfig` — style is Prettier's job, don't hand-fight it).

## Standards learned the hard way

Each rule below exists because the bug already happened. Don't relax one because it looks trivial.

- **A stored template overrides your fallback.** `renderResponseTemplate(key, fallback, data)` returns the JSON template whenever the key exists — your fallback string is then dead code. Adding a new `${slot}` to the fallback alone means the section is **computed and silently never sent**. That is exactly how the upstream-path section and the app-aware diagnosis stayed invisible to customers for weeks. **Add the slot to `database/*_templates.json` in the same change**, and check no hardcoded copy of that text is left in the stored template.
- **Gate on evidence, not on a config flag.** `upstreamMonitor.enabled=true` does not mean the upstream is healthy — if the customer IP maps to no path, status resolves to `null`. A gate keyed off the flag then skips *both* the upstream check and the strict check, ending up **looser than with the feature off**. Derive the mode from a resolved verdict; absent evidence ⇒ fail closed.
- **"Cannot observe" ≠ "observed bad".** When the router is unreachable the bot is blind, not looking at a dead modem — and GenieACS, being local, will happily keep serving a stale `_lastInform` that reads like failure. Never message a customer or escalate from a blind read. Return a third state (`null`), retry, and escalate to **admin** with the real reason after a bounded wait (`lib/reboot-followup-service.js:isModemBack`).
- **Calibrate thresholds against measured telemetry, never intuition.** A 7-minute "device online" window looked obviously fine and matched only **7%** of healthy modems, because this ACS informs every ~12 minutes. Measure the distribution first, then pick the constant, then encode the measurement in a test.
- **Prove the event, don't infer it from a heartbeat.** A periodic inform landing after `rebootAt` does not prove a reboot happened. PPPoE session `uptime` does. And the same evidence is wrong for a customer-initiated restart, where `rebootAt` is when they *told* you, not when they unplugged.
- **Local dialect is not Indonesian.** In this customer base `tak` means *saya* ("Sudah tak bayar" = *I already paid*), not *tidak*. Treating it as negation inverts the meaning of real replies. Same for generic tokens like `sama` — see `lib/affirmative-parser.js` and the corpus tests.
- **Accept the language customers actually use.** Exact-match confirmation lists (`["ya","ok"]`) rejected **83%** of real affirmatives ("Ok mas", "ya ka", "Siap"). Parse with `lib/affirmative-parser.js`; never re-introduce an exact-match list.
- **Durable jobs, not `setTimeout`.** Production restarts 7–13×/day. Anything the bot promised a customer must survive a restart: persist it and rescan from disk on tick (`lib/reboot-followup-store.js`).

## Git, deploy, and drift

- **Trunk is `raf-bot-v3/main`; the local working branch is `main` and tracks it directly.** (The `clean-main` local branch from the v2→v3 transition is gone — ignore stale references to it.)
- **Never `git add -A`.** Parallel agents and worktrees share this checkout; a blanket add once swept an unrelated payment refactor into a reboot-fix commit and pushed it. Stage the files you touched, by name.
- **Production is NOT a git repo.** `/root/bot/raf-dander-v3` and `/root/bot/raf-tanjungharjo-v3` are file copies (`pscp`), so `git status` cannot tell you what is live. Deploy from a git blob (`git cat-file blob HEAD:<path>`) to guarantee LF, `node --check` before `pm2 restart` (PM2 fork keeps running the old code until restart, so a syntax error is still recoverable), and back the target files up first.
- **`config.json` and `database/*.json` are merge-key, never overwrite.** Production customises templates and config; a blanket copy destroys that.
- **Make drift visible:** `scripts/prod-drift-check.js` classifies every runtime file as identical / CRLF-only / behind / **real drift** (content never committed — i.e. a hand-edit on the server that the next deploy will erase) / missing / extra. Run it before and after a deploy. Prod files are CRLF from the original Windows install; the tool normalises before comparing, so ignore that bucket.
