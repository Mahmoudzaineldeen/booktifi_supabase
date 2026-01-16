# Final Database Schema Export Script
# Uses your connection string with proper password encoding

$password = "Z@in11/11/200"
# URL encode special characters
$encodedPassword = $password -replace '@', '%40' -replace '/', '%2F'

# Try direct connection format
$connectionString = "postgresql://postgres:$encodedPassword@db.pivmdulophbdciygvegx.supabase.co:5432/postgres"

Write-Host ""
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "EXPORTING DATABASE SCHEMA" -ForegroundColor Cyan
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host ""

$pgDumpPath = "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe"

if (-not (Test-Path $pgDumpPath)) {
    Write-Host "ERROR: pg_dump not found at $pgDumpPath" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please use Supabase Dashboard method instead:" -ForegroundColor Yellow
    Write-Host "  1. Open: https://supabase.com/dashboard"
    Write-Host "  2. Go to SQL Editor"
    Write-Host "  3. Run queries from: database/export-complete-schema.sql"
    Write-Host ""
    exit 1
}

Write-Host "Exporting schema..." -ForegroundColor Green
Write-Host "Connection: postgresql://postgres:***@db.pivmdulophbdciygvegx.supabase.co:5432/postgres" -ForegroundColor Gray
Write-Host ""

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$outputFile = "complete_schema_$timestamp.sql"
$errorFile = "export_error_$timestamp.log"

# Run pg_dump with error output to separate file
$process = Start-Process -FilePath $pgDumpPath -ArgumentList @(
    "--schema-only",
    "--no-owner",
    "--no-acl",
    "--clean",
    "--if-exists",
    $connectionString
) -NoNewWindow -Wait -PassThru -RedirectStandardOutput $outputFile -RedirectStandardError $errorFile

if ($process.ExitCode -eq 0) {
    if (Test-Path $outputFile) {
        $content = Get-Content $outputFile -Raw -ErrorAction SilentlyContinue
        if ($content -and $content.Length -gt 1000 -and $content -match "CREATE") {
            $size = $content.Length / 1KB
            Write-Host ""
            Write-Host "============================================================================" -ForegroundColor Green
            Write-Host "✅ SUCCESS: Schema exported!" -ForegroundColor Green
            Write-Host "============================================================================" -ForegroundColor Green
            Write-Host "File: $outputFile" -ForegroundColor Cyan
            Write-Host "Size: $([math]::Round($size, 2)) KB" -ForegroundColor Cyan
            Write-Host ""
            
            # Clean up error file if it only has warnings
            if (Test-Path $errorFile) {
                $errorContent = Get-Content $errorFile -Raw
                if ($errorContent -match "WARNING|NOTICE") {
                    Remove-Item $errorFile -ErrorAction SilentlyContinue
                }
            }
        } else {
            Write-Host ""
            Write-Host "⚠️  Output file created but appears empty or invalid" -ForegroundColor Yellow
            if (Test-Path $errorFile) {
                Write-Host ""
                Write-Host "Error details:" -ForegroundColor Yellow
                Get-Content $errorFile
            }
        }
    }
} else {
    Write-Host ""
    Write-Host "============================================================================" -ForegroundColor Red
    Write-Host "❌ Export failed (exit code: $($process.ExitCode))" -ForegroundColor Red
    Write-Host "============================================================================" -ForegroundColor Red
    Write-Host ""
    
    if (Test-Path $errorFile) {
        Write-Host "Error details:" -ForegroundColor Yellow
        Get-Content $errorFile
        Write-Host ""
    }
    
    Write-Host "Alternative: Use Supabase Dashboard" -ForegroundColor Yellow
    Write-Host "  1. Go to: https://supabase.com/dashboard"
    Write-Host "  2. SQL Editor → New Query"
    Write-Host "  3. Run queries from: database/export-complete-schema.sql"
    Write-Host ""
}
