import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

// Double-submit CSRF guard.
//
// Cookie-based auth means an attacker site can ride the browser's
// access_token cookie on cross-site POST/PUT/PATCH/DELETE requests
// (the classic CSRF risk). The mitigation here is the double-submit
// pattern: every login / refresh also issues a *separate*, JS-readable
// `csrf_token` cookie, and the client must echo it back in the
// `x-csrf-token` request header. An attacker page can read neither
// the HttpOnly JWTs nor the SameSite=Lax cookie across origins, so
// it cannot forge the header.
//
// Safe methods never carry side effects and are passed through. We
// also pass through when there is no `access_token` cookie at all —
// this covers anonymous login / register and Bearer-only API clients
// (which never set cookies). Only when cookie-auth is in play do we
// enforce the double-submit check.

const SAFE_METHODS = new Set<string>(['GET', 'HEAD', 'OPTIONS']);

// File-local cookie parser. Mirrors the one in `auth.controller.ts` so
// this guard stays self-contained — the packet keeps a tight scope
// that does not allow extracting shared helpers.
function parseCookieHeader(
  cookieHeader: string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const name = trimmed.slice(0, eq).trim();
    if (name) out[name] = decodeURIComponent(trimmed.slice(eq + 1).trim());
  }
  return out;
}

function pickHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const method = (req.method || 'GET').toUpperCase();
    if (SAFE_METHODS.has(method)) {
      return true;
    }

    const cookies = parseCookieHeader(req.headers.cookie);

    // No cookie-auth session → either an anonymous request (login /
    // register) or a Bearer-only API client. CSRF only matters when
    // browsers automatically attach credentials; nothing is being
    // attached here, so we pass through.
    if (!cookies['access_token']) {
      return true;
    }

    const csrfCookie = cookies['csrf_token'];
    const csrfHeader = pickHeader(req.headers['x-csrf-token']);

    if (!csrfCookie || !csrfHeader) {
      throw new ForbiddenException(
        'CSRF token missing: x-csrf-token header and csrf_token cookie must both be present on cookie-auth unsafe requests',
      );
    }

    // timingSafeEqual requires equal-length buffers; check first to
    // avoid throwing RangeError, then compare.
    const a = Buffer.from(csrfCookie);
    const b = Buffer.from(csrfHeader);
    if (a.length === 0 || a.length !== b.length) {
      throw new ForbiddenException('CSRF token mismatch');
    }
    if (!timingSafeEqual(a, b)) {
      throw new ForbiddenException('CSRF token mismatch');
    }

    return true;
  }
}