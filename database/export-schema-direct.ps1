# Direct Database Schema Export
# Uses pg_dump with your connection string

$password = "Z@in11/11/200"
$connectionString = "postgresql://postgres:$password@db.pivmdulophbdciygvegx.supabase.co:5432/postgres"

Write-Host ""
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "EXPORTING DATABASE SCHEMA" -ForegroundColor Cyan
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host ""

# Check if pg_dump is available
$pgDumpPath = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgDumpPath) {
    Write-Host "ERROR: pg_dump not found" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install PostgreSQL client tools:" -ForegroundColor Yellow
    Write-Host "  https://www.postgresql.org/download/windows/"
    Write-Host ""
    Write-Host "Or use the API method:" -ForegroundColor Yellow
    Write-Host "  node database/export-schema-via-api.js"
    Write-Host ""
    exit 1
}

Write-Host "Exporting schema..." -ForegroundColor Green
Write-Host "This may take a few moments..." -ForegroundColor Yellow
Write-Host ""

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$outputFile = "complete_schema_$timestamp.sql"

# Escape password for command line (handle special characters)
$escapedConnection = $connectionString

# Run pg_dump
try {
    # Use Start-Process with proper escaping
    $process = Start-Process -FilePath "pg_dump" -ArgumentList @(
        "--schema-only",
        "--no-owner",
        "--no-acl",
        "--clean",
        "--if-exists",
        $escapedConnection
    ) -NoNewWindow -Wait -PassThru -RedirectStandardOutput $outputFile -RedirectStandardError "export_error.log"
    
    if ($process.ExitCode -eq 0) {
        if (Test-Path $outputFile) {
            $fileSize = (Get-Item $outputFile).Length / 1KB
            $content = Get-Content $outputFile -Raw
            
            if ($content.Length -gt 100) {
                Write-Host ""
                Write-Host "============================================================================" -ForegroundColor Green
                Write-Host "SUCCESS: Schema exported!" -ForegroundColor Green
                Write-Host "============================================================================" -ForegroundColor Green
                Write-Host "File: $outputFile" -ForegroundColor Cyan
                Write-Host "Size: $([math]::Round($fileSize, 2)) KB" -ForegroundColor Cyan
                Write-Host ""
                
                # Clean up error log if it only has warnings
                if (Test-Path "export_error.log") {
                    $errorContent = Get-Content "export_error.log" -Raw
                    if ($errorContent -match "WARNING|NOTICE") {
                        Remove-Item "export_error.log" -ErrorAction SilentlyContinue
                    }
                }
            } else {
                Write-Host ""
                Write-Host "ERROR: Export failed - empty output" -ForegroundColor Red
                Write-Host "Check export_error.log for details" -ForegroundColor Yellow
                Write-Host ""
                exit 1
            }
        } else {
            Write-Host ""
            Write-Host "ERROR: Output file not created" -ForegroundColor Red
            Write-Host ""
            exit 1
        }
    } else {
        Write-Host ""
        Write-Host "ERROR: Export failed (exit code: $($process.ExitCode))" -ForegroundColor Red
        if (Test-Path "export_error.log") {
            Write-Host ""
            Write-Host "Error details:" -ForegroundColor Yellow
            Get-Content "export_error.log"
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
