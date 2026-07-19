Product name: LeozOps AI

Current approved direction — 2026-07-18:

Egoric is the production CRM/ERP and the sole operational system of record.

LeozOps must become a separately deployed, read-only intelligence layer for
versioned KPIs, CEO Briefs, and advisory recommendations. It must not become a
second CRM/ERP for Egoric employees.

The existing LeozOps CRM, campaign, task, onboarding, and email capabilities are
historical foundation code. They are not mounted in the Egoric integration
deployment profile and they do not authorize operational write-back.

Non-negotiable integration constraints:

- Start with a GET-only, de-identified Egoric lead snapshot.
- Egoric owns clients, leads, tasks, users, invoices, and operational workflows.
- LeozOps owns derived metrics, briefs, and advisory recommendations.
- No direct/shared database access, production DB writes, double entry, generic
  Egoric CRUD API access, Director key, or autonomous external action.
- Preserve the Egoric-native funnel and disclose missing stage history.
- Use the milestone and QA contract in `docs/EGORIC_INTEGRATION.md`.

This direction supersedes the older standalone-CRM launch model below wherever
the two conflict. The original description is retained as product history.



Goal:

Build an AI Operating Partner for agencies and business owners.



Core idea:

CRM + AI Brain + Agent Workforce.



Funnel:

Traffic -> Attention -> Lead -> Qualification -> Nurture -> Conversion -> Activation -> Upsell -> Retention.



Do not use AMF branding or AMF data.

Use only the general funnel logic.



First MVP:

1\. Custom CRM foundation

2\. Client and campaign database

3\. Content queue

4\. Lead tracking

5\. KPI dashboard

6\. Daily CEO Brief Agent

7\. Recommendation system

8\. Placeholder integrations for Facebook, TikTok, Instagram, email, and AI video/image tools.



Roles:

Leoz = CEO/Product Owner

Hermes = PM

Claude Code = Senior Dev

Codex = QA

