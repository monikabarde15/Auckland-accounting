import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../middleware/logger.js';

let redisClient: Redis | null = null;
let isRedisConnected = false;
let lastRedisError: string | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: (env.REDIS_PASSWORD && env.REDIS_PASSWORD !== 'none') ? env.REDIS_PASSWORD : undefined,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        // Stop reconnecting aggressively if Redis is not locally available
        if (times > 3) {
          return null; // stop reconnecting
        }
        return Math.min(times * 1000, 3000);
      }
    });

    redisClient.on('connect', () => {
      isRedisConnected = true;
      lastRedisError = null;
      logger.info('Redis connected successfully');
    });

    redisClient.on('ready', () => {
      isRedisConnected = true;
      lastRedisError = null;
    });

    redisClient.on('error', (err: Error) => {
      isRedisConnected = false;
      lastRedisError = err.message;
      // Do not throw unhandled exception; log as warning for foundation
      logger.warn({ redisError: err.message }, 'Redis connection warning: service not available or failed');
    });

    redisClient.on('close', () => {
      isRedisConnected = false;
    });

    // Attempt non-blocking initial connection
    redisClient.connect().catch((err: Error) => {
      isRedisConnected = false;
      lastRedisError = err.message;
      logger.info({ redisError: err.message }, 'Redis server is currently unavailable (continuing in resilient mode)');
    });
  }

  return redisClient;
}

export async function checkRedisHealth(): Promise<{
  connected: boolean;
  status: string;
  latencyMs?: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    const client = getRedisClient();
    if (!isRedisConnected) {
      return {
        connected: false,
        status: 'unavailable',
        latencyMs: Date.now() - start,
        error: lastRedisError || 'Redis not connected'
      };
    }

    const pong = await client.ping();
    if (pong === 'PONG') {
      return {
        connected: true,
        status: 'healthy',
        latencyMs: Date.now() - start
      };
    }

    return {
      connected: false,
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      error: `Unexpected ping response: ${pong}`
    };
  } catch (error) {
    const err = error as Error;
    return {
      connected: false,
      status: 'unavailable',
      latencyMs: Date.now() - start,
      error: err.message
    };
  }
}

export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch {
      redisClient.disconnect();
    } finally {
      redisClient = null;
      isRedisConnected = false;
    }
  }
}
