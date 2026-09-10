import { prisma } from '../prisma.js';
import { CallStatus, CallJobStatus, CampaignStatus } from '@prisma/client';
import { logger } from '../../middleware/logger.js';
import { addRetryCallJob } from '../../queues/queueManager.js';

export interface RetryEvaluation {
  shouldRetry: boolean;
  reason?: string;
  delayMinutes?: number;
  scheduledRetryAt?: Date;
}

/**
 * Evaluates whether a failed or unanswered call attempt qualifies for a retry.
 */
export async function evaluateAndScheduleRetry(
  callAttemptId: string,
  finalStatus: CallStatus,
  failureReason?: string
): Promise<RetryEvaluation> {
  const attempt = await prisma.callAttempt.findUnique({
    where: { id: callAttemptId },
    include: {
      callJob: {
        include: {
          campaign: true,
          contact: true
        }
      }
    }
  });

  if (!attempt) {
    logger.warn({ callAttemptId }, 'Cannot evaluate retry: CallAttempt not found');
    return { shouldRetry: false, reason: 'CallAttempt not found' };
  }

  const { callJob } = attempt;
  const { campaign, contact } = callJob;

  // 1. Success check - Never retry completed calls
  if (finalStatus === CallStatus.COMPLETED) {
    await prisma.callJob.update({
      where: { id: callJob.id },
      data: { status: CallJobStatus.COMPLETED }
    });
    return { shouldRetry: false, reason: 'Call completed successfully' };
  }

  // 2. Retry Enabled check
  if (!campaign.retryEnabled) {
    await prisma.callJob.update({
      where: { id: callJob.id },
      data: { status: CallJobStatus.FAILED }
    });
    return { shouldRetry: false, reason: 'Retries are disabled for this campaign' };
  }

  // 3. Campaign State check - Never retry on cancelled campaigns
  if (campaign.status === CampaignStatus.CANCELLED || campaign.status === CampaignStatus.COMPLETED) {
    await prisma.callJob.update({
      where: { id: callJob.id },
      data: { status: CallJobStatus.CANCELLED }
    });
    return { shouldRetry: false, reason: `Campaign is in terminal state (${campaign.status})` };
  }

  // 4. Contact DNC & Strict Consent check
  if (contact.isDoNotCall || contact.consentStatus !== 'GRANTED') {
    await prisma.callJob.update({
      where: { id: callJob.id },
      data: { status: CallJobStatus.CANCELLED }
    });
    return { shouldRetry: false, reason: 'Contact is suppressed or lacks explicit GRANTED consent' };
  }

  // 5. Max Attempts check
  const currentAttempts = callJob.attempts;
  const maxRetries = campaign.maxRetries || callJob.maxAttempts || 3;
  const nextAttemptNumber = currentAttempts + 1;

  if (currentAttempts >= maxRetries) {
    await prisma.callJob.update({
      where: { id: callJob.id },
      data: { status: CallJobStatus.FAILED }
    });
    logger.info(
      { callJobId: callJob.id, currentAttempts, maxRetries },
      'Call job reached maximum retry attempts'
    );
    return { shouldRetry: false, reason: `Reached maximum attempts limit (${currentAttempts}/${maxRetries})` };
  }

  // 5b. Deduplication: Check if a retry for this next attempt number was already scheduled
  const existingRetry = await prisma.retryLog.findFirst({
    where: {
      callJobId: callJob.id,
      attemptNumber: nextAttemptNumber
    }
  });

  if (existingRetry) {
    logger.info({ callJobId: callJob.id, nextAttemptNumber }, 'Retry already scheduled for this attempt; skipping duplicate');
    return { shouldRetry: false, reason: `Retry #${nextAttemptNumber} is already scheduled` };
  }

  // 6. Failure Outcome Matching
  let outcomeMatchesPolicy = false;
  let reasonTag = failureReason || 'FAILED';

  if (finalStatus === CallStatus.BUSY && campaign.retryOnBusy) {
    outcomeMatchesPolicy = true;
    reasonTag = 'BUSY';
  } else if (finalStatus === CallStatus.NO_ANSWER && campaign.retryOnNoAnswer) {
    outcomeMatchesPolicy = true;
    reasonTag = 'NO_ANSWER';
  } else if (finalStatus === CallStatus.FAILED && campaign.retryOnFailed) {
    outcomeMatchesPolicy = true;
    reasonTag = 'TEMPORARY_FAILURE';
  }

  if (!outcomeMatchesPolicy) {
    await prisma.callJob.update({
      where: { id: callJob.id },
      data: { status: CallJobStatus.FAILED }
    });
    return { shouldRetry: false, reason: `Outcome (${finalStatus}) is not configured for retry in campaign policy` };
  }

  // 7. Schedule Retry
  const intervalMinutes = campaign.retryIntervalMinutes || 60;
  const delayMs = intervalMinutes * 60 * 1000;
  const scheduledRetryAt = new Date(Date.now() + delayMs);

  // Persist Retry Log in DB
  await prisma.$transaction(async (tx) => {
    await tx.retryLog.create({
      data: {
        callJobId: callJob.id,
        attemptNumber: nextAttemptNumber,
        reason: reasonTag,
        scheduledRetryAt
      }
    });

    await tx.callJob.update({
      where: { id: callJob.id },
      data: {
        status: CallJobStatus.PENDING,
        scheduledFor: scheduledRetryAt
      }
    });
  });

  // Enqueue delayed job in BullMQ
  try {
    await addRetryCallJob(
      {
        campaignId: campaign.id,
        contactId: contact.id,
        callJobId: callJob.id,
        attemptNumber: currentAttempts,
        reason: reasonTag
      },
      delayMs
    );
  } catch (queueErr) {
    logger.warn({ error: (queueErr as Error).message }, 'Failed to enqueue retry job in BullMQ; preserved in PostgreSQL');
  }

  logger.info(
    { callJobId: callJob.id, nextAttempt: currentAttempts + 1, scheduledRetryAt },
    'Retry scheduled successfully'
  );

  return {
    shouldRetry: true,
    reason: `Retry scheduled for ${scheduledRetryAt.toISOString()}`,
    delayMinutes: intervalMinutes,
    scheduledRetryAt
  };
}
