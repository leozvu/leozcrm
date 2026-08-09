# Jarvis v1 release and incident runbook

Status: **operator-ready repository procedure; no live run claimed**

This is the minimum human-operable path from the repository candidate to a
real J8 decision. It never waives G0–G7 or J1–J7.

## 1. Freeze one release

1. Merge reviewed RepositoryRealms and LeozOps revisions to their canonical
   branches. Record immutable commit and image digests.
2. Rebuild every source qualification and release manifest from those commits;
   do not reuse working-tree fingerprints.
3. Verify the normal action registry is empty. Register the one task adapter
   only inside the separately authorized action worker after exact G5/G6
   release and runtime credential verification.
4. Run migrations, `/startup`, `/health`, and `/ready` against the named
   PostgreSQL deployment. A pending migration or local/unbound fingerprint is
   a stop condition.

## 2. Required repository gates

```powershell
npm run typecheck
npm test
npm run build
npm run test:phase15
npm run test:phase16
npm audit --omit=dev --audit-level=high
```

Also execute the checked-in disposable PostgreSQL lifecycle and container
jobs. A local SQLite pass cannot substitute for PostgreSQL or image evidence.

## 3. Start the live window

- Provision separate read, output, observability, source-operator, alert,
  action-preview, action-approval, action-execute, receipt, rollback-preview,
  rollback-approval, and rollback credentials as required by their exact
  manifests. Test revocation for each class.
- Keep RepositoryRealms task command feature flag off until the source commit,
  migration, credentials, and G6 release all match.
- Run the Observer and alert worker as scheduler-owned one-shot processes; the
  HTTP service starts no loop.
- Enable the OpenAI advisor only after its project privacy/retention decision,
  budget, revocation, live eval, and monitoring have been accepted.
- Record the named deployment, region, service, database, source project,
  dashboards, alerts, on-call owner, and trace correlation procedure.

## 4. Daily checks for 30 days

Inspect `/internal/operations/snapshot`, Prometheus metrics, and each tenant's
`jarvis/evaluation?days=30` plus `jarvis/readiness`.

Stop promotion for any of the following:

- stale source or reconciliation failure outside the approved SLO;
- uncited accepted answer, material false claim, or privacy leak;
- unknown delivery/action outcome or unexplained external mutation;
- unresolved P0/P1 incident, failed credential revocation, or broken tenant
  isolation;
- alert false-positive rate above 10%, more than three alerts/day, or fewer
  than 20 genuine reviews at decision time;
- action adapter/source/release drift, rollback failure, or kill-switch doubt;
- missing backup, disposable restore, incident, and sanitized-export drill.

Never “fix” an elapsed evidence window by changing timestamps or using fixtures.

## 5. Incident response

1. Engage the applicable kill switch and disable the source feature flag or
   external adapter registration. Revocation is preferred over redeploy delay.
2. Stop one-shot scheduler invocations. Do not retry unknown action/delivery
   outcomes.
3. Preserve request ID, trace ID, release/source fingerprints, canonical
   receipt, immutable event timeline, and dashboard window. Do not copy raw
   credentials or unnecessary source payloads into tickets.
4. Reconcile the provider/source receipt before any retry. Use the separately
   approved rollback/recovery path only when its fresh preview still matches.
5. Restore only to a distinctly named disposable database during drills.
   Production restoration is a human incident procedure with backup hash and
   database identity verification.
6. Close the incident only with root cause, blast radius, data/privacy impact,
   receipt/reconciliation result, recovery verification, and prevention owner.
   Restarting a process is not closure.

## 6. Data-rights drill

From the authenticated cockpit, create `EXPORT <tenant-key>`, download the
sanitized package, verify its hash and exclusions, and record the request ID.
Create `DELETE <tenant-key>` to prove request capture and its explicit blocked
state. Do not implement or execute destructive deletion until the candidate
90/365-day policy, legal/privacy scope, backup interaction, immutable-audit
exceptions, and operator command receive separate acceptance.

## 7. J8 decision packet

The Product Owner receives immutable references for accepted J1–J7, the full
30-day evaluation/SLO report, zero open P0/P1 blockers, dependency/security and
privacy review, revocation drills, backup/disposable restore, incident drill,
export drill, and operator walkthrough. J8 remains blocked if any reference is
missing, expired, targets another deployment/revision, or cannot be reproduced.

J8 acceptance releases a specific version to a specific environment. It does
not authorize a broader command, new tenant, generic agent tool, or unbounded
autonomy.
