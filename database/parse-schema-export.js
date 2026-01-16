#!/usr/bin/env node

/**
 * Parse schema.txt JSON export and create complete SQL file
 * This script extracts functions and triggers from the JSON format
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const schemaTxtPath = join(__dirname, 'schema.txt');
const outputPath = join(__dirname, 'complete_schema.sql');

console.log('📖 Reading schema.txt...');
const content = readFileSync(schemaTxtPath, 'utf-8');

// Parse JSON arrays - they're separated by pattern: ]\n\n[
// Split on this pattern and reconstruct each array
const parts = content.split(/\n\]\n\n\[/);
const sections = parts.map((part, index) => {
  if (index === 0) {
    return part + '\n]';
  } else if (index === parts.length - 1) {
    return '[\n' + part;
  } else {
    return '[\n' + part + '\n]';
  }
});

let tables = [];
let functions = [];
let types = [];
let indexes = [];
let triggers = [];
let foreignKeys = [];

sections.forEach((section, index) => {
  try {
    const data = JSON.parse(section);
    
    if (Array.isArray(data)) {
      if (data.length > 0) {
        const firstItem = data[0];
        
        if (firstItem.create_table_statement) {
          tables = data;
          console.log(`✅ Found ${tables.length} tables`);
        } else if (firstItem.function_name) {
          functions = data;
          console.log(`✅ Found ${functions.length} functions`);
        } else if (firstItem.create_type_statement) {
          types = data;
          console.log(`✅ Found ${types.length} types`);
        } else if (firstItem.create_index_statement) {
          indexes = data;
          console.log(`✅ Found ${indexes.length} indexes`);
        } else if (firstItem.create_trigger_statement) {
          triggers = data;
          console.log(`✅ Found ${triggers.length} triggers`);
        } else if (firstItem.create_fk_statement) {
          foreignKeys = data;
          console.log(`✅ Found ${foreignKeys.length} foreign keys`);
        }
      }
    }
  } catch (e) {
    console.warn(`⚠️  Could not parse section ${index + 1}:`, e.message);
  }
});

// Build complete SQL file
let sql = `-- ============================================================================
-- Complete Database Schema Export
-- Generated from Supabase SQL Editor
-- ============================================================================
-- This file contains the complete schema for the booking system database
-- Run this file in a fresh database to recreate the entire schema
-- ============================================================================

`;

// 1. Types/Enums (must be first)
sql += `-- ============================================================================
-- 1. CREATE TYPES/ENUMS (Must be created first)
-- ============================================================================

`;
types.forEach(item => {
  sql += item.create_type_statement + '\n';
});
sql += '\n';

// 2. Tables
sql += `-- ============================================================================
-- 2. CREATE TABLES
-- ============================================================================

`;
tables.forEach(item => {
  sql += item.create_table_statement + '\n\n';
});

// 3. Primary Keys
sql += `-- ============================================================================
-- 3. CREATE PRIMARY KEYS
-- ============================================================================

`;
tables.forEach(item => {
  const tableName = item.create_table_statement.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1];
  if (tableName) {
    sql += `ALTER TABLE ${tableName} ADD CONSTRAINT ${tableName}_pkey PRIMARY KEY (id);\n`;
  }
});
sql += '\n';

// 4. Unique Constraints (from indexes)
sql += `-- ============================================================================
-- 4. CREATE UNIQUE CONSTRAINTS
-- ============================================================================

`;
indexes.forEach(item => {
  if (item.create_index_statement.includes('UNIQUE INDEX')) {
    sql += item.create_index_statement + '\n';
  }
});
sql += '\n';

// 5. Indexes
sql += `-- ============================================================================
-- 5. CREATE INDEXES
-- ============================================================================

`;
indexes.forEach(item => {
  if (!item.create_index_statement.includes('UNIQUE INDEX') && !item.create_index_statement.includes('PRIMARY KEY')) {
    sql += item.create_index_statement + '\n';
  }
});
sql += '\n';

// 6. Foreign Keys
sql += `-- ============================================================================
-- 6. CREATE FOREIGN KEY CONSTRAINTS
-- ============================================================================

`;
foreignKeys.forEach(item => {
  sql += item.create_fk_statement + '\n';
});
sql += '\n';

// 7. Functions
sql += `-- ============================================================================
-- 7. CREATE FUNCTIONS
-- ============================================================================

`;
functions.forEach(item => {
  // Clean up function definition (remove \r\n, fix formatting)
  let funcDef = item.function_definition
    .replace(/\r\n/g, '\n')
    .replace(/\$function\$/g, '$$');
  sql += funcDef + '\n\n';
});

// 8. Triggers
sql += `-- ============================================================================
-- 8. CREATE TRIGGERS
-- ============================================================================

`;
triggers.forEach(item => {
  sql += item.create_trigger_statement + '\n';
});
sql += '\n';

sql += `-- ============================================================================
-- END OF SCHEMA EXPORT
-- ============================================================================
`;

console.log('\n💾 Writing complete_schema.sql...');
writeFileSync(outputPath, sql, 'utf-8');

console.log('\n✅ Complete! Schema exported to: complete_schema.sql');
console.log(`   - ${types.length} types`);
console.log(`   - ${tables.length} tables`);
console.log(`   - ${indexes.length} indexes`);
console.log(`   - ${foreignKeys.length} foreign keys`);
console.log(`   - ${functions.length} functions`);
console.log(`   - ${triggers.length} triggers`);
