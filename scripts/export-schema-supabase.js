#!/usr/bin/env node

/**
 * Export Database Schema from Supabase
 * 
 * Uses Supabase SQL Editor approach - provides SQL queries
 * that you can run in Supabase Dashboard to export schema
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
  console.log('\n📋 Exporting Database Schema from Supabase...\n');
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = join(__dirname, '..', 'database', `complete_schema_${timestamp}.sql`);
  
  const schemaSQL = [];
  
  schemaSQL.push('-- ============================================================================');
  schemaSQL.push('-- Complete Database Schema Export');
  schemaSQL.push(`-- Generated: ${new Date().toISOString()}`);
  schemaSQL.push('-- Source: Supabase PostgreSQL Database');
  schemaSQL.push('-- ============================================================================\n');
  
  try {
    // Method 1: Use pg_dump via Supabase connection string
    console.log('📊 Method 1: Using pg_dump (recommended)...');
    console.log('   This requires DATABASE_URL in .env file\n');
    
    const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
    
    if (databaseUrl) {
      const { spawn } = await import('child_process');
      
      return new Promise((resolve, reject) => {
        const pgDump = spawn('pg_dump', [
          databaseUrl,
          '--schema-only',
          '--no-owner',
          '--no-acl',
          '--clean',
          '--if-exists'
        ], {
          shell: true
        });
        
        let output = '';
        
        pgDump.stdout.on('data', (data) => {
          output += data.toString();
        });
        
        pgDump.stderr.on('data', (data) => {
          const error = data.toString();
          if (!error.includes('WARNING')) {
            console.error('pg_dump error:', error);
          }
        });
        
        pgDump.on('close', (code) => {
          if (code === 0) {
            writeFileSync(outputPath, output, 'utf8');
            console.log('✅ Schema exported successfully!');
            console.log(`   File: ${outputPath}`);
            console.log(`   Size: ${(output.length / 1024).toFixed(2)} KB\n`);
            resolve(true);
          } else {
            console.log(`⚠️  pg_dump exited with code ${code}`);
            console.log('   Trying alternative method...\n');
            resolve(false);
          }
        });
      });
    } else {
      console.log('⚠️  DATABASE_URL not found, using alternative method...\n');
    }
    
    // Method 2: Manual SQL queries (for Supabase Dashboard)
    console.log('📊 Method 2: Generating SQL queries for Supabase Dashboard...\n');
    
    const queries = [];
    
    queries.push('-- ============================================================================');
    queries.push('-- EXPORT ALL TABLES');
    queries.push('-- ============================================================================');
    queries.push(`
SELECT 
  'CREATE TABLE IF NOT EXISTS ' || schemaname || '.' || tablename || ' (' || 
  string_agg(
    column_name || ' ' || 
    CASE 
      WHEN data_type = 'USER-DEFINED' THEN udt_name
      WHEN data_type = 'ARRAY' THEN udt_name || '[]'
      ELSE UPPER(data_type)
    END ||
    CASE 
      WHEN character_maximum_length IS NOT NULL THEN '(' || character_maximum_length || ')'
      WHEN numeric_precision IS NOT NULL THEN '(' || numeric_precision || 
        CASE WHEN numeric_scale IS NOT NULL THEN ',' || numeric_scale ELSE '' END || ')'
      ELSE ''
    END ||
    CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
    CASE WHEN column_default IS NOT NULL THEN ' DEFAULT ' || column_default ELSE '' END,
    E',\\n  '
  ) || E'\\n);' as create_statement
FROM information_schema.columns
WHERE table_schema = 'public'
GROUP BY schemaname, tablename
ORDER BY tablename;
    `);
    
    queries.push('\n-- ============================================================================');
    queries.push('-- EXPORT ALL FUNCTIONS');
    queries.push('-- ============================================================================');
    queries.push(`
SELECT 
  proname as function_name,
  pg_get_functiondef(oid) as function_definition
FROM pg_proc
WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
ORDER BY proname;
    `);
    
    queries.push('\n-- ============================================================================');
    queries.push('-- EXPORT ALL TYPES/ENUMS');
    queries.push('-- ============================================================================');
    queries.push(`
SELECT 
  'CREATE TYPE ' || t.typname || ' AS ENUM (' || 
  string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder) || 
  ');' as create_type
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
WHERE t.typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
GROUP BY t.typname
ORDER BY t.typname;
    `);
    
    queries.push('\n-- ============================================================================');
    queries.push('-- EXPORT ALL INDEXES');
    queries.push('-- ============================================================================');
    queries.push(`
SELECT indexdef || ';' as create_index
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
    `);
    
    queries.push('\n-- ============================================================================');
    queries.push('-- EXPORT ALL TRIGGERS');
    queries.push('-- ============================================================================');
    queries.push(`
SELECT 
  'CREATE TRIGGER ' || trigger_name || 
  ' ' || action_timing || ' ' || event_manipulation ||
  ' ON ' || event_object_table ||
  ' FOR EACH ' || action_statement_condition ||
  ' EXECUTE FUNCTION ' || action_statement || ';' as create_trigger
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;
    `);
    
    const queriesPath = join(__dirname, '..', 'database', `schema_export_queries_${timestamp}.sql`);
    writeFileSync(queriesPath, queries.join('\n'), 'utf8');
    
    console.log('✅ SQL queries generated!');
    console.log(`   File: ${queriesPath}`);
    console.log('\n📝 Instructions:');
    console.log('   1. Open Supabase Dashboard → SQL Editor');
    console.log('   2. Copy and run each query section');
    console.log('   3. Copy the results and save to a file\n');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

exportSchema().catch(error => {
  console.error('\nFatal error:', error.message);
  process.exit(1);
});
