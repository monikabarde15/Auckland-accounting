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

  if (env.TWILIO_PHONE_NUMBER) {
    const twilioNum = env.TWILIO_PHONE_NUMBER;
    // Auto-sync database campaign callerIds and default caller settings
    prisma.systemSetting.upsert({
      where: { key: 'DEFAULT_CALLER_ID' },
      update: { value: twilioNum },
      create: { key: 'DEFAULT_CALLER_ID', value: twilioNum, description: 'Practice Outbound Caller ID' }
    }).catch(() => {});

    prisma.campaign.updateMany({
      where: {
        OR: [
          { callerId: '' },
          { callerId: { contains: '7372508034' } },
          { callerId: { contains: '737 250 8034' } },
          { callerId: { contains: '6498370000' } }
        ]
      },
      data: { callerId: twilioNum }
    }).then((res) => {
      if (res.count > 0) {
        logger.info(`[AutoSync] Updated ${res.count} campaign caller IDs to ${twilioNum}`);
      }
    }).catch((err) => {
      logger.warn({ err }, '[AutoSync] Failed to sync campaign caller IDs');
    });
  }

  if (env.NODE_ENV !== 'test') {
    // Auto-start the Call Worker for local dev convenience
    import('./workers/callWorker.js')
      .then(({ callWorker }) => {
        logger.info('Auto-starting CallWorker from API server...');
        callWorker.start().catch((err: any) => logger.error({ err }, 'Failed to start CallWorker'));
      })
      .catch((err: any) => {
        logger.warn({ err }, 'Could not import CallWorker');
      });
  }
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
