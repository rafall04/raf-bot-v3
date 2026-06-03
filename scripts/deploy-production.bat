@echo off
setlocal enabledelayedexpansion

REM ============================================
REM   RAF Bot V2 - Production Deployment Script (Enhanced)
REM   With Database Safety Checks
REM ============================================

echo.
echo ============================================
echo    RAF Bot V2 - Production Deployment
echo ============================================
echo.

REM Configuration
set APP_NAME=raf-bot
set APP_DIR=%CD%
set BACKUP_DIR=%APP_DIR%\backups

REM Set production environment
set NODE_ENV=production

REM Check if running in correct directory
if not exist "package.json" (
    echo [ERROR] Not in RAF Bot directory!
    echo Please run this script from the RAF Bot root directory.
    pause
    exit /b 1
)

REM Pre-deployment checks
echo [INFO] Running pre-deployment checks...
node scripts\pre-deploy-check.js
if %errorlevel% neq 0 (
    echo [ERROR] Pre-deployment checks failed!
    pause
    exit /b 1
)
echo [OK] Pre-deployment checks passed
echo.

REM Create backup of database
echo [INFO] Creating database backup...
REM All databases stored in database/ folder
if exist "database\database.sqlite" (
    if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
    set BACKUP_NAME=database_backup_%date:~-4%%date:~3,2%%date:~0,2%_%time:~0,2%%time:~3,2%%time:~6,2%.sqlite
    set BACKUP_NAME=!BACKUP_NAME: =0!
    copy /Y "database\database.sqlite" "%BACKUP_DIR%\!BACKUP_NAME!" >nul
    if %errorlevel% equ 0 (
        echo [OK] Database backup created: !BACKUP_NAME!
    ) else (
        echo [WARNING] Failed to create database backup
    )
) else (
    echo [INFO] No existing database found, skipping backup
)
echo.

REM Pull latest code (if git repo exists)
if exist ".git" (
    echo [INFO] Pulling latest code...
    git fetch origin main 2>nul
    git pull origin main
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to pull latest code!
        pause
        exit /b 1
    )
    echo [OK] Code updated
) else (
    echo [INFO] No git repository found, skipping code update
)
echo.

REM Install dependencies
echo [INFO] Installing dependencies...
if exist "package-lock.json" (
    call npm ci --production
) else (
    call npm install --production
)
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies!
    pause
    exit /b 1
)
echo [OK] Dependencies installed
echo.

REM Run safe migrations
echo [INFO] Running database migrations...
if exist "scripts\safe-migrate.js" (
    set NODE_ENV=production
    node scripts\safe-migrate.js
    if %errorlevel% neq 0 (
        echo [ERROR] Database migration failed!
        echo [WARNING] Please restore from backup if needed
        pause
        exit /b 1
    )
    echo [OK] Database migrations completed
) else (
    echo [WARNING] Safe migration script not found, skipping
)
echo.

REM Restart application
echo [INFO] Restarting application...
where pm2 >nul 2>&1
if %errorlevel% equ 0 (
    pm2 list | findstr /C:"%APP_NAME%" >nul 2>&1
    if %errorlevel% equ 0 (
        pm2 reload %APP_NAME% --update-env
        echo [OK] Application reloaded
    ) else (
        pm2 start index.js --name %APP_NAME%
        echo [OK] Application started
    )
    pm2 save >nul 2>&1
) else (
    echo [WARNING] PM2 not found, application not restarted
    echo [INFO] Please restart the application manually
)
echo.

REM Health check
echo [INFO] Performing health check...
timeout /t 5 /nobreak >nul
curl -f -s -o nul http://localhost:3100/health 2>nul
if %errorlevel% equ 0 (
    echo [OK] Health check passed
) else (
    echo [WARNING] Health check failed - check application logs
)
echo.

echo ============================================
echo    Deployment completed successfully!
echo ============================================
echo.
echo Useful commands:
echo   - View status: pm2 status
echo   - View logs: pm2 logs %APP_NAME%
echo   - Monitor: pm2 monit
echo.
pause
exit /b 0

