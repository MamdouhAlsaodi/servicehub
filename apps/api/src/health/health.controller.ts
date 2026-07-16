import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  /**
   * Liveness-only endpoint. It deliberately performs no database query, so
   * a 200 means this HTTP process can serve requests—not that Postgres or
   * migrations are ready.
   */
  @Get()
  getHealth() {
    return { status: 'ok' };
  }
}
