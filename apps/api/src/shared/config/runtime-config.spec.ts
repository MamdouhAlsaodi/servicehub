import {
  getAllowedOrigins,
  getJwtSecret,
  isAllowedOrigin,
  RuntimeEnvironment,
} from './runtime-config';

const productionEnvironment = (
  overrides: Partial<RuntimeEnvironment> = {},
): RuntimeEnvironment => ({
  NODE_ENV: 'production',
  JWT_SECRET: 'a-secure-production-jwt-secret-with-at-least-32-chars',
  ALLOWED_ORIGINS: 'https://app.servicehub.example',
  ...overrides,
});

describe('runtime security configuration', () => {
  describe('getJwtSecret', () => {
    it.each([
      undefined,
      '   ',
      'dev-secret-change-me',
      'replace-with-a-strong-random-secret-at-least-32-characters',
      'short-secret',
    ])('rejects an unsafe production JWT secret', (JWT_SECRET) => {
      expect(() => getJwtSecret(productionEnvironment({ JWT_SECRET }))).toThrow(
        /JWT_SECRET/,
      );
    });

    it('requires an explicit secret outside production without imposing the production length rule', () => {
      expect(() => getJwtSecret({ NODE_ENV: 'test' })).toThrow(/JWT_SECRET/);
      expect(getJwtSecret({ NODE_ENV: 'test', JWT_SECRET: 'test-value' })).toBe(
        'test-value',
      );
    });

    it('returns the configured secret after validation', () => {
      const secret = 'a-secure-production-jwt-secret-with-at-least-32-chars';
      expect(getJwtSecret(productionEnvironment({ JWT_SECRET: secret }))).toBe(secret);
    });
  });

  describe('getAllowedOrigins', () => {
    it('uses only the localhost development default when unset outside production', () => {
      expect(getAllowedOrigins({ NODE_ENV: 'development' })).toEqual([
        'http://localhost:3000',
      ]);
    });

    it('requires explicit production origins and rejects malformed entries', () => {
      expect(() => getAllowedOrigins(productionEnvironment({ ALLOWED_ORIGINS: ' ' }))).toThrow(
        /ALLOWED_ORIGINS/,
      );
      expect(() =>
        getAllowedOrigins(productionEnvironment({
          ALLOWED_ORIGINS: 'https://app.servicehub.example/path',
        })),
      ).toThrow(/ALLOWED_ORIGINS/);
      expect(() =>
        getAllowedOrigins(productionEnvironment({
          ALLOWED_ORIGINS: 'https://app.servicehub.example,',
        })),
      ).toThrow(/ALLOWED_ORIGINS/);
    });

    it('parses exact comma-separated origins and makes exact-match decisions', () => {
      const origins = getAllowedOrigins(
        productionEnvironment({
          ALLOWED_ORIGINS: 'https://app.servicehub.example, http://localhost:3000',
        }),
      );

      expect(origins).toEqual([
        'https://app.servicehub.example',
        'http://localhost:3000',
      ]);
      expect(isAllowedOrigin('https://app.servicehub.example', origins)).toBe(true);
      expect(isAllowedOrigin('https://evil.servicehub.example', origins)).toBe(false);
    });
  });
});
