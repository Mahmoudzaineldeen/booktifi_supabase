#!/usr/bin/env node

/**
 * Database Schema Replacement Script
 * 
 * This script drops all existing database objects and recreates them
 * with the new schema from apply_new_schema.sql
 * 
 * Usage:
 *   DATABASE_URL="postgresql://user:pass@host:port/db" node database/run_schema_replacement.js
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get database URL from environment
const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

if (!databaseUrl) {
  console.error('❌ Error: DATABASE_URL environment variable is not set');
  console.error('');
  console.error('Please set it before running this script:');
  console.error('  export DATABASE_URL="postgresql://user:password@host:port/database"');
  console.error('  node database/run_schema_replacement.js');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  // Increase timeout for large operations
  statement_timeout: 0,
  query_timeout: 0,
});

async function runSchemaReplacement() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Starting database schema replacement...\n');
    console.log('⚠️  WARNING: This will DELETE ALL DATA in your database!\n');
    
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
    console.error('   1. Check your DATABASE_URL is correct');
    console.error('   2. Ensure you have sufficient database permissions');
    console.error('   3. Check if the database is accessible');
    console.error('   4. Review the error message above\n');
    
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
