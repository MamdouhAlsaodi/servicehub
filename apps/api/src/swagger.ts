/**
 * B7 — OpenAPI / Swagger bootstrap for the ServiceHub API.
 *
 * This module is the SINGLE source of truth for:
 *   1. Whether Swagger (and the raw JSON document at /api/docs-json)
 *      is mounted.
 *   2. What the OpenAPI document SAYS about authentication.
 *
 * The contract is intentionally conservative: every security
 * scheme declared here corresponds to an actual code path. We do
 * NOT advertise e.g. OAuth2, API keys, or scopes that the codebase
 * does not implement, because doing so would be a documentation
 * lie that lies to consumers about the security posture.
 *
 * ─── WHEN IS SWAGGER ENABLED? ────────────────────────────────────────
 *
 *   SWAGGER_ENABLED=true                  → forced ON (any NODE_ENV)
 *   SWAGGER_ENABLED=false                 → forced OFF (any NODE_ENV)
 *   SWAGGER_ENABLED unset + NODE_ENV != production  → ON
 *   SWAGGER_ENABLED unset + NODE_ENV == production  → OFF
 *
 * That is, in production the surface is OFF by default. The packet
 * requirement "/api/docs must not be public in production by default"
 * is satisfied: if `SWAGGER_ENABLED` is missing or anything other
 * than the literal string "true", production boot skips the
 * `SwaggerModule.setup(...)` call entirely. Operators who want the
 * docs surface in production must opt in with an explicit env var.
 *
 * ─── WHAT IS DOCUMENTED ABOUT AUTH? ──────────────────────────────────
 *
 * The codebase ships two mutually-compatible auth transports:
 *
 *   1. HttpOnly cookie (the browser / web client).
 *      - `access_token` cookie — short-lived JWT, HttpOnly, SameSite=Lax.
 *        In production, also `Secure`. This is what `JwtAuthGuard`
 *        reads FIRST via `JwtStrategy.fromCookie('access_token')`.
 *      - `refresh_token` cookie — long-lived JWT, HttpOnly, used by
 *        POST /auth/refresh.
 *
 *   2. Authorization: Bearer <jwt> (server-to-server / API clients).
 *      - JwtStrategy also accepts a Bearer header. Cookies win when
 *        both are present (extractors run in declared order).
 *
 * And ONE defensive measure, accurately described:
 *
 *   - Double-submit CSRF.
 *     Cookie-auth requests on unsafe methods (POST/PUT/PATCH/DELETE)
 *     MUST echo the JS-readable `csrf_token` cookie in the
 *     `x-csrf-token` request header. `CsrfGuard` enforces this with
 *     `timingSafeEqual`. See `apps/api/src/modules/auth/guards/csrf.guard.ts`.
 *
 * We declare exactly two schemes in the document:
 *   • `bearerAuth`   → Authorization: Bearer <jwt>
 *   • `cookieAuth`   → access_token cookie (and refresh_token cookie
 *                       for /auth/refresh)
 *
 * There is no API key, no OAuth2, no "global rate limit", and no
 * "global RBAC override" scheme declared — those are not implemented
 * here. What IS implemented (the throttle guard on /auth/forgot-password)
 * is per-route and not surfaced as a doc-level scheme.
 *
 * ─── WHY A SEPARATE FILE (NOT INLINE IN main.ts)? ────────────────────
 *
 *   - It lets the security acceptance test import `isSwaggerEnabled`
 *     and `buildOpenApiConfig` WITHOUT booting the full HTTP listener.
 *     That makes the enablement matrix a pure-function unit that the
 *     test can pin down deterministically.
 *   - Keeps `main.ts` focused on bootstrap, matching the project's
 *     convention of one concern per file.
 */
import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
} from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';

/* Canonical swagger mount path. The global HTTP prefix is `api/v1`,
 * but `SwaggerModule.setup` defaults `useGlobalPrefix: false`, so
 * the UI ends up at exactly `/api/docs` (not `/api/v1/api/docs`). */
export const SWAGGER_UI_PATH = 'api/docs';
export const SWAGGER_JSON_PATH = 'api/docs-json';

/**
 * Decide whether Swagger is mounted for a given NODE_ENV / SWAGGER_ENABLED pair.
 *
 * Truth table (matches the doc comment above):
 *
 *   SWAGGER_ENABLED=true   → true
 *   SWAGGER_ENABLED=false  → false
 *   SWAGGER_ENABLED unset  → NODE_ENV !== 'production'
 *
 * Any value other than the literal strings "true" / "false" (e.g.
 * "1", "yes", "TRUE") is treated as UNSET. That keeps the surface
 * hard to enable by accident.
 */
export function isSwaggerEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.SWAGGER_ENABLED;
  if (typeof raw === 'string') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    /* Anything else falls through to the NODE_ENV check below so
     * a typo like `SWAGGER_ENABLED=TRUE` does NOT silently expose
     * the docs in production. */
  }
  return env.NODE_ENV !== 'production';
}

