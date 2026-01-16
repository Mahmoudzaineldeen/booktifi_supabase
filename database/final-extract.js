import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const content = readFileSync(join(__dirname, 'schema.txt'), 'utf-8');

// Find all JSON arrays using regex
const arrayPattern = /\[[\s\S]*?\]/g;
const matches = content.match(arrayPattern);

if (!matches || matches.length === 0) {
  console.error('No JSON arrays found');
  process.exit(1);
}

console.log(`Found ${matches.length} JSON arrays`);

const data = {
  tables: [],
  functions: [],
  types: [],
  indexes: [],
  triggers: [],
  foreignKeys: []
};

matches.forEach((match, i) => {
  try {
    const parsed = JSON.parse(match);
    if (!Array.isArray(parsed) || parsed.length === 0) return;
    
    const first = parsed[0];
    if (first.create_table_statement) {
      data.tables = parsed;
      console.log(`✅ Tables: ${parsed.length}`);
    } else if (first.function_name) {
      data.functions = parsed;
      console.log(`✅ Functions: ${parsed.length}`);
    } else if (first.create_type_statement) {
      data.types = parsed;
      console.log(`✅ Types: ${parsed.length}`);
    } else if (first.create_index_statement) {
      data.indexes = parsed;
      console.log(`✅ Indexes: ${parsed.length}`);
    } else if (first.create_trigger_statement) {
      data.triggers = parsed;
      console.log(`✅ Triggers: ${parsed.length}`);
    } else if (first.create_fk_statement) {
      data.foreignKeys = parsed;
      console.log(`✅ Foreign Keys: ${parsed.length}`);
    }
  } catch (e) {
    console.warn(`⚠️  Array ${i + 1}: ${e.message.substring(0, 50)}`);
  }
});

// Build SQL
let sql = `-- ============================================================================
-- Complete Database Schema Export
-- ============================================================================

-- 1. TYPES/ENUMS
-- ============================================================================
`;
data.types.forEach(t => sql += t.create_type_statement + '\n');
sql += '\n-- 2. TABLES\n-- ============================================================================\n\n';
data.tables.forEach(t => sql += t.create_table_statement + '\n\n');
sql += '\n-- 3. PRIMARY KEYS\n-- ============================================================================\n\n';
data.tables.forEach(t => {
  const m = t.create_table_statement.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
  if (m) sql += `ALTER TABLE ${m[1]} ADD CONSTRAINT ${m[1]}_pkey PRIMARY KEY (id);\n`;
});
sql += '\n-- 4. UNIQUE INDEXES\n-- ============================================================================\n\n';
data.indexes.filter(i => i.create_index_statement.includes('UNIQUE INDEX')).forEach(i => sql += i.create_index_statement + '\n');
sql += '\n-- 5. INDEXES\n-- ============================================================================\n\n';
data.indexes.filter(i => !i.create_index_statement.includes('UNIQUE') && !i.create_index_statement.includes('PRIMARY KEY')).forEach(i => sql += i.create_index_statement + '\n');
sql += '\n-- 6. FOREIGN KEYS\n-- ============================================================================\n\n';
data.foreignKeys.forEach(fk => sql += fk.create_fk_statement + '\n');
sql += '\n-- 7. FUNCTIONS\n-- ============================================================================\n\n';
data.functions.forEach(f => {
  sql += f.function_definition.replace(/\r\n/g, '\n').replace(/\$function\$/g, '$$') + '\n\n';
});
sql += '\n-- 8. TRIGGERS\n-- ============================================================================\n\n';
data.triggers.forEach(t => sql += t.create_trigger_statement + '\n');

writeFileSync(join(__dirname, 'complete_schema.sql'), sql, 'utf-8');
console.log(`\n✅ Exported to complete_schema.sql`);
