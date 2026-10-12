@echo off
setlocal
title Update ShortsForge
rem This file replaces itself during the update, so it runs from a temporary copy.
if not "%~1"=="--run" (
  copy /y "%~f0" "%TEMP%\shortsforge-update.bat" >nul
  call "%TEMP%\shortsforge-update.bat" --run "%~dp0"
  exit /b
)
set "APP=%~2"
cd /d "%APP%"

netstat -ano | findstr /r /c:":5173 .*LISTENING" >nul
if not errorlevel 1 (
  echo ShortsForge is running. Close its window first, then run this update again.
  pause
  exit /b 1
)

echo Downloading the latest ShortsForge...
if exist ".git" (
  git pull --ff-only
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference='Stop';" ^
    "$zip = Join-Path $env:TEMP 'shortsforge.zip'; $out = Join-Path $env:TEMP 'shortsforge-update';" ^
    "Invoke-WebRequest 'https://github.com/asadpuremarketing-wq/Shortsforge/archive/refs/heads/main.zip' -OutFile $zip;" ^
    "if (Test-Path $out) { Remove-Item $out -Recurse -Force };" ^
    "Expand-Archive $zip $out;" ^
    "$src = (Get-ChildItem $out | Select-Object -First 1).FullName;" ^
    "$dst = $env:APP.TrimEnd('\'); robocopy $src $dst /E /XD data node_modules .git /XF .env /NFL /NDL /NJH /NJS /NP | Out-Null;" ^
    "if ($LASTEXITCODE -ge 8) { throw 'Copying the new files failed.' }"
)
if errorlevel 1 (
  echo.
  echo The update failed. Your projects are safe - nothing in the data folder was touched.
  pause
  exit /b 1
)
echo.
echo Updated. Your projects and settings were kept.
echo Start ShortsForge again - it will finish installing anything new.
pause
