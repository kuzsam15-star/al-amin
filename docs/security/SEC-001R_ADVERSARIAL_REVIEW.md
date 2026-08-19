# SEC-001R Adversarial Review

## Review conclusion

The adapter is narrow and fail closed. It does not make a legacy path intrinsically owner-scoped. It creates a non-serializable authorization only after scanning the complete approved-application and published-specialist inventory and proving that an exact object path has one distinct DB owner.

## Attack results

| Attack | Result |
|---|---|
| Forged UUID segment | Ignored as owner evidence; exact DB owner still required |
| Same exact object referenced by two owners | Blocks the entire inventory before Storage access |
| Same filename under a different exact path | Separate object; no prefix/filename matching |
| Same exact object reused by two entities of one owner | Explicitly allowed; each entity/slot receives an independent canonical descriptor |
| Stale DB reference | Service-only RPC locks the row and rejects changed avatar/gallery preconditions |
| Application ownership change | Descriptor owner/canonical path cannot satisfy the newly locked row owner; cutover fails |
| Revision ownership mismatch | Not an allowlisted backfill reference source; rejected by registry target classification |
| Encoded separator, backslash, duplicate/extra segment, traversal | Exact ASCII regex rejects before download |
| Unicode separator/normalization collision | Exact ASCII regex rejects; no decoding or normalization is performed by the registry |
| Unknown or root-level legacy family | Blocks as not allowlisted |
| Missing/corrupt/unsupported object | Fails during validated source read; no RPC cutover |
| Existing canonical object with different bytes | Hash conflict blocks; overwrite remains disabled |
| Duplicate DB references | Same-owner sharing is counted; cross-owner sharing blocks |

## Boundary assessment

- The service credential remains runtime-only and server-controlled.
- The source path is bound to target type, target row, DB owner, slot, and exact path before an authorization is returned.
- Authorization is held only in memory and carries a private symbol; it cannot be reconstructed from browser JSON.
- The backfill RPC independently rechecks current row state, owner, canonical descriptor, provenance, and path.
- No migration, policy, grant, public route, or ordinary publication flow was broadened.

Verdict: `PASS — READY_TO_REFREEZE_FOR_CONSOLIDATED_DEPLOYMENT_RETRY`.
