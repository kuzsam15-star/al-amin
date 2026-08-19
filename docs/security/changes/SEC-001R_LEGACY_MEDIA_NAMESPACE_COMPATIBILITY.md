# SEC-001R — Legacy Media Namespace Compatibility Remediation

## Security issue

- **Finding ID:** SEC-001 compatibility remediation (`SEC-001R`)
- **Название:** verified legacy media namespace support without weakening canonical ownership
- **Severity / launch blocker:** High deployment blocker; SEC-001 remains pending remote deployment
- **Roadmap task / workflow priority:** consolidated pre-launch backend deployment retry prerequisite
- **Security-инвариант этого change:** a legacy object may be canonicalized only when its exact path belongs to an explicit family and every authoritative DB reference resolves to one owner
- **Owner:** AL-AMIN repository/application owner
- **Reviewer(s):** local adversarial review recorded in `SEC-001R_ADVERSARIAL_REVIEW.md`
- **Dependencies / prerequisites:** frozen SEC-001 implementation, aggregate-only read-only live evidence, Recovery Level 3
- **Status:** `IMPLEMENTED_LOCAL_VERIFIED_PENDING_DEPLOYMENT_RETRY`

## Threat model

- **Actor:** ordinary user, forged/stale operator input, compromised caller, or accidental cross-owner legacy reference.
- **Prerequisites / attacker access:** ability to influence a stored path or create conflicting DB references; no service credential is assumed.
- **Asset / trust boundary:** published media bytes, DB-reference-to-Storage-object integrity, owner identity, and canonical provenance.
- **Attack path:** arbitrary legacy path acceptance; treating the first UUID segment or `storage.objects.owner_id` as authoritative; first-match ownership; stale inventory; cross-owner reuse; path normalization confusion.
- **Impact:** publication of another owner's media, ambiguous provenance, or incorrect canonical cutover.
- **Expected secure behavior:** only the exact allowlisted family is accepted; the complete backfill inventory must contain exactly one distinct DB owner for each exact object path; RPC optimistic preconditions recheck the current row at cutover.
- **Confirmed facts:** the live blocker affects four references in `profile-media`; the path has three segments and matches `submissions/<legacy-scope-uuid>/<main|gallery-N>-<object-uuid>.<ext>`; its first UUID and Storage owner metadata do not match the authoritative row owner; no unknown, missing, or multi-owner object was observed.
- **Unverified hypotheses:** the semantic meaning of the opaque legacy-scope UUID predates the verified source baseline and is intentionally not guessed.
- **Out of scope:** other findings, remote writes, media-byte inspection, migration changes, and generic path migration.

## Affected files

- **Production files:** `src/lib/published-media.mjs`, `src/lib/published-media.d.mts` — explicit registry, non-serializable authorization, and exact source binding.
- **Configuration files:** none.
- **Test/tool files:** `tests/security/helpers/sec001-backfill.mjs`, `scripts/release/sec001/backfill-runner.mjs`, `tests/sec001-backfill.test.mjs`, `tests/security/sec001-deployment-rehearsal.mjs`.
- **Documentation/evidence files:** this record, local verification, adversarial review, SEC-001 deployment plan/runbook, and versioned refreeze manifests.
- **Explicitly unaffected files/components:** all nine forward migrations, 18 historical migrations, verified bootstrap baseline/manifest, `schema.sql`, Auth, Storage policies, package files, main, and the baseline tag.

## Database changes

- **Migration path:** None.
- **Exact objects/signatures:** unchanged.
- **Before grants/policies/ACL:** unchanged.
- **After grants/policies/ACL:** unchanged.
- **Views/functions/search_path changes:** unchanged.
- **Clean-room replay result:** two independent runs PASS; complete chain applied after successful Phase B.
- **Catalog diff result:** no migration delta.
- **Full role-matrix result:** two independent environments each `188 PASS / 0 XFAIL / 0 XPASS / 0 FAIL / 0 SKIP`.
- **Seed/data reconciliation:** synthetic only; remote backfill remains zero.
- **Production application approval:** Not granted in SEC-001R.

## Before state

