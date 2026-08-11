param(
  [Parameter(Mandatory)][string]$ExpandedRoot,
  [Parameter(Mandatory)][string]$TargetContainer,
  [Parameter(Mandatory)][string]$TargetProjectId,
  [Parameter(Mandatory)][string]$TargetApiUrl,
  [string]$ResultFile
)

. (Join-Path $PSScriptRoot 'Recovery.Common.ps1')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Assert-LocalDisposableTarget -ProjectId $TargetProjectId -ApiUrl $TargetApiUrl -Container $TargetContainer
$sourceInventory = Get-Content -LiteralPath (Join-Path $ExpandedRoot 'database\database_inventory.json') -Raw | ConvertFrom-Json
$sourceStorage = Get-Content -LiteralPath (Join-Path $ExpandedRoot 'storage\storage_manifest.raw.json') -Raw | ConvertFrom-Json

$counts = @{}
foreach ($table in $sourceInventory.tables) {
  $qualified = ($table.table -split '\.') | ForEach-Object { '"' + $_.Replace('"','""') + '"' }
  if ($qualified.Count -ne 2) { throw 'Unsafe table identifier in inventory.' }
  $value = (& $script:DockerPath exec $TargetContainer psql -X -A -t -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -c "select count(*) from $($qualified -join '.')" 2>$null).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Target row-count reconciliation query failed.' }
  $counts[$table.table] = [int64]$value
  if ($counts[$table.table] -ne [int64]$table.row_count) { throw 'Database row-count reconciliation failed.' }
}

$localKey = $env:ALAMIN_RECOVERY_LOCAL_SERVICE_KEY
if ([string]::IsNullOrWhiteSpace($localKey)) { throw 'Disposable target Storage key is absent from process memory.' }
$headers = @{ Authorization = "Bearer $localKey"; apikey = $localKey }
$verified = 0
try {
  foreach ($object in $sourceStorage.objects) {
    $encoded = (($object.path -split '/') | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/'
    $temp = Join-Path $env:TEMP ("alamin-verify-$([guid]::NewGuid().ToString('N')).bin")
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$TargetApiUrl/storage/v1/object/$($object.bucket)/$encoded" -Headers $headers -Method Get -OutFile $temp | Out-Null
      if ((Get-Sha256Lower $temp) -ne $object.sha256) { throw 'Restored Storage content hash mismatch.' }
      $verified++
    } finally { if (Test-Path $temp) { Remove-Item -LiteralPath $temp -Force } }
  }
} finally { $headers.Clear(); $localKey = $null }

$authUserCount = 0
if ($counts.ContainsKey('auth.users')) { $authUserCount = $counts['auth.users'] }
$resultJson = [pscustomobject]@{
  Status='PASS'
  TableCount=$counts.Count
  AuthUserCount=$authUserCount
  StorageObjectCount=$verified
  RowCountsMatch=$true
  StorageHashesMatch=$true
} | ConvertTo-Json -Compress
if ($ResultFile) {
  Assert-OutsideRepository -Path $ResultFile
  Write-Utf8NoBom -Path $ResultFile -Value $resultJson
}
$resultJson
