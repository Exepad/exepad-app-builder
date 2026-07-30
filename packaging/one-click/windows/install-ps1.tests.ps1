# Behavioural tests for install.ps1, run under WINDOWS POWERSHELL 5.1.
#
# Why this file exists: packaging-ci already parses install.ps1 under 5.1 and
# runs it with -DryRun. Neither catches anything here. -DryRun returns early from
# Show-SetupToken and never writes a .env, so two defects shipped that made a
# successful install look broken to the user:
#
#   * Merge-EnvFile folded the LLM key into a comment line when the existing
#     .env had exactly one surviving line (a pipeline yielding one item is a
#     [string], and += on a string concatenates).
#   * Every `native 2>&1` capture threw NativeCommandError under EAP=Stop, so
#     the first-run setup token was never printed - the install "worked" and
#     then asked for a token the user had no way to see.
#
# These tests need no Docker and no network: they load the function definitions
# out of install.ps1 with the PowerShell parser (so they test the shipped file,
# not a copy) and exercise them directly.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File packaging/one-click/windows/install-ps1.tests.ps1
[CmdletBinding()]
param([string]$ScriptPath)

$ErrorActionPreference = 'Stop'
if (-not $ScriptPath) {
  $ScriptPath = Join-Path (Split-Path (Split-Path (Split-Path $PSScriptRoot))) 'install.ps1'
}
$ScriptPath = (Resolve-Path $ScriptPath).Path

$script:Failures = 0
function Check([string]$name, [bool]$ok, [string]$detail) {
  if ($ok) {
    Write-Host "  ok    $name"
  } else {
    Write-Host "  FAIL  $name" -ForegroundColor Red
    if ($detail) { Write-Host "        $detail" -ForegroundColor Red }
    $script:Failures++
  }
}

# ---- load the functions without running the script's main block ----------------
# install.ps1 ends in a main block that talks to Docker, so it cannot simply be
# dot-sourced. Lift just the function definitions out of the real file.
$errs = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($ScriptPath, [ref]$null, [ref]$errs)
if ($errs.Count -gt 0) {
  Write-Host "install.ps1 does not parse under PowerShell $($PSVersionTable.PSVersion)" -ForegroundColor Red
  exit 1
}
$funcs = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)
foreach ($f in $funcs) { . ([scriptblock]::Create($f.Extent.Text)) }
Write-Host "loaded $($funcs.Count) functions from $ScriptPath"
Write-Host ''

# ---- Merge-EnvFile -------------------------------------------------------------
Write-Host 'Merge-EnvFile'
$tmp = Join-Path $env:TEMP ("exepad-envtest-{0}.env" -f [guid]::NewGuid())

# The regression: ONE surviving line + an update. Must stay a separate line, and
# must not be glued onto the comment above it.
Set-Content -Path $tmp -Value "# my notes`r`nEXEPAD_LLM_API_KEY=OLDKEY" -NoNewline
$out = Merge-EnvFile $tmp @{ 'EXEPAD_LLM_API_KEY' = 'NEWKEY' }
# @() for the same reason Merge-EnvFile needs it: a one-item pipeline is a
# [string], and $lines[0] on a string yields its first CHARACTER.
$lines = @($out -split "`r`n" | Where-Object { $_ -ne '' })
Check 'one surviving line: key stays on its own line' `
  ($lines -contains 'EXEPAD_LLM_API_KEY=NEWKEY') "got: $($lines -join ' | ')"
Check 'one surviving line: comment is not corrupted' `
  ($lines -contains '# my notes') "got: $($lines -join ' | ')"
Check 'one surviving line: old value is gone' `
  (-not ($out -match 'OLDKEY')) "got: $out"

# Zero surviving lines (the .env held only the managed key).
Set-Content -Path $tmp -Value "EXEPAD_LLM_API_KEY=OLDKEY" -NoNewline
$out = Merge-EnvFile $tmp @{ 'EXEPAD_LLM_API_KEY' = 'NEWKEY' }
# @() for the same reason Merge-EnvFile needs it: a one-item pipeline is a
# [string], and $lines[0] on a string yields its first CHARACTER.
$lines = @($out -split "`r`n" | Where-Object { $_ -ne '' })
Check 'zero surviving lines: single key line' `
  (@($lines).Count -eq 1 -and $lines[0] -eq 'EXEPAD_LLM_API_KEY=NEWKEY') "got: $($lines -join ' | ')"

