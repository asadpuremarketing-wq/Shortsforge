# ShortsForge updater: installs the newest version from GitHub, keeping projects (data\) and keys (.env).
# Returns $true when files were updated.
param(
  [switch]$Quiet,       # used by the launcher: never fail, just report
  [switch]$Interactive  # used by "Update ShortsForge.bat": wait for Enter at the end
)

$ErrorActionPreference = 'Stop'
$App = Split-Path -Parent $PSScriptRoot
$Repo = 'asadpuremarketing-wq/Shortsforge'
$Stamp = Join-Path $App 'data\installed-version.txt'

function Say([string]$Text, [string]$Color = 'Gray') { Write-Host $Text -ForegroundColor $Color }

function Finish([bool]$Updated) {
  if ($Interactive) {
    Write-Host ''
    Read-Host 'Press Enter to close' | Out-Null
  }
  return $Updated
}

# Never update while ShortsForge is running: files would change under it.
$running = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
if ($running -and $Interactive) {
  Say 'ShortsForge is running. Close its window first, then run this update again.' Yellow
  return (Finish $false)
}

# Developer copy (cloned with git): just pull.
if (Test-Path (Join-Path $App '.git')) {
  $git = Get-Command git -ErrorAction SilentlyContinue
  if ($git) {
    try {
      Say 'Checking for updates (git)...'
      git -C $App pull --ff-only --quiet 2>$null
    } catch {
      Say 'Could not pull updates; continuing with this version.' Yellow
    }
  }
  return (Finish $false)
}

try {
  Say 'Checking for updates...'
  $headers = @{ 'User-Agent' = 'ShortsForge-updater' }
  $latest = (Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/commits/main" -Headers $headers -TimeoutSec 10).sha
  $current = if (Test-Path $Stamp) { (Get-Content $Stamp -Raw).Trim() } else { '' }
  if ($latest -eq $current) {
    Say 'ShortsForge is up to date.' Green
    return (Finish $false)
  }

  Say 'Downloading the latest version...' Cyan
  $zip = Join-Path $env:TEMP 'shortsforge-update.zip'
  $out = Join-Path $env:TEMP 'shortsforge-update'
  if (Test-Path $out) { Remove-Item $out -Recurse -Force }
  Invoke-WebRequest -Uri "https://github.com/$Repo/archive/$latest.zip" -OutFile $zip -UseBasicParsing -Headers $headers -TimeoutSec 120
  Expand-Archive -Path $zip -DestinationPath $out -Force
  $src = (Get-ChildItem $out | Select-Object -First 1).FullName

  # Copy everything except projects, keys, installed packages and git data.
  robocopy $src $App /E /XD data node_modules .git /XF .env /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw 'Copying the new files failed.' }
  Get-ChildItem $App -Recurse -File -Include *.ps1, *.bat, *.js -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue

  New-Item -ItemType Directory -Force (Split-Path $Stamp) | Out-Null
  Set-Content -Path $Stamp -Value $latest -Encoding ASCII
  Remove-Item $zip, $out -Recurse -Force -ErrorAction SilentlyContinue
  Say 'Updated to the latest version. Your projects and settings were kept.' Green
  return (Finish $true)
} catch {
  if ($Quiet) {
    Say "Couldn't check for updates (offline?). Starting this version." Yellow
    return $false
  }
  Say "Update failed: $($_.Exception.Message)" Red
  Say 'Your projects are safe - nothing in the data folder was touched.' Yellow
  return (Finish $false)
}
