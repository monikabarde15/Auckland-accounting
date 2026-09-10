import { Router, Request, Response } from 'express';
import { checkDatabaseHealth } from '../services/prisma.js';
import { checkRedisHealth } from '../services/redis.js';
import { env } from '../config/env.js';

export const healthRouter = Router();

/**
 * GET /api/health/live
 * Kubernetes / PM2 Liveness probe. Returns 200 if process is active.
 */
healthRouter.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/health/ready
 * Kubernetes / PM2 Readiness probe. Returns 200 if primary database is connected, 503 otherwise.
 */
healthRouter.get('/ready', async (_req: Request, res: Response) => {
  const dbHealth = await checkDatabaseHealth();
  if (!dbHealth.connected) {
    return res.status(503).json({
      status: 'not_ready',
      reason: 'Database connection unavailable',
      timestamp: new Date().toISOString()
    });
  }
  return res.status(200).json({
    status: 'ready',
    database: 'connected',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/health
 * Comprehensive infrastructure telemetry probe.
 */
healthRouter.get('/', async (_req: Request, res: Response) => {
  const dbHealth = await checkDatabaseHealth();
  const redisHealth = await checkRedisHealth();

  const isHealthy = dbHealth.connected;
  const overallStatus = isHealthy ? (redisHealth.connected ? 'healthy' : 'degraded') : 'unhealthy';

  const statusCode = dbHealth.connected ? 200 : 503;

  return res.status(statusCode).json({
    success: isHealthy,
    data: {
      status: overallStatus,
      service: 'acula-api',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptimeSeconds: process.uptime(),
      environment: env.NODE_ENV,
      database: dbHealth,
      redis: redisHealth
    }
  });
});
