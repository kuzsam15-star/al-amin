const REQUIRED_BOOLEAN_GATES = [
  ["repositoryValid", "REPOSITORY_INVALID"],
  ["branchValid", "WRONG_BRANCH"],
  ["treeClean", "DIRTY_WORKTREE"],
  ["ancestryValid", "UNEXPECTED_COMMIT_ANCESTRY"],
  ["mainValid", "MAIN_MOVED"],
  ["baselineTagValid", "BASELINE_TAG_MOVED"],
  ["protectedArtifactsValid", "PROTECTED_ARTIFACT_HASH_MISMATCH"],
  ["forwardBundleValid", "FORWARD_MIGRATION_BUNDLE_MISMATCH"],
  ["packageIntegrityValid", "PACKAGE_LOCKFILE_MISMATCH"],
  ["testsPassed", "TEST_FAILURE"],
  ["roleMatrixPassed", "ROLE_MATRIX_FAILURE"],
  ["resourceConfigValid", "RESOURCE_CONFIGURATION_INVALID"],
  ["recoveryLevel3Valid", "RECOVERY_LEVEL_3_MISSING"],
  ["configurationManifestValid", "CONFIGURATION_MANIFEST_INCOMPLETE"],
  ["findingsClassified", "FINDING_CLASSIFICATION_INCOMPLETE"],
  ["secretScanPassed", "SECRET_OR_PII_PATTERN_DETECTED"],
  ["clientBundleScanPassed", "CLIENT_BUNDLE_SECRET_PATTERN_DETECTED"],
];

export function evaluateGateState(state) {
  const reasons = [];

  for (const [field, reason] of REQUIRED_BOOLEAN_GATES) {
    if (state[field] !== true) reasons.push(reason);
  }

  if (state.remoteMutationRequested === true) reasons.push("REMOTE_MUTATION_FORBIDDEN");
  if ((state.openCriticalHighLocalBlockers ?? 0) > 0) reasons.push("OPEN_CRITICAL_HIGH_LOCAL_BLOCKER");
  if ((state.unadjudicatedXfails ?? 0) > 0) reasons.push("UNADJUDICATED_XFAIL");
  if ((state.unexpectedFailures ?? 0) > 0) reasons.push("UNEXPECTED_SECURITY_FAILURE");
  if ((state.unexpectedXpasses ?? 0) > 0) reasons.push("UNEXPECTED_SECURITY_XPASS");

  for (const severity of ["critical", "high", "moderate"]) {
    if ((state.dependencyAudit?.[severity] ?? 0) > 0) {
      reasons.push(`DEPENDENCY_${severity.toUpperCase()}_ADVISORY`);
    }
  }

  if (state.recoveryArtifactRequired === true) {
    if (state.recoveryArtifactPresent !== true) reasons.push("RECOVERY_ARTIFACT_MISSING");
    if (state.recoveryArtifactFresh !== true) reasons.push("RECOVERY_ARTIFACT_STALE");
  }

  return {
    status: reasons.length === 0 ? "READY_FOR_FINAL_BUNDLE_FREEZE" : "BLOCKED",
    reasons: [...new Set(reasons)].sort(),
  };
}

export function readyGateState() {
  return {
    repositoryValid: true,
    branchValid: true,
    treeClean: true,
    ancestryValid: true,
    mainValid: true,
    baselineTagValid: true,
    protectedArtifactsValid: true,
    forwardBundleValid: true,
    packageIntegrityValid: true,
    testsPassed: true,
    roleMatrixPassed: true,
    resourceConfigValid: true,
    recoveryLevel3Valid: true,
    configurationManifestValid: true,
    findingsClassified: true,
    secretScanPassed: true,
    clientBundleScanPassed: true,
    remoteMutationRequested: false,
    openCriticalHighLocalBlockers: 0,
    unadjudicatedXfails: 0,
    unexpectedFailures: 0,
    unexpectedXpasses: 0,
    dependencyAudit: { critical: 0, high: 0, moderate: 0 },
    recoveryArtifactRequired: false,
    recoveryArtifactPresent: true,
    recoveryArtifactFresh: true,
  };
}
