param(
  [ValidateSet('Interactive','Preflight','PhaseA','VerifyPhaseA','SourceCheckpoint','Inventory','Backfill','VerifyBackfill','PhaseB','VerifyPhaseB','Resume','Abort')]
  [string]$Stage = 'Interactive'
)
. (Join-Path $PSScriptRoot 'Release.Common.ps1')
Protect-Sec001Directory $script:StateRoot
$sessionId = [guid]::NewGuid().ToString('n')
$lockHeld = $false
$exitCode = 0

try {
  Enter-Sec001LocalLock $sessionId
  $lockHeld = $true
  if ($Stage -eq 'Interactive') {
    Write-Host 'AL-AMIN SEC-001 controlled release wrapper'
    Write-Host 'No production action is authorized by P0-12.'
    Write-Host 'P0-13 owner approval and an external identity package are required.'
    $checkpoint = Read-Sec001Checkpoint
    if ($checkpoint) { Write-Host "Existing state: $($checkpoint.state)" }
    else { Write-Host 'State: NOT_STARTED' }
    if ($env:ALAMIN_SEC001_PRODUCTION_APPROVED -ne '1') { throw 'P0_13_OWNER_APPROVAL_REQUIRED' }
    while ($true) {
      $checkpoint = Read-Sec001Checkpoint
      $next = if (-not $checkpoint) { 'Preflight' } else {
        switch ($checkpoint.state) {
          'NOT_STARTED' { 'Preflight' }
          'PREFLIGHT_PASSED' { 'PhaseA' }
          'PHASE_A_APPLIED' { 'SourceCheckpoint' }
          'SOURCE_DEPLOY_CONFIRMED' { 'SourceCheckpoint' }
          'CANARY_PASSED' { 'Inventory' }
          'INVENTORY_REVIEWED' { 'Backfill' }
          'BACKFILL_IN_PROGRESS' { 'Backfill' }
          'BACKFILL_COMPLETE' { 'VerifyBackfill' }
          'OBSERVATION_PASSED' { 'PhaseB' }
          'COMPLETE' { Write-Host 'SEC-001 release COMPLETE.'; exit 0 }
          default { throw "NO_AUTOMATIC_ACTION_FOR_STATE_$($checkpoint.state)" }
        }
      }
      Exit-Sec001LocalLock $sessionId
      $lockHeld = $false
      & $PSCommandPath -Stage $next
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
      Enter-Sec001LocalLock $sessionId
      $lockHeld = $true
    }
  }
  Assert-Sec001ProductionAuthorization
  $identity = Get-Sec001IdentityFile
  if ($Stage -ne 'Preflight') { Assert-Sec001ArtifactFreeze | Out-Null }
  switch ($Stage) {
    'Preflight' {
      Assert-Sec001LocalTooling
      Confirm-Exact 'Confirm the approved maintenance and observation window: type RELEASE WINDOW READY' 'RELEASE WINDOW READY'
      New-Sec001Checkpoint $identity.projectFingerprint
      Confirm-Exact 'Type the displayed project fingerprint to confirm target' $identity.projectFingerprint
      $catalog = Invoke-Sec001VerificationSql 'preflight.sql' $identity 'SEC001_PREFLIGHT_CATALOG_OK'
      $expectedBuckets = 'SEC001_BUCKETS=' + (($identity.bucketNames | Sort-Object) -join ',')
      if (($catalog -split "`n" | ForEach-Object Trim) -notcontains $expectedBuckets) { throw 'PROJECT_BUCKET_SET_MISMATCH' }
      if (($catalog -split "`n" | ForEach-Object Trim) -notcontains ('SEC001_CATALOG=' + $identity.catalogMarker)) { throw 'PROJECT_CATALOG_FINGERPRINT_MISMATCH' }
      Invoke-Sec001State 'advance' 'PREFLIGHT_PASSED'
    }
    'PhaseA' {
      Confirm-Exact 'Type APPLY PHASE A' 'APPLY PHASE A'
      Invoke-Sec001PhaseSql '202608110001_sec001_immutable_published_media.sql' $identity | Out-Null
      Invoke-Sec001VerificationSql 'verify-phase-a.sql' $identity 'SEC001_PHASE_A_OK' | Out-Null
      Invoke-Sec001State 'advance' 'PHASE_A_APPLIED'
    }
    'VerifyPhaseA' { Invoke-Sec001VerificationSql 'verify-phase-a.sql' $identity 'SEC001_PHASE_A_OK' | Out-Null }
    'SourceCheckpoint' {
      $checkpoint = Read-Sec001Checkpoint
      if ($checkpoint.state -eq 'PHASE_A_APPLIED') {
        Invoke-Sec001VerificationSql 'verify-phase-a.sql' $identity 'SEC001_PHASE_A_OK' | Out-Null
        Confirm-Exact "After deploying commit $($checkpoint.sourceCommit), type SOURCE DEPLOY VERIFIED" 'SOURCE DEPLOY VERIFIED'
        $marker = Invoke-RestMethod -Uri $identity.sourceVersionUrl -Method Get -TimeoutSec 15
        if (($marker | ConvertTo-Json -Compress) -notmatch [Regex]::Escape($checkpoint.sourceCommit)) { throw 'SOURCE_COMMIT_MISMATCH' }
        Invoke-Sec001State 'advance' 'SOURCE_DEPLOY_CONFIRMED'
      }
      Confirm-Exact 'After the controlled canary proves canonical create/render and client mutation denial, type CANARY PASSED' 'CANARY PASSED'
      Invoke-Sec001State 'advance' 'CANARY_PASSED'
    }
    'Inventory' { Invoke-Sec001BackfillRunner 'inventory' $identity }
    'Backfill' { Invoke-Sec001BackfillRunner 'backfill' $identity }
    'VerifyBackfill' {
      Invoke-Sec001BackfillRunner 'verify' $identity
      Confirm-Exact 'After deleting the exact temporary backfill credential, type TEMPORARY BACKFILL CREDENTIAL DELETED' 'TEMPORARY BACKFILL CREDENTIAL DELETED'
      $minutes = [int](Read-Host 'Observed minutes since canary (minimum 30)')
      $applications = [int](Read-Host 'Successful new application approvals observed (minimum 2)')
      $revisions = [int](Read-Host 'Successful revision approvals observed (minimum 1)')
      $errors = [int](Read-Host 'Combined canonicalization/media/security errors and unresolved alerts (must be 0)')
      $evidencePath = Join-Path $script:StateRoot 'observation.tmp.json'
      @{ metrics = @{ elapsedMinutes=$minutes; applicationApprovals=$applications; revisionApprovals=$revisions; canonicalizationErrors=$errors; mediaServingErrors=0; securityErrors=0; unresolvedAlerts=0 } } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $evidencePath -Encoding UTF8
      try { Invoke-Sec001State 'advance' 'OBSERVATION_PASSED' $evidencePath }
      finally { Remove-Item -LiteralPath $evidencePath -Force -ErrorAction SilentlyContinue }
    }
    'PhaseB' {
      $checkpoint = Read-Sec001Checkpoint
      $evidencePath = Join-Path $script:StateRoot 'phase-b.tmp.json'
      $confirmation = Read-Host 'Final irreversible gate: type APPLY PHASE B'
      @{ confirmation=$confirmation; counts=$checkpoint.counters } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $evidencePath -Encoding UTF8
      try {
        Invoke-Sec001State 'gate-phase-b' -EvidencePath $evidencePath
        Invoke-Sec001PhaseSql '202608110002_sec001_enforce_canonical_published_media.sql' $identity | Out-Null
        Invoke-Sec001VerificationSql 'verify-phase-b.sql' $identity 'SEC001_PHASE_B_OK' | Out-Null
        Invoke-Sec001State 'advance' 'PHASE_B_APPLIED' $evidencePath
        Invoke-Sec001State 'advance' 'POST_VERIFY_PASSED'
        Invoke-Sec001State 'finish'
      } finally { Remove-Item -LiteralPath $evidencePath -Force -ErrorAction SilentlyContinue }
    }
    'VerifyPhaseB' { Invoke-Sec001VerificationSql 'verify-phase-b.sql' $identity 'SEC001_PHASE_B_OK' | Out-Null }
    'Resume' { throw 'RERUN_START_LAUNCHER_TO_RESUME_FROM_CHECKPOINT' }
    'Abort' { Invoke-Sec001State 'abort' -Code 'OWNER_ABORT' }
    default { throw "STAGE_REQUIRES_VERIFIED_EVIDENCE_ADAPTER_$Stage" }
  }
  Write-Sec001SafeLog $Stage 'PASS'
} catch {
  $message = [string]$_.Exception.Message
  $safeCode = if ($message -cmatch '^[A-Z0-9_-]{1,96}$') { $message } else { 'UNEXPECTED_RELEASE_ERROR' }
  Write-Sec001SafeLog $Stage 'FAILED_SAFE' @{ safeErrorCode = $safeCode }
  Write-Error $safeCode
  $exitCode = 1
} finally {
  if ($lockHeld) { Exit-Sec001LocalLock $sessionId }
}
exit $exitCode
