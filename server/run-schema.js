const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: 'postgresql://postgres:ayanshaikh1234@db.bvmhjennzemiqafekfgm.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function runSchema() {
  console.log('Connecting to Supabase database...');
  
  try {
    const client = await pool.connect();
    console.log('✅ Connected to Supabase!');

    const sql = fs.readFileSync(
      path.join(__dirname, '../supabase/schema.sql'),
      'utf8'
    );

    console.log('Running SQL schema...');
    await client.query(sql);
    console.log('✅ Schema applied successfully!');

    // Verify tables
    const { rows } = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    console.log('\n📋 Tables created:');
    rows.forEach(r => console.log(`  ✅ ${r.table_name}`));

    client.release();
    await pool.end();
    console.log('\n🎉 Database setup complete!');
  } catch (err) {
    console.error('❌ Error:', err.message);
    await pool.end();
    process.exit(1);
  }
}

runSchema();
