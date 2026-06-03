# Tech Stack & Build System

## Runtime
- Node.js (ES modules via dynamic import for Baileys)
- Express.js web framework
- PHP views for admin panel (via php-express)

## Database
- SQLite3 for structured data (users.sqlite, saldo.sqlite, activity_logs.sqlite, psb_database.sqlite)
- JSON files for configuration and simple collections (database/*.json)
- File locking via proper-lockfile for concurrent JSON access

## Key Dependencies
- `@whiskeysockets/baileys` - WhatsApp Web API
- `express` + `helmet` + `express-rate-limit` - Web server with security
- `sqlite3` - Database
- `jsonwebtoken` - JWT authentication
- `node-cron` - Scheduled tasks
- `puppeteer` - PDF generation
- `socket.io` - Real-time updates

## Commands

```bash
# Development (with nodemon auto-reload)
npm run dev

# Production
npm run start:prod

# Run tests
npm test

# Database migration (auto-runs on startup)
node scripts/auto-migrate-on-startup.js

# Database backup
node scripts/backup-database.js
```

## Testing
- Jest with babel-jest for ES module support
- Test databases: *_test.sqlite files
- Run with: `npm test`

## Environment
- Configuration via `.env` file (see `.env.example`)
- Fallback to `config.json` for legacy settings
- Database files in `database/` folder
- Backups in `backups/` folder

## Security
- Helmet.js for HTTP headers
- Rate limiting on API and auth endpoints
- JWT for authentication (admin and customer tokens)
- bcrypt for password hashing
