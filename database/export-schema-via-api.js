#!/usr/bin/env node

/**
 * Export Database Schema via Supabase API
 * 
 * Uses Supabase client to query schema information and generate SQL
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
  console.log('\n' + '='.repeat(70));
  console.log('EXPORTING DATABASE SCHEMA VIA SUPABASE API');
  console.log('='.repeat(70) + '\n');
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = join(__dirname, `complete_schema_${timestamp}.sql`);
  
  const schemaSQL = [];
  
  schemaSQL.push('-- ============================================================================');
  schemaSQL.push('-- Complete Database Schema Export');
  schemaSQL.push(`-- Generated: ${new Date().toISOString()}`);
  schemaSQL.push('-- Source: Supabase PostgreSQL Database');
  schemaSQL.push('-- Method: Supabase API Queries');
  schemaSQL.push('-- ============================================================================\n');
  
  try {
    // Export Tables
    console.log('📊 Exporting tables...');
    const { data: tables, error: tablesError } = await supabase.rpc('exec_sql', {
      query: `
        SELECT 
          table_name,
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
            E',\n  ' ORDER BY ordinal_position
          ) as columns
        FROM information_schema.columns
        WHERE table_schema = 'public'
        GROUP BY table_name
        ORDER BY table_name;
      `
    });
    
    if (tablesError) {
      console.warn('⚠️  Could not export tables via RPC, trying alternative method...');
      // Alternative: Use direct queries
      await exportTablesAlternative(schemaSQL);
    } else if (tables && tables.length > 0) {
      schemaSQL.push('-- ============================================================================');
      schemaSQL.push('-- TABLES');
      schemaSQL.push('-- ============================================================================\n');
      tables.forEach((table) => {
        schemaSQL.push(`CREATE TABLE IF NOT EXISTS ${table.table_name} (`);
        schemaSQL.push('  ' + table.columns);
        schemaSQL.push(');');
        schemaSQL.push('');
      });
      console.log(`✅ Exported ${tables.length} table(s)`);
    }
    
    // Export Functions
    console.log('⚙️  Exporting functions...');
    const { data: functions, error: functionsError } = await supabase.rpc('exec_sql', {
      query: `
        SELECT 
          proname as function_name,
          pg_get_functiondef(oid) as function_definition
        FROM pg_proc
        WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        ORDER BY proname;
      `
    });
    
    if (!functionsError && functions && functions.length > 0) {
      schemaSQL.push('-- ============================================================================');
      schemaSQL.push('-- FUNCTIONS');
      schemaSQL.push('-- ============================================================================\n');
      functions.forEach((func) => {
        schemaSQL.push(func.function_definition);
        schemaSQL.push('');
      });
      console.log(`✅ Exported ${functions.length} function(s)`);
    }
    
    // Export Types/Enums
    console.log('📝 Exporting types and enums...');
    const { data: types, error: typesError } = await supabase.rpc('exec_sql', {
      query: `
        SELECT 
          t.typname as type_name,
          string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder) as enum_values
        FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        GROUP BY t.typname
        ORDER BY t.typname;
      `
    });
    
    if (!typesError && types && types.length > 0) {
      schemaSQL.push('-- ============================================================================');
      schemaSQL.push('-- TYPES / ENUMS');
      schemaSQL.push('-- ============================================================================\n');
      types.forEach((type) => {
        schemaSQL.push(`CREATE TYPE ${type.type_name} AS ENUM (`);
        schemaSQL.push('  ' + type.enum_values);
        schemaSQL.push(');');
        schemaSQL.push('');
      });
      console.log(`✅ Exported ${types.length} type(s)`);
    }
    
    // Export Indexes
    console.log('🔍 Exporting indexes...');
    const { data: indexes, error: indexesError } = await supabase.rpc('exec_sql', {
      query: `
        SELECT indexdef || ';' as create_index
        FROM pg_indexes
        WHERE schemaname = 'public'
        ORDER BY tablename, indexname;
      `
    });
    
    if (!indexesError && indexes && indexes.length > 0) {
      schemaSQL.push('-- ============================================================================');
      schemaSQL.push('-- INDEXES');
      schemaSQL.push('-- ============================================================================\n');
      indexes.forEach((idx) => {
        schemaSQL.push(idx.create_index);
        schemaSQL.push('');
      });
      console.log(`✅ Exported ${indexes.length} index(es)`);
    }
    
    // Write to file
    const schemaContent = schemaSQL.join('\n');
    writeFileSync(outputPath, schemaContent, 'utf8');
    
    console.log('\n' + '='.repeat(70));
    console.log('✅ SCHEMA EXPORTED SUCCESSFULLY!');
    console.log('='.repeat(70));
    console.log(`File: ${outputPath}`);
    console.log(`Size: ${(schemaContent.length / 1024).toFixed(2)} KB`);
    console.log('');
    
  } catch (error) {
    console.error('\n❌ Error exporting schema:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

async function exportTablesAlternative(schemaSQL) {
  // Alternative method: Query tables directly
  console.log('Using alternative method to export tables...');
  
  // Get list of tables
  const { data: tableList } = await supabase.rpc('exec_sql', {
    query: `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `
  });
  
  if (tableList && tableList.length > 0) {
    schemaSQL.push('-- ============================================================================');
    schemaSQL.push('-- TABLES');
    schemaSQL.push('-- ============================================================================\n');
    schemaSQL.push('-- Note: Table definitions exported via alternative method');
    schemaSQL.push('-- For complete CREATE TABLE statements, use pg_dump\n');
    console.log(`✅ Found ${tableList.length} table(s)`);
  }
}

exportSchema().catch(error => {
  console.error('\nFatal error:', error.message);
  process.exit(1);
});
