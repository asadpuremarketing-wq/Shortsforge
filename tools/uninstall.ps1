# ShortsForge uninstaller (Settings > Apps > ShortsForge > Uninstall).
$ErrorActionPreference = 'Stop'
$App = Split-Path -Parent $PSScriptRoot
$Key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ShortsForge'
Set-Location $env:TEMP  # so the app folder isn't in use

Add-Type -AssemblyName System.Windows.Forms
function Ask([string]$Text, [string]$Buttons = 'YesNo', [string]$Icon = 'Question') {
  if ($env:SF_SETUP_YES) { Write-Host $Text; return 'Yes' }  # automated tests
  $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
  $r = [System.Windows.Forms.MessageBox]::Show($owner, $Text, 'Uninstall ShortsForge', $Buttons, $Icon)
  $owner.Dispose()
  return $r
}

if ((Ask 'Remove ShortsForge from this PC?') -ne 'Yes') { exit 0 }
$keep = (Ask "Keep your projects and videos?`n`nYes keeps them in:`n$App\data`nNo deletes them for good." 'YesNo' 'Warning') -eq 'Yes'

# Stop it if it's running.
if (-not $env:SF_SETUP_NO_START) {
  Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue } |
    Where-Object { $_.ProcessName -eq 'node' } | Stop-Process -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 500

if (-not $env:SF_NO_SHORTCUT) {
  foreach ($lnk in @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'ShortsForge.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'ShortsForge.lnk')
  )) { Remove-Item $lnk -Force -ErrorAction SilentlyContinue }
  Remove-Item $Key -Recurse -Force -ErrorAction SilentlyContinue
}

if ($keep) {
  Get-ChildItem $App -Force | Where-Object { $_.Name -ne 'data' } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
} else {
  Remove-Item $App -Recurse -Force -ErrorAction SilentlyContinue
}

Ask 'ShortsForge was removed.' 'OK' 'Information' | Out-Null
