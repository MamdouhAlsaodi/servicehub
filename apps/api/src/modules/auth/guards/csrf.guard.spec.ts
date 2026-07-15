import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { CsrfGuard } from './csrf.guard';
import type { Request } from 'express';

// Minimal ExecutionContext factory. CsrfGuard only reads the HTTP
// request via `switchToHttp().getRequest()`, so we never wire up
// Reflector, getHandler, or getClass.
function makeContext(req: Partial<Request>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

describe('CsrfGuard', () => {
  let guard: CsrfGuard;

  beforeEach(() => {
    guard = new CsrfGuard();
  });

  describe('safe HTTP methods (pass-through)', () => {
    it('passes GET with no cookies at all', () => {
      const ctx = makeContext({ method: 'GET', headers: {}, cookies: {} });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('passes GET even when access_token cookie is present but no x-csrf-token header', () => {
      // Safe methods must never be blocked by CSRF, regardless of state.
      const ctx = makeContext({
        method: 'GET',
        headers: { cookie: 'access_token=abc' },
        cookies: { access_token: 'abc' },
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('passes HEAD and OPTIONS the same way', () => {
      const headCtx = makeContext({ method: 'HEAD', headers: {}, cookies: {} });
      const optsCtx = makeContext({ method: 'OPTIONS', headers: {}, cookies: {} });
      expect(guard.canActivate(headCtx)).toBe(true);
      expect(guard.canActivate(optsCtx)).toBe(true);
    });
  });

  describe('unsafe methods without cookie-auth session (pass-through)', () => {
    it('passes POST when there is no Cookie header at all', () => {
      // Anonymous login / register — no access_token yet.
      const ctx = makeContext({ method: 'POST', headers: {}, cookies: {} });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('passes POST when cookies are present but no access_token', () => {
      // Bearer-only API client sending arbitrary other cookies.
      const ctx = makeContext({
        method: 'POST',
        headers: { cookie: 'theme=dark; locale=ar' },
        cookies: { theme: 'dark', locale: 'ar' },
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('unsafe methods with cookie-auth session (enforced)', () => {
    const csrf = 'a'.repeat(64); // 32 random bytes → 64 hex chars

    it('accepts matching csrf_token cookie + x-csrf-token header', () => {
      const ctx = makeContext({
        method: 'POST',
        headers: {
          cookie: `access_token=jwt; csrf_token=${csrf}`,
          'x-csrf-token': csrf,
        },
        cookies: { access_token: 'jwt', csrf_token: csrf },
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('rejects when csrf_token cookie is missing', () => {
      const ctx = makeContext({
        method: 'POST',
        headers: {
          cookie: 'access_token=jwt',
          'x-csrf-token': csrf,
        },
        cookies: { access_token: 'jwt' },
      });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('rejects when x-csrf-token header is missing', () => {
      const ctx = makeContext({
        method: 'POST',
        headers: {
          cookie: `access_token=jwt; csrf_token=${csrf}`,
        },
        cookies: { access_token: 'jwt', csrf_token: csrf },
      });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('rejects when csrf_token cookie and x-csrf-token header differ', () => {
      const ctx = makeContext({
        method: 'POST',
        headers: {
          cookie: `access_token=jwt; csrf_token=${csrf}`,
          'x-csrf-token': 'b'.repeat(64),
        },
        cookies: { access_token: 'jwt', csrf_token: csrf },
      });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('rejects when csrf_token cookie and x-csrf-token header have different lengths', () => {
      // Pre-length-check path — timingSafeEqual cannot compare
      // unequal buffers; the guard must refuse explicitly.
      const ctx = makeContext({
        method: 'POST',
        headers: {
          cookie: `access_token=jwt; csrf_token=${csrf}`,
          'x-csrf-token': 'short',
        },
        cookies: { access_token: 'jwt', csrf_token: csrf },
      });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('rejects when csrf_token cookie is the empty string', () => {
      const ctx = makeContext({
        method: 'POST',
        headers: {
          cookie: 'access_token=jwt; csrf_token=',
          'x-csrf-token': csrf,
        },
        cookies: { access_token: 'jwt', csrf_token: '' },
      });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('enforces on PUT / PATCH / DELETE just like POST', () => {
      for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
        const okCtx = makeContext({
          method,
          headers: {
            cookie: `access_token=jwt; csrf_token=${csrf}`,
            'x-csrf-token': csrf,
          },
          cookies: { access_token: 'jwt', csrf_token: csrf },
        });
        expect(guard.canActivate(okCtx)).toBe(true);

        const badCtx = makeContext({
          method,
          headers: {
            cookie: `access_token=jwt; csrf_token=${csrf}`,
            'x-csrf-token': 'wrong',
          },
          cookies: { access_token: 'jwt', csrf_token: csrf },
        });
        expect(() => guard.canActivate(badCtx)).toThrow(ForbiddenException);
      }
    });

    it('accepts an x-csrf-token header delivered as a single-element array', () => {
      // Express may surface multi-value headers as string[].
      const ctx = makeContext({
        method: 'POST',
        headers: {
          cookie: `access_token=jwt; csrf_token=${csrf}`,
          'x-csrf-token': [csrf],
        } as unknown as Request['headers'],
        cookies: { access_token: 'jwt', csrf_token: csrf },
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('error message clarity', () => {
    it('produces an explicit message when the token is missing', () => {
      const ctx = makeContext({
        method: 'POST',
        headers: { cookie: 'access_token=jwt' },
        cookies: { access_token: 'jwt' },
      });
      try {
        guard.canActivate(ctx);
        fail('expected ForbiddenException');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        expect((err as ForbiddenException).message).toMatch(/CSRF token missing/);
      }
    });

    it('produces an explicit message when the token mismatches', () => {
      const ctx = makeContext({
        method: 'POST',
        headers: {
          cookie: 'access_token=jwt; csrf_token=aaaa',
          'x-csrf-token': 'bbbb',
        },
        cookies: { access_token: 'jwt', csrf_token: 'aaaa' },
      });
      try {
        guard.canActivate(ctx);
        fail('expected ForbiddenException');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        expect((err as ForbiddenException).message).toMatch(/CSRF token mismatch/);
      }
    });
  });
});