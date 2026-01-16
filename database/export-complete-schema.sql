-- ============================================================================
-- Complete Database Schema Export
-- ============================================================================
-- Run this in Supabase SQL Editor to export your complete schema
-- Copy the results and save to a file
-- ============================================================================

-- ============================================================================
-- 1. EXPORT ALL TABLES
-- ============================================================================
-- Run this query and copy the results
SELECT 
  'CREATE TABLE IF NOT EXISTS ' || table_name || ' (' || 
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
  ) || E'\n);' as create_table_statement
FROM information_schema.columns
WHERE table_schema = 'public'
GROUP BY table_name
ORDER BY table_name;

-- ============================================================================
-- 2. EXPORT ALL FUNCTIONS
-- ============================================================================
SELECT 
  proname as function_name,
  pg_get_functiondef(oid) as function_definition
FROM pg_proc
WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
ORDER BY proname;

-- ============================================================================
-- 3. EXPORT ALL TYPES/ENUMS
-- ============================================================================
SELECT 
  'CREATE TYPE ' || t.typname || ' AS ENUM (' || 
  string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder) || 
  ');' as create_type_statement
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
WHERE t.typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
GROUP BY t.typname
ORDER BY t.typname;

-- ============================================================================
-- 4. EXPORT ALL INDEXES
-- ============================================================================
SELECT indexdef || ';' as create_index_statement
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- ============================================================================
-- 5. EXPORT ALL TRIGGERS
-- ============================================================================
SELECT 
  pg_get_triggerdef(oid) || ';' as create_trigger_statement
FROM pg_trigger
WHERE tgrelid IN (
  SELECT oid 
  FROM pg_class 
  WHERE relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    AND relkind = 'r'
)
AND tgisinternal = false
ORDER BY tgname;

-- ============================================================================
-- 6. EXPORT ALL FOREIGN KEY CONSTRAINTS
-- ============================================================================
SELECT 
  'ALTER TABLE ' || tc.table_name || 
  ' ADD CONSTRAINT ' || tc.constraint_name ||
  ' FOREIGN KEY (' || kcu.column_name || ')' ||
  ' REFERENCES ' || ccu.table_name || '(' || ccu.column_name || ')' ||
  CASE 
    WHEN rc.delete_rule != 'NO ACTION' THEN ' ON DELETE ' || rc.delete_rule
    ELSE ''
  END ||
  CASE 
    WHEN rc.update_rule != 'NO ACTION' THEN ' ON UPDATE ' || rc.update_rule
    ELSE ''
  END || ';' as create_fk_statement
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
JOIN information_schema.referential_constraints AS rc
  ON rc.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name, tc.constraint_name;

-- ============================================================================
-- 7. EXPORT ALL SEQUENCES
-- ============================================================================
-- Note: Sequences owned by SERIAL/identity columns are automatically created
-- when you create tables, so they're already included in the table definitions above.
-- This query only exports standalone sequences.
SELECT 
  'CREATE SEQUENCE IF NOT EXISTS ' || sequence_name ||
  ' START WITH ' || start_value ||
  ' INCREMENT BY ' || increment ||
  ' MINVALUE ' || minimum_value ||
  ' MAXVALUE ' || maximum_value ||
  CASE WHEN cycle_option = 'YES' THEN ' CYCLE' ELSE ' NO CYCLE' END || ';' as create_sequence_statement
FROM information_schema.sequences
WHERE sequence_schema = 'public'
ORDER BY sequence_name;

-- If you want to see ALL sequences (including those owned by columns), run this instead:
-- SELECT 
--   'CREATE SEQUENCE IF NOT EXISTS ' || c.relname ||
--   ' START WITH ' || s.seqstart ||
--   ' INCREMENT BY ' || s.seqincrement ||
--   ' MINVALUE ' || s.seqmin ||
--   ' MAXVALUE ' || s.seqmax ||
--   CASE WHEN s.seqcycle THEN ' CYCLE' ELSE ' NO CYCLE' END || ';' as create_sequence_statement
-- FROM pg_sequence s
-- JOIN pg_class c ON c.oid = s.seqrelid
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public'
-- ORDER BY c.relname;
