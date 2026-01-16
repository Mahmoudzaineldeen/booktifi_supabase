#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const schemaTxtPath = join(__dirname, 'schema.txt');
const outputPath = join(__dirname, 'complete_schema.sql');

console.log('📖 Reading schema.txt...');
const content = readFileSync(schemaTxtPath, 'utf-8');

// Split by pattern: ]\n\n[
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

let tables = [], functions = [], types = [], indexes = [], triggers = [], foreignKeys = [];

sections.forEach((section, index) => {
  try {
    const data = JSON.parse(section);
    if (!Array.isArray(data) || data.length === 0) return;
    
    const first = data[0];
    if (first.create_table_statement) {
      tables = data;
      console.log(`✅ Found ${tables.length} tables`);
    } else if (first.function_name) {
      functions = data;
      console.log(`✅ Found ${functions.length} functions`);
    } else if (first.create_type_statement) {
      types = data;
      console.log(`✅ Found ${types.length} types`);
    } else if (first.create_index_statement) {
      indexes = data;
      console.log(`✅ Found ${indexes.length} indexes`);
    } else if (first.create_trigger_statement) {
      triggers = data;
      console.log(`✅ Found ${triggers.length} triggers`);
    } else if (first.create_fk_statement) {
      foreignKeys = data;
      console.log(`✅ Found ${foreignKeys.length} foreign keys`);
    }
  } catch (e) {
    console.warn(`⚠️  Section ${index + 1} parse error:`, e.message.substring(0, 50));
  }
});

// Build SQL
let sql = `-- ============================================================================
-- Complete Database Schema Export
-- Generated from Supabase SQL Editor
-- ============================================================================

-- 1. TYPES/ENUMS
-- ============================================================================

`;
types.forEach(item => sql += item.create_type_statement + '\n');
sql += '\n-- 2. TABLES\n-- ============================================================================\n\n';
tables.forEach(item => sql += item.create_table_statement + '\n\n');
sql += '\n-- 3. PRIMARY KEYS\n-- ============================================================================\n\n';
tables.forEach(item => {
  const match = item.create_table_statement.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
  if (match) sql += `ALTER TABLE ${match[1]} ADD CONSTRAINT ${match[1]}_pkey PRIMARY KEY (id);\n`;
});
sql += '\n-- 4. UNIQUE CONSTRAINTS\n-- ============================================================================\n\n';
indexes.forEach(item => {
  if (item.create_index_statement.includes('UNIQUE INDEX')) {
    sql += item.create_index_statement + '\n';
  }
});
sql += '\n-- 5. INDEXES\n-- ============================================================================\n\n';
indexes.forEach(item => {
  if (!item.create_index_statement.includes('UNIQUE') && !item.create_index_statement.includes('PRIMARY KEY')) {
    sql += item.create_index_statement + '\n';
  }
});
sql += '\n-- 6. FOREIGN KEYS\n-- ============================================================================\n\n';
foreignKeys.forEach(item => sql += item.create_fk_statement + '\n');
sql += '\n-- 7. FUNCTIONS\n-- ============================================================================\n\n';
functions.forEach(item => {
  sql += item.function_definition.replace(/\r\n/g, '\n').replace(/\$function\$/g, '$$') + '\n\n';
});
sql += '\n-- 8. TRIGGERS\n-- ============================================================================\n\n';
triggers.forEach(item => sql += item.create_trigger_statement + '\n');

console.log('\n💾 Writing complete_schema.sql...');
writeFileSync(outputPath, sql, 'utf-8');
console.log(`\n✅ Complete! Exported ${types.length} types, ${tables.length} tables, ${indexes.length} indexes, ${foreignKeys.length} FKs, ${functions.length} functions, ${triggers.length} triggers`);
