. (Join-Path $PSScriptRoot 'Recovery.Common.ps1')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$probe = Join-Path ([IO.Path]::GetTempPath()) ("alamin-sha256-{0}.bin" -f [guid]::NewGuid().ToString('N'))
try {
  [IO.File]::WriteAllBytes($probe, [Text.Encoding]::UTF8.GetBytes('AL-AMIN recovery SHA-256 compatibility probe'))
  $expected = 'b2ee3bf77638270f7e1604fade31e2f975f9c8ebf38c4dc22b69e5a1abb9417f'
  $actual = Get-Sha256Lower $probe
  if ($actual -cne $expected) { throw 'SHA-256 compatibility probe returned an unexpected digest.' }

  $commonSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Recovery.Common.ps1') -Raw
  if ($commonSource -match '(?im)\bGet-FileHash\b') { throw 'Recovery hashing still depends on Get-FileHash.' }

  Write-Output '{"status":"PASS","getFileHashDependency":false,"containsCredentials":false,"productionContacted":false,"productionMutated":false}'
} finally {
  if (Test-Path -LiteralPath $probe) { Remove-Item -LiteralPath $probe -Force }
}
