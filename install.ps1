# exepad install.ps1 - single-command Windows installer for the self-hosted Exepad studio.
#
#   irm https://get.exepad.com/install.ps1 | iex
#   & ([scriptblock]::Create((irm https://get.exepad.com/install.ps1))) -Version 0.3.0 -LlmKey sk-...
#
# The Windows twin of install.sh (same managed files, same .exepad-version marker,
# same GHCR image). Front-door logic:
#   1. Docker Desktop present + running -> proceed.
#      Missing -> DETECT-AND-INSTRUCT: we cannot silently install Docker Desktop
#      (its own installer + license acceptance + WSL2 enablement, which needs
#      admin and often a reboot). We open the download page and print the steps.
#   2. Node >= 18 present -> delegate to the canonical `npx exepad-app-builder up`.
#   3. Otherwise -> embedded bootstrap: write docker-compose.yml + .env, pull, up.
#
# Verify before piping to a shell:  irm https://get.exepad.com/install.ps1 -OutFile install.ps1
#
# The image is public - no `docker login` needed. Override it with
# $env:EXEPAD_IMAGE = '<your-registry/image>' if you host your own mirror.
[CmdletBinding()]
param(
  # Studio version (image tag). CI rewrites the default to the released tag.
  [string]$Version = 'latest',
  # Install dir holding the managed compose/.env/marker files.
  [string]$Dir = (Join-Path $env:USERPROFILE '.exepad'),
  # Host port for the studio's plain-HTTP listener.
  [int]$Port = 8080,
  # For UNATTENDED installs only. Interactively, the AI key is set in the
  # studio's Settings UI - the installer never asks for it.
  [string]$LlmKey = $env:EXEPAD_LLM_API_KEY,
  [string]$AdminEmail = $env:EXEPAD_ADMIN_EMAIL,
  [string]$AdminPassword = $env:EXEPAD_ADMIN_PASSWORD,
  # Non-interactive: skip the one remaining prompt (the Docker download page).
  [switch]$Yes,
  # Allow a downgrade (back up first!) - mirrors install.sh --force.
  [switch]$Force,
  # Print actions without changing anything.
  [switch]$DryRun,
  # Skip the npx delegation and use the embedded bootstrap.
  [switch]$NoNode
)

$ErrorActionPreference = 'Stop'
$ImageRepo = if ($env:EXEPAD_IMAGE) { $env:EXEPAD_IMAGE } else { 'ghcr.io/exepad/exepad-app-builder' }
$DataVolume = 'exepad-data'
$ContainerName = 'exepad'
# Release channel, rewritten by CI: 'public' | 'private' | 'dev' (repo default).
# Gates the npx delegation - the npm launcher exists ONLY for public releases;
# on dev/private builds `npx exepad-app-builder` would 404 (or worse, execute a
# name-squatted package), so those channels always use the embedded bootstrap.
$ReleaseChannel = 'dev'

function Say([string]$msg)  { Write-Host "[exepad] $msg" }
function Warn2([string]$msg) { Write-Host "[exepad] ! $msg" -ForegroundColor Yellow }
# NEVER `exit` from this script.
#
# The documented Windows front door is `irm https://get.exepad.com/install.ps1 |
# iex`, and Invoke-Expression runs the body in the CALLER'S session -- so `exit`
# terminates the user's entire PowerShell window, taking the error message with
# it. The reported symptom was exactly that: "it closed the powershell and
# nothing happens". Nothing was wrong with the install logic; the diagnosis was
# destroyed before it could be read.
#
# Wrapping in `& { }` or in a function does NOT contain it -- both were measured
# and both still kill the host. Only never calling `exit` does. So failures
# `throw`, the bottom of the script catches and reports, and the single `exit`
# lives there guarded by $PSCommandPath, which is the script path when run as a
# .ps1 (the one-click bundles and the MSI) and EMPTY under iex.
function Die([string]$msg)  { throw $msg }
function WouldRun([string]$what) { Write-Host "  -> would run: $what" }

function Test-Semver([string]$v) { return $v -match '^\d+\.\d+\.\d+([-+].*)?$' }

