const MINIMUM_PRODUCTION_JWT_SECRET_LENGTH = 32;

const KNOWN_JWT_PLACEHOLDERS = new Set([
  'dev-secret-change-me',
  'your-secret-here',
  'change-me',
  'replace-me',
  'jwt-secret',
  'secret',
  'test-secret-key-for-testing-only',
]);

export type RuntimeEnvironment = Partial<
  Pick<NodeJS.ProcessEnv, 'NODE_ENV' | 'JWT_SECRET' | 'ALLOWED_ORIGINS'>
>;

function isProduction(environment: RuntimeEnvironment): boolean {
  return environment.NODE_ENV === 'production';
}

function isKnownPlaceholder(secret: string): boolean {
  return (
    KNOWN_JWT_PLACEHOLDERS.has(secret.toLowerCase()) ||
    /^(?:your|replace|change|example|placeholder|test-only)[-_ ]/i.test(secret)
  );
}

/**
 * Returns the only JWT secret used by signing and verification. A secret must
 * always be explicitly configured; production additionally rejects known
 * placeholders and secrets too short for a 256-bit key.
 */
export function getJwtSecret(
  environment: RuntimeEnvironment = process.env,
): string {
  const secret = environment.JWT_SECRET?.trim();

  if (!secret) {
    throw new Error('JWT_SECRET must be explicitly configured.');
  }

  if (isProduction(environment)) {
    if (isKnownPlaceholder(secret)) {
      throw new Error('JWT_SECRET must not use a placeholder in production.');
    }

    if (secret.length < MINIMUM_PRODUCTION_JWT_SECRET_LENGTH) {
      throw new Error(
        `JWT_SECRET must be at least ${MINIMUM_PRODUCTION_JWT_SECRET_LENGTH} characters in production.`,
      );
    }
  }

  return secret;
}

/** Parses the exact browser origins that may send credentialed CORS requests. */
export function getAllowedOrigins(
  environment: RuntimeEnvironment = process.env,
): string[] {
  const configuredOrigins = environment.ALLOWED_ORIGINS?.trim();

  if (!configuredOrigins) {
    if (isProduction(environment)) {
      throw new Error('ALLOWED_ORIGINS must be explicitly configured in production.');
    }

    return ['http://localhost:3000'];
  }

  const origins = configuredOrigins.split(',').map((origin) => origin.trim());
  if (origins.some((origin) => !origin)) {
    throw new Error('ALLOWED_ORIGINS must not contain empty entries.');
  }

  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('ALLOWED_ORIGINS entries must be valid exact HTTP(S) origins.');
    }

    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error('ALLOWED_ORIGINS entries must be valid exact HTTP(S) origins.');
    }
  }

  return origins;
}

export function isAllowedOrigin(origin: string, allowedOrigins: string[]): boolean {
  return allowedOrigins.includes(origin);
}
