# Sprint 1C — Deterministic Egoric CEO Brief

Status: **G3 TECHNICAL QA PASS LOCALLY — PR/MERGE/ACCEPTANCE PENDING**

Target repository: `leozvu/leozcrm`

Target branch: `codex/leozops-s1c-ceo-brief`

Gate: **G3 — Deterministic Brief**

Production authorization: **NOT GRANTED**

## Tasks

- [x] T1 — Add a snapshot-native brief contract and versioned formulas.
- [x] T2 — Select accepted snapshot/run evidence deterministically by tenant and
  `asOf`.
- [x] T3 — Add provenance, freshness, exact quality, observations, and known
  limitations to every output.
- [x] T4 — Add separate tenant-scoped output authentication.
- [x] T5 — Add `egoric-readonly` with health plus one brief GET route only.
- [x] T6 — Add exact metric, replay, corruption, PII, overflow, auth, tenant,
  and legacy route-denial tests.
- [x] T7 — Independent G3 QA and gate verdict in `../CODEX_REVIEW.md`.

## Definition of done

G3 passes only when the focused and complete suites, typecheck, native-funnel
formula assertions, full provenance/limitation assertions, tenant auth, corrupt
memory fail-closed behavior, safe source presentation, no-write proof, and the
integration-profile route-denial matrix all pass and Codex records the verdict.

G3 does not authorize production, G4 acceptance, scheduled polling, source
credentials, write-back, publishing, or autonomy.