# ---- capturing a native command's output, safely on Windows PowerShell 5.1 -----
# On 5.1 (the OS default shell, and what the .bat and the MSI both invoke),
# REDIRECTING a native command's stderr - `2>&1`, `2>$null`, `*>$null` alike -
# wraps each stderr line in a NativeCommandError ErrorRecord. This script runs
# under $ErrorActionPreference='Stop', which promotes the first of those to a
# TERMINATING error. So the plain-looking `$logs = docker logs x 2>&1` does not
# return the logs; it throws, and any surrounding try/catch swallows the output
# entirely.
#
# That is not theoretical: it is why the first-run setup token was never printed
# on Windows. The install would succeed, the studio would come up asking for a
# token, and the installer had already silently discarded the only copy of it.
#
# Every capture of a native command must therefore go through here. $LASTEXITCODE
# survives the call, so callers can still branch on the exit status.
function Invoke-NativeCapture([string]$exe, [string[]]$exeArgs) {
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try     { return (& $exe @exeArgs 2>&1 | Out-String) }
  catch   { return '' }
  finally { $ErrorActionPreference = $prevEap }
}

# Same hazard, opposite need: `docker compose pull` prints its progress to
# stderr and the user should SEE it scroll, so this streams instead of
# capturing. The EAP guard is still required, because 5.1 also raises
# NativeCommandError when the CALLER has redirected this script's stderr - a log
# file, a CI step, `> install.log 2>&1`. Without the guard the install dies
# mid-pull with a baffling "error: Image ... Pulling" that names no problem at
# all. $LASTEXITCODE remains the verdict, which is what callers check.
function Invoke-NativeStreamed([string]$exe, [string[]]$exeArgs) {
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try     { & $exe @exeArgs }
  finally { $ErrorActionPreference = $prevEap }
}

function Get-ImageRef {
  if ($Version -like '@sha256:*') { return "$ImageRepo$Version" }
  if ($Version -like 'sha256:*')  { return "$ImageRepo@$Version" }
  return "${ImageRepo}:$Version"
}

# ---- WSL state (Docker Desktop's Linux engine depends on it) -------------------
# Docker Desktop's WSL2 backend runs `wsl.exe --version`, which exists only in
# the MODERN (Store) WSL. On the older in-box WSL that call prints its usage text
# and exits 1, and Docker Desktop surfaces it as an opaque dialog --
# "There was a problem with WSL / DockerDesktop/Wsl/ExecError ... wsl.exe
# --version: exit status 1" -- with no remedy in it. A user hit exactly that.
#
# Detect it here and name the command, because by the time that dialog appears
# the person has left this installer behind and has nothing to act on.
function Get-WslState {
  if (-not (Get-Command wsl -ErrorAction SilentlyContinue)) { return 'missing' }
  # Only the exit code matters here; wsl.exe emits UTF-16 that Out-String may
  # render oddly, which is harmless because the text is discarded.
  Invoke-NativeCapture 'wsl.exe' @('--version') | Out-Null
  if ($LASTEXITCODE -eq 0) { return 'ok' }
  return 'outdated'
}

function Show-WslGuidance {
  $state = Get-WslState
  if ($state -eq 'ok') { return }
  Say ''
  if ($state -eq 'missing') {
    Warn2 'WSL is not installed. Docker Desktop needs it to run Linux containers.'
    Say  '  In an ADMIN PowerShell:   wsl --install'
  } else {
    # `wsl --version` failing means "too old" OR "feature present but not
    # enabled", and the two are not reliably distinguishable from the exit code
    # alone -- so name both commands rather than guess and send someone down the
    # wrong one. --update fixes the old-version case, --install the not-enabled
    # case, and running the wrong one first is harmless.
    Warn2 'WSL is present but not usable by Docker Desktop.'
    Say  '  It does not support "wsl --version", which is what Docker Desktop calls -'
    Say  '  that is the "There was a problem with WSL" dialog.'
    Say  '  In an ADMIN PowerShell:   wsl --update'
    Say  '  If that reports WSL is not installed, run:   wsl --install'
  }
  Say  '  Then REBOOT and check it took:   wsl --version'
  Say  '  It must print version numbers, not the usage/help text.'
  Say  ''
  Say  '  On Windows Pro/Enterprise you can skip WSL entirely instead:'
  Say  '  Docker Desktop > Settings > General > uncheck "Use the WSL 2 based engine".'
}

# ---- 1. Docker Desktop: detect-and-instruct (never silent-install) -------------
function Test-DockerDaemon {
  Invoke-NativeCapture 'docker' @('info') | Out-Null
  return ($LASTEXITCODE -eq 0)
}

