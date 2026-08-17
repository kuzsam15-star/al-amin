import assert from "node:assert/strict";
import test from "node:test";
import { evaluateGateState, readyGateState } from "../scripts/security/prelaunch/gate-core.mjs";

test("ready gate state produces the single success verdict", () => {
  assert.deepEqual(evaluateGateState(readyGateState()), {
    status: "READY_FOR_FINAL_BUNDLE_FREEZE",
    reasons: [],
  });
});

const injections = [
  ["dirty tree", (state) => { state.treeClean = false; }, "DIRTY_WORKTREE"],
  ["wrong branch", (state) => { state.branchValid = false; }, "WRONG_BRANCH"],
  ["historical or baseline bytes", (state) => { state.protectedArtifactsValid = false; }, "PROTECTED_ARTIFACT_HASH_MISMATCH"],
  ["forward migration", (state) => { state.forwardBundleValid = false; }, "FORWARD_MIGRATION_BUNDLE_MISMATCH"],
  ["package lock", (state) => { state.packageIntegrityValid = false; }, "PACKAGE_LOCKFILE_MISMATCH"],
  ["failed test", (state) => { state.testsPassed = false; }, "TEST_FAILURE"],
  ["role-matrix XFAIL", (state) => { state.unadjudicatedXfails = 1; }, "UNADJUDICATED_XFAIL"],
  ["open High blocker", (state) => { state.openCriticalHighLocalBlockers = 1; }, "OPEN_CRITICAL_HIGH_LOCAL_BLOCKER"],
  ["dependency advisory", (state) => { state.dependencyAudit.high = 1; }, "DEPENDENCY_HIGH_ADVISORY"],
  ["secret", (state) => { state.secretScanPassed = false; }, "SECRET_OR_PII_PATTERN_DETECTED"],
  ["client bundle leak", (state) => { state.clientBundleScanPassed = false; }, "CLIENT_BUNDLE_SECRET_PATTERN_DETECTED"],
  ["missing config", (state) => { state.configurationManifestValid = false; }, "CONFIGURATION_MANIFEST_INCOMPLETE"],
  ["malformed resource limit", (state) => { state.resourceConfigValid = false; }, "RESOURCE_CONFIGURATION_INVALID"],
  ["missing recovery proof", (state) => { state.recoveryLevel3Valid = false; }, "RECOVERY_LEVEL_3_MISSING"],
  ["stale backup", (state) => { state.recoveryArtifactRequired = true; state.recoveryArtifactFresh = false; }, "RECOVERY_ARTIFACT_STALE"],
  ["remote mutation", (state) => { state.remoteMutationRequested = true; }, "REMOTE_MUTATION_FORBIDDEN"],
  ["unexpected XPASS", (state) => { state.unexpectedXpasses = 1; }, "UNEXPECTED_SECURITY_XPASS"],
];

for (const [name, mutate, expectedReason] of injections) {
  test(`gate fails closed for ${name}`, () => {
    const state = readyGateState();
    mutate(state);
    const verdict = evaluateGateState(state);
    assert.equal(verdict.status, "BLOCKED");
    assert.ok(verdict.reasons.includes(expectedReason));
  });
}