# Several surviving lines, several updates: operator-added lines are preserved.
Set-Content -Path $tmp -Value "# a`r`n# b`r`nMY_OWN=keepme`r`nEXEPAD_LLM_API_KEY=OLD" -NoNewline
$out = Merge-EnvFile $tmp @{ 'EXEPAD_LLM_API_KEY' = 'NEW'; 'EXEPAD_ADMIN_EMAIL' = 'a@b.c' }
# @() for the same reason Merge-EnvFile needs it: a one-item pipeline is a
# [string], and $lines[0] on a string yields its first CHARACTER.
$lines = @($out -split "`r`n" | Where-Object { $_ -ne '' })
Check 'many lines: operator-added line preserved' ($lines -contains 'MY_OWN=keepme') "got: $($lines -join ' | ')"
Check 'many lines: both managed keys written' `
  (($lines -contains 'EXEPAD_LLM_API_KEY=NEW') -and ($lines -contains 'EXEPAD_ADMIN_EMAIL=a@b.c')) `
  "got: $($lines -join ' | ')"

# Fresh install: no file yet.
Remove-Item $tmp -ErrorAction SilentlyContinue
$out = Merge-EnvFile $tmp @{ 'EXEPAD_LLM_API_KEY' = 'NEWKEY' }
# @() for the same reason Merge-EnvFile needs it: a one-item pipeline is a
# [string], and $lines[0] on a string yields its first CHARACTER.
$lines = @($out -split "`r`n" | Where-Object { $_ -ne '' })
Check 'fresh install: header + key' `
  (($lines.Count -eq 3) -and ($lines[2] -eq 'EXEPAD_LLM_API_KEY=NEWKEY')) "got: $($lines -join ' | ')"

# No updates at all (the -Yes, no-key path): file must round-trip unchanged.
Set-Content -Path $tmp -Value "# only a comment" -NoNewline
$out = Merge-EnvFile $tmp @{}
Check 'no updates: content round-trips' ($out.Trim() -eq '# only a comment') "got: $out"
Remove-Item $tmp -ErrorAction SilentlyContinue

# ---- Invoke-NativeCapture ------------------------------------------------------
# The whole point is that this does NOT throw when the callee writes to stderr
# while $ErrorActionPreference is 'Stop' - which is how install.ps1 runs.
Write-Host ''
Write-Host 'Invoke-NativeCapture (under $ErrorActionPreference = ''Stop'')'
$ErrorActionPreference = 'Stop'

$threw = $false
$captured = ''
try { $captured = Invoke-NativeCapture 'cmd' @('/c', 'echo to-stderr 1>&2') }
catch { $threw = $true }
Check 'stderr-only output does not throw' (-not $threw)
Check 'stderr-only output is captured' ($captured -match 'to-stderr') "got: '$captured'"

$captured = Invoke-NativeCapture 'cmd' @('/c', 'echo to-stdout')
Check 'stdout is captured' ($captured -match 'to-stdout') "got: '$captured'"

Invoke-NativeCapture 'cmd' @('/c', 'exit 3') | Out-Null
Check 'LASTEXITCODE survives the call' ($LASTEXITCODE -eq 3) "got: $LASTEXITCODE"

$ErrorActionPreference = 'Stop'
Invoke-NativeCapture 'cmd' @('/c', 'echo noise 1>&2 & exit 0') | Out-Null
Check 'exit 0 with stderr noise reads as success' ($LASTEXITCODE -eq 0) "got: $LASTEXITCODE"

$threw = $false
try { Invoke-NativeCapture 'definitely-not-a-real-binary-xyz' @('--version') | Out-Null }
catch { $threw = $true }
Check 'missing binary does not throw' (-not $threw)

# Guard the regression directly: no bare `native 2>&1` capture may come back.
Write-Host ''
Write-Host 'source guards'
$src = Get-Content $ScriptPath -Raw
Check 'no raw `docker ... 2>&1` capture outside the helper' `
  (-not ($src -match '(?m)^\s*(\$\w+\s*=\s*)?\(?\s*&?\s*docker[^\r\n]*2>&1')) `
  'use Invoke-NativeCapture instead - a raw capture throws on PS 5.1'

# Configuration belongs in the studio's Settings UI - the AI key is changeable
# later and nothing about it needs to happen during an install.
Check 'no prompt for the AI provider key' `
  (-not ($src -match 'Read-Host[^\r\n]*(LLM|API key)')) `
  'the AI key is set in the studio Settings UI, not during install'

# The operator password IS prompted for - that is ownership, not configuration,
# and it has to be settled before someone else settles it. But a masked prompt
# is indistinguishable from a hang, which is exactly how the old AI-key prompt
# stranded people, so the script must warn BEFORE it masks.
Check 'a masked prompt announces itself' `
  ((-not ($src -match '-AsSecureString')) -or ($src -match 'will NOT be shown')) `
  'say the typing is hidden before hiding it, or it reads as a freeze'

# ---- Test-Semver / Get-ImageRef ------------------------------------------------
Write-Host ''
Write-Host 'version handling'
Check 'semver accepted'        (Test-Semver '1.2.3')
Check 'prerelease accepted'    (Test-Semver '1.2.3-rc.1')
Check 'moving tag rejected'    (-not (Test-Semver 'latest'))

# ---- Assert-NoDowngrade --------------------------------------------------------
# Reads $Version and $Dir from the enclosing scope, and Get-DeployedTag reads the
# marker file, so drive it with a real temp install dir.
Write-Host ''
Write-Host 'Assert-NoDowngrade'
$Dir = Join-Path $env:TEMP ("exepad-dgtest-{0}" -f [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
function Set-Deployed([string]$tag) {
  [System.IO.File]::WriteAllText((Join-Path $Dir '.exepad-version'), (@{ tag = $tag } | ConvertTo-Json))
}
# Capture the warnings each case emits, so "silent" can be asserted.
function Get-DowngradeOutput([string]$deployed, [string]$target, [bool]$useForce) {
  Set-Deployed $deployed
  $script:Version = $target
  $script:Force = $useForce
  $threw = $false
  $text = ''
  try { $text = (Assert-NoDowngrade 6>&1 | Out-String) } catch { $threw = $true; $text = "$_" }
  return [pscustomobject]@{ Threw = $threw; Text = $text }
}

$Force = $false
# The regression: same version in and out is a repair, and must say nothing.
$r = Get-DowngradeOutput '1.0.3' '1.0.3' $false
Check 'same version: does not throw' (-not $r.Threw) $r.Text
Check 'same version: no "moving tag" warning' (-not ($r.Text -match 'moving tag')) "got: $($r.Text.Trim())"

$r = Get-DowngradeOutput '1.0.3' '1.1.0' $false
Check 'upgrade: allowed silently' ((-not $r.Threw) -and (-not ($r.Text -match 'moving tag'))) "got: $($r.Text.Trim())"

$r = Get-DowngradeOutput '1.1.0' '1.0.3' $false
Check 'downgrade: refused' ($r.Threw) "expected a throw; got: $($r.Text.Trim())"

$r = Get-DowngradeOutput '1.1.0' '1.0.3' $true
Check 'downgrade with -Force: allowed' (-not $r.Threw) "got: $($r.Text.Trim())"

$r = Get-DowngradeOutput '1.0.3' 'latest' $false
Check 'moving target: warns, does not throw' `
  ((-not $r.Threw) -and ($r.Text -match 'moving tag')) "got: $($r.Text.Trim())"

