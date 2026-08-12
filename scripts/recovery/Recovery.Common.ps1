Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:RecoveryRoot = Join-Path $env:LOCALAPPDATA 'AL-AMIN-Recovery'
$script:RecoveryWorkRoot = Join-Path $script:RecoveryRoot 'work'
$script:AgePath = Join-Path $script:RecoveryRoot 'tools\age-1.3.1\age.exe'
$script:RclonePath = Join-Path $script:RecoveryRoot 'tools\rclone-1.74.3\rclone.exe'
$script:SupabasePath = Join-Path $env:LOCALAPPDATA 'Programs\SupabaseCLI\2.113.0\supabase.exe'
$script:DockerPath = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'
$script:PostgresImage = 'public.ecr.aws/supabase/postgres@sha256:99b1729aeb0bac314445024fc149fbd39306170b61dd50800ccf180327ab3459'

function Get-RecoveryRepositoryRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

function Assert-RecoveryTools {
  foreach ($item in @(
    @{ Path = $script:AgePath; Label = 'age v1.3.1' },
    @{ Path = $script:RclonePath; Label = 'rclone v1.74.3' },
    @{ Path = $script:SupabasePath; Label = 'Supabase CLI 2.113.0' },
    @{ Path = $script:DockerPath; Label = 'Docker Desktop CLI' }
  )) {
    if (-not (Test-Path -LiteralPath $item.Path -PathType Leaf)) {
      throw "Required pinned tool is missing: $($item.Label). See scripts/recovery/README.md."
    }
  }
  $context = (& $script:DockerPath context show 2>$null).Trim()
  if ($LASTEXITCODE -ne 0 -or $context -ne 'desktop-linux') {
    throw 'Docker must be running with the local desktop-linux context.'
  }
  $dockerInfo = & $script:DockerPath info --format '{{.OSType}}|{{.ServerVersion}}' 2>$null
  if ($LASTEXITCODE -ne 0 -or $dockerInfo -notmatch '^linux\|') {
    throw 'The local Linux Docker engine is not ready.'
  }
  if ((& $script:AgePath --version 2>&1) -notmatch '^v1\.3\.1$') {
    throw 'Pinned age version mismatch.'
  }
  if ((& $script:RclonePath version 2>&1 | Select-Object -First 1) -notmatch '^rclone v1\.74\.3$') {
    throw 'Pinned rclone version mismatch.'
  }
  if ((& $script:SupabasePath --version 2>&1).Trim() -ne '2.113.0') {
    throw 'Pinned Supabase CLI version mismatch.'
  }
}

function Assert-GitGuard {
  param([switch]$AllowRecoveryCandidateChanges)
  $root = Get-RecoveryRepositoryRoot
  $branchValue = & git -c "safe.directory=$root" -C $root branch --show-current
  if ($LASTEXITCODE -ne 0) { throw 'Git guard could not read the current branch.' }
  $branch = ($branchValue -join '').Trim()
  $status = & git -c "safe.directory=$root" -C $root status --short
  if ($AllowRecoveryCandidateChanges -and $status) {
    $allowed = @(
      '.gitattributes',
      'scripts/recovery/',
      'docs/security/recovery/OWNER_BACKUP_EXPORT_GUIDE.md',
      'docs/security/recovery/RECOVERY_TOOLING_VERIFICATION.md',
      'docs/security/recovery/RECOVERY_RUNBOOK.md'
    )
    foreach ($line in $status) {
      $path = $line.Substring(3).Replace(' -> ', "`n").Split("`n")[-1].Replace('\','/')
      if (-not ($allowed | Where-Object { $path.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) })) {
        throw "Git guard found an unrelated candidate change: $path"
      }
    }
  }
  if ($LASTEXITCODE -ne 0 -or $branch -ne 'security/hardening' -or ($status -and -not $AllowRecoveryCandidateChanges)) {
    throw 'Git guard failed: security/hardening must be clean.'
  }
  return $root
}

