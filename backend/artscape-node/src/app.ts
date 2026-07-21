import 'dotenv/config';
import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { createArtScapeRouter } from './routes/artscape.routes';
import {
  getArtScapeRuntimeService,
  type ArtScapeRuntimeService,
} from './services/ArtScapeRuntime';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { metricsMiddleware, metricsRegistry } from './observability/metrics';
import { ARTSCAPE_BACKEND_VERSION } from './version';

export async function createApp(
  suppliedService?: ArtScapeRuntimeService
): Promise<Express> {
  const service = suppliedService ?? (await getArtScapeRuntimeService());
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use((req, res, next) => {
    const requestId = req.get('x-request-id')?.slice(0, 128) || randomUUID();
    res.setHeader('x-request-id', requestId);
    next();
  });
  const allowedOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',').map((origin) => origin.trim()).filter(Boolean);
  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.use(rateLimit({ windowMs: 60_000, limit: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 120), standardHeaders: 'draft-7', legacyHeaders: false }));
  app.use(metricsMiddleware);
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '25mb' }));
  app.use(express.urlencoded({ extended: true, limit: process.env.JSON_BODY_LIMIT || '25mb' }));
  app.get(['/health', '/health/live'], (_req, res) => {
    res.json({
      ok: true,
      service: 'artscape-backend',
      version: ARTSCAPE_BACKEND_VERSION,
      timestamp: new Date().toISOString(),
      persistence: service.persistence,
    });
  });
  app.get('/health/ready', async (_req, res) => {
    try {
      await service.runtime.repository.read();
      res.json({ ok: true, persistence: service.persistence });
    } catch {
      res.status(503).json({ ok: false, code: 'DEPENDENCY_UNAVAILABLE' });
    }
  });
  app.get('/metrics', async (_req, res) => {
    res.type(metricsRegistry.contentType).send(await metricsRegistry.metrics());
  });
  app.use('/api/v1/artscape', createArtScapeRouter(service));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
