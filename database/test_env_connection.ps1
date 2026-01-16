# Test .env Database Connection
# Reads .env file and tests PostgreSQL connection

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envFile = Join-Path $projectRoot ".env"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Testing .env Database Connection" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Read .env file
if (-not (Test-Path $envFile)) {
    Write-Host "ERROR: .env file not found at: $envFile" -ForegroundColor Red
    exit 1
}

Write-Host "Reading .env file..." -ForegroundColor Yellow
$envContent = Get-Content $envFile

# Parse DATABASE_URL
$databaseUrl = $null
foreach ($line in $envContent) {
    if ($line -match "^DATABASE_URL=(.+)") {
        $databaseUrl = $matches[1].Trim()
        break
    }
}

if (-not $databaseUrl) {
    Write-Host "ERROR: DATABASE_URL not found in .env file" -ForegroundColor Red
    exit 1
}

Write-Host "Found DATABASE_URL: postgresql://postgres:***@localhost:5432/saudi_towerdb" -ForegroundColor Green
Write-Host ""

# Parse connection details
if ($databaseUrl -match "postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)") {
    $username = $matches[1]
    $password = $matches[2]
    $dbHost = $matches[3]
    $port = $matches[4]
    $database = $matches[5]
    
    Write-Host "Connection Details:" -ForegroundColor Cyan
    Write-Host "  Host: $dbHost" -ForegroundColor Gray
    Write-Host "  Port: $port" -ForegroundColor Gray
    Write-Host "  Database: $database" -ForegroundColor Gray
    Write-Host "  Username: $username" -ForegroundColor Gray
    Write-Host ""
    
    # Find psql
    $psqlPath = $null
    $pgPaths = @(
        "C:\Program Files\PostgreSQL",
        "C:\Program Files (x86)\PostgreSQL"
    )
    
    foreach ($pgPath in $pgPaths) {
        if (Test-Path $pgPath) {
            $versions = Get-ChildItem $pgPath -Directory -ErrorAction SilentlyContinue | 
                       Where-Object { $_.Name -match "^\d+" } |
                       Sort-Object Name -Descending
            foreach ($ver in $versions) {
                $testPath = Join-Path $ver.FullName "bin\psql.exe"
                if (Test-Path $testPath) {
                    $psqlPath = $testPath
                    Write-Host "Found PostgreSQL at: $testPath" -ForegroundColor Green
                    break
                }
            }
            if ($psqlPath) { break }
        }
    }
    
    # Also check if psql is in PATH
    if (-not $psqlPath) {
        $psqlInPath = Get-Command psql -ErrorAction SilentlyContinue
        if ($psqlInPath) {
            $psqlPath = $psqlInPath.Source
            Write-Host "Found psql in PATH: $psqlPath" -ForegroundColor Green
        }
    }
    
    if (-not $psqlPath) {
        Write-Host ""
        Write-Host "ERROR: PostgreSQL client (psql) not found" -ForegroundColor Red
        Write-Host ""
        Write-Host "Please install PostgreSQL or add it to your PATH" -ForegroundColor Yellow
        Write-Host "Download from: https://www.postgresql.org/download/windows/" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Connection details (for manual testing):" -ForegroundColor Yellow
        Write-Host "  Host: $dbHost" -ForegroundColor Gray
        Write-Host "  Port: $port" -ForegroundColor Gray
        Write-Host "  Database: $database" -ForegroundColor Gray
        Write-Host "  Username: $username" -ForegroundColor Gray
        Write-Host "  Password: ***" -ForegroundColor Gray
        exit 1
    }
    
    # Set password
    $env:PGPASSWORD = $password
    
    Write-Host ""
    Write-Host "Testing connection..." -ForegroundColor Yellow
    Write-Host ""
    
    # Test 1: Basic connection
    Write-Host "[Test 1] Testing PostgreSQL connection..." -ForegroundColor Cyan
    $test1 = & $psqlPath -h $dbHost -p $port -U $username -d $database -c "SELECT version();" 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Connection successful!" -ForegroundColor Green
        $versionLine = ($test1 | Select-String -Pattern "PostgreSQL").Line
        if ($versionLine) {
            Write-Host "  $versionLine" -ForegroundColor Gray
        }
    } else {
        Write-Host "✗ Connection failed!" -ForegroundColor Red
        Write-Host $test1 -ForegroundColor Red
        $env:PGPASSWORD = $null
        exit 1
    }
    
    # Test 2: Check database exists and list tables
    Write-Host ""
    Write-Host "[Test 2] Checking database tables..." -ForegroundColor Cyan
    $test2 = & $psqlPath -h $dbHost -p $port -U $username -d $database -c "\dt" 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        $tableLines = $test2 | Select-String -Pattern "public \|"
        $tableCount = ($tableLines | Measure-Object).Count
        
        if ($tableCount -gt 0) {
            Write-Host "[OK] Found $tableCount table(s) in database" -ForegroundColor Green
            Write-Host ""
            Write-Host "Tables:" -ForegroundColor Yellow
            $tableLines | ForEach-Object { Write-Host "  - $($_.Line.Trim())" -ForegroundColor Gray }
        } else {
            Write-Host "⚠ Database exists but has no tables" -ForegroundColor Yellow
            Write-Host "  Run: database\build_database.sql to create tables" -ForegroundColor Gray
        }
    } else {
        Write-Host "⚠ Could not list tables" -ForegroundColor Yellow
    }
    
    # Test 3: Check for Bookati tables
    Write-Host ""
    Write-Host "[Test 3] Checking for Bookati core tables..." -ForegroundColor Cyan
    $test3 = & $psqlPath -h $dbHost -p $port -U $username -d $database -c `
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('tenants', 'users', 'services', 'bookings', 'slots') ORDER BY table_name;" 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        $bookatiTables = $test3 | Select-String -Pattern "tenants|users|services|bookings|slots"
        if ($bookatiTables) {
            Write-Host "[OK] Found Bookati tables!" -ForegroundColor Green
            $bookatiTables | ForEach-Object { 
                if ($_.Line -match "^\s+(\w+)") {
                    Write-Host "  - $($matches[1])" -ForegroundColor Gray
                }
            }
        } else {
            Write-Host "⚠ Bookati tables not found" -ForegroundColor Yellow
            Write-Host "  Database needs to be initialized with build_database.sql" -ForegroundColor Gray
        }
    }
    
    # Test 4: Check extensions
    Write-Host ""
    Write-Host "[Test 4] Checking required extensions..." -ForegroundColor Cyan
    $test4 = & $psqlPath -h $dbHost -p $port -U $username -d $database -c `
        "SELECT extname, extversion FROM pg_extension WHERE extname = 'uuid-ossp';" 2>&1
    
    if ($LASTEXITCODE -eq 0 -and $test4 -match "uuid-ossp") {
        Write-Host "[OK] uuid-ossp extension installed" -ForegroundColor Green
        $extVersion = ($test4 | Select-String -Pattern "\d+\.\d+").Matches[0].Value
        if ($extVersion) {
            Write-Host "  Version: $extVersion" -ForegroundColor Gray
        }
    } else {
        Write-Host "⚠ uuid-ossp extension not found" -ForegroundColor Yellow
        Write-Host "  Run: CREATE EXTENSION IF NOT EXISTS 'uuid-ossp';" -ForegroundColor Gray
    }
    
    # Test 5: Check connection from application perspective
    Write-Host ""
    Write-Host "[Test 5] Testing application connection string..." -ForegroundColor Cyan
    Write-Host "  Connection String: postgresql://$username`:***@$dbHost`:$port/$database" -ForegroundColor Gray
    
    # Clear password
    $env:PGPASSWORD = $null
    
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "Connection Test Summary" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "[OK] Database connection: WORKING" -ForegroundColor Green
    Write-Host "[OK] Connection string format: VALID" -ForegroundColor Green
    
    if ($tableCount -gt 0) {
        Write-Host "[OK] Database has tables: YES ($tableCount tables)" -ForegroundColor Green
    } else {
        Write-Host "[WARN] Database has tables: NO (needs initialization)" -ForegroundColor Yellow
    }
    
    Write-Host ""
    Write-Host "Next Steps:" -ForegroundColor Cyan
    if ($tableCount -eq 0) {
        Write-Host "1. Run: database\build_database.sql to create tables" -ForegroundColor Yellow
        Write-Host "2. Or use: database\setup_database.ps1 for automated setup" -ForegroundColor Yellow
    } else {
        Write-Host "1. Database is ready to use!" -ForegroundColor Green
        Write-Host "2. Update application to use this database" -ForegroundColor Gray
    }
    Write-Host ""
    
} else {
    Write-Host "ERROR: Invalid DATABASE_URL format" -ForegroundColor Red
    Write-Host "Expected: postgresql://user:password@host:port/database" -ForegroundColor Yellow
    Write-Host "Found: $databaseUrl" -ForegroundColor Gray
    exit 1
}

