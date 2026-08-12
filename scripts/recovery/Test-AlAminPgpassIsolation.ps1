param(
  [Parameter(Mandatory)][string]$LocalContainer,
  [Parameter(Mandatory)][string]$LocalProjectId,
  [Parameter(Mandatory)][string]$LocalApiUrl
)

. (Join-Path $PSScriptRoot 'Recovery.Common.ps1')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Assert-LocalDisposableTarget -ProjectId $LocalProjectId -ApiUrl $LocalApiUrl -Container $LocalContainer
$credentialDir = New-ProtectedRecoveryDirectory -Purpose 'synthetic-pgpass-regression'
try {
  $serviceFile = Join-Path $credentialDir 'pg_service.conf'
  $passFile = Join-Path $credentialDir 'pgpass'
  Write-Utf8NoBom -Path $serviceFile -Value "[alamin_source]`nhost=127.0.0.1`nport=5432`ndbname=postgres`nuser=postgres`nsslmode=disable`n"
  Write-Utf8NoBom -Path $passFile -Value "127.0.0.1:5432:postgres:postgres:postgres`n"

  $result = Invoke-RecoveryPostgresClient -ServiceFile $serviceFile -PassFile $passFile -Network "container:$LocalContainer" -ClientArguments @(
    'psql','-X','-A','-t','-v','ON_ERROR_STOP=1','-d','service=alamin_source','-c','select 1'
  )
  if (($result -join "`n").Trim() -ne '1') {
    throw 'The synthetic pgpass connection did not return the expected result.'
  }
  [pscustomobject]@{
    status = 'PASS'
    transport = 'stdin-to-tmpfs'
    directory_mode = '0700'
    service_file_mode = '0600'
    pgpass_mode = '0600'
    connection = 'PASS'
  } | ConvertTo-Json -Compress
} finally {
  Remove-ProtectedRecoveryDirectory -Path $credentialDir
}