# Docker Desktop installs to one of two places depending on its version: the
# classic per-machine path, and the per-user path recent releases default to.
# Checking only Program Files misses a machine that plainly has Docker.
function Get-DockerDesktopPath {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'),
    (Join-Path $env:LOCALAPPDATA 'Docker\Docker Desktop.exe')
  )
  foreach ($c in $candidates) {
    if ($c -and (Test-Path $c)) { return $c }
  }
  return $null
}

function Wait-DockerEngine([int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-DockerDaemon) { return $true }
    Start-Sleep -Seconds 3
  }
  return $false
}

function Assert-Docker {
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  $daemonUp = $false
  if ($docker) { $daemonUp = Test-DockerDaemon }
  if ($docker -and $daemonUp) { return }

  if ($docker -and -not $daemonUp) {
    # "Installed but not running" is the most common state on any Windows box
    # that has met Docker before - it does not start with the session unless the
    # user opted in. Telling that person to go and start it themselves turns a
    # working machine into a failed install for no reason, so start it for them
    # and wait. (Docker Desktop is a per-user app: this needs no elevation.)
    $desktop = Get-DockerDesktopPath
    if ($desktop -and -not $DryRun) {
      Say 'Docker is installed but the engine is not running - starting Docker Desktop...'
      try { Start-Process $desktop | Out-Null } catch { }
      Say '  Waiting for the engine. A cold start takes a minute or two.'
      if (Wait-DockerEngine 240) {
        Say '  Engine running.'
        return
      }
      Warn2 'Docker Desktop did not reach "Engine running" in time.'
      Say  '  Leave it running, wait for the whale icon to stop animating, then re-run this script.'
    } else {
      Warn2 'Docker is installed but the engine is not running.'
      Say  '  Start Docker Desktop (whale icon), wait for "Engine running", then re-run this script.'
    }
    # The most common reason the engine never reaches "running" is a WSL that
    # Docker Desktop cannot use, so say so here rather than let the user loop.
    Show-WslGuidance
    Die  'Docker engine not reachable'
  }

  Warn2 'Docker Desktop is not installed. Exepad runs as a Docker container, so it is required.'
  Say  ''
  Say  'Install it (one time):'
  Say  '  1. In an ADMIN PowerShell:  wsl --install     (then REBOOT if it asks)'
  Say  '     Already have WSL? Update it:  wsl --update  - Docker Desktop needs a'
  Say  '     version that supports "wsl --version".'
  Say  '  2. winget install Docker.DockerDesktop     (or download from the page we can open below)'
  Say  '  3. Start Docker Desktop, accept its license, wait for "Engine running".'
  Say  '  4. Re-run this installer.'
  Show-WslGuidance
  Say  ''
  if (-not $Yes) {
    $ans = Read-Host 'Open the Docker Desktop download page now? [Y/n]'
    if ($ans -notmatch '^(n|no)$') {
      Start-Process 'https://www.docker.com/products/docker-desktop/'
    }
  }
  Die 'install Docker Desktop, then re-run'
}

# ---- 2. Delegate to the canonical CLI when Node >= 18 is available -------------
# Delegation is an OPTIMISATION, not a requirement: the embedded bootstrap below
# produces the same compose file, .env and container. An unreachable npm launcher
# therefore falls THROUGH to it instead of aborting the install. Mirrors
# maybe_delegate_to_npx in install.sh; keep the two in step.
function Invoke-NpxDelegation {
  if ($ReleaseChannel -ne 'public') { return $false }
  if ($NoNode) { return $false }
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return $false }
  $major = 0
  $nodeOut = Invoke-NativeCapture 'node' @('-p', 'process.versions.node.split(".")[0]')
  if ($LASTEXITCODE -ne 0) { return $false }
  try { $major = [int]($nodeOut.Trim()) } catch { return $false }
  if ($major -lt 18) { return $false }

  $pkg = 'exepad-app-builder'
  if (Test-Semver $Version) { $pkg = "exepad-app-builder@$Version" }

  # Resolve-and-run probe: proves the launcher downloads AND runs on this Node
  # before it is handed the install, and warms the npx cache so the real call
  # below is local. A probe failure means "no usable launcher" (fall through to
  # the bootstrap); a failure of the real call is a genuine install failure.
  if (-not $DryRun) {
    Invoke-NativeCapture 'npx' @('-y', $pkg, '--version') | Out-Null
    $probeOk = ($LASTEXITCODE -eq 0)
    if (-not $probeOk) {
      Warn2 "npm launcher ($pkg) is unavailable - continuing with the built-in installer."
      Say  '  Same outcome: identical docker-compose.yml, .env and container.'
      return $false
    }
  }

  Say "Node $(node -v) detected - delegating to the canonical CLI (npx exepad-app-builder)..."
  $cliArgs = @('up', '--to', $Version, '--dir', $Dir, '--port', "$Port", '--yes')
  if ($LlmKey)        { $cliArgs += @('--llm-key', $LlmKey) }
  if ($AdminEmail)    { $cliArgs += @('--admin-email', $AdminEmail) }
  if ($AdminPassword) { $cliArgs += @('--admin-password', $AdminPassword) }
  if ($Force)         { $cliArgs += '--force' }
  if ($DryRun)        { $cliArgs += '--dry-run' }
  # Records the outcome on the script scope rather than exiting: see the note on
  # Die(). A boolean return would be unreliable here because any stray pipeline
  # output from the delegated call would be collected alongside it.
  if ($DryRun) {
    WouldRun "npx -y $pkg $($cliArgs -join ' ')"
    $script:ExepadDelegated = $true
    $script:ExepadExitCode  = 0
    return $true
  }
  npx -y $pkg @cliArgs
  $script:ExepadDelegated = $true
  $script:ExepadExitCode  = $LASTEXITCODE
  return $true
}

