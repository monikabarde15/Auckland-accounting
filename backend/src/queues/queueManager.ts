import { Queue, QueueEvents, JobsOptions, ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../middleware/logger.js';

export interface OutboundCallJobData {
  campaignId: string;
  contactId: string;
  callJobId: string;
  attemptNumber: number;
  isRetry?: boolean;
  scheduledFor?: string;
  triggeredBy?: string;
}

export interface RetryJobData {
  campaignId: string;
  contactId: string;
  callJobId: string;
  attemptNumber: number;
  reason: string;
}

export interface CallEventJobData {
  callAttemptId: string;
  eventType: string;
  providerEventId?: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export const QUEUE_NAMES = {
  OUTBOUND_CALLS: 'outbound-calls',
  RETRY_CALLS: 'retry-calls',
  CALL_EVENTS: 'call-events'
} as const;

export function getRedisConnectionOptions(): any {
  const baseOptions = {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    retryStrategy(times: number) {
      if (times > 2) return null;
      return Math.min(times * 200, 1000);
    }
  };

  if (process.env.REDIS_URL) {
    // BullMQ allows passing an IORedis instance directly
    return new Redis(process.env.REDIS_URL, baseOptions);
  }

  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: (env.REDIS_PASSWORD && env.REDIS_PASSWORD !== 'none') ? env.REDIS_PASSWORD : undefined,
    ...baseOptions
  };
}

let outboundQueue: Queue<OutboundCallJobData> | null = null;
let retryQueue: Queue<RetryJobData> | null = null;
let eventQueue: Queue<CallEventJobData> | null = null;
let outboundEvents: QueueEvents | null = null;

export function getOutboundCallQueue(): Queue<OutboundCallJobData> {
  if (!outboundQueue) {
    outboundQueue = new Queue<OutboundCallJobData>(QUEUE_NAMES.OUTBOUND_CALLS, {
      connection: getRedisConnectionOptions(),
      defaultJobOptions: {
        attempts: 1, // Retries are managed by our explicit retryService & state machine
        removeOnComplete: { count: 1000, age: 3600 * 24 }, // keep 1000 or 24h
        removeOnFail: { count: 1000, age: 3600 * 24 }
      }
    });

    outboundQueue.on('error', (err) => {
      logger.warn({ error: err.message }, 'Outbound call queue warning');
    });
  }
  return outboundQueue;
}

export function getRetryQueue(): Queue<RetryJobData> {
  if (!retryQueue) {
    retryQueue = new Queue<RetryJobData>(QUEUE_NAMES.RETRY_CALLS, {
      connection: getRedisConnectionOptions(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 1000, age: 3600 * 24 },
        removeOnFail: { count: 1000, age: 3600 * 24 }
      }
    });

    retryQueue.on('error', (err) => {
      logger.warn({ error: err.message }, 'Retry queue warning');
    });
  }
  return retryQueue;
}

export function getEventQueue(): Queue<CallEventJobData> {
  if (!eventQueue) {
    eventQueue = new Queue<CallEventJobData>(QUEUE_NAMES.CALL_EVENTS, {
      connection: getRedisConnectionOptions(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 5000, age: 3600 * 24 }
      }
    });

    eventQueue.on('error', (err) => {
      logger.warn({ error: err.message }, 'Event queue warning');
    });
  }
  return eventQueue;
}

/**
 * Generates a deterministic, idempotent job ID.
 * Prevents double-enqueuing of the exact same call attempt.
 */
export function generateCallJobId(callJobId: string, attemptNumber: number): string {
  return `calljob-${callJobId}-att-${attemptNumber}`;
}

/**
 * Enqueues an outbound call job with deterministic job ID.
 */
export async function addOutboundCallJob(
  data: OutboundCallJobData,
  options?: Partial<JobsOptions>
) {
  const queue = getOutboundCallQueue();
  const jobId = options?.jobId || generateCallJobId(data.callJobId, data.attemptNumber);

  const job = await queue.add('dial-contact', data, {
    jobId,
    ...options
  });

  logger.info(
    { jobId: job.id, callJobId: data.callJobId, campaignId: data.campaignId, attempt: data.attemptNumber },
    'Enqueued outbound call job'
  );

  return job;
}

/**
 * Enqueues a delayed retry call job.
 */
export async function addRetryCallJob(
  data: RetryJobData,
  delayMs: number
) {
  const queue = getOutboundCallQueue();
  const nextAttempt = data.attemptNumber + 1;
  const jobId = generateCallJobId(data.callJobId, nextAttempt);

  const job = await queue.add(
    'dial-contact',
    {
      campaignId: data.campaignId,
      contactId: data.contactId,
      callJobId: data.callJobId,
      attemptNumber: nextAttempt,
      isRetry: true
    },
    {
      jobId,
      delay: delayMs
    }
  );

  logger.info(
    { jobId: job.id, callJobId: data.callJobId, delayMs, nextAttempt },
    'Enqueued delayed retry call job'
  );

  return job;
}

/**
 * Returns summary counts across queues.
 */
export async function getQueueTelemetry() {
  const queue = getOutboundCallQueue();
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount().catch(() => 0),
    queue.getActiveCount().catch(() => 0),
    queue.getCompletedCount().catch(() => 0),
    queue.getFailedCount().catch(() => 0),
    queue.getDelayedCount().catch(() => 0)
  ]);

  return {
    outbound: { waiting, active, completed, failed, delayed }
  };
}

/**
 * Closes all queue connections gracefully.
 */
export async function closeAllQueues(): Promise<void> {
  const closers = [
    outboundQueue?.close(),
    retryQueue?.close(),
    eventQueue?.close(),
    outboundEvents?.close()
  ].filter(Boolean);

  await Promise.all(closers);
  outboundQueue = null;
  retryQueue = null;
  eventQueue = null;
  outboundEvents = null;
  logger.info('All BullMQ queues closed gracefully');
}
