# LehroSol CLI (alias: lehr-sol) Windows installer — the PowerShell counterpart
# of install.sh. Usage (from a cloned repo):
#   powershell -ExecutionPolicy Bypass -File install.ps1
# or for a global npm install:
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Global
param(
  [switch]$Global
)

$ErrorActionPreference = 'Stop'

function Log($msg)  { Write-Host "[lehro] $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "[lehro] $msg" -ForegroundColor Red; exit 1 }

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js 20+ is required. Install Node, then re-run this script." }

$nodeMajor = [int](& node -p 'process.versions.node.split(".")[0]')
if ($nodeMajor -lt 20) { Fail "Node.js 20+ required, found $(node -v)." }

if ($Global) {
  Log "Installing via npm (global)"
  npm install -g @lehrosolutions/cli@beta
  if ($LASTEXITCODE -ne 0) { Fail "npm install failed." }
} else {
  $repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
  $bin = Join-Path $repoRoot 'bin\lehrosol.js'
  if (-not (Test-Path $bin)) { Fail "bin\lehrosol.js not found next to install.ps1 — run this from a clone of the repo." }

  $installDir = if ($env:LEHRO_INSTALL_DIR) { $env:LEHRO_INSTALL_DIR } else { Join-Path $env:USERPROFILE '.lehro\bin' }
  New-Item -ItemType Directory -Force -Path $installDir | Out-Null

  Log "Creating launchers in $installDir (add this folder to your PATH)"
  $cmd = Join-Path $installDir 'lehrosol.cmd'
  @'
@echo off
node "%~dp0..\..\lehrosol-cli\bin\lehrosol.js" %*
'@ | Out-Null
  # Launchers point at the cloned repo directly (no copying, stays in sync with git pull)
  Set-Content -Path (Join-Path $installDir 'lehrosol.cmd') -Value "@echo off`r`nnode `"$bin`" %*"
  Set-Content -Path (Join-Path $installDir 'lehr-sol.cmd') -Value "@echo off`r`nnode `"$bin`" %*"

  if ($env:PATH -notlike "*$installDir*") {
    Log "Adding $installDir to your user PATH"
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    [Environment]::SetEnvironmentVariable('Path', "$userPath;$installDir", 'User')
    $env:PATH = "$env:PATH;$installDir"
  }
}

Log "Installed. Try: lehrosol --help   (short alias: lehr-sol --help)"
