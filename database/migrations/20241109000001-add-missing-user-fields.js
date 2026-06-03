/**
 * Migration: Add missing fields to users table
 * Date: 2024-11-09
 * Description: Adds fields that exist in code but missing in production database
 */

module.exports = {
  up: async ({ context: db }) => {
    console.log('📋 Checking users table structure...');
    
    try {
      // Get current table structure
      const tableInfo = await db.all("PRAGMA table_info(users)");
      const existingColumns = tableInfo.map(col => col.name);
      
      console.log('Current columns:', existingColumns.join(', '));
      
      // List of fields to add with their definitions
      // Based on expectedColumns in admin.js and usage in api.js
      const fieldsToAdd = [
        // Basic user info
        { name: 'username', type: 'TEXT', default: "NULL" },
        { name: 'password', type: 'TEXT', default: "NULL" },
        { name: 'status', type: 'TEXT', default: "'active'" },
        
        // Location data
        { name: 'latitude', type: 'TEXT', default: "NULL" },
        { name: 'longitude', type: 'TEXT', default: "NULL" },
        
        // Subscription & billing
        { name: 'subscription', type: 'TEXT', default: "NULL" },
        { name: 'subscription_price', type: 'INTEGER', default: "0" },
        { name: 'payment_due_date', type: 'INTEGER', default: "1" },
        { name: 'paid', type: 'BOOLEAN', default: "0" },
        { name: 'send_invoice', type: 'BOOLEAN', default: "0" }, // CRITICAL - was missing!
        { name: 'is_paid', type: 'BOOLEAN', default: "0" }, // Legacy field
        { name: 'auto_isolir', type: 'BOOLEAN', default: "1" },
        
        // Corporate fields
        { name: 'is_corporate', type: 'BOOLEAN', default: "0" },
        { name: 'corporate_name', type: 'TEXT', default: "NULL" },
        { name: 'corporate_address', type: 'TEXT', default: "NULL" },
        { name: 'corporate_npwp', type: 'TEXT', default: "NULL" },
        { name: 'corporate_pic_name', type: 'TEXT', default: "NULL" },
        { name: 'corporate_pic_phone', type: 'TEXT', default: "NULL" },
        { name: 'corporate_pic_email', type: 'TEXT', default: "NULL" },
        
        // PPPoE & network
        { name: 'pppoe_username', type: 'TEXT', default: "NULL" },
        { name: 'pppoe_password', type: 'TEXT', default: "NULL" },
        { name: 'connected_odp_id', type: 'TEXT', default: "NULL" },
        { name: 'bulk', type: 'TEXT', default: "NULL" }, // JSON string for bulk SSIDs
        
        // Infrastructure
        { name: 'odc', type: 'TEXT', default: "NULL" },
        { name: 'odp', type: 'TEXT', default: "NULL" },
        { name: 'olt', type: 'TEXT', default: "NULL" },
        { name: 'maps_url', type: 'TEXT', default: "NULL" },
        
        // OTP fields
        { name: 'otp', type: 'TEXT', default: "NULL" },
        { name: 'otpTimestamp', type: 'INTEGER', default: "NULL" },
        
        // Timestamps
        { name: 'registration_date', type: 'DATETIME', default: "NULL" },
        { name: 'created_at', type: 'DATETIME', default: "NULL" },
        { name: 'updated_at', type: 'DATETIME', default: "NULL" },
        { name: 'last_login', type: 'DATETIME', default: "NULL" },
        { name: 'last_payment_date', type: 'DATETIME', default: "NULL" },
        
        // Notifications & flags
        { name: 'reminder_sent', type: 'BOOLEAN', default: "0" },
        { name: 'isolir_sent', type: 'BOOLEAN', default: "0" },
        
        // Additional fields
        { name: 'compensation_minutes', type: 'INTEGER', default: "0" },
        { name: 'email', type: 'TEXT', default: "NULL" },
        { name: 'alternative_phone', type: 'TEXT', default: "NULL" },
        { name: 'notes', type: 'TEXT', default: "NULL" }
      ];
      
      // Add missing columns
      let addedCount = 0;
      const timestampFields = ['registration_date', 'created_at', 'updated_at'];
      
      for (const field of fieldsToAdd) {
        if (!existingColumns.includes(field.name)) {
          const sql = `ALTER TABLE users ADD COLUMN ${field.name} ${field.type} DEFAULT ${field.default}`;
          console.log(`Adding column: ${field.name}...`);
          await db.run(sql);
          addedCount++;
          
          // Set current timestamp for datetime fields that need it
          if (timestampFields.includes(field.name)) {
            const updateSql = `UPDATE users SET ${field.name} = datetime('now') WHERE ${field.name} IS NULL`;
            await db.run(updateSql);
            console.log(`   ✓ Set default timestamp for ${field.name}`);
          }
        } else {
          console.log(`Column ${field.name} already exists, skipping...`);
        }
      }
      
      if (addedCount > 0) {
        console.log(`✅ Successfully added ${addedCount} new columns to users table`);
      } else {
        console.log('✅ All columns already exist, no changes needed');
      }
      
      // Create indexes for better performance
      console.log('📋 Creating indexes...');
      
      // Index for phone number lookup
      try {
        await db.run('CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number)');
        console.log('✅ Created index on phone_number');
      } catch (e) {
        console.log('Index on phone_number already exists or failed:', e.message);
      }
      
      // Index for device_id lookup
      try {
        await db.run('CREATE INDEX IF NOT EXISTS idx_users_device ON users(device_id)');
        console.log('✅ Created index on device_id');
      } catch (e) {
        console.log('Index on device_id already exists or failed:', e.message);
      }
      
      // Index for status filtering
      try {
        await db.run('CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)');
        console.log('✅ Created index on status');
      } catch (e) {
        console.log('Index on status already exists or failed:', e.message);
      }
      
      // Index for payment queries
      try {
        await db.run('CREATE INDEX IF NOT EXISTS idx_users_payment ON users(is_paid, payment_due_date)');
        console.log('✅ Created composite index on is_paid, payment_due_date');
      } catch (e) {
        console.log('Index on payment fields already exists or failed:', e.message);
      }
      
      console.log('✅ Migration completed successfully');
      
    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  },
  
  down: async ({ context: db }) => {
    // Down migration - usually we don't remove columns for data safety
    console.log('⚠️ Rollback not implemented - removing columns is destructive and not recommended');
    console.log('If you really need to rollback, manually DROP the columns or restore from backup');
  }
};
