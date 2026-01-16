#!/usr/bin/env node

/**
 * Simple Database Schema Export
 * 
 * Provides instructions and generates SQL queries for Supabase
 */

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

console.log('\n' + '='.repeat(70));
console.log('DATABASE SCHEMA EXPORT');
console.log('='.repeat(70) + '\n');

console.log('📋 Method 1: Using Supabase Dashboard (Recommended)\n');
console.log('1. Go to: https://supabase.com/dashboard');
console.log('2. Select your project');
console.log('3. Go to: Settings → Database');
console.log('4. Scroll to "Connection string" section');
console.log('5. Copy the "Connection pooling" connection string');
console.log('6. Use it with pg_dump (see Method 2)\n');

console.log('📋 Method 2: Using pg_dump (Command Line)\n');
console.log('If you have pg_dump installed, run:\n');
console.log('  pg_dump --schema-only --no-owner --no-acl <connection_string> > schema.sql\n');
console.log('Example:');
console.log('  pg_dump --schema-only --no-owner --no-acl \\');
console.log('    "postgresql://postgres.[ref]:[password]@aws-0-us-east-1.pooler.supabase.com:6543/postgres" \\');
console.log('    > database/complete_schema.sql\n');

console.log('📋 Method 3: Using SQL Queries (Manual)\n');
console.log('SQL queries have been generated in: database/export-schema-queries.sql');
console.log('Run each query section in Supabase SQL Editor and copy the results.\n');

// Generate a simple script that uses pg_dump if available
const scriptContent = `@echo off
REM Database Schema Export Script
REM Run this script to export your database schema

echo ============================================================================
echo DATABASE SCHEMA EXPORT
echo ============================================================================
echo.

REM Check if DATABASE_URL is set
if "%DATABASE_URL%"=="" (
    echo ERROR: DATABASE_URL not set
    echo.
    echo Please set DATABASE_URL in your environment:
    echo   set DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
    echo.
    echo Get the connection string from:
    echo   Supabase Dashboard → Settings → Database → Connection string
    echo.
    pause
    exit /b 1
)

REM Check if pg_dump is available
where pg_dump >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: pg_dump not found
    echo.
    echo Please install PostgreSQL client tools:
    echo   https://www.postgresql.org/download/windows/
    echo.
    pause
    exit /b 1
)

echo Exporting schema...
echo.

set TIMESTAMP=${timestamp}
set OUTPUT_FILE=database\\complete_schema_%TIMESTAMP%.sql

pg_dump --schema-only --no-owner --no-acl --clean --if-exists "%DATABASE_URL%" > "%OUTPUT_FILE%"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ============================================================================
    echo SUCCESS: Schema exported!
    echo ============================================================================
    echo File: %OUTPUT_FILE%
    echo.
) else (
    echo.
    echo ============================================================================
    echo ERROR: Export failed
    echo ============================================================================
    echo Check your DATABASE_URL and try again
    echo.
)

pause
`;

const scriptPath = join(__dirname, '..', 'database', 'export-schema.bat');
writeFileSync(scriptPath, scriptContent, 'utf8');

console.log('✅ Generated export script: database/export-schema.bat');
console.log('   Run this script after setting DATABASE_URL environment variable\n');

console.log('='.repeat(70));
console.log('QUICK START');
console.log('='.repeat(70));
console.log('');
console.log('1. Get connection string from Supabase Dashboard');
console.log('2. Set environment variable:');
console.log('   set DATABASE_URL="your-connection-string"');
console.log('3. Run: database\\export-schema.bat');
console.log('4. Schema will be saved to: database\\complete_schema_<timestamp>.sql');
console.log('');