Remove-Item $Dir -Recurse -Force -ErrorAction SilentlyContinue

# ---- open-setup default ---------------------------------------------------------
# The installer defaults first-run setup to tokenless, but must never overwrite an
# operator's explicit choice - `EXEPAD_ALLOW_OPEN_SETUP=0` has to survive every
# later re-run, or the token they deliberately turned back on vanishes again.
# This mirrors the decision install.ps1 makes inline (it is not a function, so the
# predicate is asserted directly against the same source of truth).
Write-Host ''
Write-Host 'open-setup default'
function Test-OpenSetupDecision([string]$envText) {
  $adds = -not ($envText -match '(?m)^EXEPAD_ALLOW_OPEN_SETUP=')
  # [ \t\r] mirrors install.ps1: the .env it writes is CRLF, and `$` in multiline
  # mode leaves the \r unconsumed.
  $inEffect = if ($adds) { $true }
              else { [bool]($envText -match '(?m)^EXEPAD_ALLOW_OPEN_SETUP=[ \t]*(1|true|yes|on)[ \t\r]*$') }
  return [pscustomobject]@{ Adds = $adds; InEffect = $inEffect }
}

$r = Test-OpenSetupDecision "# fresh`r`n"
Check 'absent: defaults to open setup'  ($r.Adds -and $r.InEffect)

