$ErrorActionPreference = "Stop"

$repository = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
if ((Get-Location).Path -ne $repository.Path) {
  Set-Location -LiteralPath $repository.Path
}

$env:ALAMIN_SECURITY_LOCAL_ONLY = "1"
Remove-Item Env:SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:SUPABASE_PROJECT_ID -ErrorAction SilentlyContinue
Remove-Item Env:SUPABASE_PROJECT_REF -ErrorAction SilentlyContinue
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:POSTGRES_PASSWORD -ErrorAction SilentlyContinue

& node "scripts/security/prelaunch/run-prelaunch-gate.mjs" --full
if ($LASTEXITCODE -ne 0) {
  throw "AL-AMIN pre-launch security gate is BLOCKED. Review the exact reason above."
}
