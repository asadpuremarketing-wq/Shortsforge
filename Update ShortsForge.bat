@echo off
rem Optional: ShortsForge already updates itself each time it starts. Use this to update without starting it.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\update.ps1" -Interactive