- **Test matrix ID(s):** `SEC001R-RED-LEGACY-ENTITY-SCOPE`.
- **Environment:** two local Node invocations plus remote aggregate-only metadata evidence.
- **Roles/accounts/fixtures:** synthetic UUIDs and generated image; no production identifier or media bytes were copied.
- **Safe reproduction steps:** validate a three-segment legacy source whose opaque UUID differs from the DB owner.
- **Expected failing security invariant:** a proven legacy DB reference should be eligible for safe backfill.
- **Actual result:** both red runs blocked before Storage download because the old runner required an owner segment.
- **Evidence artifact/hash:** aggregate results remain in the protected local checkpoint outside Git; committed evidence contains counts/templates only.
- **Secrets/PII handling:** DB password was hidden and destroyed with the process; no path, UUID, row, Auth user, or media byte entered output.

## After state

- **Secure contract:** `VERIFIED_ENTITY_SCOPED_V1` accepts only the exact ASCII path template documented above and only through a registry built from the complete approved-application/published-specialist inventory.
- **Allowed positive paths:** current owner-scoped submission paths; the verified three-segment legacy family with one distinct DB owner; same-owner reuse across explicitly inventoried entities.
- **Denied direct/bypass paths:** unknown/root namespace, malformed/extra segment, wrong target or slot, forged authorization, traversal, encoded/backslash/Unicode separator, missing object, multi-owner/cross-owner reference, stale DB precondition, or canonical hash conflict.
- **Concurrency/idempotency contract:** the registry is an immutable in-memory snapshot; canonical paths remain content-addressed and no-overwrite; the DB RPC locks and verifies the exact expected avatar/gallery values.
- **Failure-mode/fail-closed contract:** ambiguity is detected before any Storage access; missing/corrupt/conflict fails before DB cutover; old sources remain; Phase B still requires zero legacy references.
- **Residual risk:** the retry must rerun aggregate inventory; any changed count/family, missing object, or owner conflict blocks deployment.
- **Out-of-scope follow-ups:** none before the existing consolidated deployment retry.

## Tests

| Test ID / case | Environment | Expected | Actual | Status |
|---|---|---|---|---|
| SEC001R-RED-LEGACY-ENTITY-SCOPE ×2 | local pre-fix | reproduce namespace block | reproduced | PASS |
| SEC001R-ALLOWLIST | Node | valid family accepted | accepted | PASS |
| SEC001R-OWNER-PROOF | Node | wrong/forged/cross-owner denied | denied before Storage | PASS |
| SEC001R-PATH-NEGATIVE | Node | unknown/malformed/traversal/encoded denied | denied | PASS |
| SEC001R-SHARED | Node + clean room | one owner/two entities safe | explicit shared count and canonical cutovers | PASS |
| SEC001R-MISSING-CONFLICT | Node + clean room | no DB mutation | fail closed | PASS |
| SEC001R-CLEAN-ROOM | two disposable Supabase projects | dry/apply/zero/Phase B/full chain | 24/24 each | PASS |
| FULL-ROLE-MATRIX | two disposable Supabase projects | no regression | 188 PASS each | PASS |

## Security verification

- [x] Before-state safely reproduced twice.
- [x] Targeted positive and negative tests PASS.
- [x] Direct arbitrary-path and forged-owner bypasses are denied.
- [x] Positive current owner-scoped publication is unchanged.
- [x] Two clean-room rehearsals and two role-matrix environments PASS.
- [x] No migration or remote mutation was performed.
- [x] Adversarial review completed.

## Rollback

- **Rollback trigger:** any retry inventory anomaly or local regression.
- **Decision owner:** AL-AMIN owner/stop authority.
- **Exact reversible scope:** stop before Phase A and use the prior frozen bundle only as historical evidence, not for deployment.
- **Safe fallback / feature disable:** remain at pre-deployment state; do not backfill.
- **Forward-fix path:** correct the narrow adapter and refreeze again.
- **Data reconciliation:** fresh aggregate-only inventory before any retry mutation.
- **Backup/restore prerequisite:** existing Recovery Level 3 artifact must remain within the approved freshness gate.
- **Rollback verification tests:** targeted unit tests, clean-room rehearsal, full role matrix.
- **Forbidden rollback actions:** broad namespace acceptance, trusting path UUID/Storage owner metadata, changing frozen migrations, deleting old sources, or remote mutation during remediation.

## Commit

- **Planned commit message:** `fix(security): support verified legacy media namespace`
- **Commit SHA:** enclosing Git commit
- **Branch:** `security/hardening`
- **Finding status after independent verification:** `IMPLEMENTED_LOCAL_VERIFIED_PENDING_DEPLOYMENT_RETRY`
- **Production release status:** BLOCKED until consolidated deployment retry succeeds
