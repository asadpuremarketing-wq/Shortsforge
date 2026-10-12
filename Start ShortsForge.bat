@echo off
title ShortsForge
cd /d "%~dp0"
if not exist node_modules (
  echo Installing for the first time, this takes a minute...
  call npm install
)
rem Open the browser a moment after the server starts.
start "" cmd /c "timeout /t 3 >nul && start http://localhost:5173/#/ranking"
echo ShortsForge is running. Keep this window open while you work; close it to stop.
call npm start
pause
