@echo off
echo ============================================================
echo   FIX MISSING SCHEDULES - Quick Start
echo ============================================================
echo.
echo This script will:
echo   1. Create shifts for services without them
echo   2. Generate slots for the next 60 days
echo   3. Regenerate slots for existing shifts
echo.
echo Press any key to continue or Ctrl+C to cancel...
pause >nul

cd /d "%~dp0"

echo.
echo Running fix script...
echo.

node scripts\create-missing-shifts-and-slots.js

echo.
echo ============================================================
echo   DONE!
echo ============================================================
echo.
echo Next steps:
echo   1. Test booking as a customer
echo   2. Test booking at reception
echo   3. Verify all services have schedules
echo.
pause


