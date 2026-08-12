Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:ReleaseRoot = Split-Path -Parent $PSScriptRoot
$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$script:ManifestPath = Join-Path $script:RepoRoot 'docs\security\SEC-001_RELEASE_ARTIFACT_MANIFEST.json'
$script:Node = (Get-Command node.exe -ErrorAction Stop).Source
$script:Cli = Join-Path $PSScriptRoot 'lib\release-cli.mjs'
$script:StateRoot = Join-Path $env:LOCALAPPDATA 'AL-AMIN-Security-Releases\sec001'
$script:CheckpointPath = Join-Path $script:StateRoot 'release-checkpoint.json'
$script:LogPath = Join-Path $script:StateRoot 'release.log.jsonl'

function Protect-Sec001Directory([string]$Path) {
  New-Item -ItemType Directory -Path $Path -Force | Out-Null
  $acl = Get-Acl -LiteralPath $Path
  $acl.SetAccessRuleProtection($true, $false)
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    [System.Security.Principal.WindowsIdentity]::GetCurrent().Name,
    'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'
  )
  $acl.SetAccessRule($rule)
  Set-Acl -LiteralPath $Path -AclObject $acl
}

function Write-Sec001SafeLog([string]$Stage, [string]$Result, [hashtable]$Extra = @{}) {
  $record = [ordered]@{ timestamp = [DateTime]::UtcNow.ToString('o'); stage = $Stage; result = $Result }
  foreach ($key in @('durationMs','safeErrorCode','hashes','counts')) {
    if ($Extra.ContainsKey($key)) { $record[$key] = $Extra[$key] }
  }
  ($record | ConvertTo-Json -Compress -Depth 8) | Add-Content -LiteralPath $script:LogPath -Encoding UTF8
}

function Enter-Sec001LocalLock([string]$SessionId) {
  $path = Join-Path $script:StateRoot 'release.lock.json'
  if (Test-Path -LiteralPath $path) {
    $existing = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
    if ([DateTime]$existing.expiresAt -lt [DateTime]::UtcNow) { throw 'STALE_LOCK_REVIEW_REQUIRED' }
    throw 'RELEASE_LOCK_HELD'
  }
  $payload = @{ owner=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name; sessionId=$SessionId; createdAt=[DateTime]::UtcNow.ToString('o'); expiresAt=[DateTime]::UtcNow.AddHours(4).ToString('o') } | ConvertTo-Json
  $stream = [IO.File]::Open($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
    $stream.Write($bytes, 0, $bytes.Length)
  } finally { $stream.Dispose() }
}

function Exit-Sec001LocalLock([string]$SessionId) {
  $path = Join-Path $script:StateRoot 'release.lock.json'
  if (-not (Test-Path -LiteralPath $path)) { return }
  $existing = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
  if ($existing.sessionId -ne $SessionId) { throw 'RELEASE_LOCK_OWNER_MISMATCH' }
  Remove-Item -LiteralPath $path -Force
}

function Assert-Sec001GitGuard {
  $branch = (& git -C $script:RepoRoot branch --show-current).Trim()
  $status = & git -C $script:RepoRoot status --short
  if ($branch -ne 'security/hardening') { throw 'GIT_BRANCH_MISMATCH' }
  if ($status) { throw 'GIT_WORKTREE_NOT_CLEAN' }
  if (& git -C $script:RepoRoot remote) { throw 'GIT_REMOTE_PRESENT' }
  return (& git -C $script:RepoRoot rev-parse HEAD).Trim()
}

function Resolve-Sec001Docker {
  $command = Get-Command docker.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  foreach ($candidate in @(
    (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'),
    'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
  )) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  throw 'DOCKER_CLI_NOT_FOUND'
}

function Assert-Sec001LocalTooling {
  $docker = Resolve-Sec001Docker
  if ((& $docker context show).Trim() -ne 'desktop-linux') { throw 'DOCKER_CONTEXT_MISMATCH' }
  if ((& $docker info --format '{{.OSType}}').Trim() -ne 'linux') { throw 'DOCKER_LINUX_ENGINE_REQUIRED' }
  & $script:Node --version | Out-Null
  & git --version | Out-Null
  $drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($script:StateRoot).Substring(0,1))
  if ($drive.Free -lt 2GB) { throw 'INSUFFICIENT_LOCAL_DISK' }
}

function Invoke-Sec001State([string]$Action, [string]$State = '', [string]$EvidencePath = '', [string]$Code = '') {
  $arguments = @($script:Cli, '--action', $Action, '--repo', $script:RepoRoot, '--checkpoint', $script:CheckpointPath)
  if ($State) { $arguments += @('--state', $State) }
  if ($EvidencePath) { $arguments += @('--evidence', $EvidencePath) }
  if ($Code) { $arguments += @('--code', $Code) }
  & $script:Node @arguments
  if ($LASTEXITCODE -ne 0) { throw "STATE_MACHINE_FAILED_$Action" }
}

function New-Sec001Checkpoint([string]$ProjectFingerprint) {
  $commit = Assert-Sec001GitGuard
  & $script:Node $script:Cli '--action' 'init' '--repo' $script:RepoRoot '--checkpoint' $script:CheckpointPath '--manifest' 'docs/security/SEC-001_RELEASE_ARTIFACT_MANIFEST.json' '--commit' $commit '--fingerprint' $ProjectFingerprint
  if ($LASTEXITCODE -ne 0) { throw 'CHECKPOINT_INITIALIZATION_FAILED' }
}

