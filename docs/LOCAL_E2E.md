# Local Egoric-to-LeozOps End-to-End Verification

Status: **G4 COMPLETE — PR #8 MERGED; PRODUCT OWNER ACCEPTED**

This verification connects the canonical RepositoryRealms snapshot handler to
the LeozOps source adapter, Business Memory, deterministic CEO Brief, and
isolated read-only HTTP profile. It proves the Sprint 1 contract without a
deployment, a durable credential, a scheduler, production data, or write-back.

## Run

Prerequisites:

- the canonical `leozvu/repositoryrealms` repository is checked out locally on
  clean `main` matching `origin/main`;
- LeozOps dependencies are installed; and
- `EGORIC_REPO_PATH` points to that local checkout.

From the LeozOps repository:

```powershell
$env:EGORIC_REPO_PATH='C:\path\to\repositoryrealms'
npm run verify:e2e:local
```

The runner in [`../scripts/localE2E.ts`](../scripts/localE2E.ts) refuses to run
against a different remote, branch, commit state, or dirty source worktree. It
imports RepositoryRealms' actual `lib/leozops/handler.js`; the handler receives
a frozen, four-record local fixture through its existing test seam. All source
and output keys are randomly generated in memory and discarded when the
process exits.

## Assertions

- feature flag off returns 404 before any source read;
- a bad key and a key revoked by hash rotation return 401;
- the accepted request returns 200 and replay returns 304;
- the adapter makes three GET requests, all without a body;
- four source facts produce one immutable snapshot, one idempotent run, and a
  brief total of four with exact native-stage reconciliation;
- PII fixture values enter neither Business Memory, the CEO Brief, nor audit
  logs;
- the source fixture, source commit, and source worktree remain unchanged;
- the read-only brief route returns 200 while a malformed legacy POST returns
  404; and
- the output remains `advisory_only` under formula
  `egoric_ceo_brief_v1`.

## Reviewed evidence

The G4 run used canonical RepositoryRealms
`main@98c0eca01330cbf101bca8ff93de38cdd8ec4045` and LeozOps implementation
commit `dc9fb89`. The evidence was published through
[leozcrm PR #8](https://github.com/leozvu/leozcrm/pull/8) at `main@5ef3fd5`
and accepted by the Product Owner in DECISION-002 addendum 6.

| Evidence | Result |
|---|---:|
| Source records / brief total | 4 / 4 |
| Stage counts | new 1, contacted 0, proposal 1, negotiation 0, won 1, lost 1 |
| Stored snapshots / runs | 1 / 1 |
| Source reads | 2 (authenticated 200 and 304 only) |
| Source request methods / bodies | GET, GET, GET / 0 bodies |
| Flag off / bad key / revoked key | 404 / 401 / 401 |
| Source mutations | 0 |
| Legacy write surface | 404 |

## Boundary

This is a deterministic local proof using in-memory SQLite and an in-process
bridge to the real source handler. It does not prove deployed networking, TLS,
live PostgreSQL, secret-manager configuration, production data correctness,
runtime reliability, or CEO usefulness over time. Those are G5 shadow-pilot
concerns and remain blocked until separately planned and explicitly approved.
