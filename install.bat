@echo off
:: NetDesign AI — Windows installer
:: Run with: powershell -Command "irm https://raw.githubusercontent.com/Amit33-design/Network-Automation/main/install.ps1 | iex"
:: Or double-click this batch file after downloading docker-compose.dist.yml and .env.example

setlocal enabledelayedexpansion

echo.
echo  NetDesign AI — Windows Installer
echo  ===================================
echo.

:: Check Docker
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker is not running. Start Docker Desktop and retry.
    pause
    exit /b 1
)

set "INSTALL_DIR=%USERPROFILE%\.netdesign"
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
cd /d "%INSTALL_DIR%"

echo [netdesign] Installing to %INSTALL_DIR%

:: Download compose + env template
powershell -Command "Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/Amit33-design/Network-Automation/main/docker-compose.dist.yml' -OutFile docker-compose.yml"
powershell -Command "Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/Amit33-design/Network-Automation/main/.env.example' -OutFile .env.example"

:: Generate .env if not present
if not exist ".env" (
    copy .env.example .env >nul

    :: Generate secrets with PowerShell
    for /f %%i in ('powershell -Command "[System.Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))"') do set JWT_SECRET=%%i
    for /f %%i in ('powershell -Command "[System.Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(16))"') do set PG_PASS=%%i
    for /f %%i in ('powershell -Command "[System.Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(16))"') do set REDIS_PASS=%%i
    for /f %%i in ('powershell -Command "[System.Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(16))"') do set VAULT_TOKEN=%%i
    for /f %%i in ('powershell -Command "[System.Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(12))"') do set ADMIN_PASS=%%i

    echo.
    echo  Generated admin password: !ADMIN_PASS!
    echo  SAVE THIS — you will need it to log in.
    echo.

    powershell -Command "(Get-Content .env) -replace 'change_me_strong_password_here','!PG_PASS!' | Set-Content .env"
    powershell -Command "(Get-Content .env) -replace 'change_me_redis_password_here','!REDIS_PASS!' | Set-Content .env"
    powershell -Command "(Get-Content .env) -replace 'change_me_256bit_random_secret_here','!JWT_SECRET!' | Set-Content .env"
    powershell -Command "(Get-Content .env) -replace 'change_me_admin_password_here','!ADMIN_PASS!' | Set-Content .env"
    powershell -Command "(Get-Content .env) -replace 'change_me_vault_root_token_here','!VAULT_TOKEN!' | Set-Content .env"
    echo [netdesign] .env created with random secrets
)

set /p LICENSE_KEY="License key (leave blank for Community tier): "
if not "!LICENSE_KEY!"=="" (
    powershell -Command "(Get-Content .env) -replace '^LICENSE_KEY=.*','LICENSE_KEY=!LICENSE_KEY!' | Set-Content .env"
    echo [netdesign] License key saved
)

echo.
echo [netdesign] Pulling images...
docker compose pull

echo.
echo [netdesign] Starting NetDesign AI...
docker compose up -d

echo.
echo  ================================================================
echo   NetDesign AI is running!
echo.
echo   Web UI  -^> http://localhost:8080
echo   API     -^> http://localhost:8000/docs
echo   MCP SSE -^> http://localhost:8001/sse
echo.
echo   Manage: cd %INSTALL_DIR% ^&^& docker compose [up^|down^|logs]
echo  ================================================================
echo.
pause
