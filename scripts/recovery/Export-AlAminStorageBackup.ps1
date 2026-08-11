param(
  [Parameter(Mandatory)][ValidateSet('LocalApi','ProductionS3')][string]$SourceMode,
  [Parameter(Mandatory)][string]$OutputDirectory,
  [string]$LocalContainer,
  [string]$LocalProjectId,
  [string]$LocalApiUrl
)

. (Join-Path $PSScriptRoot 'Recovery.Common.ps1')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Assert-OutsideRepository -Path $OutputDirectory
$objectRoot = Join-Path $OutputDirectory 'storage_objects'
New-Item -ItemType Directory -Path $objectRoot -Force | Out-Null
$buckets = @('avatars','profile-media')

function Get-SafeObjectDestination([string]$Bucket, [string]$ObjectName) {
  if ([string]::IsNullOrWhiteSpace($ObjectName) -or $ObjectName.Contains('\') -or $ObjectName.StartsWith('/') -or $ObjectName.Split('/') -contains '..') {
    throw 'Storage source returned an unsafe object path.'
  }
  $base = [IO.Path]::GetFullPath((Join-Path $objectRoot $Bucket)).TrimEnd('\') + '\'
  $candidate = [IO.Path]::GetFullPath((Join-Path $base ($ObjectName -replace '/', '\')))
  if (-not $candidate.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { throw 'Storage path traversal blocked.' }
  return $candidate
}

function Get-DetectedImageMime([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  try {
    $header = New-Object byte[] 12
    $read = $stream.Read($header, 0, $header.Length)
    if ($read -ge 8 -and [BitConverter]::ToString($header,0,8) -eq '89-50-4E-47-0D-0A-1A-0A') { return 'image/png' }
    if ($read -ge 3 -and $header[0] -eq 0xFF -and $header[1] -eq 0xD8 -and $header[2] -eq 0xFF) { return 'image/jpeg' }
    if ($read -ge 12 -and [Text.Encoding]::ASCII.GetString($header,0,4) -eq 'RIFF' -and [Text.Encoding]::ASCII.GetString($header,8,4) -eq 'WEBP') { return 'image/webp' }
    throw 'Storage backup contains a non-approved or malformed media type.'
  } finally { $stream.Dispose() }
}

if ($SourceMode -eq 'LocalApi') {
  Assert-LocalDisposableTarget -ProjectId $LocalProjectId -ApiUrl $LocalApiUrl -Container $LocalContainer
  $localKey = $env:ALAMIN_RECOVERY_LOCAL_SERVICE_KEY
  if ([string]::IsNullOrWhiteSpace($localKey)) { throw 'Disposable local Storage key is absent from process memory.' }
  $headers = @{ Authorization = "Bearer $localKey"; apikey = $localKey }
  try {
    foreach ($bucket in $buckets) {
      $names = & $script:DockerPath exec $LocalContainer psql -X -A -t -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -c "select name from storage.objects where bucket_id='$bucket' order by name" 2>$null
      if ($LASTEXITCODE -ne 0) { throw 'Local Storage metadata listing failed.' }
      foreach ($name in ($names | Where-Object { $_ })) {
        $destination = Get-SafeObjectDestination -Bucket $bucket -ObjectName $name
        New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
        $encoded = (($name -split '/') | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/'
        Invoke-WebRequest -UseBasicParsing -Uri "$LocalApiUrl/storage/v1/object/$bucket/$encoded" -Headers $headers -Method Get -OutFile $destination | Out-Null
      }
    }
  } finally {
    $headers.Clear(); $localKey = $null
  }
} else {
  Write-Host 'Storage export permits LIST/HEAD/GET only. The temporary S3 secret remains in this process.'
  $endpoint = (Read-Host 'Supabase S3 endpoint (https://...)').Trim()
  $region = (Read-Host 'S3 region').Trim()
  $accessId = (Read-Host 'Temporary S3 access key ID').Trim()
  $secureSecret = Read-Host 'Temporary S3 secret access key (hidden)' -AsSecureString
  $uri = [Uri]$endpoint
  if ($uri.Scheme -ne 'https' -or $uri.Host -notmatch '(^|\.)supabase\.co$' -or $uri.Host -in @('localhost','127.0.0.1')) {
    throw 'Only the official HTTPS Supabase S3 endpoint is allowed.'
  }
  if ((Read-Host 'Type LIST GET ONLY to confirm source write/delete is forbidden') -cne 'LIST GET ONLY') {
    throw 'Storage read-only confirmation was not provided.'
  }
  $old = @{}
  $names = @('RCLONE_CONFIG_SOURCE_TYPE','RCLONE_CONFIG_SOURCE_PROVIDER','RCLONE_CONFIG_SOURCE_ACCESS_KEY_ID','RCLONE_CONFIG_SOURCE_SECRET_ACCESS_KEY','RCLONE_CONFIG_SOURCE_ENDPOINT','RCLONE_CONFIG_SOURCE_REGION','RCLONE_CONFIG_SOURCE_FORCE_PATH_STYLE')
  foreach ($name in $names) { $old[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
  try {
    $plainSecret = ConvertFrom-SecureStringTransient $secureSecret
    [Environment]::SetEnvironmentVariable('RCLONE_CONFIG_SOURCE_TYPE','s3','Process')
    [Environment]::SetEnvironmentVariable('RCLONE_CONFIG_SOURCE_PROVIDER','Other','Process')
    [Environment]::SetEnvironmentVariable('RCLONE_CONFIG_SOURCE_ACCESS_KEY_ID',$accessId,'Process')
    [Environment]::SetEnvironmentVariable('RCLONE_CONFIG_SOURCE_SECRET_ACCESS_KEY',$plainSecret,'Process')
    [Environment]::SetEnvironmentVariable('RCLONE_CONFIG_SOURCE_ENDPOINT',$endpoint,'Process')
    [Environment]::SetEnvironmentVariable('RCLONE_CONFIG_SOURCE_REGION',$region,'Process')
    [Environment]::SetEnvironmentVariable('RCLONE_CONFIG_SOURCE_FORCE_PATH_STYLE','true','Process')
    $plainSecret = $null
    foreach ($bucket in $buckets) {
      $bucketOut = Join-Path $objectRoot $bucket
      New-Item -ItemType Directory -Path $bucketOut -Force | Out-Null
      & $script:RclonePath copy "source:$bucket" $bucketOut --immutable --metadata --check-first --no-traverse --log-level ERROR 2>$null
      if ($LASTEXITCODE -ne 0) { throw "Read-only Storage download failed for an approved bucket." }
    }
  } finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $old[$name], 'Process') }
    $secureSecret.Dispose(); $plainSecret = $null; $accessId = $null
  }
}

$rawEntries = @()
$redactedBuckets = @()
foreach ($bucket in $buckets) {
  $bucketRoot = Join-Path $objectRoot $bucket
  $files = if (Test-Path $bucketRoot) { @(Get-ChildItem -LiteralPath $bucketRoot -Recurse -File) } else { @() }
  $bucketEntries = @()
  foreach ($file in $files) {
    $relative = $file.FullName.Substring($bucketRoot.Length).TrimStart('\').Replace('\','/')
    $entry = [ordered]@{ bucket=$bucket; path=$relative; size=[int64]$file.Length; sha256=(Get-Sha256Lower $file.FullName); mime=(Get-DetectedImageMime $file.FullName); etag=$null }
    $rawEntries += $entry; $bucketEntries += $entry
  }
  [int64]$sum = 0
  foreach ($bucketEntry in $bucketEntries) { $sum += [int64]$bucketEntry['size'] }
  $redactedBuckets += [ordered]@{
    bucket = $bucket
    object_count = $bucketEntries.Count
    total_bytes = [int64]$sum
    path_hash = Get-PathSafeHash @($bucketEntries | ForEach-Object { $_['path'] })
    aggregate_content_hash = Get-PathSafeHash @($bucketEntries | ForEach-Object { "$($_['path'])|$($_['size'])|$($_['sha256'])" })
    missing_or_corrupt = 0
  }
}
$raw = [ordered]@{ format_version=1; generated_utc=(Get-Date).ToUniversalTime().ToString('o'); objects=$rawEntries }
$raw | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'storage_manifest.raw.json') -Encoding UTF8
$redacted = [ordered]@{ format_version=1; generated_utc=(Get-Date).ToUniversalTime().ToString('o'); buckets=$redactedBuckets; contains_paths=$false; contains_credentials=$false }
$redacted | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'storage_manifest.redacted.json') -Encoding UTF8
$redacted
