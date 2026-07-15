import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

/**
 * Tiny pure cookie-name extractor scoped to this strategy file. It
 * reads a single named cookie from the raw `Cookie` header. We
 * intentionally avoid a shared utils folder: there are only two
 * cookie-extraction needs in the auth boundary (here for the access
 * JWT, and one inline parser in the refresh controller for the
 * refresh cookie), so a single private helper is the right scope.
 */
const fromCookie =
  (name: string) =>
  (req: any): string | null => {
    const header: string | undefined = req?.headers?.cookie;
    if (!header) return null;
    const match = header.match(
      new RegExp(`(?:^|;\\s*)${name}=([^;]+)`),
    );
    return match ? decodeURIComponent(match[1]) : null;
  };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      // Browser SPA sends the access JWT as an HttpOnly cookie;
      // server-to-server / documented API clients still send it as
      // an Authorization Bearer header. The cookie extractor runs
      // first so the browser path is the common case.
      jwtFromRequest: ExtractJwt.fromExtractors([
        fromCookie('access_token'),
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'dev-secret-change-me',
    });
  }

  async validate(payload: JwtPayload) {
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
  }
}