$r = Test-OpenSetupDecision "EXEPAD_ALLOW_OPEN_SETUP=0`r`n"
Check 'explicit 0: not overwritten'     (-not $r.Adds)
Check 'explicit 0: token mode in effect' (-not $r.InEffect)

$r = Test-OpenSetupDecision "EXEPAD_ALLOW_OPEN_SETUP=1`r`n"
Check 'explicit 1: not re-added'        (-not $r.Adds)
Check 'explicit 1: open setup in effect' ($r.InEffect)

$r = Test-OpenSetupDecision "EXEPAD_ALLOW_OPEN_SETUP=true`r`n"
Check 'explicit true: open setup in effect' ($r.InEffect)

# The predicate above must match what install.ps1 actually does.
Check 'install.ps1 defaults EXEPAD_ALLOW_OPEN_SETUP' `
  ($src -match "EXEPAD_ALLOW_OPEN_SETUP'\] = '1'") `
  'the tokenless-setup default is missing from install.ps1'
Check 'install.ps1 guards on an existing value' `
  ($src -match '-not \(\$envRaw -match') `
  'an explicit operator setting must not be overwritten'
# The CRLF trap above, asserted against the shipped source: a [ \t]*$ class here
# silently never matches the installer's own .env.
Check 'install.ps1 tolerates CRLF when reading the flag back' `
  ($src -match '\(1\|true\|yes\|on\)\[ \\t\\r\]\*\$') `
  'the trailing class must include \r - Merge-EnvFile writes CRLF'

# ---- operator account seeding ---------------------------------------------------
Write-Host ''
Write-Host 'operator account'
# seedAdminFromEnv calls createUser directly and does NOT enforce a length, so
# this check is the only thing standing between the seeded path and a weaker
# account than the setup form would have allowed.
Check 'password: 8 chars accepted'   (Test-OperatorPassword '12345678')
Check 'password: 7 chars rejected'   (-not (Test-OperatorPassword '1234567'))
Check 'password: empty rejected'     (-not (Test-OperatorPassword ''))
Check 'email: ordinary accepted'     (Test-OperatorEmail 'you@example.com')
Check 'email: no domain rejected'    (-not (Test-OperatorEmail 'you@'))
Check 'email: no at-sign rejected'   (-not (Test-OperatorEmail 'you.example.com'))
Check 'email: embedded space rejected' (-not (Test-OperatorEmail 'you @example.com'))