# ---- 3. Embedded bootstrap (Node-less fallback; mirrors install.sh) ------------
function Get-DeployedTag {
  $marker = Join-Path $Dir '.exepad-version'
  if (-not (Test-Path $marker)) { return $null }
  try {
    return (Get-Content $marker -Raw | ConvertFrom-Json).tag
  } catch { return $null }
}

function Assert-NoDowngrade {
  $deployed = Get-DeployedTag
  if (-not $deployed) { return }

  # Only two semver tags can be ordered. Name whichever side is unorderable
  # rather than blaming the target for it.
  if (-not (Test-Semver $Version)) {
    Warn2 "Target `"$Version`" is a moving tag; cannot verify downgrade safety."
    return
  }
  if (-not (Test-Semver $deployed)) {
    Warn2 "Installed tag `"$deployed`" is a moving tag; cannot verify downgrade safety."
    return
  }

  # Re-running the SAME version is a repair or a resume, not a downgrade. This
  # is the common case, not the edge case: it is what the MSI's "Install or
  # Update Exepad Studio" shortcut does every time, and what a user does after
  # installing Docker Desktop half-way through. The old ordering fell through to
  # the else-branch here and warned that a pinned semver tag was "a moving tag",
  # which is both wrong and alarming.
  if ($deployed -eq $Version) { return }

  if (([version]($Version -replace '[-+].*$','')) -lt ([version]($deployed -replace '[-+].*$',''))) {
    if ($Force) {
      Warn2 "Forcing downgrade $deployed -> $Version. Ensure you have a backup."
    } else {
      Warn2 "Refusing downgrade $deployed -> $Version."
      Say   '  Migrations run forward only; an older image on newer /data can break.'
      Say   '  Back up first, then re-run with -Force.'
      throw "refusing downgrade $deployed -> $Version"
    }
  }
}

