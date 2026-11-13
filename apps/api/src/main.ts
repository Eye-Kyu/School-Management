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
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  // Render (and most PaaS hosts) sit behind a reverse proxy — without this,
  // req.ip always resolves to the proxy's own address, not the real client's,
  // which would make the new M-Pesa Daraja callback IP allowlist check
  // exactly the wrong IP in production. app.set() isn't on INestApplication's
  // type (it's an Express-only method) — go through the underlying instance.
  //
  // SA-22 (security audit 2026-11): the hop count must equal the number of
  // proxies Railway actually puts in front of the API. Too high, and a client
  // can choose req.ip by sending its own X-Forwarded-For (spoofing a Safaricom
  // IP past the Daraja allowlist). Too low, and every callback looks like it
  // came from the proxy. Configurable via TRUST_PROXY_HOPS (default 1, the
  // previous value). Confirm the real value against Railway (see the SA-22
  // validation plan in docs/audits/security-audit-2026-11-tracker.md).
  const hopsRaw = process.env.TRUST_PROXY_HOPS?.trim();
  const trustProxyHops = hopsRaw === undefined || hopsRaw === '' ? 1 : Number(hopsRaw);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 5) {
    throw new Error(`TRUST_PROXY_HOPS must be an integer between 0 and 5 (got "${hopsRaw}")`);
  }
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxyHops);

  // ---------- CORS ----------
  // Only the configured web origin can call the API in dev.
  // A trailing slash breaks the exact-match comparison against the
  // browser's Origin header (which never has one), so strip it defensively.
  const webOrigin = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
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

  const port = Number(process.env.PORT) || Number(process.env.API_PORT) || 4000;
  await app.listen(port);
  logger.log(`API listening on http://localhost:${port}`);
  logger.log(`CORS allowed origin: ${webOrigin}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to bootstrap API:', err);
  process.exit(1);
});
