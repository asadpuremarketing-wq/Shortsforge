@echo off
setlocal
title ShortsForge
cd /d "%~dp0"

rem ---- 1. Node.js (installed automatically the first time) ----
where node >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Installing it now - this only happens once...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
)
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Could not install Node.js automatically.
  echo Please install the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 (
  echo Your Node.js is too old ^(version %NODE_MAJOR%^). Updating it...
  winget upgrade -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  echo Please close this window and start ShortsForge again.
  pause
  exit /b 1
)

rem ---- 2. Already running? Just open it. ----
netstat -ano | findstr /r /c:":5173 .*LISTENING" >nul
if not errorlevel 1 (
  echo ShortsForge is already running. Opening it in your browser...
  start "" http://localhost:5173/#/ranking
  exit /b 0
)

rem ---- 3. Install or refresh packages when they are missing or changed by an update ----
set NEED_INSTALL=0
if not exist node_modules set NEED_INSTALL=1
if not exist node_modules\.lock-copy set NEED_INSTALL=1
if exist node_modules\.lock-copy (
  fc /b package-lock.json node_modules\.lock-copy >nul 2>nul || set NEED_INSTALL=1
)
if %NEED_INSTALL%==1 (
  echo Installing ShortsForge - this takes a minute the first time...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
  copy /y package-lock.json node_modules\.lock-copy >nul
)

rem ---- 4. Start ----
if not defined SF_NO_BROWSER start "" cmd /c "timeout /t 3 >nul && start http://localhost:5173/#/ranking"
echo.
echo ShortsForge is running at http://localhost:5173
echo Keep this window open while you work. Close it to stop ShortsForge.
echo.
node server/index.js
pause
