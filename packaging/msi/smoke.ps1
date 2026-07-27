# MSI smoke test (windows-latest CI; shared by packaging-ci and release so the
# release can never ship an MSI that packaging-ci did not prove installable).
# Installs the MSI per-user + silent, asserts payload/shortcuts/ARP, parses the
# installed install.ps1, uninstalls, asserts full cleanup.
param([Parameter(Mandatory=$true)][string]$MsiPath)
$ErrorActionPreference = 'Stop'

$msi = (Resolve-Path $MsiPath).Path
$log = Join-Path $env:TEMP 'exepad-msi-smoke.log'

function Fail([string]$msg) {
  if (Test-Path $log) { Get-Content $log -Tail 60 | Write-Host }
  throw $msg
}

$p = Start-Process msiexec -ArgumentList '/i', $msi, '/qn', '/l*v', $log -Wait -PassThru
if ($p.ExitCode -ne 0) { Fail "msiexec /i exited $($p.ExitCode)" }

$dir  = Join-Path $env:LOCALAPPDATA 'Programs\Exepad'
$menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Exepad'
foreach ($f in @(
  (Join-Path $dir 'install.ps1'),
  (Join-Path $dir 'Install Exepad.bat'),
  (Join-Path $menu 'Install or Update Exepad Studio.lnk'),
  (Join-Path $menu 'Exepad Studio.url')
)) {
  if (-not (Test-Path $f)) { Fail "missing after install: $f" }
}

# Per-user MSIs do NOT write the classic ...\CurrentVersion\Uninstall key;
# Windows Installer registers them under HKCU\Software\Microsoft\Installer\
# Products (Apps & Features enumerates via the MSI API). Assert there.
$productsKey = 'HKCU:\Software\Microsoft\Installer\Products'
$reg = Get-ChildItem $productsKey -ErrorAction SilentlyContinue |
  Where-Object { ($_ | Get-ItemProperty).ProductName -eq 'Exepad Studio' }
if (-not $reg) { Fail 'no per-user Windows Installer registration named "Exepad Studio"' }

# The installed launcher must parse (catches payload corruption in the cab).
$errs = $null
[System.Management.Automation.Language.Parser]::ParseFile(
  (Join-Path $dir 'install.ps1'), [ref]$null, [ref]$errs) | Out-Null
if ($errs.Count -gt 0) { Fail 'installed install.ps1 does not parse' }

$p = Start-Process msiexec -ArgumentList '/x', $msi, '/qn' -Wait -PassThru
if ($p.ExitCode -ne 0) { Fail "msiexec /x exited $($p.ExitCode)" }
if (Test-Path $dir)  { Fail "install dir left behind: $dir" }
if (Test-Path $menu) { Fail "Start Menu dir left behind: $menu" }
$reg = Get-ChildItem $productsKey -ErrorAction SilentlyContinue |
  Where-Object { ($_ | Get-ItemProperty).ProductName -eq 'Exepad Studio' }
if ($reg) { Fail 'Windows Installer registration left behind after uninstall' }

Write-Host 'MSI smoke OK: install -> payload/shortcuts/ARP verified -> uninstall clean'
