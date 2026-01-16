import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const content = readFileSync(join(__dirname, 'schema.txt'), 'utf-8');

// Extract SQL statements using regex
const extractStatements = (pattern, key) => {
  const regex = new RegExp(`"${key}":\\s*"([^"]*(?:\\\\.[^"]*)*)"`, 'g');
  const matches = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    matches.push(match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'));
  }
  return matches;
};

console.log('📦 Extracting schema components...');

const types = extractStatements(/create_type_statement/, 'create_type_statement');
const tables = extractStatements(/create_table_statement/, 'create_table_statement');
const indexes = extractStatements(/create_index_statement/, 'create_index_statement');
const triggers = extractStatements(/create_trigger_statement/, 'create_trigger_statement');
const foreignKeys = extractStatements(/create_fk_statement/, 'create_fk_statement');
const functions = extractStatements(/function_definition/, 'function_definition');

console.log(`  ✅ ${types.length} types`);
console.log(`  ✅ ${tables.length} tables`);
console.log(`  ✅ ${indexes.length} indexes`);
console.log(`  ✅ ${triggers.length} triggers`);
console.log(`  ✅ ${foreignKeys.length} foreign keys`);
console.log(`  ✅ ${functions.length} functions`);

// Build SQL
let sql = `-- ============================================================================
-- COMPLETE DATABASE SCHEMA - READY TO EXECUTE
-- ============================================================================
-- 
-- INSTRUCTIONS:
--   1. Copy this entire file
--   2. Open Supabase Dashboard → SQL Editor (or any PostgreSQL client)
--   3. Paste and click "Run" (or press Ctrl+Enter)
--   4. Wait for completion
--
-- This file is idempotent - safe to run multiple times
-- ============================================================================

-- ============================================================================
-- STEP 1: CREATE TYPES/ENUMS (Must be created first)
-- ============================================================================

`;

types.forEach(t => sql += t + '\n');

sql += `\n-- ============================================================================
-- STEP 2: CREATE TABLES
-- ============================================================================

`;
tables.forEach(t => sql += t + '\n\n');

sql += `-- ============================================================================
-- STEP 3: CREATE PRIMARY KEYS
-- ============================================================================

`;
tables.forEach(t => {
  const m = t.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
  if (m) sql += `ALTER TABLE ${m[1]} ADD CONSTRAINT ${m[1]}_pkey PRIMARY KEY (id);\n`;
});

sql += `\n-- ============================================================================
-- STEP 4: CREATE UNIQUE CONSTRAINTS
-- ============================================================================

`;
indexes.filter(i => i.includes('UNIQUE INDEX')).forEach(i => sql += i + '\n');

sql += `\n-- ============================================================================
-- STEP 5: CREATE INDEXES
-- ============================================================================

`;
indexes.filter(i => !i.includes('UNIQUE') && !i.includes('PRIMARY KEY')).forEach(i => sql += i + '\n');

sql += `\n-- ============================================================================
-- STEP 6: CREATE FOREIGN KEY CONSTRAINTS
-- ============================================================================

`;
foreignKeys.forEach(fk => sql += fk + '\n');

sql += `\n-- ============================================================================
-- STEP 7: CREATE FUNCTIONS
-- ============================================================================

`;
functions.forEach(f => {
  sql += f.replace(/\$function\$/g, '$$') + '\n\n';
});

sql += `-- ============================================================================
-- STEP 8: CREATE TRIGGERS
-- ============================================================================

`;
triggers.forEach(t => sql += t + '\n');

sql += `\n-- ============================================================================
-- SCHEMA CREATION COMPLETE
-- ============================================================================
-- 
-- Summary:
--   - ${types.length} types/enums
--   - ${tables.length} tables
--   - ${indexes.length} indexes
--   - ${foreignKeys.length} foreign keys
--   - ${functions.length} functions
--   - ${triggers.length} triggers
--
-- ============================================================================
`;

const outputPath = join(__dirname, 'complete_schema_executable.sql');
writeFileSync(outputPath, sql, 'utf-8');
console.log(`\n✅ SQL file created: complete_schema_executable.sql`);
console.log(`   Size: ${(sql.length / 1024).toFixed(2)} KB`);
console.log(`   Ready to copy and execute!`);
