import { PrismaClient } from '@prisma/client';
import { logger } from '../middleware/logger.js';

export const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' }
  ]
});

// Log prisma warnings and errors through Pino
prisma.$on('warn' as never, (e: { message: string }) => {
  logger.warn({ prisma: e.message }, 'Prisma warning');
});

prisma.$on('error' as never, (e: { message: string }) => {
  logger.error({ prisma: e.message }, 'Prisma error');
});

export async function checkDatabaseHealth(): Promise<{
  connected: boolean;
  status: string;
  latencyMs?: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      connected: true,
      status: 'healthy',
      latencyMs: Date.now() - start
    };
  } catch (error) {
    const err = error as Error;
    return {
      connected: false,
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      error: err.message
    };
  }
}
