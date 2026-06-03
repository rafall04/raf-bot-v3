# Project Structure

```
raf-bot-v2/
├── index.js              # Main entry point, Express setup, WhatsApp connection
├── config.json           # Legacy configuration (prefer .env)
├── package.json          # Dependencies and scripts
│
├── lib/                  # Core libraries and utilities
│   ├── database.js       # SQLite + JSON data access
│   ├── auth.js           # JWT authentication middleware
│   ├── mikrotik.js       # MikroTik RouterOS API client
│   ├── saldo-manager.js  # Balance/credit management
│   ├── cron.js           # Scheduled tasks (billing reminders, etc.)
│   ├── invoice-generator.js
│   ├── pdf-invoice-generator.js
│   ├── monitoring-service.js
│   ├── error-recovery.js
│   └── ...               # Many specialized helpers
│
├── routes/               # Express route handlers
│   ├── api.js            # General API endpoints
│   ├── users.js          # Customer CRUD
│   ├── admin.js          # Admin panel APIs
│   ├── agents.js         # Agent/reseller management
│   ├── saldo.js          # Balance operations
│   ├── tickets.js        # Support ticket system
│   └── ...
│
├── message/              # WhatsApp message handling
│   ├── raf.js            # Main message router
│   └── handlers/         # Command-specific handlers
│       ├── customer-handler.js
│       ├── admin-handler.js
│       ├── payment-handler.js
│       ├── ticket-creation-handler.js
│       └── ...
│
├── database/             # Data storage
│   ├── *.sqlite          # SQLite databases
│   ├── *.json            # JSON data files
│   └── migrations/       # Database migration scripts
│
├── views/                # PHP views for admin panel
│   ├── *.php             # MikroTik monitoring, user management
│   └── sb-admin/         # Admin dashboard template
│
├── static/               # Frontend assets (CSS, JS, images)
├── scripts/              # Utility and maintenance scripts
├── config/               # Additional configuration files
├── sessions/             # WhatsApp session storage
├── uploads/              # User-uploaded files
├── backups/              # Database backups
└── logs/                 # Application logs
```

## Key Patterns

### Global State
Application uses `global.*` for shared state:
- `global.users` - Customer data (loaded from SQLite)
- `global.accounts` - Admin accounts (from JSON)
- `global.packages` - Subscription packages
- `global.config` - Application configuration
- `global.conn` / `global.raf` - WhatsApp connection

### Data Access
- SQLite: Use `lib/database.js` functions or direct sqlite3
- JSON: Use `loadJSON()` / `saveJSON()` from database.js
- Always handle file locking for concurrent JSON writes

### Authentication
- Admin: JWT token in cookie or Authorization header, verified against `global.accounts`
- Customer: JWT token verified against `global.users`
- Middleware sets `req.user` (admin) or `req.customer` (customer)

### WhatsApp Messages
- Entry point: `message/raf.js`
- Handlers in `message/handlers/` for specific commands
- State management for multi-step conversations
