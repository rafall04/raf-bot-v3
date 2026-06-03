# RAF Bot V2

WhatsApp Bot dengan Admin Panel untuk manajemen pelanggan, billing, dan support.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env dengan konfigurasi Anda

# Start aplikasi
npm start
```

## 📁 Project Structure

```
raf-bot-v2/
├── lib/              # Core libraries & utilities
├── routes/           # Express routes
├── message/          # WhatsApp message handlers
├── database/         # Database files (SQLite + JSON)
├── views/            # PHP views (Admin panel)
├── static/           # Static assets
├── scripts/          # Utility scripts
└── config/           # Configuration files
```

## 🔒 Database Management

### Auto Migration

Database otomatis di-migrate saat aplikasi start. Tidak perlu manual migration.

### Manual Migration

```bash
node scripts/auto-migrate-on-startup.js
```

### Backup

Backup otomatis dibuat sebelum setiap migration di folder `backups/`.

## 📝 Environment Variables

Copy `.env.example` ke `.env` dan sesuaikan:

```env
NODE_ENV=production
PORT=3100
JWT_SECRET=your-secret-key
# ... lainnya
```

## 🔧 Development

```bash
# Development mode
npm run dev

# Production mode
npm start:prod
```

## 📚 Documentation

- [Deployment Guide](./DEPLOYMENT_GUIDE.md) - Database migration & deployment
- [API Documentation](./docs/API.md) - API endpoints (coming soon)

## ⚠️ Important Notes

- **Database files tidak di-commit ke GitHub** (sudah di `.gitignore`)
- **Auto-migration** berjalan saat startup
- **Backup otomatis** dibuat sebelum migration
- **Environment-specific** databases (production vs test)

## 🛠️ Troubleshooting

### Migration Issues

1. Check backup di `backups/`
2. Restore jika perlu
3. Check migration logs

### Database Not Found

Database akan dibuat otomatis saat pertama kali digunakan.

## 📄 License

MIT

