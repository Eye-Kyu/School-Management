// =============================================================================
// API bootstrap
// =============================================================================

// Polyfill WebSocket for Node.js < 22 — required by @supabase/realtime-js
import ws from 'ws';
if (!('WebSocket' in globalThis)) {
  (globalThis as Record<string, unknown>).WebSocket = ws;
}

import * as Sentry from '@sentry/node';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

async function bootstrap() {
  if (process.env.SENTRY_DSN) {
    Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0 });
  }
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // ---------- CORS ----------
  // Only the configured web origin can call the API in dev.
  const webOrigin = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  app.enableCors({
    origin: webOrigin,
    credentials: true,
  });

  // ---------- Global exception filter ----------
  // Translates exceptions to consistent JSON error responses.
  app.useGlobalFilters(new GlobalExceptionFilter());

  // ---------- Global validation pipe ----------
  // For decorators-based validation (class-validator). Zod schemas use
  // ZodValidationPipe per-route - see src/common/pipes/zod-validation.pipe.ts
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  // ---------- OpenAPI / Swagger ----------
  const swaggerConfig = new DocumentBuilder()
    .setTitle('School Manager API')
    .setDescription('REST API for the School Manager platform')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = Number(process.env.API_PORT) || 4000;
  await app.listen(port);
  logger.log(`API listening on http://localhost:${port}`);
  logger.log(`CORS allowed origin: ${webOrigin}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to bootstrap API:', err);
  process.exit(1);
});
