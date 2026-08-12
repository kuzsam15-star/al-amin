param(
  [Parameter(Mandatory)][ValidateSet('LocalContainer','Production')][string]$SourceMode,
  [Parameter(Mandatory)][string]$OutputDirectory,
  [string]$LocalContainer,
  [string]$LocalProjectId,
  [string]$LocalApiUrl
)

. (Join-Path $PSScriptRoot 'Recovery.Common.ps1')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Assert-OutsideRepository -Path $OutputDirectory
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$backupPath = Join-Path $OutputDirectory 'database.backup'
$rolesPath = Join-Path $OutputDirectory 'roles.sql'
$inventoryPath = Join-Path $OutputDirectory 'database_inventory.json'
$containerBackup = "/tmp/alamin-recovery-$([guid]::NewGuid().ToString('N')).backup"

function Invoke-LocalPsql([string]$Sql) {
  $value = & $script:DockerPath exec $LocalContainer psql -X -A -t -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -c $Sql 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'A read-only local database inventory query failed.' }
  return ($value -join "`n").Trim()
}

function Build-Inventory([scriptblock]$Query) {
  $version = & $Query "select current_setting('server_version')"
  $tableLines = & $Query "select quote_ident(schemaname)||'.'||quote_ident(tablename) from pg_tables where schemaname in ('public','auth','storage','supabase_migrations') order by 1"
  $tables = @()
  foreach ($qualified in ($tableLines -split "`r?`n" | Where-Object { $_ })) {
    $count = & $Query "select count(*)::text from $qualified"
    $tables += [ordered]@{ table = $qualified.Replace('"',''); row_count = [int64]$count }
  }
  $catalog = & $Query @"
select md5(coalesce(string_agg(x, E'\n' order by x),'')) from (
  select n.nspname||'|'||c.relkind::text||'|'||c.relname||'|'||coalesce(pg_get_viewdef(c.oid,true),'') as x
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','auth','storage')
  union all
  select n.nspname||'|f|'||p.proname||'|'||pg_get_function_identity_arguments(p.oid)||'|'||pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','auth','storage')
) q
"@
  return [ordered]@{
    format_version = 1
    postgresql_version = $version
    table_count = $tables.Count
    tables = $tables
    catalog_hash_md5 = $catalog
    contains_rows = $false
    generated_utc = (Get-Date).ToUniversalTime().ToString('o')
  }
}

if ($SourceMode -eq 'LocalContainer') {
  Assert-LocalDisposableTarget -ProjectId $LocalProjectId -ApiUrl $LocalApiUrl -Container $LocalContainer
  try {
    & $script:DockerPath exec $LocalContainer pg_dump -Fc -U supabase_admin -d postgres --schema=public --schema=private --schema=auth --schema=storage --schema=supabase_migrations --exclude-table-data=storage.objects --file=$containerBackup 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Local database dump failed.' }
    & $script:DockerPath cp "${LocalContainer}:$containerBackup" $backupPath 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Could not copy the local database dump.' }
    $roles = & $script:DockerPath exec $LocalContainer pg_dumpall -U supabase_admin -d 'dbname=postgres' --roles-only --no-role-passwords 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Local roles export failed.' }
    Write-Utf8NoBom -Path $rolesPath -Value (($roles -join "`n") + "`n")
    $inventory = Build-Inventory ${function:Invoke-LocalPsql}
    $inventory | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $inventoryPath -Encoding UTF8
  } finally {
    & $script:DockerPath exec $LocalContainer rm -f $containerBackup 2>$null | Out-Null
  }
} else {
  Write-Host 'Database export is read-only. Values remain in this local prompt and are not logged.'
  $hostName = (Read-Host 'Production database host').Trim()
  $port = (Read-Host 'Port [5432]').Trim(); if (-not $port) { $port = '5432' }
  $database = (Read-Host 'Database [postgres]').Trim(); if (-not $database) { $database = 'postgres' }
  $user = (Read-Host 'Database user').Trim()
  if ($hostName -notmatch '^[A-Za-z0-9.-]+$' -or $hostName -in @('localhost','127.0.0.1') -or $port -notmatch '^\d{2,5}$' -or $database -notmatch '^[A-Za-z0-9_-]+$' -or $user -notmatch '^[A-Za-z0-9_.-]+$') {
    throw 'Database connection metadata failed validation.'
  }
  if ((Read-Host 'Type READ ONLY to confirm the production source must not be changed') -cne 'READ ONLY') {
    throw 'Production source confirmation was not provided.'
  }
  $securePassword = Read-Host 'Database password (hidden)' -AsSecureString
  $credentialDir = New-ProtectedRecoveryDirectory -Purpose 'db-credential'
  try {
    $serviceFile = Join-Path $credentialDir 'pg_service.conf'
    $passFile = Join-Path $credentialDir 'pgpass'
    Write-Utf8NoBom -Path $serviceFile -Value "[alamin_source]`nhost=$hostName`nport=$port`ndbname=$database`nuser=$user`nsslmode=require`n"
    $plainPassword = ConvertFrom-SecureStringTransient $securePassword
    try {
      $escaped = $plainPassword.Replace('\','\\').Replace(':','\:')
      Write-Utf8NoBom -Path $passFile -Value "${hostName}:${port}:${database}:${user}:${escaped}`n"
    } finally { $plainPassword = $null; $escaped = $null }

    Invoke-RecoveryPostgresClient -ServiceFile $serviceFile -PassFile $passFile -WritableBackupDirectory $OutputDirectory -ClientArguments @(
      'pg_dump','-Fc','-d','service=alamin_source','--schema=public','--schema=private','--schema=auth','--schema=storage','--schema=supabase_migrations','--exclude-table-data=storage.objects','--file=/backup/database.backup'
    ) | Out-Null
    $roles = Invoke-RecoveryPostgresClient -ServiceFile $serviceFile -PassFile $passFile -ClientArguments @(
      'pg_dumpall','-d','service=alamin_source','--roles-only','--no-role-passwords'
    )
    Write-Utf8NoBom -Path $rolesPath -Value (($roles -join "`n") + "`n")

    $query = {
      param([string]$Sql)
      $result = Invoke-RecoveryPostgresClient -ServiceFile $serviceFile -PassFile $passFile -ClientArguments @(
        'psql','-X','-A','-t','-v','ON_ERROR_STOP=1','-d','service=alamin_source','-c',$Sql
      )
      return ($result -join "`n").Trim()
    }
    $inventory = Build-Inventory $query
    $inventory | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $inventoryPath -Encoding UTF8
  } finally {
    $securePassword.Dispose()
    Remove-ProtectedRecoveryDirectory -Path $credentialDir
  }
}

foreach ($required in @($backupPath,$rolesPath,$inventoryPath)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf) -or (Get-Item -LiteralPath $required).Length -eq 0) {
    throw 'Database export did not produce every required artifact.'
  }
}
[pscustomobject]@{ DatabaseBackup = $backupPath; Roles = $rolesPath; Inventory = $inventoryPath }
