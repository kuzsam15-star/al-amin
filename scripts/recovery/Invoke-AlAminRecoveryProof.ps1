param(
  [ValidateSet('Interactive','SyntheticPreflight','PreparedProductionExport')][string]$Mode = 'Interactive',
  [string]$PreparedBackupDirectory,
  [string]$PreparedDatabaseHost,
  [string]$PreparedDatabasePort = '5432',
  [string]$PreparedDatabaseName = 'postgres',
  [string]$PreparedDatabaseUser,
  [string]$PreparedS3Endpoint,
  [string]$PreparedS3Region,
  [switch]$OwnerProductionReadApproved
)

. (Join-Path $PSScriptRoot 'Recovery.Common.ps1')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try {
  $repo = Assert-GitGuard -AllowRecoveryCandidateChanges:($Mode -eq 'SyntheticPreflight')
  Assert-RecoveryTools
  if ($Mode -eq 'SyntheticPreflight') {
    Write-Host 'Running a disposable synthetic recovery proof. Production is not contacted.'
    & node (Join-Path $PSScriptRoot 'recovery-preflight.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic recovery preflight failed.' }
    exit 0
  }

  Write-Host ''
  Write-Host 'AL-AMIN encrypted recovery proof'
  Write-Host 'This owner-operated tool never restores into production.'
  Write-Host 'Credentials remain in local hidden prompts and are not written to Git or reports.'
  Write-Host ''
  if ($Mode -eq 'PreparedProductionExport') {
    if (-not $OwnerProductionReadApproved -or -not $PreparedBackupDirectory -or -not $PreparedDatabaseHost -or -not $PreparedDatabaseUser -or -not $PreparedS3Endpoint -or -not $PreparedS3Region) {
      throw 'Prepared production export requires approved non-secret database and Storage connection metadata.'
    }
    $choice = '1'
  } else {
    Write-Host '1 - Create a read-only encrypted production backup (after owner approval)'
    Write-Host '2 - Restore an existing encrypted backup into two disposable local targets'
    Write-Host '3 - Run the synthetic local preflight'
    $choice = Read-Host 'Choose 1, 2, or 3'
  }
  if ($choice -eq '3') {
    & node (Join-Path $PSScriptRoot 'recovery-preflight.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic recovery preflight failed.' }
    exit 0
  }
  if ($choice -eq '2') {
    if ((Read-Host 'Type TEMPORARY S3 KEY DELETED to confirm owner revocation') -cne 'TEMPORARY S3 KEY DELETED') {
      throw 'Restore remains locked until temporary S3 key deletion is confirmed.'
    }
    $artifact = (Read-Host 'Full path to the encrypted .age backup outside the project').Trim()
    if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) { throw 'Encrypted backup was not found.' }
    Assert-OutsideRepository -Path $artifact
    Write-Host 'Two independent local restores will run. Enter the archive passphrase when age asks during each restore.'
    & node (Join-Path $PSScriptRoot 'recovery-restore-proof.mjs') $artifact
    if ($LASTEXITCODE -ne 0) { throw 'Two-run isolated recovery proof failed.' }
    exit 0
  }
  if ($choice -ne '1') { throw 'No valid workflow was selected.' }

  Write-Host 'The next operation reads real database rows and Storage bytes but never mutates the source.'
  if ($Mode -eq 'PreparedProductionExport') {
    $destination = $PreparedBackupDirectory.Trim()
  } else {
    if ((Read-Host 'Type CREATE ENCRYPTED BACKUP to continue') -cne 'CREATE ENCRYPTED BACKUP') { throw 'Owner confirmation was not provided locally.' }
    $destination = (Read-Host 'Existing final backup directory outside the project').Trim()
  }
  if (-not (Test-Path -LiteralPath $destination -PathType Container)) { throw 'The final backup directory does not exist.' }
  Assert-OutsideRepository -Path $destination

  $work = New-ProtectedRecoveryDirectory -Purpose 'production-export'
  $payload = Join-Path $work 'payload'
  $database = Join-Path $payload 'database'
  $storage = Join-Path $payload 'storage'
  $config = Join-Path $payload 'config'
  New-Item -ItemType Directory -Path $database,$storage,$config -Force | Out-Null
  try {
    if ($Mode -eq 'PreparedProductionExport') {
      & (Join-Path $PSScriptRoot 'Export-AlAminDatabaseBackup.ps1') -SourceMode Production -OutputDirectory $database -ProductionHost $PreparedDatabaseHost -ProductionPort $PreparedDatabasePort -ProductionDatabase $PreparedDatabaseName -ProductionUser $PreparedDatabaseUser -ProductionReadOnlyApproved
    } else {
      & (Join-Path $PSScriptRoot 'Export-AlAminDatabaseBackup.ps1') -SourceMode Production -OutputDirectory $database
    }
    if ($Mode -eq 'PreparedProductionExport') {
      & (Join-Path $PSScriptRoot 'Export-AlAminStorageBackup.ps1') -SourceMode ProductionS3 -OutputDirectory $storage -ProductionS3Endpoint $PreparedS3Endpoint -ProductionS3Region $PreparedS3Region -ProductionReadOnlyApproved
    } else {
      & (Join-Path $PSScriptRoot 'Export-AlAminStorageBackup.ps1') -SourceMode ProductionS3 -OutputDirectory $storage
    }
    Copy-Item -LiteralPath (Join-Path $repo 'docs\security\recovery\CONFIG_RECOVERY_MANIFEST.json') -Destination $config
    $zip = Join-Path $work 'payload.zip'
    Compress-Archive -LiteralPath $database,$storage,$config -DestinationPath $zip -CompressionLevel Optimal
    $archive = Join-Path $destination ("AL-AMIN-recovery-{0}.zip.age" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    Write-Host 'Create the archive passphrase in the age prompt. Codex never receives it.'
    & $script:AgePath --passphrase -o $archive $zip
    if ($LASTEXITCODE -ne 0) { throw 'Encryption failed.' }
    $testZip = Join-Path $work 'integrity-test.zip'
    Write-Host 'Re-enter the passphrase once to authenticate the encrypted archive.'
    & $script:AgePath --decrypt -o $testZip $archive
    if ($LASTEXITCODE -ne 0 -or (Get-Sha256Lower $testZip) -ne (Get-Sha256Lower $zip)) { throw 'Encrypted archive integrity verification failed.' }
    Remove-Item -LiteralPath $testZip,$zip -Force
    $report = [ordered]@{
      format_version = 1
      status = 'EXPORT_COMPLETE_S3_KEY_DELETION_REQUIRED'
      created_utc = (Get-Date).ToUniversalTime().ToString('o')
      archive_file = [IO.Path]::GetFileName($archive)
      archive_size = (Get-Item -LiteralPath $archive).Length
      archive_sha256 = Get-Sha256Lower $archive
      encryption = 'age v1.3.1 passphrase authenticated encryption'
      database = 'EXPORTED_READ_ONLY'
      storage = 'EXPORTED_LIST_HEAD_GET_ONLY'
      config = 'CAPTURED_REDACTED_MANIFEST'
      credentials_persisted = $false
      production_mutated = $false
    }
    $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $destination 'AL-AMIN-recovery-export-redacted.json') -Encoding UTF8
    Remove-ProtectedRecoveryDirectory -Path $work
    $work = $null
    Write-Host 'Encrypted export PASS. Delete the exact temporary S3 key in Supabase Dashboard now.'
    Write-Host 'Do not start restore until the security workstream records the temporary S3 key as deleted.'
  } finally {
    if ($work -and (Test-Path -LiteralPath $work)) { Remove-ProtectedRecoveryDirectory -Path $work }
  }
} catch {
  Write-Error (Get-RedactedError $_)
  exit 1
}
