param(
  [Parameter(Mandatory)][string]$EncryptedArtifact,
  [Parameter(Mandatory)][string]$TargetContainer,
  [Parameter(Mandatory)][string]$TargetProjectId,
  [Parameter(Mandatory)][string]$TargetApiUrl,
  [string]$SyntheticIdentityFile,
  [string]$ResultFile
)

. (Join-Path $PSScriptRoot 'Recovery.Common.ps1')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Assert-LocalDisposableTarget -ProjectId $TargetProjectId -ApiUrl $TargetApiUrl -Container $TargetContainer
Assert-OutsideRepository -Path $EncryptedArtifact
$localKey = $env:ALAMIN_RECOVERY_LOCAL_SERVICE_KEY
if ([string]::IsNullOrWhiteSpace($localKey)) { throw 'Disposable target Storage key is absent from process memory.' }

$restoreRoot = New-ProtectedRecoveryDirectory -Purpose 'restore'
$zipPath = Join-Path $restoreRoot 'payload.zip'
$expanded = Join-Path $restoreRoot 'payload'
try {
  if ($SyntheticIdentityFile) {
    & $script:AgePath --decrypt -i $SyntheticIdentityFile -o $zipPath $EncryptedArtifact 2>$null
  } else {
    Write-Host 'Enter the backup passphrase in the age prompt. It is not logged.'
    & $script:AgePath --decrypt -o $zipPath $EncryptedArtifact
  }
  if ($LASTEXITCODE -ne 0) { throw 'Encrypted archive authentication/decryption failed.' }
  Assert-ZipEntriesSafe -ZipPath $zipPath -Destination $expanded
  Expand-Archive -LiteralPath $zipPath -DestinationPath $expanded
  $databaseBackup = Join-Path $expanded 'database\database.backup'
  $manifestPath = Join-Path $expanded 'storage\storage_manifest.raw.json'
  if (-not (Test-Path $databaseBackup) -or -not (Test-Path $manifestPath)) { throw 'Recovery archive is incomplete.' }

  $containerFile = "/tmp/alamin-restore-$([guid]::NewGuid().ToString('N')).backup"
  try {
    & $script:DockerPath cp $databaseBackup "${TargetContainer}:$containerFile" 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Could not stage database backup in disposable target.' }
    $prepareSql = "drop schema if exists public cascade; drop schema if exists private cascade; drop schema if exists auth cascade; drop schema if exists storage cascade; drop schema if exists supabase_migrations cascade;"
    $priorPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $script:DockerPath exec $TargetContainer psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -c $prepareSql 2>$null | Out-Null
    $prepareExit = $LASTEXITCODE
    & $script:DockerPath exec $TargetContainer pg_restore --exit-on-error -U supabase_admin -d postgres $containerFile 2>$null
    $restoreExit = $LASTEXITCODE
    $ErrorActionPreference = $priorPreference
    if ($prepareExit -ne 0) { throw 'Could not clear the disposable target schemas.' }
    if ($restoreExit -ne 0) { throw 'Database restore into disposable target failed.' }
    foreach ($service in @('auth','rest','storage','kong')) {
      $serviceContainer = "supabase_${service}_$TargetProjectId"
      & $script:DockerPath restart $serviceContainer 2>$null | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'A required disposable target service could not restart after restore.' }
      $ready = $false
      for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $state = (& $script:DockerPath inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $serviceContainer 2>$null).Trim()
        if ($LASTEXITCODE -eq 0 -and ($state -eq 'running|healthy' -or $state -eq 'running|none')) { $ready = $true; break }
        Start-Sleep -Seconds 1
      }
      if (-not $ready) { throw "Disposable $service service did not become ready after database restore." }
    }
  } finally {
    & $script:DockerPath exec $TargetContainer rm -f $containerFile 2>$null | Out-Null
  }

  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $existingObjectCount = (& $script:DockerPath exec $TargetContainer psql -X -A -t -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -c 'select count(*) from storage.objects' 2>$null).Trim()
  if ($LASTEXITCODE -ne 0 -or [int64]$existingObjectCount -ne 0) { throw 'Disposable target Storage metadata is not empty before byte restore.' }
  $headers = @{ Authorization = "Bearer $localKey"; apikey = $localKey; 'x-upsert' = 'false' }
  try {
    foreach ($object in $manifest.objects) {
      $root = [IO.Path]::GetFullPath((Join-Path $expanded "storage\storage_objects\$($object.bucket)")).TrimEnd('\') + '\'
      $source = [IO.Path]::GetFullPath((Join-Path $root ($object.path -replace '/', '\')))
      if (-not $source.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $source)) { throw 'Storage restore path validation failed.' }
      if ((Get-Sha256Lower $source) -ne $object.sha256) { throw 'Storage object failed pre-restore integrity verification.' }
      $encoded = (($object.path -split '/') | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/'
      try {
        Invoke-RestMethod -Uri "$TargetApiUrl/storage/v1/object/$($object.bucket)/$encoded" -Headers $headers -Method Post -InFile $source -ContentType $object.mime | Out-Null
      } catch {
        $statusCode = 'unknown'
        if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
        if ($env:ALAMIN_RECOVERY_SYNTHETIC -eq '1' -and $_.Exception.Response) {
          $reader = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
          try { $safeSyntheticDetail = $reader.ReadToEnd() } finally { $reader.Dispose() }
          throw "Synthetic Storage API upload failed with HTTP ${statusCode}: $safeSyntheticDetail"
        }
        throw "Storage API upload failed with HTTP $statusCode."
      }
    }
  } finally { $headers.Clear(); $localKey = $null }
  $resultJson = [pscustomobject]@{ Status='PASS'; RestoreRoot=$restoreRoot; ExpandedRoot=$expanded } | ConvertTo-Json -Compress
  if ($ResultFile) {
    Assert-OutsideRepository -Path $ResultFile
    Write-Utf8NoBom -Path $ResultFile -Value $resultJson
  }
  $resultJson
} catch {
  Remove-ProtectedRecoveryDirectory -Path $restoreRoot
  throw
}
