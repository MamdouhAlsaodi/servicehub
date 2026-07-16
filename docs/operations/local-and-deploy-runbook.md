# Local stack and deployment hand-off runbook

## Scope and prerequisites

This repository provides a **local-only** Docker Compose stack. It does not provision, configure, or claim any hosted deployment. Do not use the example values below as production credentials.

Install Docker Engine with the Compose plugin, Node.js 24, and Git. The Compose project builds `postgres`, `api`, and `web`; it does not start any external payment, email, or cloud service.

## Local environment

Set values in your shell or in a git-ignored root `.env` file before running Compose. `POSTGRES_DB`, `POSTGRES_USER`, port values, mock payments, and the browser-facing API URL have harmless local defaults. `POSTGRES_PASSWORD`, `DATABASE_URL`, and `JWT_SECRET` are deliberately required and have no Compose default.

```sh
cd /home/server/projects/servicehub
export POSTGRES_PASSWORD='replace-with-a-local-password'
export DATABASE_URL="postgresql://servicehub:${POSTGRES_PASSWORD}@postgres:5432/servicehub"
# Generate a value, then export its output as JWT_SECRET in this shell.
openssl rand -hex 32
export PAYMENTS_PROVIDER=mock
export NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
```

`DATABASE_URL` uses the Compose service hostname (`postgres`), whereas `NEXT_PUBLIC_API_URL` must use `localhost`: it is embedded in browser code and a browser cannot resolve Docker's internal `api` hostname. For a different host, rebuild the web image with an API URL reachable by that browser.

API-only development uses `apps/api/.env.example` as a documented template. Copy it to ignored `apps/api/.env`; never commit credentials. Tests require a separate ignored `apps/api/.env.test`, copied from `.env.test.example`, and will refuse non-test database names.

## Start, inspect, and stop

```sh
# Validate interpolation without starting a container.
docker compose config

# Build and start the local-only stack.
docker compose up --build -d

# Liveness only: this does not prove Postgres readiness.
curl --fail http://localhost:3001/api/v1/health
# expected: {"status":"ok"}

# Web UI
after='http://localhost:3000'; printf 'Open %s\n' "$after"

# Inspect and stop. `down -v` is destructive and removes local DB data.
docker compose logs --follow api web
docker compose down
docker compose down -v
```

The API command is intentionally fail-closed: `npx prisma migrate deploy && node dist/main`. If migration deployment fails, the API process does not start. Do not run `docker compose up` against a database you do not own.

## Migrations and rollback constraints

`prisma migrate deploy` applies only committed migrations and has no automatic rollback. Review generated SQL, back up a real database, and test restoration separately before any production hand-off. For a failed local migration, stop the stack and either restore the local volume from a known backup or reset only disposable local data with `docker compose down -v`; never use destructive reset commands on shared or production data. This repository does not include production deployment automation.

## Health and Swagger posture

`GET /api/v1/health` is unauthenticated and returns only `{ "status": "ok" }`. It is a process liveness endpoint. It deliberately does not query Postgres, so it must not be treated as database readiness, migration completion, dependency health, or a production readiness probe.

Swagger is disabled by default when `NODE_ENV=production`. Keep `SWAGGER_ENABLED=false` for any production-like operation; enable it only intentionally for controlled local troubleshooting. The local Compose configuration defaults it to false.

## CI behavior

GitHub Actions runs locked installs (`npm ci`), Prisma validation/generation and test migration against an ephemeral CI PostgreSQL service, API tests/build, web build, and a credential-pattern scan that excludes `.git`. It uses no deployment credentials and does not push or deploy.
