. (Join-Path $PSScriptRoot 'Recovery.Common.ps1')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:attempts = 0
$script:cleanups = 0
Invoke-RecoveryOperationWithRetry -Operation {
  param($attempt)
  $script:attempts++
  if ($attempt -lt 2) { return 1 }
  return 0
} -CleanupFailedAttempt {
  $script:cleanups++
} -RetryMessage 'synthetic retry' -FailureMessage 'synthetic failure'

if ($script:attempts -ne 2 -or $script:cleanups -ne 1) {
  throw 'Passphrase retry did not preserve work across a recoverable mismatch.'
}

$script:failedAttempts = 0
$script:failedCleanups = 0
$blocked = $false
try {
  Invoke-RecoveryOperationWithRetry -Operation {
    param($attempt)
    $script:failedAttempts++
    return 1
  } -CleanupFailedAttempt {
    $script:failedCleanups++
  } -RetryMessage 'synthetic retry' -FailureMessage 'expected bounded failure'
} catch {
  $blocked = $_.Exception.Message -eq 'expected bounded failure'
}

if (-not $blocked -or $script:failedAttempts -ne 3 -or $script:failedCleanups -ne 3) {
  throw 'Passphrase retry was not bounded to three fail-closed attempts.'
}

$entrySource = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Invoke-AlAminRecoveryProof.ps1') -Raw
$deleteGate = $entrySource.IndexOf("After deletion, type TEMPORARY S3 KEY DELETED", [StringComparison]::Ordinal)
$encryption = $entrySource.IndexOf('Create the archive passphrase in the age prompt', [StringComparison]::Ordinal)
if ($deleteGate -lt 0 -or $encryption -lt 0 -or $deleteGate -ge $encryption) {
  throw 'Temporary S3 key deletion gate must precede passphrase encryption.'
}

[ordered]@{
  retry_after_mismatch = 'PASS'
  max_attempts = 3
  failed_attempt_cleanup = 'PASS'
  s3_key_deletion_before_encryption = 'PASS'
} | ConvertTo-Json -Compress
