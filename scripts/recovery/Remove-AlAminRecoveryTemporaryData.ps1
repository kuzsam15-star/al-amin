param([Parameter(Mandatory)][string]$Path)
. (Join-Path $PSScriptRoot 'Recovery.Common.ps1')
Remove-ProtectedRecoveryDirectory -Path $Path
Write-Host 'Temporary plaintext recovery data removed.'