function Read-Sec001Checkpoint {
  if (-not (Test-Path -LiteralPath $script:CheckpointPath)) { return $null }
  return Get-Content -Raw -LiteralPath $script:CheckpointPath | ConvertFrom-Json
}

function Assert-Sec001ArtifactFreeze {
  $code = "import('node:url').then(async u=>{const root=process.argv[1];const m=await import(u.pathToFileURL(root + '/scripts/release/sec001/lib/release-state.mjs').href);process.stdout.write(JSON.stringify(await m.verifyArtifactManifest(root,'docs/security/SEC-001_RELEASE_ARTIFACT_MANIFEST.json')))}).catch(e=>{process.stderr.write(e.message);process.exit(1)})"
  $result = & $script:Node -e $code $script:RepoRoot.Replace('\','/')
  if ($LASTEXITCODE -ne 0) { throw 'ARTIFACT_FREEZE_MISMATCH' }
  $verified = $result | ConvertFrom-Json
  $checkpoint = Read-Sec001Checkpoint
  if ($checkpoint -and $checkpoint.artifactManifestHash -ne $verified.manifestHash) { throw 'ARTIFACT_MANIFEST_MISMATCH' }
  return $verified.manifestHash
}

function Read-HiddenLine([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Confirm-Exact([string]$Prompt, [string]$Expected) {
  $actual = Read-Host $Prompt
  if ($actual -cne $Expected) { throw 'OWNER_CONFIRMATION_MISMATCH' }
}

function Get-Sec001IdentityFile {
  $path = Read-Host 'Owner identity package path (outside Git)'
  if (-not [IO.Path]::IsPathRooted($path)) { throw 'IDENTITY_PATH_MUST_BE_ABSOLUTE' }
  $resolved = (Resolve-Path -LiteralPath $path).Path
  if ($resolved.StartsWith($script:RepoRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'IDENTITY_FILE_INSIDE_REPOSITORY' }
  $identity = Get-Content -Raw -LiteralPath $resolved | ConvertFrom-Json
  foreach ($field in @('projectFingerprint','projectRef','region','dbHost','database','databaseUser','catalogMarker','bucketNames','apiUrl','sourceVersionUrl')) {
    if (-not $identity.PSObject.Properties.Name.Contains($field)) { throw "IDENTITY_FIELD_MISSING_$field" }
  }
  & $script:Node (Join-Path $PSScriptRoot 'lib\identity-check.mjs') $resolved | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'PROJECT_IDENTITY_MISMATCH' }
  return $identity
}

function Invoke-Sec001BackfillRunner([string]$Mode, $Identity) {
  $secret = Read-HiddenLine 'Temporary backfill credential (hidden; never logged)'
  try {
    $payload = "$($Identity.apiUrl)`n$secret`n"
    $payload | & $script:Node (Join-Path $PSScriptRoot 'backfill-runner.mjs') $Mode $script:CheckpointPath $script:RepoRoot
    if ($LASTEXITCODE -ne 0) { throw "BACKFILL_${Mode}_FAILED_SAFE" }
  } finally { $secret = $null; $payload = $null }
}

function Invoke-Sec001SqlFile([string]$SqlPath, $Identity, [ValidateSet('query','phase-a','phase-b')][string]$Mode) {
  $docker = Resolve-Sec001Docker
  if ((& $docker context show).Trim() -ne 'desktop-linux') { throw 'DOCKER_CONTEXT_MISMATCH' }
  $helper = Join-Path $PSScriptRoot 'Invoke-IsolatedReleasePsql.sh'
  $password = Read-HiddenLine 'Production database password (hidden; never logged)'
  try {
    $input = "$password`n"
    $output = $input | & $docker run --rm -i --tmpfs '/run/secrets:rw,noexec,nosuid,nodev,size=64k' `
      --mount "type=bind,src=$sqlPath,dst=/release/stage.sql,readonly" `
      --mount "type=bind,src=$helper,dst=/release/run.sh,readonly" `
      postgres:17.6-bookworm bash /release/run.sh $Identity.dbHost $Identity.databaseUser $Identity.database 5432 $Mode
    if ($LASTEXITCODE -ne 0) { throw 'DATABASE_STAGE_FAILED_SAFE' }
    return ($output -join "`n")
  } finally { $password = $null; $input = $null }
}

function Invoke-Sec001PhaseSql([string]$MigrationName, $Identity) {
  $sqlPath = Join-Path $script:RepoRoot "supabase\forward-migrations\$MigrationName"
  $mode = if ($MigrationName -like '*0001*') { 'phase-a' } else { 'phase-b' }
  return Invoke-Sec001SqlFile $sqlPath $Identity $mode
}

function Invoke-Sec001VerificationSql([string]$Name, $Identity, [string]$ExpectedMarker) {
  $sqlPath = Join-Path $PSScriptRoot "sql\$Name"
  $output = Invoke-Sec001SqlFile $sqlPath $Identity 'query'
  if (($output -split "`n" | ForEach-Object Trim) -notcontains $ExpectedMarker) { throw "CATALOG_VERIFICATION_FAILED_$ExpectedMarker" }
  return $output
}

function Assert-Sec001ProductionAuthorization {
  if ($env:ALAMIN_SEC001_PRODUCTION_APPROVED -ne '1') { throw 'P0_13_OWNER_APPROVAL_REQUIRED' }
}
