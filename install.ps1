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
  [string]$LlmKey = $env:EXEPAD_LLM_API_KEY,
  [string]$AdminEmail = $env:EXEPAD_ADMIN_EMAIL,
  [string]$AdminPassword = $env:EXEPAD_ADMIN_PASSWORD,
  # Non-interactive: skip prompts (LLM key, Docker download page).
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
function Die([string]$msg)  { Write-Host "[exepad] error: $msg" -ForegroundColor Red; exit 1 }
function WouldRun([string]$what) { Write-Host "  -> would run: $what" }

function Test-Semver([string]$v) { return $v -match '^\d+\.\d+\.\d+([-+].*)?$' }

function Get-ImageRef {
  if ($Version -like '@sha256:*') { return "$ImageRepo$Version" }
  if ($Version -like 'sha256:*')  { return "$ImageRepo@$Version" }
  return "${ImageRepo}:$Version"
}

# ---- 1. Docker Desktop: detect-and-instruct (never silent-install) -------------
function Assert-Docker {
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  $daemonUp = $false
  if ($docker) {
    # Windows PowerShell 5.1: with EAP=Stop, REDIRECTED native stderr becomes a
    # terminating NativeCommandError - a stopped engine would crash right here
    # instead of reaching the guidance below. Relax EAP around the probe.
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { docker info *> $null } catch { } finally { $ErrorActionPreference = $prevEap }
    $daemonUp = ($LASTEXITCODE -eq 0)
  }
  if ($docker -and $daemonUp) { return }

  if ($docker -and -not $daemonUp) {
    Warn2 'Docker is installed but the engine is not running.'
    Say  '  Start Docker Desktop (whale icon), wait for "Engine running", then re-run this script.'
    Die  'Docker engine not reachable'
  }

  Warn2 'Docker Desktop is not installed. Exepad runs as a Docker container, so it is required.'
  Say  ''
  Say  'Install it (one time):'
  Say  '  1. winget install Docker.DockerDesktop     (or download from the page we can open below)'
  Say  '  2. If Windows asks to enable WSL 2: allow it (admin prompt) and REBOOT when told.'
  Say  '  3. Start Docker Desktop, accept its license, wait for "Engine running".'
  Say  '  4. Re-run this installer.'
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
  try { $major = [int](node -p 'process.versions.node.split(".")[0]' 2>$null) } catch { return $false }
  if ($major -lt 18) { return $false }

  $pkg = 'exepad-app-builder'
  if (Test-Semver $Version) { $pkg = "exepad-app-builder@$Version" }

  # Resolve-and-run probe: proves the launcher downloads AND runs on this Node
  # before it is handed the install, and warms the npx cache so the real call
  # below is local. A probe failure means "no usable launcher" (fall through to
  # the bootstrap); a failure of the real call is a genuine install failure.
  if (-not $DryRun) {
    $probeOk = $false
    try {
      & npx -y $pkg --version 2>$null | Out-Null
      $probeOk = ($LASTEXITCODE -eq 0)
    } catch { $probeOk = $false }
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
  if ($DryRun) { WouldRun "npx -y $pkg exepad $($cliArgs -join ' ')" ; exit 0 }
  npx -y $pkg @cliArgs
  exit $LASTEXITCODE
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
  if ((Test-Semver $deployed) -and (Test-Semver $Version) -and ($deployed -ne $Version)) {
    if (([version]($Version -replace '[-+].*$','')) -lt ([version]($deployed -replace '[-+].*$',''))) {
      if ($Force) {
        Warn2 "Forcing downgrade $deployed -> $Version. Ensure you have a backup."
      } else {
        Warn2 "Refusing downgrade $deployed -> $Version."
        Say   '  Migrations run forward only; an older image on newer /data can break.'
        Say   '  Back up first, then re-run with -Force.'
        exit 1
      }
    }
  } elseif ($deployed) {
    Warn2 "Target `"$Version`" is a moving tag; cannot verify downgrade safety."
  }
}

function Merge-EnvFile([string]$path, [hashtable]$updates) {
  # Preserve operator-added lines; override only the managed keys (mirrors the
  # CLI's mergeEnv / install.sh's env_merge so the front doors don't diverge).
  $lines = @()
  if (Test-Path $path) {
    $lines = Get-Content $path | Where-Object {
      $line = $_
      -not ($updates.Keys | Where-Object { $line -like "$_=*" })
    }
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

  # Skip the prompt when .env already carries a key (mirrors install.sh + the
  # CLI's hasEnvKey - re-running the installer must not nag existing installs).
  $envHasKey = (Test-Path $envPath) -and
    ((Get-Content $envPath -Raw -ErrorAction SilentlyContinue) -match '(?m)^EXEPAD_LLM_API_KEY=')
  if (-not $LlmKey -and -not $envHasKey -and -not $Yes -and -not $DryRun) {
    # -AsSecureString so the pasted key is not echoed to the console (the
    # one-click .bat keeps the window open afterwards).
    $sec = Read-Host 'LLM API key (EXEPAD_LLM_API_KEY) - press Enter to set it later in Settings' -AsSecureString
    $key = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
      [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
    if ($key) { $updates['EXEPAD_LLM_API_KEY'] = $key }
  }

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
  if (-not ($envContent -match 'EXEPAD_LLM_API_KEY=')) {
    Warn2 'No LLM key set - builds fail until you add EXEPAD_LLM_API_KEY (edit .env or /settings).'
  }

  Say ''
  Say "Pulling $imageRef ..."
  docker compose --project-directory "$Dir" -f "$composePath" pull
  if ($LASTEXITCODE -ne 0) { Die 'docker compose pull failed' }
  docker compose --project-directory "$Dir" -f "$composePath" up -d
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

  Say ''
  Say "Exepad $Version is up -> http://localhost:$Port"
  Say "  install dir: $Dir"
  Say "  data volume: $DataVolume"
  if ($ReleaseChannel -eq 'public') {
    Say '  operator CLI: npx exepad-app-builder status | update | stop | start | backup   (needs Node)'
  }
  Show-SetupToken
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
  $token = $null
  foreach ($i in 1..8) {
    $logs = ''
    try { $logs = (& docker logs $ContainerName 2>&1 | Out-String) } catch { $logs = '' }
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
  if (-not $token) { return }
  Say ''
  Say "  Setup token: $token"
  Say '  Enter it on the first screen to create your operator account.'
}

# ---- main -----------------------------------------------------------------------
Assert-Docker
Invoke-NpxDelegation | Out-Null   # exits the script if it delegates
Install-Embedded
