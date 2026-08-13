# AL-AMIN Pre-launch Deployment Model Reassessment

Date: 2026-08-13

Status: `PRELAUNCH_ARCHITECTURE_CONFIRMED`

This document corrects the deployment assumptions used by the SEC-001 release
planning. It authorizes no SQL, Supabase mutation, source deployment, or hosting
change.

## 1. Corrected architecture state

AL-AMIN is currently a **pre-launch** system:

- the Next.js application runs only on Viktor's local computer from the
  canonical repository;
- there is no hosted application, public application URL, deployed source
  revision, hosting provider, or production application traffic;
- the remote Supabase project `amanat` is a live remote backend containing the
  Database, Auth, Data API and Storage surfaces;
- the remote Supabase backend is not evidence that a production Next.js
  application exists.

The live backend remains security-relevant because its Supabase endpoints and
database/Storage authorization boundaries exist independently of a hosted
frontend. The absence of a public application reduces current application
traffic and source-release risk; it does not close any backend finding.

## 2. Incorrect prior assumptions

P0-03C/P0-12 release planning incorrectly assumed that an existing hosting
owner could deploy a frozen source revision over a currently deployed
application. That led to requirements for a current hosting identity, current
deployed revision, read-only source version marker, deployed-source rollback,
public canary, and traffic observation.

`HOSTING_IDENTITY_UNKNOWN` was therefore not a security blocker. It was an
inapplicable question about a deployment that does not exist.

## 3. Gate classification

### Not applicable in the current state

- identifying a current hosting provider, project, origin, or deployment;
- proving a current deployed source SHA;
- adding a version marker to a nonexistent deployment;
- deploying source between SEC-001 Phase A and Phase B;
- rolling back from one deployed application revision to another;
- observing public application traffic or running a public canary;
- verifying deployed TLS, cookies, headers, cache, edge, WAF or public-rate
  controls against a nonexistent origin.

These gates are **deferred, not waived**. They become mandatory when the first
hosting target and first public application release are prepared.

### Still applicable before launch

- immutable Git provenance for every reviewed source and migration artifact;
- clean-room and production-like isolated replay;
- forward-only migration order, hashes, recovery points and stop conditions;
- remote-backend identity, same-day catalog compatibility and owner approval;
- database/RLS/RPC/view/default-ACL and Storage-policy verification;
- existing-media inventory, SEC-001 backfill, zero second pass and Phase B
  enforcement;
- Auth, role-matrix, race, recovery and regression evidence;
- a compatible application build ready to be the first hosted release.

## 4. Source version marker decision

A source version marker is not needed now. There is no deployed source whose
identity it could prove, and adding one would not strengthen the remote
Supabase cutover.

At first hosting, provenance must be established with either the provider's
immutable deployment revision or a build-time marker containing the exact
reviewed Git SHA. That first deployment creates the checkpoint; it does not
need a fictional "previous deployed source" checkpoint.

## 5. SEC-001 split responsibility

### Remote Supabase work required before first public deployment

- apply the reviewed Phase A forward migration;
- take and verify the required recovery point and same-day compatibility
  evidence;
- inventory legacy published media without exporting user content into Git;
- perform the approved dry-run-first idempotent canonical-media backfill;
- prove a zero-change second pass and complete the observation gate;
- apply Phase B only after its hard preconditions pass;
- verify canonical media policies, RPC/function boundaries, backfill coverage
  and the absence of remaining mutable published references.

This work is not performed by this reassessment.

### Application work that belongs in the first future deployment

- the already reviewed SEC-001 server-controlled publication writer;
- immutable submission/canonical path handling and media validation;
- compatible approval/revision flows and media-serving behavior;
- local-only verified source for the other completed security fixes;
- the first-deployment provenance marker or provider revision evidence;
- hosting-dependent SSR, cookie, header, TLS, cache and edge controls.

The first application deployment must not occur until the remote backend is in
the compatible enforced state required by that build.

## 6. Consolidated pre-launch backend strategy

SEC-001 should not be deployed as an isolated remote mutation now. The safer
path is to complete the remaining P0 findings locally as separate, reviewable,
test-first changes and forward migrations, then rehearse their exact combined
order in a fresh isolated environment.

After the P0 set is accepted, use one owner-approved **consolidated pre-launch
backend hardening window** for the compatible remote changes. Consolidated
means one coordinated maintenance/recovery/verification window; it does not
mean one giant SQL file, one unreviewable commit, or loss of per-finding
rollback and evidence boundaries.

This approach minimizes repeated production access, credential exposure,
backup cycles, catalog-drift windows, maintenance coordination and partially
compatible backend states. SEC-001 remains open until that controlled window
and its live evidence complete.

## 7. P0 work possible before hosting

The following can be implemented and proved before choosing a hosting
provider:

- SEC-001 media immutability and SEC-006 safe media cleanup;
- SEC-002 owner-safe application projection;
- SEC-003/SEC-010 moderator, admin and AAL authorization boundaries;
- SEC-004 controlled anonymous feedback writes;
- SEC-007/SEC-008 concurrency, idempotency and moderation state machines;
- SEC-015/SEC-016 views, function ACL and search-path boundaries;
- SEC-017 request/resource limits at the application and API contract level;
- SEC-018 transactional audit/outbox behavior;
- SEC-025/SEC-026 profile drift and public operational-identity exposure;
- dependency, bootstrap, recovery, provenance, retention, monitoring and
  incident-response work that does not depend on a public origin;
- clean-room, role-matrix, race, advisor, secret and recovery tests.

Hosting-dependent verification for SEC-014, SEC-020 and the deployed portions
of SEC-024 can be implemented locally where possible, but cannot be closed
until a real first deployment target exists.

## 8. Shortest safe path to launch

1. Keep the remote Supabase backend unchanged while completing the remaining
   P0 findings locally, each as a separate reviewed change.
2. Replay the complete ordered forward-migration set and compatible first
   application build in fresh isolated/staging environments.
3. Freeze one pre-launch backend release manifest, recovery plan, forward-fix
   plan and aggregate verification checklist.
4. In one separately authorized maintenance window, harden remote Supabase,
   including SEC-001 Phase A, inventory/backfill/zero pass, Phase B and the
   other dependency-ordered backend changes.
5. Verify the hardened remote backend without production application traffic.
6. Select and configure hosting only after the P0 backend/application set is
   release-ready.
7. Perform the first application deployment from the frozen reviewed commit
   and establish its source provenance.
8. Run final public-origin security verification and monitor the launch.

## 9. Decision

Decision: do not create a version marker or hosting checkpoint now; do not run
the existing SEC-001 release wrapper as written; do not deploy SEC-001 alone.

Approved planning direction: finish the remaining P0 fixes locally and prepare
one dependency-ordered, owner-approved consolidated pre-launch backend
hardening deployment. The next finding-scoped stage is P0-04 / SEC-002.
