param(
  [Parameter(Mandatory)][string]$PayloadRoot,
  [Parameter(Mandatory)][string]$OutputZip
)
. (Join-Path $PSScriptRoot 'Recovery.Common.ps1')
Assert-OutsideRepository -Path $PayloadRoot
Assert-OutsideRepository -Path $OutputZip
$database = Join-Path $PayloadRoot 'database'
$storage = Join-Path $PayloadRoot 'storage'
$config = Join-Path $PayloadRoot 'config'
foreach ($path in @($database,$storage,$config)) {
  if (-not (Test-Path -LiteralPath $path -PathType Container)) { throw 'Recovery payload directory is incomplete.' }
}
Compress-Archive -LiteralPath $database,$storage,$config -DestinationPath $OutputZip -CompressionLevel Optimal
if (-not (Test-Path -LiteralPath $OutputZip -PathType Leaf)) { throw 'Recovery ZIP creation failed.' }
