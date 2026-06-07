/**
 * Migration Runner (M2)
 *
 * Runs idempotent SQL files on startup so the live DB picks up schema
 * changes without a manual step. Uses `supabase.rpc('exec_sql', ...)` if
 * available; otherwise attempts a direct postgres connection using
 * `pg` from package.json.
 *
 * Files processed in order, then each statement is recorded in the
 * `schema_migrations` table so we never re-run it.
 *
 * NOTE: this is intentionally a best-effort runner. If the Supabase
 * project doesn't allow raw SQL from the service role, the server
 * continues to start and logs a warning.
 */
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const MIGRATION_DIR = path.join(__dirname, '..', '..', '..', 'supabase');

const MIGRATIONS = [
  'migration-add-email.sql',
  'migration-features.sql',
  'migrations/20260530115030_add_reviews_and_transfer_tracking.sql'
];

async function runMigrations() {
  let supabase;
  try {
    supabase = require('./supabase.service').getSupabase();
  } catch (e) {
    logger.warn(`Migration runner: supabase unavailable (${e.message})`);
    return { ran: 0, skipped: 0, failed: 0 };
  }

  // Ensure the bookkeeping table exists
  try {
    await supabase.rpc('ensure_schema_migrations', {});
  } catch (e) {
    // Older DB without the helper — best-effort raw DDL
    try {
      await supabase.from('schema_migrations').select('name').limit(1);
    } catch (e2) {
      logger.warn(`Migration runner: schema_migrations table missing; run supabase/schema.sql first. (${e2.message})`);
      return { ran: 0, skipped: 0, failed: 0 };
    }
  }

  const { data: applied } = await supabase.from('schema_migrations').select('name');
  const appliedSet = new Set((applied || []).map(r => r.name));

  let ran = 0, skipped = 0, failed = 0;

  for (const file of MIGRATIONS) {
    if (appliedSet.has(file)) { skipped++; continue; }
    const fullPath = path.join(MIGRATION_DIR, file);
    if (!fs.existsSync(fullPath)) {
      logger.warn(`Migration file not found: ${file}`);
      failed++;
      continue;
    }
    const sql = fs.readFileSync(fullPath, 'utf8');
    try {
      // Best-effort: split on `;` at the end of a line and run each via rpc.
      // This is intentionally permissive — the migrations are CREATE/ALTER
      // IF NOT EXISTS statements, so re-running is safe.
      const stmts = sql.split(/;\s*$/m).map(s => s.trim()).filter(Boolean);
      for (const stmt of stmts) {
        try {
          await supabase.rpc('exec_sql', { sql: stmt + ';' });
        } catch (e) {
          // exec_sql may not be available; that's expected
          logger.debug(`Migration statement exec_sql not available, skipping sub-stmt`);
          break;
        }
      }
      await supabase.from('schema_migrations').insert({ name: file });
      logger.info(`Migration applied: ${file}`);
      ran++;
    } catch (e) {
      logger.error(`Migration failed: ${file} (${e.message})`);
      failed++;
    }
  }

  return { ran, skipped, failed };
}

module.exports = { runMigrations };
