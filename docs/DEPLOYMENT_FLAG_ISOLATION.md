# LeozOps Integration — Deployment Flag Isolation (repositoryrealms)

Status: Governing document for Sprint 1A deployment isolation.
Authority: CEO decision 2026-07-19 (DECISIONS.md, DECISION-002 addendum 2);
GOVERNANCE.md Repository Identity Registry.

## 1. Context: one codebase, five live businesses

The ERP codebase deploys to five independent businesses via `deploy-all.ps1`,
each with its own Vercel project and its own database:

| Key | Business | Vercel project ID | URL |
|---|---|---|---|
| aim | AIm Agency | prj_gOCkd1N5rIovGeHZBtL8dJFepbGC | https://agency-erp-mu.vercel.app |
| egoric | Egoric Agency | prj_Hh4aZEj9q3hvULaUfC4GwFvxYii9 | https://erp-egoric.vercel.app |
| vnecom | Vnecom LLC | prj_Vaz8Su75zNPtjnX6M7ouR7aQ5Vrc | https://erp-vnecom.vercel.app |
| fretas | Fretas (XNK) | prj_yBFkK8gIALc9dilgp3gPfFJXqmjk | https://erp-fretas.vercel.app |
| egolive | Egolive (live) | prj_ztSxMfO1MWDBQ758HgsMMPw4Ue4f | https://erp-egolive.vercel.app |

Any code merged to `main` ships to ALL FIVE on the next deploy. Therefore the
LeozOps snapshot route must be inert by default and activated per deployment.

## 2. Isolation rules (binding)

1. The integration route is DISABLED BY DEFAULT in every deployment. With no
   flag configured, the route is absent (404) and no LEOZOPS_READ key
   validates.
2. Activation is exclusively via deployment-specific environment variables
   set in the Egoric Vercel project (prj_Hh4aZEj9q3hvULaUfC4GwFvxYii9) ONLY:
   - `LEOZOPS_SNAPSHOT_ENABLED=true` — feature flag (absent/false = off)
   - `LEOZOPS_READ_KEY_HASH=<sha256>` — hash of the integration key
     (raw key never stored server-side; absent = no key validates)
3. The flag and key hash MUST NOT be set in the aim, vnecom, fretas, or
   egolive Vercel projects. Setting them there is a governance violation.
4. No shared/org-level environment variable may carry the flag or key hash;
   project-scoped variables only.
5. Keys are per-deployment: a key minted for Egoric must fail (401) against
   every other deployment even if a flag were mistakenly enabled — the key
   hash env var is per-project, so cross-instance reuse fails by
   construction. This implements QA gate §15.3 ("cannot cross Egoric
   instances") across all five businesses.
6. Rollback = unset `LEOZOPS_SNAPSHOT_ENABLED` (or the key hash) in the
   Egoric Vercel project. No redeploy of other projects, no data
   restoration.

## 3. Promotion flow (CEO-defined, 2026-07-19)

```
feat/leozops-s1a (branched from main @ 76082dc)
  -> test/staging deployment for Egoric only
  -> Codex G1 PASS (recorded in leozcrm CODEX_REVIEW.md)
  -> merge to main (PR; main is branch-protected, 1 review required)
  -> explicit CEO production approval (recorded in DECISIONS.md)
  -> Vercel CLI deploy to the Egoric project ONLY
     (deploy-all.ps1 -Only egoric — never the bare deploy-all)
```

Production deployment approval: NOT YET GRANTED. Merge to main does not
authorize deployment.

## 4. Branch model (repositoryrealms)

| Branch | Role | Created from | Protection |
|---|---|---|---|
| main | Protected production baseline | 76082dc (v3.36, latest verified production-lineage commit) | GitHub branch protection: PR required, 1 approving review; default branch |
| codex/realms-demo | Staging/demo (Realms clone) — preserved | pre-existing | none |
| feat/leozops-s1a | Sprint 1A implementation | main @ 76082dc | merges only via PR into main |

## 5. Verification checklist before any deploy

- [ ] `LEOZOPS_SNAPSHOT_ENABLED` absent in aim/vnecom/fretas/egolive projects
- [ ] `LEOZOPS_READ_KEY_HASH` absent in aim/vnecom/fretas/egolive projects
- [ ] Route returns 404 on a deployment with no flag (tested)
- [ ] Egoric-minted key returns 401 against any other deployment (tested)
- [ ] Deploy command targets Egoric only (`-Only egoric`)
