Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:RecoveryRoot = Join-Path $env:LOCALAPPDATA 'AL-AMIN-Recovery'
$script:RecoveryWorkRoot = Join-Path $script:RecoveryRoot 'work'
$script:AgePath = Join-Path $script:RecoveryRoot 'tools\age-1.3.1\age.exe'
$script:RclonePath = Join-Path $script:RecoveryRoot 'tools\rclone-1.74.3\rclone.exe'
$script:SupabasePath = Join-Path $env:LOCALAPPDATA 'Programs\SupabaseCLI\2.113.0\supabase.exe'
$script:DockerPath = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'
$script:PostgresImage = 'postgres:17.6-alpine'

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
