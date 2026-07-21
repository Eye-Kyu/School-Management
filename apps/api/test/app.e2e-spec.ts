// =============================================================================
// First e2e test - confirms the API bootstraps and /health returns 200.
// More tests added as features land.
// =============================================================================

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('App (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    try {
      // PrismaService is mocked — this suite never touches Prisma, and a real
      // PrismaClient throws at construction time if DATABASE_URL is missing
      // or (in CI) points at the pooler connection Prisma's client rejects.
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue({ $connect: jest.fn(), $disconnect: jest.fn() })
        .compile();

      app = moduleFixture.createNestApplication();
      await app.init();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[app e2e] FATAL: app bootstrap failed:', err);
      throw err;
    }
  });

  afterAll(async () => {
    if (!app) return;
    await app.close();
  });

  it('GET /health returns ok', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });
});
