# Cockpit page override

Inherits `design-system/MASTER.md`.

The cockpit has five destinations: Today, Ask LeozOps, Business, Planner, and
Command Deck. Recommendations remain evidence-bound advisory inputs inside
Planner rather than consuming a sixth navigation slot. Today is the default and
must answer the North Star questions without scrolling on a 1440px viewport
when representative data exists.

## Hierarchy

1. Realm identity, tenant, and source freshness.
2. Current business state and evidence-backed attention items.
3. Ask LeozOps composer and validated answer/citation stream.
4. Funnel, source quality, and explicit historical-data limitation.
5. Planner: advisory recommendations feed versioned goals, deterministic plans,
   comparisons, decisions, checkpoints, and outcomes.
6. Command Deck authority boundary.

The Command Deck uses a visible sealed state. `Approval is not execution` is
permanent copy until a later gate replaces the read-only capability contract.
Unknown kill-switch state must be labelled `Not exposed`, never `Safe`.

Phase 11 adds a Proactive Nervous System panel to Today. It uses text-labelled
`warning` and `urgent` severity, an explicit open/acknowledged/snoozed state,
and trigger → fact → recommendation → delivery evidence. Acknowledge and
Snooze are 44px LeozOps-only controls; neither resembles an operational
approval or changes Egoric. The empty state names the freshness, completeness,
change, cooldown, and snooze gates instead of implying monitoring failed.

## State coverage

- Disconnected: credential chamber with no business content.
- Loading: stable skeleton regions and an `aria-live` status.
- Fresh/stale/future: labelled source badge plus timestamps and age.
- Empty recommendations: explain that no warning-derived priority exists.
- Partial history: show current-state metrics and the missing-history reason.
- API/auth failure: preserve the shell, name the recovery action, clear the
  in-memory credential on 401/403.
- Ask timeout/failure: keep the question visible and offer retry.
- Reduced motion/high contrast: no progressive animation requirement and
  stronger system borders/focus colors.

## Phase 13 planner boundary

- The same goal version and evidence set must produce the same plan graph.
- Accepting a plan records operator intent only; it grants no execution authority.
- Recommendations appear inside Planner so mobile navigation remains limited to
  five labelled destinations.
- Plans expose evidence, conflicts, simulations, comparison, decision state,
  checkpoints, and outcomes without hiding uncertainty.
