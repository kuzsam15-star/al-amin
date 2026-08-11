# SEC-001 — Immutable Canonical Published Media

Date: 2026-08-11
Status: `IMPLEMENTED_LOCAL_VERIFIED_PENDING_DEPLOYMENT`

## Security issue

- **Finding ID:** SEC-001
- **Severity / launch blocker:** High / yes
- **Roadmap task:** P0-03A
- **Invariant:** bytes shown by a published profile are the bytes approved by
  moderation and cannot be replaced, removed, or re-pointed by an untrusted
  client.
- **Owner:** Application, Storage, and Database owners
- **Dependencies:** verified no-data bootstrap, local role matrix, Supabase CLI
  2.113.0, PostgreSQL 17, existing `sharp` dependency
- **Production status:** not deployed; live finding remains a launch blocker

## Threat model

### Assets

- moderator-approved avatar/main image and gallery images;
- public profile integrity and user trust;
- the binding between a database reference and exact Storage bytes;
- the integrity of the moderation decision and publication history.

### Actors

- anonymous visitor;
- authenticated owner and an attacker with an ordinary account;
- another authenticated user;
- moderator with an AAL1 client session;
- admin with an AAL2 session;
- trusted server backend using only a local/approved service principal.

### Attacks considered

- same-path overwrite, Storage upsert, direct object UPDATE, DELETE/reinsert;
- replacement or deletion of a reviewed source before publication;
- source replacement after approval; foreign-path substitution and traversal;
- direct database substitution of a canonical-looking path;
- review-to-publish race, replayed approval, and concurrent same-path writes;
- partial Storage-copy/database failure and retry conflict;
- stale cleanup deleting active published media.

### Secure invariants

1. Submission and published namespaces are separate.
2. Owners can create unique submission objects but cannot overwrite them.
3. Canonical published objects can only be created by the controlled backend.
4. Canonical upload uses `upsert=false`; the path is content-addressed and
   includes owner, source entity, slot, and SHA-256.
5. A browser-provided canonical path is never accepted as publication proof.
6. Source bytes are downloaded once, decoded, re-encoded to WebP, hashed, then
   the stored canonical bytes are downloaded and hash-verified.
7. A publication database transition requires registered provenance and a
   service-role caller; client moderator writes fail closed.
8. The current published path changes only inside the approval transaction
   after canonical Storage verification.
9. Deleting a dereferenced submission cannot break the current profile.
10. Existing active canonical objects are retained; lifecycle deletion is a
    separate SEC-006 workstream.

## Media lifecycle and dependency map

```text
owner browser
  -> POST /api/media
  -> sharp decode + WebP transform
  -> profile-media/submissions/<owner>/<avatar|gallery>/<uuid>.webp
  -> applications.main_image_path/gallery_paths
     or specialist_revisions.payload.avatar_path/gallery_paths
  -> moderator reads through /api/media/source
  -> server action verifies moderator membership
  -> controlled backend downloads and validates immutable submission
  -> profile-media/published/<owner>/<applications|revisions>/<entity>/<slot>/<sha256>.webp
  -> private.published_media_assets provenance registration
  -> service-only publication RPC
  -> applications/specialists canonical fields
  -> published_specialists projection
  -> /api/media/view -> public profile rendering
```

The active v2 application/revision flow uses the main avatar. Legacy gallery
fields remain part of the database, view, route, and publication contract and
are canonicalized as ordered `gallery-N` slots. The unreferenced legacy
`AvatarUpload` component targets the separate `avatars` bucket and is not an
active caller; the database publication guard nevertheless rejects its legacy
path for a published specialist after Phase A.

Before this change, approval copied the owner submission path into
`specialists`, while owner Storage policies allowed UPDATE and DELETE on that
same object. Application approval used a service client for the row update but
did not create independent bytes. Revision approval used a moderator client
RPC and likewise reused the mutable path. Media-serving authorization checked
the reference, not its byte history.

## Chosen design

### Submission namespace

`submissions/<owner>/<avatar|gallery>/<uuid>.webp`

- owner INSERT is restricted to the exact owner/slot/UUID shape;
- same-path UPDATE/upsert is denied at Storage policy level;
- foreign reads, updates, deletes, and traversal-shaped paths are denied;
- owner DELETE is allowed only after the path is no longer referenced by an
  application, specialist, or active revision.

### Canonical namespace

`published/<owner>/<applications|revisions>/<entity-id>/<avatar|gallery-N>/<sha256>.webp`

- no anon/authenticated/moderator-client write policy covers this namespace;
- the server derives the path after decoding and canonical WebP conversion;
- upload is no-overwrite and a retry is accepted only if stored bytes have the
  same SHA-256;
