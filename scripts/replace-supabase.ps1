# Script to replace all Supabase imports with PostgreSQL client

$files = @(
    "src\lib\capacityUtils.ts",
    "src\pages\employee\EmployeePage.tsx",
    "src\pages\reception\ReceptionPage.tsx",
    "src\pages\public\PublicBookingPage.tsx",
    "src\pages\auth\SignupPage.tsx",
    "src\pages\admin\SolutionOwnerDashboard.tsx",
    "src\pages\admin\TenantFeaturesPage.tsx",
    "src\pages\tenant\PackagesPage.tsx",
    "src\pages\tenant\SettingsPage.tsx",
    "src\pages\tenant\TenantDashboardContent.tsx",
    "src\pages\tenant\ServicesPage.tsx",
    "src\pages\tenant\LandingPageBuilder.tsx",
    "src\pages\tenant\EmployeesPage.tsx",
    "src\pages\tenant\BookingsPage.tsx",
    "src\pages\tenant\TenantDashboard.tsx",
    "src\hooks\useTenantFeatures.ts"
)

$projectRoot = "E:\New folder\sauidi tower\project"

foreach ($file in $files) {
    $fullPath = Join-Path $projectRoot $file
    if (Test-Path $fullPath) {
        Write-Host "Processing: $file" -ForegroundColor Yellow
        $content = Get-Content $fullPath -Raw
        
        # Replace imports
        $content = $content -replace "import\s+\{\s*supabase\s*\}\s+from\s+['""]\.\.\/lib\/supabase['""]", "import { db } from '../lib/db'"
        $content = $content -replace "import\s+\{\s*supabase\s*\}\s+from\s+['""]\.\.\/\.\.\/lib\/supabase['""]", "import { db } from '../../lib/db'"
        $content = $content -replace "import\s+\{\s*supabase\s*\}\s+from\s+['""]\.\.\/\.\.\/\.\.\/lib\/supabase['""]", "import { db } from '../../../lib/db'"
        $content = $content -replace "import\s+\{\s*supabaseAdmin\s*\}\s+from\s+['""]\.\.\/lib\/supabase-admin['""]", "import { supabaseAdmin } from '../lib/supabase-admin'"
        
        # Replace supabase with db
        $content = $content -replace "\bsupabase\b", "db"
        
        Set-Content -Path $fullPath -Value $content -NoNewline
        Write-Host "  ✓ Updated" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "All files updated!" -ForegroundColor Green