function Test-IsPathInside {
  param([Parameter(Mandatory)][string]$Child, [Parameter(Mandatory)][string]$Parent)
  $childFull = [IO.Path]::GetFullPath($Child).TrimEnd('\') + '\'
  $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  return $childFull.StartsWith($parentFull, [StringComparison]::OrdinalIgnoreCase)
}

function Assert-OutsideRepository {
  param([Parameter(Mandatory)][string]$Path)
  $repo = Get-RecoveryRepositoryRoot
  if (Test-IsPathInside -Child $Path -Parent $repo) {
    throw 'Recovery artifacts must be outside the Git repository.'
  }
}

function New-ProtectedRecoveryDirectory {
  param([Parameter(Mandatory)][string]$Purpose)
  New-Item -ItemType Directory -Path $script:RecoveryWorkRoot -Force | Out-Null
  $path = Join-Path $script:RecoveryWorkRoot ("{0}-{1}-{2}" -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $Purpose, [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $path | Out-Null
  & icacls.exe $path /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not protect the temporary recovery directory ACL.' }
  return $path
}

function Remove-ProtectedRecoveryDirectory {
  param([Parameter(Mandatory)][string]$Path)
  if (-not (Test-IsPathInside -Child $Path -Parent $script:RecoveryWorkRoot)) {
    throw 'Refusing to remove a path outside the recovery work root.'
  }
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
  if (Test-Path -LiteralPath $Path) { throw 'Temporary recovery directory remains after cleanup.' }
}

function ConvertFrom-SecureStringTransient {
  param([Parameter(Mandatory)][Security.SecureString]$SecureValue)
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Write-Utf8NoBom {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][AllowEmptyString()][string]$Value)
  [IO.File]::WriteAllText($Path, $Value, [Text.UTF8Encoding]::new($false))
}

function Invoke-RecoveryPostgresClient {
  param(
    [Parameter(Mandatory)][string]$ServiceFile,
    [Parameter(Mandatory)][string]$PassFile,
    [Parameter(Mandatory)][string[]]$ClientArguments,
    [string]$Network = 'bridge',
    [string]$WritableBackupDirectory
  )

  foreach ($credentialPath in @($ServiceFile, $PassFile)) {
    if (-not (Test-Path -LiteralPath $credentialPath -PathType Leaf)) {
      throw 'A required temporary PostgreSQL credential file is missing.'
    }
    if (-not (Test-IsPathInside -Child $credentialPath -Parent $script:RecoveryWorkRoot)) {
      throw 'PostgreSQL credential files must remain inside the protected recovery work root.'
    }
  }
  if ($ClientArguments.Count -eq 0 -or $ClientArguments[0] -notin @('pg_dump','pg_dumpall','psql')) {
    throw 'The isolated PostgreSQL client command is outside the recovery allowlist.'
  }
  if ($Network -ne 'bridge' -and $Network -notmatch '^container:supabase_db_alamin-recovery-(source|target)-[a-z0-9-]+$') {
    throw 'PostgreSQL client network mode is outside the recovery allowlist.'
  }
  if ($WritableBackupDirectory) {
    Assert-OutsideRepository -Path $WritableBackupDirectory
    if (-not (Test-Path -LiteralPath $WritableBackupDirectory -PathType Container)) {
      throw 'PostgreSQL backup output directory does not exist.'
    }
  }

  $serviceBytes = $null
  $passBytes = $null
  $servicePayload = $null
  $passPayload = $null
  $argumentPayloads = $null
  $stdinPayload = $null
  try {
    $serviceBytes = [IO.File]::ReadAllBytes($ServiceFile)
    $passBytes = [IO.File]::ReadAllBytes($PassFile)
    $servicePayload = [Convert]::ToBase64String($serviceBytes)
    $passPayload = [Convert]::ToBase64String($passBytes)
    $argumentPayloads = @($ClientArguments | ForEach-Object {
      [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($_))
    })
    $stdinPayload = "$servicePayload`n$passPayload`n$($argumentPayloads.Count)`n$($argumentPayloads -join "`n")`n"

    # Credential content crosses the Docker boundary only on stdin. The client
    # receives freshly materialized files in a private tmpfs after exact mode
    # checks. No password is placed in args, environment, bind mounts, or logs.
    $bootstrapFile = Join-Path (Get-RecoveryRepositoryRoot) 'scripts\recovery\Invoke-IsolatedPostgresClient.sh'
    if (-not (Test-Path -LiteralPath $bootstrapFile -PathType Leaf)) {
      throw 'The isolated PostgreSQL client bootstrap is missing.'
    }
    $mountBootstrap = ([IO.Path]::GetFullPath($bootstrapFile) -replace '\\','/')
    $dockerArguments = @(
      'run','--rm','-i','--pull','never','--network',$Network,
      '--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
      '--tmpfs','/run/secrets:rw,noexec,nosuid,nodev,mode=0700,size=1m',
      '-e','PGSERVICEFILE=/run/secrets/pg_service.conf',
      '-e','PGPASSFILE=/run/secrets/pgpass',
      '-v',"${mountBootstrap}:/opt/alamin/Invoke-IsolatedPostgresClient.sh:ro"
    )
    if ($WritableBackupDirectory) {
      $mountOut = ([IO.Path]::GetFullPath($WritableBackupDirectory) -replace '\\','/')
      $dockerArguments += @('-v', "${mountOut}:/backup:rw")
    }
    $dockerArguments += @($script:PostgresImage,'sh','/opt/alamin/Invoke-IsolatedPostgresClient.sh')

    $output = @($stdinPayload | & $script:DockerPath @dockerArguments 2>$null)
    if ($LASTEXITCODE -ne 0) {
      throw 'The isolated PostgreSQL client failed before completing the requested read-only operation.'
    }
    return $output
  } finally {
    if ($serviceBytes) { [Array]::Clear($serviceBytes, 0, $serviceBytes.Length) }
    if ($passBytes) { [Array]::Clear($passBytes, 0, $passBytes.Length) }
    $servicePayload = $null
    $passPayload = $null
    $argumentPayloads = $null
    $stdinPayload = $null
  }
}

function Get-Sha256Lower {
  param([Parameter(Mandatory)][string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-PathSafeHash {
  param([Parameter(Mandatory)][string[]]$Values)
  $joined = ($Values | Sort-Object) -join "`n"
  $bytes = [Text.Encoding]::UTF8.GetBytes($joined)
  try {
    $hash = [Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
    return ([BitConverter]::ToString($hash).Replace('-','')).ToLowerInvariant()
  } finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}

function Get-ValidatedS3Connection {
  param(
    [Parameter(Mandatory)][string]$Endpoint,
    [Parameter(Mandatory)][string]$Region,
    [switch]$AllowLocal
  )

  $endpointValue = $Endpoint.Trim().TrimEnd('/')
  $regionValue = $Region.Trim()
  try { $uri = [Uri]$endpointValue } catch { throw 'The S3 endpoint is not a valid absolute URL.' }
  if (-not $uri.IsAbsoluteUri -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) {
    throw 'The S3 endpoint must be an absolute credential-free URL without query or fragment.'
  }
  if ($uri.AbsolutePath -cne '/storage/v1/s3') {
    throw 'The official Supabase S3 endpoint must end exactly with /storage/v1/s3.'
  }

  if ($AllowLocal) {
    if ($uri.Scheme -notin @('http','https') -or $uri.Host -notin @('127.0.0.1','localhost','::1') -or $regionValue -cne 'local') {
      throw 'Synthetic S3 signing is restricted to a loopback endpoint and region local.'
    }
  } else {
    if ($uri.Scheme -cne 'https' -or -not $uri.IsDefaultPort -or $uri.Host -notmatch '^[a-z0-9]+(?:\.storage)?\.supabase\.co$') {
      throw 'Only an official HTTPS Supabase project S3 endpoint is allowed.'
    }
    if ($regionValue -cnotmatch '^[a-z]{2}(?:-[a-z0-9]+)+-[0-9]+$') {
      throw 'The S3 region must be the exact project region identifier shown by Supabase.'
    }
  }

  return [pscustomobject]@{
    Endpoint = $endpointValue
    Region = $regionValue
  }
}

function Invoke-ReadOnlyS3BucketExport {
  param(
    [Parameter(Mandatory)][string]$Endpoint,
    [Parameter(Mandatory)][string]$Region,
    [Parameter(Mandatory)][string]$AccessKeyId,
    [Parameter(Mandatory)][Security.SecureString]$SecretAccessKey,
    [Parameter(Mandatory)][string[]]$Buckets,
    [Parameter(Mandatory)][string]$DestinationRoot,
    [switch]$AllowLocal
  )

  $connection = Get-ValidatedS3Connection -Endpoint $Endpoint -Region $Region -AllowLocal:$AllowLocal
  if ([string]::IsNullOrWhiteSpace($AccessKeyId) -or $AccessKeyId -match '[\r\n]') {
    throw 'The temporary S3 access key ID is missing or malformed.'
  }
  Assert-OutsideRepository -Path $DestinationRoot

  $controlled = [ordered]@{
    RCLONE_CONFIG_SOURCE_TYPE = 's3'
    RCLONE_CONFIG_SOURCE_PROVIDER = 'Other'
    RCLONE_CONFIG_SOURCE_ENV_AUTH = 'false'
    RCLONE_CONFIG_SOURCE_ACCESS_KEY_ID = $AccessKeyId
    RCLONE_CONFIG_SOURCE_SECRET_ACCESS_KEY = $null
    RCLONE_CONFIG_SOURCE_SESSION_TOKEN = $null
    RCLONE_CONFIG_SOURCE_ENDPOINT = $connection.Endpoint
    RCLONE_CONFIG_SOURCE_REGION = $connection.Region
    RCLONE_CONFIG_SOURCE_FORCE_PATH_STYLE = 'true'
    RCLONE_CONFIG_SOURCE_LIST_VERSION = '2'
    RCLONE_CONFIG_SOURCE_V2_AUTH = 'false'
    RCLONE_CONFIG_SOURCE_USE_ACCELERATE_ENDPOINT = 'false'
    RCLONE_S3_ACCESS_KEY_ID = $null
    RCLONE_S3_SECRET_ACCESS_KEY = $null
    RCLONE_S3_SESSION_TOKEN = $null
    AWS_ACCESS_KEY_ID = $null
    AWS_SECRET_ACCESS_KEY = $null
    AWS_SESSION_TOKEN = $null
    AWS_PROFILE = $null
    AWS_SHARED_CREDENTIALS_FILE = $null
    AWS_CONFIG_FILE = $null
    AWS_EC2_METADATA_DISABLED = 'true'
  }
  $old = @{}
  foreach ($name in $controlled.Keys) {
    $old[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  }

  $plainSecret = $null
  try {
    $plainSecret = ConvertFrom-SecureStringTransient $SecretAccessKey
    if ([string]::IsNullOrWhiteSpace($plainSecret) -or $plainSecret -match '[\r\n]') {
      throw 'The temporary S3 secret access key is missing or malformed.'
    }
    $controlled.RCLONE_CONFIG_SOURCE_SECRET_ACCESS_KEY = $plainSecret
    foreach ($entry in $controlled.GetEnumerator()) {
      [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
    }
    $plainSecret = $null

    foreach ($bucket in $Buckets) {
      if ($bucket -notmatch '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$') {
        throw 'The Storage export bucket is outside the fixed safe-name contract.'
      }

      # This is a fail-fast SigV4/ListObjects probe. Output is suppressed so
      # object paths cannot reach logs. It performs no source mutation.
      $priorPreference = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      try {
        & $script:RclonePath lsf "source:$bucket" --max-depth 1 --s3-list-version 2 --config NUL --log-level ERROR 2>$null | Out-Null
        $probeExit = $LASTEXITCODE
      } finally {
        $ErrorActionPreference = $priorPreference
      }
      if ($probeExit -ne 0) {
        throw 'Supabase S3 read-only signing or bucket-list verification failed.'
      }

      $bucketOut = Join-Path $DestinationRoot $bucket
      New-Item -ItemType Directory -Path $bucketOut -Force | Out-Null
      $priorPreference = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      try {
        & $script:RclonePath copy "source:$bucket" $bucketOut --immutable --metadata --check-first --no-traverse --s3-list-version 2 --config NUL --log-level ERROR 2>$null | Out-Null
        $copyExit = $LASTEXITCODE
      } finally {
        $ErrorActionPreference = $priorPreference
      }
      if ($copyExit -ne 0) {
        throw 'Read-only Storage download failed for an approved bucket.'
      }
    }
  } finally {
    foreach ($name in $controlled.Keys) {
      [Environment]::SetEnvironmentVariable($name, $old[$name], 'Process')
    }
    $controlled.RCLONE_CONFIG_SOURCE_SECRET_ACCESS_KEY = $null
    $plainSecret = $null
    $connection = $null
  }
}

function Assert-LocalDisposableTarget {
  param(
    [Parameter(Mandatory)][string]$ProjectId,
    [Parameter(Mandatory)][string]$ApiUrl,
    [Parameter(Mandatory)][string]$Container
  )
  if ($ProjectId -notmatch '^alamin-recovery-(source|target)-[a-z0-9-]+$') {
    throw 'Disposable project_id does not have the required recovery prefix.'
  }
  $uri = [Uri]$ApiUrl
  if ($uri.Host -notin @('127.0.0.1', 'localhost', '::1')) {
    throw 'Recovery target API is not loopback-only.'
  }
  if ($Container -ne "supabase_db_$ProjectId") {
    throw 'Recovery target container does not match the disposable project_id.'
  }
  $name = (& $script:DockerPath inspect --format '{{.Name}}|{{.State.Status}}' $Container 2>$null).TrimStart('/')
  if ($LASTEXITCODE -ne 0 -or $name -notmatch "^$([regex]::Escape($Container))\|running$") {
    throw 'Disposable recovery database container is not running.'
  }
}

function Assert-ZipEntriesSafe {
  param([Parameter(Mandatory)][string]$ZipPath, [Parameter(Mandatory)][string]$Destination)
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    $root = [IO.Path]::GetFullPath($Destination).TrimEnd('\') + '\'
    foreach ($entry in $archive.Entries) {
      $candidate = [IO.Path]::GetFullPath((Join-Path $Destination $entry.FullName))
      if (-not $candidate.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Encrypted archive contains a path traversal entry.'
      }
    }
  } finally { $archive.Dispose() }
}

function Get-RedactedError {
  param([Parameter(Mandatory)]$ErrorRecord)
  $message = [string]$ErrorRecord.Exception.Message
  $message = $message -replace '(?i)(password|secret|token|key|authorization)\s*[:=]\s*\S+', '$1=[REDACTED]'
  $message = $message -replace '(?i)postgres(?:ql)?://\S+', 'postgresql://[REDACTED]'
  return $message
}