# ---- claiming the instance during install --------------------------------------
# Seeding EXEPAD_ADMIN_EMAIL/PASSWORD makes the container create the operator
# account at boot, which CLOSES first-run setup (seedAdminFromEnv is idempotent
# and no-ops once any user exists). That is strictly better than either guarding
# the setup form with a token or leaving it open: there is no unclaimed window
# for anyone to race for, and the user's first visit is an ordinary login.
#
# Asking here is not a return of the AI-key prompt this script deliberately
# dropped. That was CONFIGURATION - changeable later, and Settings is the right
# place for it. This is OWNERSHIP, and ownership has to be established before
# somebody else establishes it.
#
# The typing-is-hidden trap is real though (a masked prompt is indistinguishable
# from a hang), so the prompt says so in as many words before asking.
function Read-Secret([string]$promptText) {
  $sec = Read-Host $promptText -AsSecureString
  if (-not $sec -or $sec.Length -eq 0) { return '' }
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try     { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# The server's own /auth/setup enforces 8 characters, but seedAdminFromEnv does
# NOT - it calls createUser directly. Without this check the seeded path would be
# WEAKER than the form it replaces, and silently so.
function Test-OperatorPassword([string]$pw) { return ($pw.Length -ge 8) }
function Test-OperatorEmail([string]$em)    { return ($em -match '^[^@\s]+@[^@\s]+$') }

# Should we ask at all? Split from the asking itself so the loop below is
# reachable in tests - the redirected-stdin guard here makes it unreachable
# under any harness, which is exactly where the validation loop would rot.
function Test-ShouldAskForAccount {
  if ($DryRun) { return $false }
  if ($Yes) { return $false }
  # Already supplied non-interactively.
  if ($AdminEmail -and $AdminPassword) { return $false }
  # No console to type into (piped, CI, a service): never block.
  if ([Console]::IsInputRedirected) { return $false }
  # Re-run over an existing install: the account question was settled the first
  # time, and re-prompting on every update would be its own kind of broken.
  if (Get-DeployedTag) { return $false }
  return $true
}

# The prompt loop. Returns @{ Email; Password }, or $null when the user skips or
# runs out of attempts. Reads via Read-Host / Read-Secret so a test can stub
# both and drive it without a console.
function Read-OperatorAccount {
  Say ''
  Say 'Create your operator account now, so nobody else can claim this studio.'
  Say '  Press Enter at the email prompt to skip and create it in the browser.'
  foreach ($attempt in 1..3) {
    $email = (Read-Host '  Email').Trim()
    if (-not $email) { return $null }
    if (-not (Test-OperatorEmail $email)) {
      Warn2 '  That does not look like an email address.'
      continue
    }
    # Say it BEFORE the masked prompt, not after - after is too late for someone
    # already wondering whether the installer has frozen.
    Say '  Now the password. Your typing will NOT be shown - that is normal.'
    $password = Read-Secret '  Password (at least 8 characters)'
    if (-not (Test-OperatorPassword $password)) {
      Warn2 '  Too short - at least 8 characters.'
      continue
    }
    return @{ Email = $email; Password = $password }
  }
  Warn2 '  Skipping account creation - you can do it in the browser.'
  return $null
}

# Returns @{ Email; Password } or $null when the caller should skip seeding.
function Get-OperatorAccount {
  if (-not (Test-ShouldAskForAccount)) { return $null }
  return (Read-OperatorAccount)
}

# Poll until the studio reports setup is closed, i.e. the seed actually landed.
function Wait-SetupComplete([int]$HostPort, [int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $status = Invoke-RestMethod -Uri "http://localhost:$HostPort/auth/status" -TimeoutSec 5
      if ($status -and ($status.needsSetup -eq $false)) { return $true }
    } catch { }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Remove-EnvKey([string]$path, [string]$key) {
  if (-not (Test-Path $path)) { return }
  # @() for the same reason Merge-EnvFile needs it - see the note there.
  $lines = @(Get-Content $path | Where-Object { $_ -notlike "$key=*" })
  [System.IO.File]::WriteAllText($path, (($lines -join "`r`n") + "`r`n"))
}

function Merge-EnvFile([string]$path, [hashtable]$updates) {
  # Preserve operator-added lines; override only the managed keys (mirrors the
  # CLI's mergeEnv / install.sh's env_merge so the front doors don't diverge).
  $lines = @()
  if (Test-Path $path) {
    # The @(...) is load-bearing. A pipeline that yields exactly ONE line returns
    # a bare [string], not an array - and `$lines += "KEY=value"` on a string is
    # STRING CONCATENATION, not an append. The .env then came out as
    # `# my notesEXEPAD_LLM_API_KEY=sk-...`, i.e. the key folded into a comment
    # and silently lost, leaving the studio unable to build with no clue why.
    # Reached whenever an existing .env has one surviving line after the managed
    # keys are filtered out, which is the ordinary "re-run with a new key" case.
    $lines = @(Get-Content $path | Where-Object {
      $line = $_
      -not ($updates.Keys | Where-Object { $line -like "$_=*" })
    })
  } else {
    $lines = @(
      '# Exepad operator config (managed by install.ps1).',
      '# Safe to edit. Platform secrets are generated inside /data, never here.'
    )
  }
  foreach ($k in $updates.Keys) { $lines += "$k=$($updates[$k])" }
  return ($lines -join "`r`n") + "`r`n"
}

function Install-Embedded {
  if (-not (Test-Semver $Version)) {
    Warn2 "`"$Version`" is a moving tag - not reproducible. Pin -Version X.Y.Z for production."
  }
  Assert-NoDowngrade

  $imageRef = Get-ImageRef
  $compose = @"
# Generated by exepad install.ps1. Managed file. Pinned ref - never floats :latest.
# Persistent state lives in the named volume "$DataVolume" (/data), NOT in this directory.
services:
  ${ContainerName}:
    image: $imageRef
    container_name: $ContainerName
    restart: unless-stopped
    env_file:
      - .env
    environment:
      # This file publishes :8080 as the front door with nothing terminating TLS
      # in front of it. Left on, the in-image Caddy makes the runtime issue Secure
      # cookies (EXEPAD_COOKIE_SECURE=1) while terminating TLS on a container port
      # this file never publishes - the browser then REFUSES to store the cookie
      # over http://<lan-ip>:${Port} and login silently fails everywhere except
      # localhost (which browsers treat as a secure context). Mirrors install.sh,
      # the exepad CLI's non-domain compose, and deploy/docker-compose.yml. Behind
      # a TLS-terminating proxy the runtime reads X-Forwarded-Proto and issues
      # Secure cookies again.
      - EXEPAD_HTTPS_DISABLE=1
    ports:
      - "${Port}:8080"
    volumes:
      - ${DataVolume}:/data
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
volumes:
  ${DataVolume}:
    name: ${DataVolume}  # literal name (backup/docs mount it directly)
"@

  $updates = @{}
  if ($LlmKey)        { $updates['EXEPAD_LLM_API_KEY'] = $LlmKey }
  if ($AdminEmail)    { $updates['EXEPAD_ADMIN_EMAIL'] = $AdminEmail }
  if ($AdminPassword) { $updates['EXEPAD_ADMIN_PASSWORD'] = $AdminPassword }

  $envPath = Join-Path $Dir '.env'
  $composePath = Join-Path $Dir 'docker-compose.yml'
  $markerPath = Join-Path $Dir '.exepad-version'

  # Claim the instance up front when we can. A seeded admin closes first-run
  # setup outright, which beats both of the alternatives below.
  $account = Get-OperatorAccount
  if ($account) {
    $updates['EXEPAD_ADMIN_EMAIL'] = $account.Email
    $updates['EXEPAD_ADMIN_PASSWORD'] = $account.Password
    $script:ExepadSeedEmail = $account.Email
  } elseif ($AdminEmail -and $AdminPassword) {
    # Seeded from flags/environment instead of the prompt. Same confirm-then-
    # strip treatment: an unattended install has even less reason to leave a
    # plaintext admin password sitting in .env afterwards.
    $script:ExepadSeedEmail = $AdminEmail
  }

  # Tokenless first-run setup - only relevant when NOTHING was seeded above.
  #
  # The setup token proves "I can read this host's logs" - a stand-in for "I am
  # the operator" - so that a network-reachable instance cannot be claimed by
  # whoever reaches the port first. That race is real, but charging every
  # desktop user for it is not: the overwhelming case is someone who just
  # double-clicked an installer on their own machine and had the browser opened
  # for them seconds later. Making that person dig through `docker logs` to
  # prove they own the laptop they are sitting at is friction that buys them
  # nothing. So the installers default to open setup and the studio drops the
  # token field entirely (the setup form hides it when it is not required).
  #
  # The trade this accepts: this compose file publishes on ALL interfaces, so
  # until you finish the setup form anyone who can reach <this-host>:$Port can
  # complete it instead of you. Finish setup right after installing, and prefer
  # a trusted network while you do.
  #
  # Only a DEFAULT: an explicit EXEPAD_ALLOW_OPEN_SETUP already in .env is left
  # alone, so an operator who wants the token back sets it to 0 once and no
  # later re-run overwrites that.
  $envRaw = ''
  if (Test-Path $envPath) {
    $envRaw = (Get-Content $envPath -Raw -ErrorAction SilentlyContinue)
  }
  # ExepadOpenSetup means "open setup is IN EFFECT", not "this run added it" -
  # a re-run over an .env that already carries the flag must reach the same
  # conclusion, or it skips the "create your account" hint and goes looking for
  # a token that was never minted.
  if ($account -or ($AdminEmail -and $AdminPassword)) {
    # A seeded admin closes setup, so open setup is moot. Deliberately NOT
    # written: if the seed were to fail, the absence of this flag leaves the
    # token guard standing rather than leaving the instance wide open - the
    # right way round for a failure nobody is watching for.
    $script:ExepadOpenSetup = $false
  } elseif (-not ($envRaw -match '(?m)^EXEPAD_ALLOW_OPEN_SETUP=')) {
    $updates['EXEPAD_ALLOW_OPEN_SETUP'] = '1'
    $script:ExepadOpenSetup = $true
  } else {
    # [ \t\r] - the \r is load-bearing. Merge-EnvFile writes this file with CRLF,
    # and in .NET multiline mode `$` matches before the \n with the \r still
    # unconsumed, so a class of only [ \t] never matches our own output.
    $script:ExepadOpenSetup = [bool]($envRaw -match '(?m)^EXEPAD_ALLOW_OPEN_SETUP=[ \t]*(1|true|yes|on)[ \t\r]*$')
  }

  # NO interactive key prompt here, deliberately.
  #
  # Configuration - the AI provider key above all - belongs in the studio's
  # Settings UI, which is the one place it can be validated, changed and
  # rotated. Asking for it mid-install bought nothing and cost a lot: the prompt
  # HID the typing (correct for a secret, indistinguishable from a hang), so the
  # installer looked frozen at the exact moment a first-time user had no way to
  # tell whether it had crashed. The one-click .bat and the MSI both hit this,
  # because neither passes -Yes.
  #
  # The install now always runs straight through, and the key is set once, in
  # the UI. -LlmKey / EXEPAD_LLM_API_KEY remain for unattended and scripted
  # installs, where there is no UI to go to.

  if ($DryRun) {
    WouldRun "mkdir $Dir"
    WouldRun "write $composePath"
    WouldRun "write $envPath"
    WouldRun "docker compose --project-directory `"$Dir`" -f `"$composePath`" pull"
    WouldRun "docker compose --project-directory `"$Dir`" -f `"$composePath`" up -d"
    WouldRun "write $markerPath"
    return
  }

  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  # [IO.File]::WriteAllText writes BOM-less UTF-8 on BOTH PowerShell editions.
  # `Set-Content -Encoding utf8` on Windows PowerShell 5.1 (the OS default)
  # prepends a BOM - the .env's first key would become "<U+FEFF>EXEPAD_LLM_API_KEY"
  # and compose could silently drop the LLM key.
  [System.IO.File]::WriteAllText($composePath, $compose + "`n")
  $envContent = Merge-EnvFile $envPath $updates
  [System.IO.File]::WriteAllText($envPath, $envContent)
  # Not a warning, and not printed here. Having no key yet is the NORMAL state
  # after an interactive install now that nothing asks for one - flagging it in
  # yellow before the pull would make every healthy install look defective. It
  # is a next step, so it is said once at the end, with the rest of them.
  $script:ExepadNeedsKey = -not ($envContent -match 'EXEPAD_LLM_API_KEY=')

  Say ''
  Say "Pulling $imageRef ..."
  Invoke-NativeStreamed 'docker' @('compose', '--project-directory', $Dir, '-f', $composePath, 'pull')
  if ($LASTEXITCODE -ne 0) { Die 'docker compose pull failed' }
  Invoke-NativeStreamed 'docker' @('compose', '--project-directory', $Dir, '-f', $composePath, 'up', '-d')
  if ($LASTEXITCODE -ne 0) { Die 'docker compose up failed' }

  $marker = [ordered]@{
    image     = $ImageRepo
    tag       = $Version
    launcher  = 'install.ps1'
    hostPort  = $Port
    engine    = 'docker'
    updatedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  } | ConvertTo-Json
  [System.IO.File]::WriteAllText($markerPath, $marker + "`n")

  # The seeded password has done its job the moment the account exists - it is
  # hashed into /data and seedAdminFromEnv no-ops from here on. Leaving the
  # plaintext sitting in .env forever buys nothing, so confirm the account
  # landed and then take it back out.
  #
  # Only AFTER confirming: stripping a password whose seed silently failed would
  # strand the user with no account and no way to seed one.
  if ($script:ExepadSeedEmail) {
    Say ''
    Say '  Creating your operator account...'
    if (Wait-SetupComplete $Port 90) {
      Remove-EnvKey $envPath 'EXEPAD_ADMIN_PASSWORD'
      $script:ExepadSeeded = $true
    } else {
      Warn2 '  Could not confirm the account was created within 90s.'
      Say   '  The password stays in .env so the next start can retry the seed.'
      Say   "  Check the studio at http://localhost:$Port - if it asks you to"
      Say   '  create an account, just create it there.'
    }
  }

  Say ''
  Say "Exepad $Version is up -> http://localhost:$Port"
  Say "  install dir: $Dir"
  Say "  data volume: $DataVolume"
  if ($ReleaseChannel -eq 'public') {
    Say '  operator CLI: npx exepad-app-builder status | update | stop | start | backup   (needs Node)'
  }
  Show-SetupToken
  Say ''
  if ($script:ExepadSeeded) {
    Say "  Log in as $script:ExepadSeedEmail - your account is already created,"
    Say '  and this instance can no longer be claimed by anyone else.'
  } elseif ($script:ExepadOpenSetup -and -not ($AdminEmail -and $AdminPassword)) {
    # Worth one line: the account is unclaimed until they fill the form, and on
    # a shared network someone else could fill it first.
    Say '  Next: open it and create your operator account - do this now, while'
    Say '  nobody else can reach the port first.'
  }
  if ($script:ExepadNeedsKey) {
    Say '  Then add your AI provider key in the studio - Settings > AI provider.'
    Say '  Builds need it; everything else works without it.'
  }
}

# ---- first-run setup token ------------------------------------------------------
# The container prints it to STDERR once at boot, but the install starts it
# DETACHED, so the banner lands in the logs and the user never sees it. They then
# meet a setup screen demanding a token nothing has shown them - and `docker logs
# ... | grep` is not a thing a Windows user has any reason to know. Mirrors
# print_setup_token in install.sh and printSetupToken in the npm launcher.
# Best-effort: it must never fail an otherwise successful install.
function Show-SetupToken {
  if ($DryRun) { return }
  # Seeded admin means setup is closed and no token is ever minted.
  if ($AdminEmail -and $AdminPassword) { return }
  # Open setup: no token is minted, so skip the log poll entirely rather than
  # spend its retry budget waiting for a banner that will never appear. This
  # function still earns its keep for an operator who set
  # EXEPAD_ALLOW_OPEN_SETUP=0 to put the token back.
  if ($script:ExepadOpenSetup) { return }
  $token = $null
  foreach ($i in 1..8) {
    # Invoke-NativeCapture, not `docker logs ... 2>&1` - see the note on that
    # function. The banner goes to STDERR, so the redirect is exactly what makes
    # 5.1 throw, and this loop used to discard every line and always come up
    # empty.
    $logs = Invoke-NativeCapture 'docker' @('logs', $ContainerName)
    if ($logs -match 'EXEPAD_ALLOW_OPEN_SETUP') { return }
    # Anchor on the banner first, so no unrelated 64-hex string in the logs can
    # ever be presented to the user as their setup token.
    $idx = $logs.IndexOf('FIRST-RUN SETUP TOKEN')
    if ($idx -ge 0) {
      $m = [regex]::Match($logs.Substring($idx), '[0-9a-f]{64}')
      if ($m.Success) { $token = $m.Value; break }
    }
    Start-Sleep -Seconds 1
  }
  Say ''
  if ($token) {
    Say "  Setup token: $token"
    Say '  Enter it on the first screen to create your operator account.'
  } else {
    # Still better than silence: the setup screen will ask for a token, so name
    # the command that prints it rather than leaving the user stuck at it.
    Say '  The first screen asks for a setup token. Print it with:'
    Say "    docker logs $ContainerName"
  }
}

# ---- main -----------------------------------------------------------------------
# Single exit point, guarded. Everything above reports failure with `throw`.
$script:ExepadDelegated = $false
$script:ExepadExitCode  = 0
$script:ExepadNeedsKey  = $false
$script:ExepadOpenSetup = $false
$script:ExepadSeedEmail = ''
$script:ExepadSeeded    = $false
try {
  Assert-Docker
  Invoke-NpxDelegation | Out-Null
  if (-not $script:ExepadDelegated) { Install-Embedded }
} catch {
  Write-Host "[exepad] error: $($_.Exception.Message)" -ForegroundColor Red
  $script:ExepadExitCode = 1
}

if ($PSCommandPath) {
  # Real .ps1 invocation (one-click bundle, MSI, -File): exit is correct and the
  # caller needs the status code.
  exit $script:ExepadExitCode
} else {
  # Under `irm | iex` there is no script to exit -- only the user's shell, which
  # must survive so they can read what went wrong.
  $global:LASTEXITCODE = $script:ExepadExitCode
  if ($script:ExepadExitCode -ne 0) {
    Write-Host "[exepad] install did not complete (exit $script:ExepadExitCode)." -ForegroundColor Red
  }
}
