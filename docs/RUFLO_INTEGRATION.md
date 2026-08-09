# Ruflo integration

Status: **installed as an observe-only engineering harness; no autonomous runtime authority**

## Active project surfaces

- `AGENTS.md` is the repository entry point and records the LeoZOps safety
  boundary.
- `.agents/config.toml` and `claude-flow.config.json` disable unattended
  agents, hooks, workers, autoscaling, and daemon autostart.
- `.agents/skills/` contains reviewable memory, SPARC, security, and optional
  swarm procedures.
- `.mcp.json` defines the local Ruflo MCP server with autostart disabled.
- `.claude-flow/`, `.swarm/`, and `ruvector.db` are ignored runtime state.

The current Codex task does not expose Ruflo MCP methods because MCP discovery
occurs when a task starts. CLI verification is therefore the evidence source
for this cut; a later task reload is required before any newly registered MCP
surface can be used.

## Health evidence — 2026-08-08

Ruflo CLI `3.34.0` was run directly from the local npm cache after the `npx`
wrapper proved unreliable on this Windows host.

- configuration: pass;
- native `better-sqlite3` memory integrity: pass, zero stored rows;
- memory schema: usable with episode-schema warnings;
- daemon: intentionally not running;
- MCP configuration discovery: pass, six configured servers.

A semantic memory search attempted an approximately 4.4 GB allocation and was
aborted by the runtime. Keyword fallback found no relevant prior record. Do not
rely on semantic Ruflo memory on this host until its allocation behavior is
bounded and re-verified; repository decisions and tests remain canonical.

## Phase 14 use

Ruflo influenced this increment in four bounded ways:

1. routing classified specification and architecture work as high-complexity;
2. the SPARC template dry-run completed as
   `workflow-1786243699346-rrj4tf` with no spawned agents and no mutation;
3. doctor checks verified the observe-only scaffold; and
4. security scans supplemented repository tests.

The initial RepositoryRealms dependency scan reported one high-severity
`nanoid` issue and moderate Next.js/PostCSS issues. The release pass pinned
patched `nanoid` and PostCSS versions without a framework major upgrade; full
QA and the final npm/Ruflo dependency scans report zero findings.

Focused deep scans of the changed LeozOps domain and service directories also
reported zero critical, high, medium, or low findings. LeoZOps dependency
remediation likewise leaves `npm audit --audit-level=low` at zero findings.

## Authority boundary

Ruflo never creates Product Owner approval, G5/G6/G7 authority, a source
credential, deployment evidence, adapter registration, or permission to mutate
RepositoryRealms. Swarm orchestration remains unused unless the user explicitly
authorizes delegated agent work.

Repository verification remains authoritative:

```powershell
npm run test:phase14
npm run typecheck
npm test
npm run build
```
