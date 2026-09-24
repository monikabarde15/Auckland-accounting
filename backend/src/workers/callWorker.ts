import { Worker, Job } from 'bullmq';
import { prisma } from '../services/prisma.js';
import { env } from '../config/env.js';
import { logger } from '../middleware/logger.js';
import {
  QUEUE_NAMES,
  getRedisConnectionOptions,
  OutboundCallJobData,
  addOutboundCallJob
} from '../queues/queueManager.js';
import { performPreDialSafetyCheck } from '../services/dialer/dialerSafetyCheck.js';
import { twilioService } from '../services/twilio/twilioService.js';
import { evaluateAndScheduleRetry } from '../services/retry/retryService.js';
import { CallStatus, CallJobStatus } from '@prisma/client';

export class CallWorker {
  private worker: Worker<OutboundCallJobData> | null = null;
  private isShuttingDown = false;

  public async start(): Promise<void> {
    const concurrency = env.CALL_WORKER_CONCURRENCY;

    logger.info(
      {
        concurrency,
        liveCallingEnabled: env.ENABLE_LIVE_CALLING,
        redisHost: env.REDIS_HOST,
        redisPort: env.REDIS_PORT
      },
      'Starting ACULA Call Worker'
    );

    this.worker = new Worker<OutboundCallJobData>(
      QUEUE_NAMES.OUTBOUND_CALLS,
      async (job: Job<OutboundCallJobData>) => {
        return this.processCallJob(job);
      },
      {
        connection: getRedisConnectionOptions(),
        concurrency
      }
    );

    this.worker.on('active', (job) => {
      logger.info({ jobId: job.id, data: job.data }, 'Call job picked up by worker');
    });

    this.worker.on('completed', (job) => {
      logger.info({ jobId: job.id }, 'Call job execution completed in worker');
    });

    this.worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, error: err.message }, 'Call job failed in worker');
    });

    this.worker.on('error', (err) => {
      logger.warn({ error: err.message }, 'Call worker error');
    });

    // Graceful shutdown handling
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));
  }

  /**
   * Main job processor.
   */
  public async processCallJob(job: Job<OutboundCallJobData> | { id?: string; data: OutboundCallJobData }): Promise<{ success: boolean; reason?: string }> {
    if (this.isShuttingDown) {
      return { success: false, reason: 'Worker shutting down' };
    }

    const { campaignId, contactId, callJobId, attemptNumber = 1 } = job.data;

    logger.info(
      { jobId: job.id, campaignId, contactId, callJobId, attemptNumber },
      'Executing pre-dial check in worker'
    );

    // 1. Rigorous 10-Point Pre-Dial Safety Check
    const safetyResult = await performPreDialSafetyCheck(campaignId, contactId, callJobId);

    if (!safetyResult.canDial) {
      logger.info(
        {
          jobId: job.id,
          code: safetyResult.code,
          reason: safetyResult.reason,
          campaignId,
          contactId
        },
        'Pre-dial check prevented call execution'
      );

      // Requeue with delay if transient limitation (outside hours or concurrency peak)
      if (safetyResult.code === 'OUTSIDE_HOURS' || safetyResult.code === 'CONCURRENCY_LIMIT_REACHED') {
        const delayMs = safetyResult.code === 'OUTSIDE_HOURS' ? 5 * 60 * 1000 : 15 * 1000;
        logger.info({ delayMs, code: safetyResult.code }, 'Re-queuing delayed call job');
        
        await addOutboundCallJob(
          {
            campaignId,
            contactId,
            callJobId,
            attemptNumber
          },
          { delay: delayMs }
        );
        return { success: false, reason: `Requeued: ${safetyResult.reason}` };
      }

      // If permanent failure (DNC, revoked consent, missing data), update CallJob state
      if (['DNC_SUPPRESSED', 'CONSENT_REVOKED', 'CONTACT_NOT_FOUND', 'INVALID_PHONE'].includes(safetyResult.code || '')) {
        await prisma.callJob.update({
          where: { id: callJobId },
          data: { status: CallJobStatus.CANCELLED }
        });
      }

      return { success: false, reason: safetyResult.reason };
    }

    // 2. Atomic Reservation: Create CallAttempt in DB with concurrency protection
    let attempt;
    try {
      attempt = await prisma.$transaction(async (tx) => {
        const updateResult = await tx.callJob.updateMany({
          where: {
            id: callJobId,
            status: { in: [CallJobStatus.PENDING, CallJobStatus.SCHEDULED] }
          },
          data: {
            status: CallJobStatus.DISPATCHED,
            attempts: attemptNumber,
            lockedAt: new Date()
          }
        });

        if (updateResult.count === 0) {
          throw new Error(`CallJob ${callJobId} is no longer pending or was concurrently claimed`);
        }

        const newAttempt = await tx.callAttempt.create({
          data: {
            callJobId,
            status: CallStatus.QUEUED,
            startedAt: new Date()
          }
        });

        await tx.callEvent.create({
          data: {
            callAttemptId: newAttempt.id,
            eventType: 'CALL_INITIATED',
            payloadJson: {
              campaignId,
              contactId,
              attemptNumber,
              isLive: env.ENABLE_LIVE_CALLING
            }
          }
        });

        return newAttempt;
      });
    } catch (reserveError) {
      logger.warn(
        { callJobId, error: (reserveError as Error).message },
        'Job was already claimed or is no longer in pending state'
      );
      return { success: false, reason: (reserveError as Error).message };
    }

    // 3. Initiate Call via Twilio Service
    try {
      const contactPhone = (safetyResult.contact?.phoneNumber as string) || '';
      const callerId = (safetyResult.campaign?.callerId as string) || undefined;
      const questionnaireId = (safetyResult.campaign?.questionnaireId as string) || '';

      const twilioResult = await twilioService.createOutboundCall({
        to: contactPhone,
        from: callerId,
        callAttemptId: attempt.id,
        campaignId,
        contactId,
        questionnaireId
      });

      // Update attempt with Provider Call SID
      await prisma.callAttempt.update({
        where: { id: attempt.id },
        data: {
          providerCallId: twilioResult.providerCallId,
          status: CallStatus.INITIATED,
          providerResponse: (twilioResult.providerDetails as object) || undefined
        }
      });

      logger.info(
        {
          attemptId: attempt.id,
          providerCallId: twilioResult.providerCallId,
          isSimulated: twilioResult.isSimulated
        },
        'Outbound call initiated successfully'
      );

      return { success: true };
    } catch (dialError) {
      const err = dialError as Error;
      logger.error(
        { attemptId: attempt.id, error: err.message },
        'Outbound call creation failed in provider'
      );

      await prisma.$transaction(async (tx) => {
        await tx.callAttempt.update({
          where: { id: attempt.id },
          data: {
            status: CallStatus.FAILED,
            hangupCause: err.message,
            endedAt: new Date()
          }
        });
      });

      // Check retry eligibility
      await evaluateAndScheduleRetry(attempt.id, CallStatus.FAILED, err.message);

      return { success: false, reason: err.message };
    }
  }

  /**
   * Graceful shutdown.
   */
  public async shutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    logger.info({ signal }, 'Stopping Call Worker gracefully...');

    if (this.worker) {
      await this.worker.close();
    }
    await prisma.$disconnect();
    logger.info('Call Worker shutdown complete.');
    process.exit(0);
  }
}

export const callWorker = new CallWorker();

// Allow running standalone from CLI (supports both .ts under tsx and .js under Node/PM2)
const isWorkerMain = Boolean(
  process.argv[1] &&
  (process.argv[1].endsWith('callWorker.ts') ||
   process.argv[1].endsWith('callWorker.js') ||
   process.argv[1].includes('callWorker'))
);

if (isWorkerMain) {
  callWorker.start().catch((err) => {
    logger.error({ error: (err as Error).message }, 'Fatal error starting call worker');
    process.exit(1);
  });
}
