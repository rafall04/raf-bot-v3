/**
 * Migration: Add kasbon, partial payment, and discount features
 * Date: 2026-01-13
 * Description: 
 * - Adds technician_kasbon table for kasbon teknisi
 * - Adds discount fields to users table
 * - Adds partial payment fields to requests
 */

module.exports = {
  up: async ({ context: db }) => {
    console.log('📋 Adding kasbon, partial payment, and discount features...');
    
    try {
      // 1. Create technician_kasbon table
      console.log('Creating technician_kasbon table...');
      await db.run(`
        CREATE TABLE IF NOT EXISTS technician_kasbon (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          teknisi_id INTEGER NOT NULL,
          teknisi_name TEXT,
          amount INTEGER NOT NULL CHECK(amount > 0),
          description TEXT,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'paid')),
          approved_by INTEGER,
          approved_by_name TEXT,
          approved_at TEXT,
          paid_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          notes TEXT
        )
      `);
      console.log('✅ Created technician_kasbon table');
      
      // Create index for kasbon
      await db.run('CREATE INDEX IF NOT EXISTS idx_kasbon_teknisi ON technician_kasbon(teknisi_id)');
      await db.run('CREATE INDEX IF NOT EXISTS idx_kasbon_status ON technician_kasbon(status)');
      console.log('✅ Created indexes for technician_kasbon');
      
      // 2. Add discount fields to users table
      console.log('Adding discount fields to users table...');
      const tableInfo = await db.all("PRAGMA table_info(users)");
      const existingColumns = tableInfo.map(col => col.name);
      
      const discountFields = [
        { name: 'discount_amount', type: 'INTEGER', default: '0' },
        { name: 'discount_percentage', type: 'INTEGER', default: '0' },
        { name: 'discount_reason', type: 'TEXT', default: 'NULL' },
        { name: 'discount_valid_until', type: 'TEXT', default: 'NULL' },
        { name: 'discount_months', type: 'INTEGER', default: '0' },
        { name: 'discount_months_used', type: 'INTEGER', default: '0' },
        { name: 'discount_created_by', type: 'TEXT', default: 'NULL' },
        { name: 'discount_created_at', type: 'TEXT', default: 'NULL' }
      ];
      
      for (const field of discountFields) {
        if (!existingColumns.includes(field.name)) {
          await db.run(`ALTER TABLE users ADD COLUMN ${field.name} ${field.type} DEFAULT ${field.default}`);
          console.log(`✅ Added column: ${field.name}`);
        } else {
          console.log(`Column ${field.name} already exists, skipping...`);
        }
      }
      
      // 3. Create payment_history table for partial payments
      console.log('Creating payment_history table for partial payments...');
      await db.run(`
        CREATE TABLE IF NOT EXISTS payment_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          user_name TEXT,
          request_id INTEGER,
          amount_due INTEGER NOT NULL,
          amount_paid INTEGER NOT NULL,
          amount_remaining INTEGER NOT NULL DEFAULT 0,
          payment_method TEXT DEFAULT 'CASH' CHECK(payment_method IN ('CASH', 'TRANSFER_BANK')),
          is_partial INTEGER DEFAULT 0,
          teknisi_id INTEGER,
          teknisi_name TEXT,
          approved_by INTEGER,
          approved_by_name TEXT,
          period_month INTEGER,
          period_year INTEGER,
          notes TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      console.log('✅ Created payment_history table');
      
      const paymentHistoryInfo = await db.all("PRAGMA table_info(payment_history)");
      const paymentHistoryColumns = paymentHistoryInfo.map(col => col.name);
      if (!paymentHistoryColumns.includes('created_by')) {
        await db.run("ALTER TABLE payment_history ADD COLUMN created_by TEXT");
        console.log('âœ… Added column: payment_history.created_by');
      } else {
        console.log('Column payment_history.created_by already exists, skipping...');
      }

      // Create indexes for payment_history
      await db.run('CREATE INDEX IF NOT EXISTS idx_payment_history_user ON payment_history(user_id)');
      await db.run('CREATE INDEX IF NOT EXISTS idx_payment_history_period ON payment_history(period_month, period_year)');
      await db.run('CREATE INDEX IF NOT EXISTS idx_payment_history_teknisi ON payment_history(teknisi_id)');
      console.log('✅ Created indexes for payment_history');
      
      console.log('✅ Migration completed successfully');
      
    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  },
  
  down: async ({ context: db }) => {
    console.log('⚠️ Rolling back kasbon, partial payment, and discount features...');
    
    try {
      // Drop tables (columns cannot be easily dropped in SQLite)
      await db.run('DROP TABLE IF EXISTS technician_kasbon');
      await db.run('DROP TABLE IF EXISTS payment_history');
      console.log('✅ Dropped tables');
    } catch (error) {
      console.error('❌ Rollback failed:', error);
      throw error;
    }
  }
};
