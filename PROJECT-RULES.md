# Project Rules - RAF Bot V2

## 🛠️ Technology Stack
- **Runtime**: Node.js (Express)
- **WhatsApp**: `@whiskeysockets/baileys`
- **Database**: SQLite (managed with specific `database/*.sqlite` files or utils)
- **Frontend**: EJS/HTML/Static (basic web interface)

## 📁 File Structure & Responsibilities
- `lib/` - Core logic independent of WhatsApp (services, utilities, helpers).
- `message/handlers/` - WhatsApp message handlers for specific commands.
- `routes/` - Express route handlers.
- `database/` - SQLite databases and JSON template files.
- `config/` - Configuration files (`config.json`, etc.).
- `static/` - Static assets for web interface.
- `views/` - Web templates.

## 🧱 Coding Standards

### 1. Naming & Language
- **Files**: kebab-case (e.g., `user-service.js`).
- **Classes**: PascalCase (e.g., `UserService`).
- **Functions/Variables**: camelCase (e.g., `processUserPayment`).
- **Constants**: CONSTANT_CASE (e.g., `MAX_RETRY`).
- **Language**: 
    - **Comments & Docs**: Bahasa Indonesia.
    - **Code (Variables/Functions)**: English.

### 2. Async/Await & Error Handling
- Use `async/await` for ALL asynchronous operations.
- WRAP every async operation in `try-catch`.
- Log errors using `console.error` with clear context (English tech terms okay in logs, but descriptive message prefers Indonesian).
- NEVER use `.then()`/`.catch()` mixed with async/await unless absolutely necessary.

### 3. Database Operations (SQLite)
- Separate DB files per domain:
    - `users.sqlite` for user data.
    - `saldo.sqlite` for balance.
- Use parameterized queries (`?`) to prevent SQL Injection.
- Use transactions for balance updates.
- **Rule**: Never update balance with amount <= 0.
- **Rule**: Validate JID format before DB operations.

### 4. WhatsApp Integration (Baileys)
- **Message Sending**:
    - ALWAYS check `global.whatsappConnectionState === 'open'` before sending.
    - Use `whatsapp-notification-wrapper.js` for notifications.
    - Use `skipDuplicateCheck: true` for direct command replies.
- **JID Normalization**:
    - Convert `@lid` to `@s.whatsapp.net` standardized format.
    - Use `normalizeJidForSaldo(jid)` helper.
- **Message Templates**:
    - NEVER hardcode messages.
    - Load templates from JSON files in `database/`:
        - `message_templates.json` (Notifications)
        - `response_templates.json` (Bot replies)
        - `error_templates.json` (Errors)
    - Use `renderTemplate(templateName, data)` helper.

### 5. Frontend Integration
- **User Header**: specifically use `name` from JWT/Session (not `username` or `role`).
- Prefer standard PHP/JS helpers provided in `static/js/user-header-helper.js`.

## 🔒 Security & Performance
- **Credentials**: Never commit keys/passwords. Use `.env` or config files.
- **Validation**: Validate ALL user inputs (JID, amounts, text).
- **Optimization**: Avoid N+1 queries. Use bulk inserts where possible.
- **Logging**: Do not log sensitive data (passwords, tokens).

## 🧪 Testing Guidelines
- Use Jest for unit tests if available.
- Focus on testing business logic in `lib/`.
- Mock external APIs (MikroTik, WhatsApp) in tests.

---
**Note**: This file should serve as the primary technical reference. Consult existing code (`lib/`, `message/handlers/`) for specific implementation patterns.
