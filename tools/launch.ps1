# ShortsForge launcher: installs what's missing, updates, and starts the app.
# PowerShell reads this whole file before running it, so an update can safely replace it.
$ErrorActionPreference = 'Stop'
$App = Split-Path -Parent $PSScriptRoot
Set-Location $App
$Host.UI.RawUI.WindowTitle = 'ShortsForge'
$Url = 'http://localhost:5173/#/ranking'

function Say([string]$Text, [string]$Color = 'Gray') { Write-Host $Text -ForegroundColor $Color }
function Fail([string]$Text) {
  Say ''
  Say $Text Red
  Read-Host 'Press Enter to close' | Out-Null
  exit 1
}

Say ''
Say '  ShortsForge' Cyan
Say ''

# ---- 1. Node.js (installed automatically the first time) ----
function Find-Node {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $default = Join-Path $env:ProgramFiles 'nodejs\node.exe'
  if (Test-Path $default) {
    $env:Path = "$(Split-Path $default);$env:Path"
    return $default
  }
  return $null
}
if (-not (Find-Node)) {
  Say 'Node.js is not installed. Installing it now (one time only)...' Cyan
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) { Fail 'Could not install Node.js automatically. Install the LTS version from https://nodejs.org and start ShortsForge again.' }
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (Find-Node)) { Fail 'Node.js was installed, but Windows needs a moment. Close this window and start ShortsForge again.' }
}
$major = [int]((node -p "process.versions.node.split('.')[0]") | Out-String).Trim()
if ($major -lt 20) {
  Say "Your Node.js is too old (version $major). Updating it..." Yellow
  winget upgrade -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  Fail 'Node.js was updated. Close this window and start ShortsForge again.'
}

# ---- 2. Already running? Just open it. ----
if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) {
  Say 'ShortsForge is already running. Opening it in your browser...' Green
  if (-not $env:SF_NO_BROWSER) { Start-Process $Url }
  exit 0
}

# ---- 3. Automatic update ----
if (-not $env:SF_NO_UPDATE) {
  & (Join-Path $PSScriptRoot 'update.ps1') -Quiet | Out-Null
}

# ---- 4. Install or refresh packages when missing or changed by an update ----
$lock = Join-Path $App 'package-lock.json'
$copy = Join-Path $App 'node_modules\.lock-copy'
$needInstall = -not (Test-Path $copy)
if (-not $needInstall) { $needInstall = (Get-FileHash $lock).Hash -ne (Get-FileHash $copy).Hash }
if ($needInstall) {
  Say 'Installing ShortsForge - this takes a minute the first time...' Cyan
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail 'Install failed. Check your internet connection and try again.' }
  Copy-Item $lock $copy -Force
}

# ---- 5. Desktop shortcut (first run only; the Desktop may live in OneDrive) ----
if (-not $env:SF_NO_SHORTCUT) {
  $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'ShortsForge.lnk'
  if (-not (Test-Path $lnk)) {
    try {
      $s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
      $s.TargetPath = Join-Path $App 'Start ShortsForge.bat'
      $s.WorkingDirectory = $App
      $s.Description = 'Start ShortsForge'
      $s.Save()
      Say 'A ShortsForge shortcut was added to your Desktop.' Green
    } catch { }
  }
}

# ---- 6. Start ----
if (-not $env:SF_NO_BROWSER) {
  Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', "Start-Sleep 3; Start-Process '$Url'"
}
Say ''
Say 'ShortsForge is running at http://localhost:5173' Green
Say 'Keep this window open while you work. Close it to stop ShortsForge.'
Say ''
node server/index.js
Read-Host 'ShortsForge stopped. Press Enter to close' | Out-Null
