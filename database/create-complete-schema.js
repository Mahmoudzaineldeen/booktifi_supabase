#!/usr/bin/env node

/**
 * Create Complete SQL Schema File
 * Extracts all schema components from schema.txt and creates an executable SQL file
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const schemaTxtPath = join(__dirname, 'schema.txt');
const outputPath = join(__dirname, 'complete_schema_executable.sql');

console.log('📖 Reading schema.txt...');
const content = readFileSync(schemaTxtPath, 'utf-8');

// Extract JSON arrays - they're separated by ]\n\n[
const rawSections = content.split(/\n\]\n\n\[/);

// Reconstruct JSON arrays
const sections = rawSections.map((part, index) => {
  if (index === 0) {
    return part + '\n]';
  } else if (index === rawSections.length - 1) {
    return '[\n' + part;
  } else {
    return '[\n' + part + '\n]';
  }
});

const data = {
  tables: [],
  functions: [],
  types: [],
  indexes: [],
  triggers: [],
  foreignKeys: []
};

console.log('📦 Parsing JSON sections...');
sections.forEach((section, index) => {
  try {
    const parsed = JSON.parse(section);
    if (!Array.isArray(parsed) || parsed.length === 0) return;
    
    const first = parsed[0];
    if (first.create_table_statement) {
      data.tables = parsed;
      console.log(`  ✅ Tables: ${parsed.length}`);
    } else if (first.function_name) {
      data.functions = parsed;
      console.log(`  ✅ Functions: ${parsed.length}`);
    } else if (first.create_type_statement) {
      data.types = parsed;
      console.log(`  ✅ Types: ${parsed.length}`);
    } else if (first.create_index_statement) {
      data.indexes = parsed;
      console.log(`  ✅ Indexes: ${parsed.length}`);
    } else if (first.create_trigger_statement) {
      data.triggers = parsed;
      console.log(`  ✅ Triggers: ${parsed.length}`);
    } else if (first.create_fk_statement) {
      data.foreignKeys = parsed;
      console.log(`  ✅ Foreign Keys: ${parsed.length}`);
    }
  } catch (e) {
    // Skip parse errors for now
  }
});

// Build complete SQL file
let sql = `-- ============================================================================
-- COMPLETE DATABASE SCHEMA
-- ============================================================================
-- This file contains the complete schema for the booking system database
-- 
-- USAGE:
--   1. Copy this entire file
--   2. Open Supabase SQL Editor (or any PostgreSQL client)
--   3. Paste and execute
--
-- NOTE: This file is idempotent - safe to run multiple times
-- ============================================================================

-- ============================================================================
-- STEP 1: CREATE TYPES/ENUMS (Must be created first)
-- ============================================================================

`;

// Types/Enums
data.types.forEach(t => {
  sql += t.create_type_statement + '\n';
});

sql += `\n-- ============================================================================
-- STEP 2: CREATE TABLES
-- ============================================================================

`;

// Tables
data.tables.forEach(t => {
  sql += t.create_table_statement + '\n\n';
});

sql += `-- ============================================================================
-- STEP 3: CREATE PRIMARY KEYS
-- ============================================================================

`;

// Primary Keys
data.tables.forEach(t => {
  const match = t.create_table_statement.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
  if (match) {
    const tableName = match[1];
    sql += `ALTER TABLE ${tableName} ADD CONSTRAINT ${tableName}_pkey PRIMARY KEY (id);\n`;
  }
});

sql += `\n-- ============================================================================
-- STEP 4: CREATE UNIQUE CONSTRAINTS
-- ============================================================================

`;

// Unique Indexes
data.indexes.forEach(idx => {
  if (idx.create_index_statement.includes('UNIQUE INDEX')) {
    sql += idx.create_index_statement + '\n';
  }
});

sql += `\n-- ============================================================================
-- STEP 5: CREATE INDEXES
-- ============================================================================

`;

// Regular Indexes
data.indexes.forEach(idx => {
  if (!idx.create_index_statement.includes('UNIQUE') && 
      !idx.create_index_statement.includes('PRIMARY KEY')) {
    sql += idx.create_index_statement + '\n';
  }
});

sql += `\n-- ============================================================================
-- STEP 6: CREATE FOREIGN KEY CONSTRAINTS
-- ============================================================================

`;

// Foreign Keys
data.foreignKeys.forEach(fk => {
  sql += fk.create_fk_statement + '\n';
});

sql += `\n-- ============================================================================
-- STEP 7: CREATE FUNCTIONS
-- ============================================================================

`;

// Functions
data.functions.forEach(f => {
  // Clean up function definition
  let funcDef = f.function_definition
    .replace(/\r\n/g, '\n')
    .replace(/\$function\$/g, '$$');
  sql += funcDef + '\n\n';
});

sql += `-- ============================================================================
-- STEP 8: CREATE TRIGGERS
-- ============================================================================

`;

// Triggers
data.triggers.forEach(t => {
  sql += t.create_trigger_statement + '\n';
});

sql += `\n-- ============================================================================
-- SCHEMA CREATION COMPLETE
-- ============================================================================
-- 
-- Summary:
--   - ${data.types.length} types/enums created
--   - ${data.tables.length} tables created
--   - ${data.indexes.length} indexes created
--   - ${data.foreignKeys.length} foreign keys created
--   - ${data.functions.length} functions created
--   - ${data.triggers.length} triggers created
--
-- ============================================================================
`;

console.log('\n💾 Writing complete_schema_executable.sql...');
writeFileSync(outputPath, sql, 'utf-8');

const fileSize = (sql.length / 1024).toFixed(2);
console.log(`\n✅ Complete! SQL file created: complete_schema_executable.sql`);
console.log(`   File size: ${fileSize} KB`);
console.log(`   Ready to copy and execute in Supabase SQL Editor or PostgreSQL client`);
