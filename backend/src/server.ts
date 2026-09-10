import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './middleware/logger.js';
import { prisma } from './services/prisma.js';
import { closeRedisConnection } from './services/redis.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({
    port: env.PORT,
    env: env.NODE_ENV,
    url: `http://localhost:${env.PORT}`
  }, `🚀 Acula Express REST API listening on port ${env.PORT}`);
});

// Graceful Shutdown
async function handleShutdown(signal: string) {
  logger.info({ signal }, 'Graceful shutdown initiated');

  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      await prisma.$disconnect();
      logger.info('Database connection closed');
    } catch (e) {
      logger.error({ err: e }, 'Error closing database connection');
    }

    try {
      await closeRedisConnection();
      logger.info('Redis connection closed');
    } catch (e) {
      logger.error({ err: e }, 'Error closing Redis connection');
    }

    process.exit(0);
  });

  // Force shutdown after 10s if connections don't drain
  setTimeout(() => {
    logger.error('Forcefully terminating process after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
