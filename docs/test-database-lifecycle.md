# ServiceHub — Test Database Lifecycle (Phase A1+A2)

This document explains how the Jest suite is kept isolated from the
development database and how to reset the test DB safely.

## Databases in this repo

| Database        | Owner       | Purpose                                |
|-----------------|-------------|----------------------------------------|
| `servicehub`    | `servicehub`| **Development.** Real demo data. NEVER mutated by tests. |
| `servicehub_test` | `servicehub`| **Test only.** Used by every Jest run. Drop / re-create freely. |

## How the suite picks the test DB

`apps/api/jest.config.js` declares:

```js
setupFiles: ['<rootDir>/../test/setup-env.ts']
```

`setup-env.ts` runs **before** the test framework or any SUT module
is imported. It:

1. Loads `apps/api/.env.test` with `override: true` so a leaked
   dev `DATABASE_URL` in the shell or in `.env` cannot survive.
2. Forces `NODE_ENV=test`.
3. **Fails fast** (`process.exit(1)`) if the resolved `DATABASE_URL`
   targets a development DB name (`servicehub`, `servicehub_dev`,
   `servicehub_production`, `postgres`) or any DB not on the
   allow-list (`servicehub_test`, `servicehub_test_e2e`).

The failure message is human-readable so a misconfiguration is
caught in seconds, not after a polluted dev DB.

## Provision / reset

```bash
# One-time copy of the example template
cp apps/api/.env.test.example apps/api/.env.test

# Apply migrations + reset the test DB schema
npm run db:test:reset -w apps/api
```

`scripts/reset-test-db.ts` only ever touches the test DB — it
re-reads `.env.test`, refuses to run if the DB name is not on the
allow-list, then shells out to `prisma migrate reset --force`.

## Running tests

```bash
cd apps/api
npm test                 # standard run
npm run test:detect      # run with --detectOpenHandles for diagnosis
npm run test:cov         # with coverage
```

## Cleanup model

`apps/api/test/helpers/prisma-test-db.ts` exposes:

- `getTestPrisma()` — singleton `PrismaClient`, lazily connected.
- `truncateAll()` — deletes every row from every application table
  in FK-safe order (dependents first, parents last). Category is
  included.
- `resetPrismaTestDb()` — truncates then disconnects the singleton,
  intended for `globalTeardown` / `afterAll`.
- Hard guard against non-test DB names.

`apps/api/src/test/setup.ts` re-exports the legacy `{ prisma,
cleanDatabase, disconnectPrisma }` API used by the original spec
files, so no existing spec needed editing.

## Acceptance evidence

| Criterion                                                   | Where to look                              |
|-------------------------------------------------------------|--------------------------------------------|
| Tests use `servicehub_test`, never `servicehub`             | `setup-env.ts` allow-list                  |
| Fail-fast on wrong DB                                       | `setup-env.ts` `process.exit(1)` branches  |
| Documented env template + reset script                      | `.env.test.example`, `scripts/reset-test-db.ts` |
| Cleanup removes ALL data (incl. Category), FK-safe          | `truncateAll()` delete order               |
| Prisma/Nest lifecycle closes cleanly; no `forceExit`        | `jest.config.js`, `npm run test:detect`    |
| Dev DB is NEVER mutated by tests                            | Sentinel proof: see durable report         |
| A1+A2 only — no product features from later phases          | Diff inspection                            |
| No secrets in source / logs / report                        | Placeholder values only                    |