/**
 * Build the `DocumentBuilder` configuration. Pure function — no app
 * side effects — so the security acceptance test can call it directly
 * and assert on the produced config (title, security schemes, etc.)
 * without booting the full HTTP listener.
 *
 * Returns the partial OpenAPI document (everything except `paths`,
 * which is introspected from the live app at `SwaggerModule.createDocument()`
 * time).
 */
export function buildOpenApiConfig(): Omit<OpenAPIObject, 'paths'> {
  return new DocumentBuilder()
    .setTitle('ServiceHub API')
    .setDescription(
      [
        'ServiceHub REST API.',
        '',
        '## Authentication',
        '',
        'Two parallel auth transports are supported (mutually compatible — ' +
          'cookies win when both are present):',
        '',
        '- **Bearer**: send `Authorization: Bearer <jwt>` on every request. ' +
          'This is the documented API-client path.',
        '- **HttpOnly cookies** (the browser client):',
        '  - `access_token` — short-lived JWT (15 minutes).',
        '  - `refresh_token` — long-lived JWT (7 days); used by ' +
          '`POST /auth/refresh` to mint a new `access_token`.',
        '',
        'Cookies are `HttpOnly` and `SameSite=Lax`. In production they ' +
          'are also `Secure`. Login, refresh, and demo-google-login set ' +
          'them via `Set-Cookie`.',
        '',
        '## CSRF',
        '',
        'Cookie-authenticated requests on unsafe methods (POST/PUT/PATCH/' +
          'DELETE) must include an `x-csrf-token` header whose value ' +
          'matches the `csrf_token` cookie. `csrf_token` is JS-readable ' +
          '(NOT HttpOnly) and is rotated on every login / refresh. ' +
          'Bearer-only clients skip the check (no cookie session is ' +
          'attached, so there is nothing to forge).',
        '',
        '## Roles',
        '',
        '- `CUSTOMER` — book services, write messages on own bookings.',
        '- `VENDOR` — manage own services, availability, bookings, ' +
          'payouts, and messages on own bookings.',
        '- `ADMIN` — platform settings, vendor approvals, reports, ' +
          'payout decisions, and read-only access to booking ' +
          'message threads (no write).',
        '',
        '## Operational notes',
        '',
        '- All monetary values are decimal strings with two fractional ' +
          'digits (BRL).',
        '- All timestamps are ISO-8601.',
        '- Rate limiting is per-route (e.g. `POST /auth/forgot-password` ' +
          'is throttled to 3/minute). There is no global rate limit ' +
          'scheme advertised.',
        '- Swagger UI is OFF by default in production. Set ' +
          '`SWAGGER_ENABLED=true` to force-enable it.',
      ].join('\n'),
    )
    .setVersion('0.1.0')
    /* Schemes we ACTUALLY implement. */
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Send as `Authorization: Bearer <jwt>`. Used by API clients ' +
          'and by tests. The cookie extractor runs first in ' +
          '`JwtStrategy`, so a Bearer header is only consulted when ' +
          'no `access_token` cookie is present.',
      },
      'bearerAuth',
    )
    .addCookieAuth(
      'access_token',
      {
        type: 'apiKey',
        in: 'cookie',
        name: 'access_token',
        description:
          'Browser session cookie. HttpOnly, SameSite=Lax. ' +
          '`POST /auth/login` sets it on success. Pair with the ' +
          '`csrf_token` cookie + `x-csrf-token` header for unsafe ' +
          'methods. `refresh_token` is set alongside it and consumed ' +
          'only by `POST /auth/refresh`.',
      },
      'cookieAuth',
    )
    .build();
}

/**
 * Mount Swagger UI + the raw JSON document on the running app. Safe
 * to call only after `isSwaggerEnabled` returned true. Calling this
 * when it is disabled would be a caller bug — we guard with an
 * explicit throw so the misuse is loud, not silent.
 */
export function mountSwagger(app: INestApplication): void {
  if (!isSwaggerEnabled()) {
    throw new Error(
      '[swagger] mountSwagger() called while Swagger is disabled. ' +
        'Refusing to expose /api/docs. Check isSwaggerEnabled() first.',
    );
  }
  const document: OpenAPIObject = SwaggerModule.createDocument(
    app,
    buildOpenApiConfig(),
  );
  SwaggerModule.setup(SWAGGER_UI_PATH, app, document, {
    jsonDocumentUrl: SWAGGER_JSON_PATH,
    /* useGlobalPrefix defaults to false — keep it that way so the
     * UI lives at exactly `/api/docs`, not `/api/v1/api/docs`. */
    swaggerOptions: {
      persistAuthorization: false,
      displayRequestDuration: true,
    },
  });
}