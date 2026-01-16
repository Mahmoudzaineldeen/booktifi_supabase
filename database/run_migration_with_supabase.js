#!/usr/bin/env node

/**
 * Database Schema Replacement Script for Supabase
 * 
 * This script uses Supabase credentials to run the schema replacement
 * 
 * Usage:
 *   node database/run_migration_with_supabase.js
 * 
 * Or set environment variables:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node database/run_migration_with_supabase.js
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Supabase credentials
const supabaseUrl = process.env.SUPABASE_URL || 'https://pivmdulophbdciygvegx.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpdm1kdWxvcGhiZGNpeWd2ZWd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODUxMDgzMiwiZXhwIjoyMDg0MDg2ODMyfQ.HHoaJESYPmbbfA_g95WxcBkSzPzL9RG7Jp7CyNlmoZY';

// Extract project reference from URL
const projectRef = supabaseUrl.match(/https?:\/\/([^.]+)\.supabase\.co/)?.[1];

if (!projectRef) {
  console.error('❌ Error: Could not extract project reference from Supabase URL');
  process.exit(1);
}

// Construct database connection string
// Note: You'll need to get the database password from Supabase Dashboard
// Settings → Database → Connection string → Show connection string
const dbPassword = process.env.SUPABASE_DB_PASSWORD;
const databaseUrl = process.env.DATABASE_URL || 
  (dbPassword ? `postgresql://postgres.${projectRef}:${dbPassword}@aws-0-us-east-1.pooler.supabase.com:6543/postgres` : null);

if (!databaseUrl && !dbPassword) {
  console.error('❌ Error: Database connection string not found');
  console.error('');
  console.error('You need to provide the database password to connect directly.');
  console.error('');
  console.error('Option 1: Set SUPABASE_DB_PASSWORD environment variable');
  console.error('  export SUPABASE_DB_PASSWORD="your-database-password"');
  console.error('  node database/run_migration_with_supabase.js');
  console.error('');
  console.error('Option 2: Set DATABASE_URL directly');
  console.error('  export DATABASE_URL="postgresql://postgres.[ref]:[password]@aws-0-us-east-1.pooler.supabase.com:6543/postgres"');
  console.error('  node database/run_migration_with_supabase.js');
  console.error('');
  console.error('To get your database password:');
  console.error('  1. Go to Supabase Dashboard → Settings → Database');
  console.error('  2. Find "Connection string" section');
  console.error('  3. Copy the password from the connection string');
  console.error('');
  console.error('Alternatively, use the Supabase SQL Editor:');
  console.error('  1. Go to Supabase Dashboard → SQL Editor');
  console.error('  2. Copy the contents of database/apply_new_schema.sql');
  console.error('  3. Paste and run it directly');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  // Increase timeout for large operations
  statement_timeout: 0,
  query_timeout: 0,
  ssl: {
    rejectUnauthorized: false // Supabase requires SSL
  }
});

async function runSchemaReplacement() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Starting database schema replacement...\n');
    console.log('⚠️  WARNING: This will DELETE ALL DATA in your database!\n');
    console.log(`📡 Connecting to: ${supabaseUrl}\n`);
    
    // Read the SQL file
    const sqlPath = join(__dirname, 'apply_new_schema.sql');
    console.log(`📖 Reading SQL file: ${sqlPath}`);
    const sql = readFileSync(sqlPath, 'utf8');
    
    // Remove the \restrict command if present (not valid in direct SQL execution)
    let cleanedSql = sql.replace(/\\restrict[^\n]*\n/g, '');
    
    // Fix schema creation to use IF NOT EXISTS
    cleanedSql = cleanedSql.replace(/CREATE SCHEMA auth;/g, 'CREATE SCHEMA IF NOT EXISTS auth;');
    
    // Remove \unrestrict command if present
    cleanedSql = cleanedSql.replace(/\\unrestrict[^\n]*\n/g, '');
    
    console.log('🚀 Executing schema replacement...\n');
    console.log('   This may take several minutes depending on database size...\n');
    
    const startTime = Date.now();
    
    // Execute the SQL
    await client.query(cleanedSql);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`\n✅ Schema replacement completed successfully! (took ${duration}s)\n`);
    
    // Verify the schema was created
    console.log('🔍 Verifying schema...\n');
    
    const tablesResult = await client.query(`
      SELECT COUNT(*) as count
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
    `);
    
    const functionsResult = await client.query(`
      SELECT COUNT(*) as count
      FROM information_schema.routines 
      WHERE routine_schema = 'public'
      AND routine_type = 'FUNCTION'
    `);
    
    const indexesResult = await client.query(`
      SELECT COUNT(*) as count
      FROM pg_indexes 
      WHERE schemaname = 'public'
    `);
    
    console.log(`   ✅ Tables created: ${tablesResult.rows[0].count}`);
    console.log(`   ✅ Functions created: ${functionsResult.rows[0].count}`);
    console.log(`   ✅ Indexes created: ${indexesResult.rows[0].count}\n`);
    
    console.log('🎉 Database schema replacement is complete!');
    console.log('\n📝 Next steps:');
    console.log('   1. Create initial data (tenants, users, etc.)');
    console.log('   2. Test your application');
    console.log('   3. Verify all endpoints are working\n');
    
  } catch (error) {
    console.error('\n❌ Error during schema replacement:');
    console.error(error.message);
    
    if (error.code) {
      console.error(`\n   Error code: ${error.code}`);
    }
    
    if (error.position) {
      console.error(`\n   Error position: ${error.position}`);
    }
    
    console.error('\n💡 Troubleshooting:');
    console.error('   1. Check your database password is correct');
    console.error('   2. Ensure you have sufficient database permissions');
    console.error('   3. Check if the database is accessible');
    console.error('   4. Try using Supabase SQL Editor instead (no password needed)');
    console.error('   5. Review the error message above\n');
    
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the migration
runSchemaReplacement().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
