import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/services/prisma.js';
import { evaluateAndScheduleRetry } from '../src/services/retry/retryService.js';
import { CampaignStatus, CallStatus, CallJobStatus } from '@prisma/client';

describe('Retry Engine Policy & Scheduling Tests', () => {
  let testCampaignId: string;
  let testContactId: string;

  beforeAll(async () => {
    const campaign = await prisma.campaign.create({
      data: {
        name: 'Retry Policy Campaign',
        status: CampaignStatus.RUNNING,
        callerId: '+6498370000',
        retryEnabled: true,
        maxRetries: 3,
        retryIntervalMinutes: 30,
        retryOnBusy: true,
        retryOnNoAnswer: true,
        retryOnFailed: false
      }
    });
    testCampaignId = campaign.id;

    const contact = await prisma.contact.create({
      data: {
        name: 'Retry Target',
        phoneNumber: '+64213337777',
        isDoNotCall: false,
        consentStatus: 'GRANTED'
      }
    });
    testContactId = contact.id;
  });

  afterAll(async () => {
    await prisma.retryLog.deleteMany({});
    await prisma.callAttempt.deleteMany({});
    await prisma.callJob.deleteMany({});
    await prisma.campaign.deleteMany({ where: { id: testCampaignId } });
    await prisma.contact.deleteMany({ where: { id: testContactId } });
  });

  it('should NOT retry if call completed successfully', async () => {
    const job = await prisma.callJob.create({
      data: {
        campaignId: testCampaignId,
        contactId: testContactId,
        status: CallJobStatus.DISPATCHED,
        attempts: 1,
        maxAttempts: 3
      }
    });

    const attempt = await prisma.callAttempt.create({
      data: {
        callJobId: job.id,
        status: CallStatus.IN_PROGRESS
      }
    });

    const result = await evaluateAndScheduleRetry(attempt.id, CallStatus.COMPLETED);
    expect(result.shouldRetry).toBe(false);
    expect(result.reason).toContain('completed successfully');

    const updatedJob = await prisma.callJob.findUnique({ where: { id: job.id } });
    expect(updatedJob?.status).toBe(CallJobStatus.COMPLETED);
  });

  it('should schedule retry for BUSY outcome when retryOnBusy is enabled', async () => {
    const job = await prisma.callJob.create({
      data: {
        campaignId: testCampaignId,
        contactId: testContactId,
        status: CallJobStatus.DISPATCHED,
        attempts: 1,
        maxAttempts: 3
      }
    });

    const attempt = await prisma.callAttempt.create({
      data: {
        callJobId: job.id,
        status: CallStatus.IN_PROGRESS
      }
    });

    const result = await evaluateAndScheduleRetry(attempt.id, CallStatus.BUSY, 'Line busy');
    expect(result.shouldRetry).toBe(true);
    expect(result.delayMinutes).toBe(30);

    const retryLogs = await prisma.retryLog.findMany({
      where: { callJobId: job.id }
    });
    expect(retryLogs.length).toBeGreaterThan(0);
    expect(retryLogs[0].reason).toBe('BUSY');
  });

  it('should refuse retry if max retry count has been reached', async () => {
    const job = await prisma.callJob.create({
      data: {
        campaignId: testCampaignId,
        contactId: testContactId,
        status: CallJobStatus.DISPATCHED,
        attempts: 3,
        maxAttempts: 3
      }
    });

    const attempt = await prisma.callAttempt.create({
      data: {
        callJobId: job.id,
        status: CallStatus.IN_PROGRESS
      }
    });

    const result = await evaluateAndScheduleRetry(attempt.id, CallStatus.NO_ANSWER);
    expect(result.shouldRetry).toBe(false);
    expect(result.reason).toContain('Reached maximum attempts limit');

    const updatedJob = await prisma.callJob.findUnique({ where: { id: job.id } });
    expect(updatedJob?.status).toBe(CallJobStatus.FAILED);
  });
});
