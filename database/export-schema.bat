@echo off
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

set TIMESTAMP=2026-01-16T13-29-28-854Z
set OUTPUT_FILE=database\complete_schema_%TIMESTAMP%.sql

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
