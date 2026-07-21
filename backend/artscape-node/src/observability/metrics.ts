import type { RequestHandler } from 'express';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry, prefix: 'artscape_' });

const requests = new Counter({
  name: 'artscape_http_requests_total',
  help: 'HTTP requests by method, route and status.',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [metricsRegistry],
});
const latency = new Histogram({
  name: 'artscape_http_request_duration_seconds',
  help: 'HTTP request latency.',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});

export const metricsMiddleware: RequestHandler = (req, res, next) => {
  const end = latency.startTimer();
  res.on('finish', () => {
    const labels = {
      method: req.method,
      route: req.route?.path ?? req.path.replace(/[a-f0-9_-]{16,}/gi, ':id'),
      status: String(res.statusCode),
    };
    requests.inc(labels);
    end(labels);
  });
  next();
};