- `private.published_media_assets` records source/canonical hashes, byte size,
  owner, entity, slot, and optional specialist binding;
- service-only RPCs register descriptors and change publication references in
  the same database transaction;
- database triggers reject noncanonical, unregistered, or client-originated
  publication changes.

## Affected files and database objects

- `src/lib/published-media.mjs`, `.d.mts`, and `.ts`: server-only canonicalizer;
- `src/app/admin/actions.ts`: application and revision approval integration;
- `src/lib/media-paths.ts`: strict submission/canonical path classification;
- `src/lib/supabase/server.ts`: explicit server-only boundary;
- `supabase/forward-migrations/202608110001_sec001_immutable_published_media.sql`;
- `supabase/forward-migrations/202608110002_sec001_enforce_canonical_published_media.sql`;
- Storage policies for `profile-media`, publication guards, provenance table,
  and service-only approval functions.

The 18 historical migrations, `supabase/schema.sql`, verified
`supabase/bootstrap/baseline.sql`, and its manifest remain unchanged.

## Before state

- **Environment:** two disposable local Supabase projects from the verified
  pre-hardening baseline.
- **Result:** each run produced `54 PASS / 31 XFAIL / 0 XPASS / 0 FAIL / 0 SKIP`.
- **SEC-001 evidence:** `STORAGE-010`, `MEDIA-001`, `MEDIA-002`, `MEDIA-003`,
  `MEDIA-007`, `MEDIA-008`, `MEDIA-009`, and `MEDIA-010` failed their secure
  expectations and were mapped only to SEC-001.
- **Meaning:** owner mutation/deletion affected referenced submission bytes;
  published paths were not canonical; service-only publication contracts were
  absent.
- **Secrets/PII:** fixtures were synthetic and run-specific values were not
  written to Git or output.

## After state and tests

Both independent fresh projects produced:

`68 PASS / 23 XFAIL / 0 XPASS / 0 FAIL / 0 SKIP`

All 19 SEC-001 cases (`STORAGE-010` plus `MEDIA-001` through `MEDIA-018`)
are PASS. Tests cover submission immutability, cross-owner isolation, path
traversal, canonical client denials, controlled no-overwrite creation,
application and revision publication, moderator reference substitution,
post-publication source deletion, content hashes, malformed/missing/foreign
sources, idempotent retry, and conflicting retry.

The 23 remaining XFAIL classifications retain their prior non-SEC-001
mappings. No other finding produced XPASS. Node tests, typecheck, and ESLint
have separate evidence in `SEC-001_LOCAL_VERIFICATION.md`.

## Concurrency, failures, and retry

- unique immutable submission paths remove the owner overwrite race;
- canonical content paths make concurrent identical copies converge;
- `upsert=false` makes different bytes at one path impossible;
- a canonical conflict is accepted only after re-download and exact hash match;
- missing or malformed source, foreign owner path, size/type mismatch, failed
  upload, failed verification, or failed RPC aborts publication;
- a Storage object created before a failed RPC may remain an unreferenced
  content-addressed object, but cannot be selected by a client publication
  transition; safe GC remains SEC-006.

## Existing live media

Phase A is dual-compatible for existing rows and immediately makes new
approvals canonical after matching source deployment. Existing live published
rows may still reference mutable paths. They require a separately approved,
owner-operated, idempotent backfill. Phase B deliberately fails if any approved
application or published specialist retains a noncanonical media reference.
Therefore SEC-001 is not fixed live until inventory, backfill, verification,
Phase B, and post-deployment role tests complete.

## Rollback / forward-fix

- stop new moderation publication if canonical creation or RPC verification
  fails; do not re-enable broad owner UPDATE;
- retain current canonical references and old source objects;
- roll application callers forward to a corrected server writer or RPC;
- Phase A objects are additive except for the deliberate owner overwrite
  revoke; restoring overwrite is forbidden;
- Phase B is applied only after zero-legacy verification and should be corrected
  by a forward migration, never by rewriting applied history;
- no production backfill, rollback, or deployment is authorized by P0-03A.

## Residual risk and scope

SEC-006 cleanup safety, SEC-017 quotas/resource abuse/MIME policy breadth,
SEC-010 AAL2 enforcement, and all other findings remain open. The local
database security advisors still report the unrelated pre-hardening set of
4 ERROR and 8 WARN. Independent adversarial review and deployment rehearsal
are still required.

## Commit

- **Planned message:** `fix(security): make published media immutable`
- **Branch:** `security/hardening`
- **Finding status after this stage:**
  `IMPLEMENTED_LOCAL_VERIFIED_PENDING_DEPLOYMENT`
- **Production release status:** BLOCKED pending P0-03B and approved rollout
