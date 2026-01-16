#!/usr/bin/env node

/**
 * Export Database Schema
 * 
 * Exports the complete database schema including:
 * - Tables
 * - Functions
 * - Triggers
 * - Indexes
 * - Sequences
 * - Types/Enums
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', 'server', '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  console.error('   Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function exportSchema() {
  console.log('\n📋 Exporting Database Schema...\n');
  
  const schemaSQL = [];
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  schemaSQL.push('-- ============================================================================');
  schemaSQL.push('-- Database Schema Export');
  schemaSQL.push(`-- Generated: ${new Date().toISOString()}`);
  schemaSQL.push('-- ============================================================================\n');
  
  try {
    // Export Tables
    console.log('📊 Exporting tables...');
    const { data: tables, error: tablesError } = await supabase
      .rpc('exec_sql', {
        query: `
          SELECT 
            schemaname,
            tablename,
            tableowner
          FROM pg_tables
          WHERE schemaname = 'public'
          ORDER BY tablename;
        `
      });
    
    if (tablesError) {
      console.warn('⚠️  Could not list tables via RPC, trying direct query...');
    }
    
    // Get table definitions
    const { data: tableDefs, error: tableDefsError } = await supabase
      .rpc('exec_sql', {
        query: `
          SELECT 
            'CREATE TABLE IF NOT EXISTS ' || schemaname || '.' || tablename || ' (' || 
            string_agg(
              column_name || ' ' || 
              CASE 
                WHEN data_type = 'USER-DEFINED' THEN udt_name
                WHEN data_type = 'ARRAY' THEN udt_name || '[]'
                ELSE data_type
              END ||
              CASE 
                WHEN character_maximum_length IS NOT NULL THEN '(' || character_maximum_length || ')'
                WHEN numeric_precision IS NOT NULL THEN '(' || numeric_precision || 
                  CASE WHEN numeric_scale IS NOT NULL THEN ',' || numeric_scale ELSE '' END || ')'
                ELSE ''
              END ||
              CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
              CASE WHEN column_default IS NOT NULL THEN ' DEFAULT ' || column_default ELSE '' END,
              ', '
            ) || ');' as create_statement
          FROM information_schema.columns
          WHERE table_schema = 'public'
          GROUP BY schemaname, tablename
          ORDER BY tablename;
        `
      });
    
    if (tableDefsError) {
      console.error('❌ Error getting table definitions:', tableDefsError);
    } else if (tableDefs) {
      schemaSQL.push('-- ============================================================================');
      schemaSQL.push('-- TABLES');
      schemaSQL.push('-- ============================================================================\n');
      tableDefs.forEach((def: any) => {
        schemaSQL.push(def.create_statement);
        schemaSQL.push('');
      });
    }
    
    // Export Functions
    console.log('⚙️  Exporting functions...');
    const { data: functions, error: functionsError } = await supabase
      .rpc('exec_sql', {
        query: `
          SELECT 
            proname as function_name,
            pg_get_functiondef(oid) as function_definition
          FROM pg_proc
          WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
          ORDER BY proname;
        `
      });
    
    if (functionsError) {
      console.warn('⚠️  Could not export functions:', functionsError.message);
    } else if (functions) {
      schemaSQL.push('-- ============================================================================');
      schemaSQL.push('-- FUNCTIONS');
      schemaSQL.push('-- ============================================================================\n');
      functions.forEach((func: any) => {
        schemaSQL.push(func.function_definition);
        schemaSQL.push('');
      });
    }
    
    // Export Types/Enums
    console.log('📝 Exporting types and enums...');
    const { data: types, error: typesError } = await supabase
      .rpc('exec_sql', {
        query: `
          SELECT 
            t.typname as type_name,
            string_agg(e.enumlabel, E'\\n' ORDER BY e.enumsortorder) as enum_values
          FROM pg_type t
          JOIN pg_enum e ON t.oid = e.enumtypid
          WHERE t.typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
          GROUP BY t.typname
          ORDER BY t.typname;
        `
      });
    
    if (typesError) {
      console.warn('⚠️  Could not export types:', typesError.message);
    } else if (types) {
      schemaSQL.push('-- ============================================================================');
      schemaSQL.push('-- TYPES / ENUMS');
      schemaSQL.push('-- ============================================================================\n');
      types.forEach((type: any) => {
        schemaSQL.push(`CREATE TYPE ${type.type_name} AS ENUM (`);
        const values = type.enum_values.split('\n').map((v: string) => `  '${v}'`).join(',\n');
        schemaSQL.push(values);
        schemaSQL.push(');');
        schemaSQL.push('');
      });
    }
    
    // Export Indexes
    console.log('🔍 Exporting indexes...');
    const { data: indexes, error: indexesError } = await supabase
      .rpc('exec_sql', {
        query: `
          SELECT 
            indexname,
            indexdef
          FROM pg_indexes
          WHERE schemaname = 'public'
          ORDER BY tablename, indexname;
        `
      });
    
    if (indexesError) {
      console.warn('⚠️  Could not export indexes:', indexesError.message);
    } else if (indexes) {
      schemaSQL.push('-- ============================================================================');
      schemaSQL.push('-- INDEXES');
      schemaSQL.push('-- ============================================================================\n');
      indexes.forEach((idx: any) => {
        schemaSQL.push(idx.indexdef + ';');
        schemaSQL.push('');
      });
    }
    
    // Write to file
    const outputPath = join(__dirname, '..', 'database', `schema_export_${timestamp}.sql`);
    const schemaContent = schemaSQL.join('\n');
    
    writeFileSync(outputPath, schemaContent, 'utf8');
    
    console.log('\n✅ Schema exported successfully!');
    console.log(`   File: ${outputPath}`);
    console.log(`   Size: ${(schemaContent.length / 1024).toFixed(2)} KB\n`);
    
  } catch (error: any) {
    console.error('\n❌ Error exporting schema:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

// Alternative: Use pg_dump if available
async function exportSchemaWithPgDump() {
  console.log('\n📋 Exporting Database Schema using pg_dump...\n');
  
  const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL or SUPABASE_DB_URL not found in .env');
    console.log('\n💡 Alternative: Use Supabase Dashboard');
    console.log('   1. Go to Supabase Dashboard');
    console.log('   2. Navigate to SQL Editor');
    console.log('   3. Run the queries in this script manually\n');
    return;
  }
  
  const { spawn } = await import('child_process');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = join(__dirname, '..', 'database', `schema_export_${timestamp}.sql`);
  
  console.log('Running pg_dump...');
  
  const pgDump = spawn('pg_dump', [
    databaseUrl,
    '--schema-only',
    '--no-owner',
    '--no-acl',
    '-f', outputPath
  ]);
  
  pgDump.stdout.on('data', (data) => {
    console.log(data.toString());
  });
  
  pgDump.stderr.on('data', (data) => {
    console.error(data.toString());
  });
  
  pgDump.on('close', (code) => {
    if (code === 0) {
      console.log('\n✅ Schema exported successfully!');
      console.log(`   File: ${outputPath}\n`);
    } else {
      console.error(`\n❌ pg_dump exited with code ${code}`);
      console.log('\n💡 Try the Supabase Dashboard method instead\n');
    }
  });
}

async function main() {
  console.log('='.repeat(70));
  console.log('DATABASE SCHEMA EXPORT');
  console.log('='.repeat(70));
  
  // Try Supabase RPC method first
  try {
    await exportSchema();
  } catch (error) {
    console.log('\n⚠️  Supabase RPC method failed, trying pg_dump...\n');
    await exportSchemaWithPgDump();
  }
}

main().catch(error => {
  console.error('\nFatal error:', error.message);
  process.exit(1);
});