# Remove-EnvKey backs the "strip the password once the account exists" step.
$tmp2 = Join-Path $env:TEMP ("exepad-strip-{0}.env" -f [guid]::NewGuid())
Set-Content -Path $tmp2 -Value "# note`r`nEXEPAD_ADMIN_EMAIL=a@b.c`r`nEXEPAD_ADMIN_PASSWORD=hunter2secret`r`nEXEPAD_LLM_API_KEY=sk-x" -NoNewline
Remove-EnvKey $tmp2 'EXEPAD_ADMIN_PASSWORD'
$after = Get-Content $tmp2 -Raw
Check 'strip: password gone'          (-not ($after -match 'hunter2secret')) "got: $after"
Check 'strip: email kept'             ($after -match 'EXEPAD_ADMIN_EMAIL=a@b\.c')
Check 'strip: other keys kept'        ($after -match 'EXEPAD_LLM_API_KEY=sk-x')
Check 'strip: comment kept'           ($after -match '# note')
# One surviving line + strip - the scalar-collapse shape that bit Merge-EnvFile.
Set-Content -Path $tmp2 -Value "EXEPAD_ADMIN_PASSWORD=secret`r`nEXEPAD_ADMIN_EMAIL=a@b.c" -NoNewline
Remove-EnvKey $tmp2 'EXEPAD_ADMIN_PASSWORD'
$after = (Get-Content $tmp2 -Raw)
Check 'strip: single remaining line stays a line' `
  ($after.Trim() -eq 'EXEPAD_ADMIN_EMAIL=a@b.c') "got: '$($after.Trim())'"
Remove-Item $tmp2 -ErrorAction SilentlyContinue

# Seeding closes setup, so the open-setup flag must NOT also be written - if the
# seed failed, its absence leaves the token guard standing.
Check 'seeding suppresses the open-setup default' `
  ($src -match '\$account -or \(\$AdminEmail -and \$AdminPassword\)') `
  'a seeded admin must not also default the instance to open setup'

# ---- the prompt loop, driven with stubbed input ---------------------------------
# Read-OperatorAccount is split from its guards precisely so this is reachable:
# under any test harness stdin is redirected, so the real entry point always
# short-circuits and the validation loop would never be exercised.
Write-Host ''
Write-Host 'account prompt loop'
$script:StubEmails = @()
$script:StubSecrets = @()
$script:StubEmailIdx = 0
$script:StubSecretIdx = 0
function Read-Host { param([string]$Prompt) $v = $script:StubEmails[$script:StubEmailIdx]; $script:StubEmailIdx++; return $v }
function Read-Secret { param([string]$promptText) $v = $script:StubSecrets[$script:StubSecretIdx]; $script:StubSecretIdx++; return $v }
function Invoke-Prompt([string[]]$emails, [string[]]$secrets) {
  $script:StubEmails = $emails; $script:StubSecrets = $secrets
  $script:StubEmailIdx = 0; $script:StubSecretIdx = 0
  return (Read-OperatorAccount 6>&1 | Where-Object { $_ -is [hashtable] } | Select-Object -First 1)
}

$a = Invoke-Prompt @('you@example.com') @('longenough1')
Check 'happy path returns the account' `
  ($a -and $a.Email -eq 'you@example.com' -and $a.Password -eq 'longenough1') "got: $($a | Out-String)"

$a = Invoke-Prompt @('') @()
Check 'empty email skips (no account)' ($null -eq $a)

# A bad email must re-ask rather than abort - and must not consume a password.
$a = Invoke-Prompt @('nonsense', 'you@example.com') @('longenough1')
Check 'bad email re-asks, then succeeds' `
  ($a -and $a.Email -eq 'you@example.com') "got: $($a | Out-String)"

# A short password must re-ask, and must NOT leak through as the final value.
$a = Invoke-Prompt @('you@example.com', 'you@example.com') @('short', 'longenough1')
Check 'short password re-asks, then succeeds' `
  ($a -and $a.Password -eq 'longenough1') "got: $($a | Out-String)"

# Three bad attempts give up rather than looping forever.
$a = Invoke-Prompt @('you@example.com','you@example.com','you@example.com') @('a','b','c')
Check 'gives up after 3 attempts' ($null -eq $a) "got: $($a | Out-String)"

Remove-Item function:Read-Host -ErrorAction SilentlyContinue
Remove-Item function:Read-Secret -ErrorAction SilentlyContinue

Write-Host ''
if ($script:Failures -gt 0) {
  Write-Host "$($script:Failures) check(s) failed" -ForegroundColor Red
  exit 1
}
Write-Host 'all install.ps1 checks passed' -ForegroundColor Green
exit 0
