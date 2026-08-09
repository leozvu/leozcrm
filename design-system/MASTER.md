# LeozOps Realm Design System

Status: Phase 10 source of truth.

LeozOps uses RepositoryRealms' premium dark command language without copying
game mechanics. The interface should feel like a calm executive war room:
midnight surfaces, emerald operational state, restrained gold emphasis, and
thin engraved borders. Medieval atmosphere is presentation only; evidence,
freshness, limitations, and authority state always win the hierarchy.

## Foundation

| Token | Value | Use |
|---|---|---|
| `--realm-canvas` | `#0b1015` | page background |
| `--realm-surface` | `#111923` | navigation and primary panels |
| `--realm-elevated` | `#17212b` | cards and raised controls |
| `--realm-soft` | `#1d2934` | selected and secondary surfaces |
| `--realm-emerald` | `#4fa47a` | healthy operational state |
| `--realm-emerald-dark` | `#2f7255` | primary action surface |
| `--realm-gold` | `#c8a96b` | evidence, milestones, active navigation |
| `--realm-blue` | `#6398c8` | information and citations |
| `--realm-amber` | `#d69a4c` | warning and stale state |
| `--realm-red` | `#cf5a5a` | real blocked/error state only |
| `--realm-text` | `#f3f5f7` | primary text |
| `--realm-text-2` | `#aab4be` | secondary text |
| `--realm-muted` | `#82909c` | metadata that still meets contrast |

Use a humanist system sans for controls and body. A restrained Georgia-style
serif is allowed only for the product wordmark and one page display heading.
Numbers use tabular figures. Body copy is at least 16px on narrow viewports.

Spacing follows a 4/8px rhythm. Interactive controls are at least 44px high.
Panels use 12px radii, controls 8px, one-pixel borders, and restrained shadows.
Glass blur is reserved for modal isolation; it is not the default card style.

## Product rules

- Every metric exposes an evidence or provenance path.
- Fresh, stale, future, blocked, unknown, and unavailable states include text;
  color is never the only signal.
- Approval, execution, receipt, and rollback are separate states.
- No UI may imply a successful action without a canonical receipt.
- No raw lead identity is presented in the Phase 10 cockpit.
- No emoji is used as a structural icon; use one consistent inline SVG family.
- Motion lasts 150-300ms, uses opacity/transform, and disappears under
  `prefers-reduced-motion`.
- Keyboard focus is always visible. Main content has a skip link and route/tab
  changes move focus to the destination heading.
- Mobile prioritizes brief, attention, and Ask; dense business data becomes a
  vertical list rather than a compressed desktop dashboard.

## Breakpoints

- 375/390: single-column phone, compact header, five labeled destinations.
- 768: tablet, two-column evidence cards where useful.
- 1024: compact desktop rail and two-column workspace.
- 1440: full executive rail, 12-column workspace, contextual evidence drawer.

The canonical visual reference remains the Realm v2 CEO Terminal design board
in `CRMegoric-Realm-DS-v2`; this file narrows it to LeozOps' evidence-first
cockpit and does not authorize changes to that separate repository.
