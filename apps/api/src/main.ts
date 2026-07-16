import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import {
  isSwaggerEnabled,
  mountSwagger,
  SWAGGER_UI_PATH,
} from './swagger';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.setGlobalPrefix('api/v1');

  app.enableCors({
    origin: 'http://localhost:3000',
    credentials: true,
  });

  /* IMPORTANT: Stripe (and our Mock) webhooks need access to the raw
   * request body so the signature HMAC can be verified. NestJS parses
   * the body via its built-in body-parser, so we attach a `verify`
   * callback that stashes the raw bytes on the request object before
   * the JSON parse happens. The webhook controller reads `req.rawBody`.
   *
   * Limiting the size to 1MB keeps the webhook payload safe.
   */
  app.use(
    json({
      limit: '1mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: '1mb' }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  /* B7 — Swagger / OpenAPI surface.
   *
   * Default behaviour: OFF in production, ON everywhere else. Operators
   * can force-enable it in production with `SWAGGER_ENABLED=true` or
   * force-disable it in dev with `SWAGGER_ENABLED=false`. The full
   * truth table lives in `apps/api/src/swagger.ts` and is exercised by
   * the security acceptance suite.
   *
   * When enabled, Swagger UI is mounted at `/api/docs` and the raw
   * JSON document at `/api/docs-json`. Neither path is prefixed with
   * `/api/v1` because `SwaggerModule.setup` defaults to
   * `useGlobalPrefix: false` — exactly the contract the web client
   * expects (no double prefix). */
  if (isSwaggerEnabled()) {
    mountSwagger(app);
    // eslint-disable-next-line no-console
    console.log(
      `Swagger UI mounted at: http://localhost:${process.env.PORT || 3001}/${SWAGGER_UI_PATH}`,
    );
  }

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}/api/v1`);
}

bootstrap();