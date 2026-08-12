. (Join-Path $PSScriptRoot 'Recovery.Common.ps1')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$checks = [ordered]@{
  local_valid = [bool](Get-ValidatedS3Connection -Endpoint 'http://127.0.0.1:54321/storage/v1/s3' -Region 'local' -AllowLocal)
  production_direct_valid = [bool](Get-ValidatedS3Connection -Endpoint 'https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3' -Region 'eu-west-2')
  production_gateway_valid = [bool](Get-ValidatedS3Connection -Endpoint 'https://abcdefghijklmnopqrst.supabase.co/storage/v1/s3' -Region 'eu-west-2')
  missing_path_blocked = $false
  foreign_host_blocked = $false
  bad_region_blocked = $false
  query_blocked = $false
}

try { Get-ValidatedS3Connection -Endpoint 'https://abcdefghijklmnopqrst.storage.supabase.co' -Region 'eu-west-2' | Out-Null } catch { $checks.missing_path_blocked = $true }
try { Get-ValidatedS3Connection -Endpoint 'https://example.invalid/storage/v1/s3' -Region 'eu-west-2' | Out-Null } catch { $checks.foreign_host_blocked = $true }
try { Get-ValidatedS3Connection -Endpoint 'https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3' -Region 'wrong-region' | Out-Null } catch { $checks.bad_region_blocked = $true }
try { Get-ValidatedS3Connection -Endpoint 'https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3?unsafe=1' -Region 'eu-west-2' | Out-Null } catch { $checks.query_blocked = $true }

if ($checks.Values -contains $false) { throw 'S3 endpoint/region validation regression failed.' }

$commonSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Recovery.Common.ps1') -Raw
if (($commonSource | Select-String -Pattern '--s3-list-version 2' -AllMatches).Matches.Count -ne 2 -or
    $commonSource -notmatch "RCLONE_CONFIG_SOURCE_LIST_VERSION = '2'") {
  throw 'Supabase S3 ListObjects V2 pin regression failed.'
}

$entrySource = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Invoke-AlAminRecoveryProof.ps1') -Raw
$exportSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Export-AlAminStorageBackup.ps1') -Raw
if ($entrySource -notmatch '\[string\]\$PreparedS3Endpoint' -or
    $entrySource -notmatch '\[string\]\$PreparedS3Region' -or
    $entrySource -notmatch '-ProductionS3Endpoint \$PreparedS3Endpoint -ProductionS3Region \$PreparedS3Region -ProductionReadOnlyApproved' -or
    $exportSource -notmatch '\[switch\]\$ProductionReadOnlyApproved' -or
    $exportSource -notmatch 'Get-ValidatedS3Connection -Endpoint \$endpoint -Region \$region') {
  throw 'Prepared non-secret S3 metadata wiring regression failed.'
}
$checks | ConvertTo-Json -Compress
