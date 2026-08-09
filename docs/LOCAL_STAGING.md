# LeozOps isolated local staging

Status: **provisioned locally; not G5/G6/J4-J8 evidence**

`leozops-local-staging` is a production-shaped, non-production environment for
one founder to verify packaging and operations without touching an existing
cloud database or RepositoryRealms deployment. It contains:

- the reviewed non-root production image on loopback port `3100`;
- an independent PostgreSQL 16 database on loopback port `55437`;
- an HTTPS, token-protected, PII-minimized RepositoryRealms fixture source on
  loopback port `3200`;
- one-shot migration and exact idempotent tenant/source provisioning jobs;
- runtime-generated, private-key-isolated local TLS material and randomly
  generated secret bindings;
- no action adapter, source task flag, scheduler, OpenAI credential, or live
  business data.

The generated `.env.local-staging.local`, deployment manifest, certificate,
and private key are ignored by Git. Bootstrap prints no secret values and
refuses to overwrite an existing environment.

## Start and verify

```powershell
npm run staging:bootstrap # first run only
npm run staging:up
npm run staging:verify
npm run staging:restore-drill
```

Verification requires the exact staging manifest and checks its fingerprint,
secret-reference separation, database identity, current migrations, non-root
app and source runtimes, `/health`, `/startup`, `/ready`, tenant/operations authentication,
source TLS/token protection, PII denial, ETag, and `304` replay.

The restore drill creates only
`leozops_local_staging_restore_drill` inside the isolated container, restores a
custom-format backup, verifies Phase 16 tables, and removes both the disposable
database and dump in an exit trap.

## Stop and recover

```powershell
npm run staging:down
npm run staging:up
npm run staging:verify
```

`staging:down` removes containers and the private Docker network but preserves
the named PostgreSQL volume. It never calls `down --volumes`. Secret rotation
or destruction of the named volume is a separate explicit operator act; the
bootstrap script intentionally provides no automatic destructive reset.

## Truth boundary

This environment proves that the reviewed revision can run with independent
PostgreSQL, exact runtime bindings, authentication, HTTPS source semantics,
restart persistence, and disposable restore. Its source is a frozen fixture.
It does not prove a real source connection, P1/P2, G5 shadow trust, G6 action
release, supervised execution, canary history, or any elapsed J8 window.
