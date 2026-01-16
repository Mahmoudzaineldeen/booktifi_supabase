# Database Schema Export Script (PowerShell)
# Exports complete database schema from Supabase

param(
    [string]$Password
)

Write-Host ""
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "DATABASE SCHEMA EXPORT" -ForegroundColor Cyan
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host ""

# Connection string template
$connectionTemplate = "postgresql://postgres:[YOUR-PASSWORD]@db.pivmdulophbdciygvegx.supabase.co:5432/postgres"

# Get password
if (-not $Password) {
    $Password = $env:SUPABASE_DB_PASSWORD
}

if (-not $Password) {
    Write-Host "ERROR: Database password required" -ForegroundColor Red
    Write-Host ""
    Write-Host "Usage:" -ForegroundColor Yellow
    Write-Host '  .\database\export-schema.ps1 -Password "your-password"'
    Write-Host ""
    Write-Host "Or set environment variable:" -ForegroundColor Yellow
    Write-Host '  $env:SUPABASE_DB_PASSWORD = "your-password"'
    Write-Host ""
    Write-Host "Get password from:" -ForegroundColor Yellow
    Write-Host "  Supabase Dashboard → Settings → Database → Connection string"
    Write-Host ""
    exit 1
}

# Build connection string
$connectionString = $connectionTemplate -replace '\[YOUR-PASSWORD\]', $Password
$maskedConnection = $connectionString -replace ':[^:@]+@', ':***@'

Write-Host "Connection: $maskedConnection" -ForegroundColor Cyan
Write-Host ""

# Check if pg_dump is available
$pgDumpPath = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgDumpPath) {
    Write-Host "ERROR: pg_dump not found" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install PostgreSQL client tools:" -ForegroundColor Yellow
    Write-Host "  https://www.postgresql.org/download/windows/"
    Write-Host ""
    exit 1
}

Write-Host "Exporting schema..." -ForegroundColor Green
Write-Host "This may take a few moments..." -ForegroundColor Yellow
Write-Host ""

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$outputFile = "database\complete_schema_$timestamp.sql"

# Ensure database directory exists
if (-not (Test-Path "database")) {
    New-Item -ItemType Directory -Path "database" | Out-Null
}

# Run pg_dump
try {
    $process = Start-Process -FilePath "pg_dump" -ArgumentList @(
        "--schema-only",
        "--no-owner",
        "--no-acl",
        "--clean",
        "--if-exists",
        $connectionString
    ) -NoNewWindow -Wait -PassThru -RedirectStandardOutput $outputFile -RedirectStandardError "database\export_error.log"
    
    if ($process.ExitCode -eq 0) {
        $fileSize = (Get-Item $outputFile).Length / 1KB
        
        # Check if file has content
        $content = Get-Content $outputFile -Raw
        if ($content.Length -gt 100) {
            Write-Host ""
            Write-Host "============================================================================" -ForegroundColor Green
            Write-Host "SUCCESS: Schema exported!" -ForegroundColor Green
            Write-Host "============================================================================" -ForegroundColor Green
            Write-Host "File: $outputFile" -ForegroundColor Cyan
            Write-Host "Size: $([math]::Round($fileSize, 2)) KB" -ForegroundColor Cyan
            Write-Host ""
            
            # Clean up error log if empty
            if (Test-Path "database\export_error.log") {
                $errorContent = Get-Content "database\export_error.log" -Raw
                if ($errorContent -match "WARNING|NOTICE") {
                    Remove-Item "database\export_error.log" -ErrorAction SilentlyContinue
                }
            }
        } else {
            Write-Host ""
            Write-Host "============================================================================" -ForegroundColor Red
            Write-Host "ERROR: Export failed - empty output" -ForegroundColor Red
            Write-Host "============================================================================" -ForegroundColor Red
            Write-Host "Possible issues:" -ForegroundColor Yellow
            Write-Host "  - Incorrect password"
            Write-Host "  - Network connection issue"
            Write-Host "  - Database not accessible"
            Write-Host ""
            if (Test-Path "database\export_error.log") {
                Write-Host "Error log:" -ForegroundColor Yellow
                Get-Content "database\export_error.log"
            }
            Write-Host ""
            exit 1
        }
    } else {
        Write-Host ""
        Write-Host "============================================================================" -ForegroundColor Red
        Write-Host "ERROR: Export failed (exit code: $($process.ExitCode))" -ForegroundColor Red
        Write-Host "============================================================================" -ForegroundColor Red
        if (Test-Path "database\export_error.log") {
            Write-Host "Error details:" -ForegroundColor Yellow
            Get-Content "database\export_error.log"
        }
        Write-Host ""
        exit 1
    }
} catch {
    Write-Host ""
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    exit 1
}
