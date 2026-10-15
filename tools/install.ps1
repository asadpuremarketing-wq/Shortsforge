# ShortsForge installer: copies the app to a permanent folder, adds shortcuts and an
# uninstall entry, then starts it. Run from an unzipped copy, or on its own (it then downloads the app):
#   irm https://raw.githubusercontent.com/asadpuremarketing-wq/Shortsforge/main/tools/install.ps1 | iex
# Files PowerShell downloads aren't marked as "from the internet", so Smart App Control doesn't block them.
$ErrorActionPreference = 'Stop'
$Repo = 'asadpuremarketing-wq/Shortsforge'
$Target = if ($env:SF_INSTALL_DIR) { $env:SF_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Programs\ShortsForge' }
$Host.UI.RawUI.WindowTitle = 'ShortsForge Setup'

Add-Type -AssemblyName System.Windows.Forms
function Ask([string]$Text, [string]$Buttons = 'YesNo', [string]$Icon = 'Question') {
  if ($env:SF_SETUP_YES) { Say $Text; return 'Yes' }  # automated tests
  $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
  $r = [System.Windows.Forms.MessageBox]::Show($owner, $Text, 'ShortsForge Setup', $Buttons, $Icon)
  $owner.Dispose()
  return $r
}
function Say([string]$Text, [string]$Color = 'Gray') { Write-Host $Text -ForegroundColor $Color }
function Fail([string]$Text) {
  Ask $Text 'OK' 'Error' | Out-Null
  exit 1
}

# No script folder when run as a pasted one-line command (irm ... | iex): download mode.
$Src = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { '' }
$fromFolder = $Src -and (Test-Path (Join-Path $Src 'server\index.js'))
$sameFolder = $fromFolder -and ((Resolve-Path $Src).Path.TrimEnd('\') -ieq $Target.TrimEnd('\'))
$installed = Test-Path (Join-Path $Target 'server\index.js')

if ($installed) {
  $msg = "ShortsForge is already installed on this PC.`n`nReinstall it with this version? Your projects and settings are kept."
} else {
  $msg = "Install ShortsForge on this PC?`n`nIt will be added to your Desktop and Start menu. The first start takes a few minutes while it sets itself up."
}
if ((Ask $msg) -ne 'Yes') { exit 0 }

if (-not $env:SF_SETUP_NO_START -and (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue)) {
  Fail 'ShortsForge is running right now. Close its black window, then run the installer again.'
}

Say ''
Say '  Installing ShortsForge...' Cyan
Say ''

# ---- 1. Copy the app (projects in data\ and keys in .env are never touched) ----
$tmp = $null
$sha = $null
try {
  if (-not $sameFolder) {
    if (-not $fromFolder) {
      Say 'Downloading ShortsForge...'
      $headers = @{ 'User-Agent' = 'ShortsForge-setup' }
      $sha = (Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/commits/main" -Headers $headers -TimeoutSec 15).sha
      $tmp = Join-Path $env:TEMP 'shortsforge-setup'
      if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
      New-Item -ItemType Directory -Force $tmp | Out-Null
      $zip = Join-Path $tmp 'app.zip'
      Invoke-WebRequest -Uri "https://github.com/$Repo/archive/$sha.zip" -OutFile $zip -UseBasicParsing -Headers $headers -TimeoutSec 180
      Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp 'x') -Force
      $Src = (Get-ChildItem (Join-Path $tmp 'x') | Select-Object -First 1).FullName
    }
    Say "Copying files to $Target..."
    New-Item -ItemType Directory -Force $Target | Out-Null
    robocopy $Src $Target /E /XD data node_modules .git /XF .env /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw 'Copying the files failed.' }
    Get-ChildItem $Target -Recurse -File -Include *.ps1, *.bat, *.js -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
    if ($sha) {
      New-Item -ItemType Directory -Force (Join-Path $Target 'data') | Out-Null
      Set-Content -Path (Join-Path $Target 'data\installed-version.txt') -Value $sha -Encoding ASCII
    }
  }
} catch {
  Fail "Installing failed: $($_.Exception.Message)`n`nCheck your internet connection and try again."
} finally {
  if ($tmp) { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}

# ---- 2. Shortcuts on the Desktop and in the Start menu ----
$start = Join-Path $Target 'Start ShortsForge.bat'
$icon = Join-Path $Target 'tools\shortsforge.ico'
$shell = New-Object -ComObject WScript.Shell
$links = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'ShortsForge.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'ShortsForge.lnk')
)
if ($env:SF_NO_SHORTCUT) { $links = @() }
foreach ($lnk in $links) {
  try {
    $s = $shell.CreateShortcut($lnk)
    $s.TargetPath = $start
    $s.WorkingDirectory = $Target
    $s.IconLocation = $icon
    $s.Description = 'Start ShortsForge'
    $s.Save()
  } catch { }
}

# ---- 3. Uninstall entry in Settings > Apps ----
if (-not $env:SF_NO_SHORTCUT) { try {
  $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ShortsForge'
  New-Item -Path $key -Force | Out-Null
  $uninstall = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$Target\tools\uninstall.ps1`""
  @{
    DisplayName = 'ShortsForge'; Publisher = 'ShortsForge'; DisplayIcon = $icon
    InstallLocation = $Target; UninstallString = $uninstall
  }.GetEnumerator() | ForEach-Object { Set-ItemProperty -Path $key -Name $_.Key -Value $_.Value }
  Set-ItemProperty -Path $key -Name NoModify -Value 1 -Type DWord
  Set-ItemProperty -Path $key -Name NoRepair -Value 1 -Type DWord
} catch { } }

Say 'Installed. Starting ShortsForge...' Green

# ---- 4. Start it (the launcher installs Node.js and packages on the first run) ----
if (-not $env:SF_SETUP_NO_START) { & (Join-Path $Target 'tools\launch.ps1') }
