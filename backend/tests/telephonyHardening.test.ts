import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { CampaignStatus, CallStatus, CallJobStatus, QuestionType, ConsentStatus } from '@prisma/client';
import { performPreDialSafetyCheck, isWithinCallingHours } from '../src/services/dialer/dialerSafetyCheck.js';
import { evaluateAndScheduleRetry } from '../src/services/retry/retryService.js';
import { voiceWebhookService } from '../src/services/voiceWebhookService.js';
import { emergencyStopAllCampaigns, transitionCampaignStatus } from '../src/services/campaignService.js';
import { callWorker } from '../src/workers/callWorker.js';

describe('ACULA Phase 5: Telephony Safety, Reliability & Failure-Mode Hardening Suite', () => {
  const app = createApp();
  let adminToken: string;
  let operatorToken: string;
  let testCampaignId: string;
  let testQuestionnaireId: string;
  let testContactGrantedId: string;
  let testContactPendingId: string;
  let testContactRevokedId: string;
  let testContactExpiredId: string;
  let testContactDncId: string;
  let testSharedNumberContact1Id: string;
  let testSharedNumberContact2Id: string;
  let sharedPhoneNumber = '+64218880001';

  beforeAll(async () => {
    // 1. Auth setup
    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@aucklandaccounting.co.nz', password: 'AculaAdmin2026!' });
    adminToken = adminRes.body.data.accessToken;

    const opRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'operator@aucklandaccounting.co.nz', password: 'AculaOperator2026!' });
    operatorToken = opRes.body.data.accessToken;

    // 2. Questionnaire setup
    const q = await prisma.questionnaire.create({
      data: {
        title: 'Hardening Test Questionnaire',
        questions: {
          create: {
            questionText: 'Press 1 to confirm or 2 to request callback.',
            type: QuestionType.YES_NO,
            orderNo: 1,
            options: {
              create: [
                { optionLabel: 'Confirm', optionKey: '1', nextAction: 'END_CALL' },
                { optionLabel: 'Callback', optionKey: '2', nextAction: 'END_CALL' }
              ]
            }
          }
        }
      }
    });
    testQuestionnaireId = q.id;

    // 3. Campaign setup
    const camp = await prisma.campaign.create({
      data: {
        name: 'Hardening Telephony Campaign',
        status: CampaignStatus.RUNNING,
        callerId: '+6498370000',
        questionnaireId: testQuestionnaireId,
        callingStartTime: '00:00',
        callingEndTime: '23:59',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        timezone: 'Pacific/Auckland',
        maxConcurrentCalls: 5,
        maxCalls: 50,
        maxCost: 100.0,
        retryEnabled: true,
        maxRetries: 3,
        retryIntervalMinutes: 30,
        retryOnBusy: true,
        retryOnNoAnswer: true,
        retryOnFailed: true
      }
    });
    testCampaignId = camp.id;

    // 4. Contacts with varied consent states
    const cGranted = await prisma.contact.create({
      data: {
        name: 'Granted Consent Contact',
        phoneNumber: '+64217770001',
        isDoNotCall: false,
        consentStatus: ConsentStatus.GRANTED
      }
    });
    testContactGrantedId = cGranted.id;

    const cPending = await prisma.contact.create({
      data: {
        name: 'Pending Consent Contact',
        phoneNumber: '+64217770002',
        isDoNotCall: false,
        consentStatus: ConsentStatus.PENDING
      }
    });
    testContactPendingId = cPending.id;

    const cRevoked = await prisma.contact.create({
      data: {
        name: 'Revoked Consent Contact',
        phoneNumber: '+64217770003',
        isDoNotCall: false,
        consentStatus: ConsentStatus.REVOKED
      }
    });
    testContactRevokedId = cRevoked.id;

    const cExpired = await prisma.contact.create({
      data: {
        name: 'Expired Consent Contact',
        phoneNumber: '+64217770004',
        isDoNotCall: false,
        consentStatus: ConsentStatus.EXPIRED
      }
    });
    testContactExpiredId = cExpired.id;

    const cDnc = await prisma.contact.create({
      data: {
        name: 'DNC Direct Contact',
        phoneNumber: '+64217770005',
        isDoNotCall: true,
        consentStatus: ConsentStatus.GRANTED
      }
    });
    testContactDncId = cDnc.id;

    // Shared number contacts
    const cShared1 = await prisma.contact.create({
      data: {
        name: 'Shared Phone Contact 1',
        phoneNumber: sharedPhoneNumber,
        isDoNotCall: false,
        consentStatus: ConsentStatus.GRANTED
      }
    });
    testSharedNumberContact1Id = cShared1.id;

    const cShared2 = await prisma.contact.create({
      data: {
        name: 'Shared Phone Contact 2',
        phoneNumber: sharedPhoneNumber,
        isDoNotCall: false,
        consentStatus: ConsentStatus.GRANTED
      }
    });
    testSharedNumberContact2Id = cShared2.id;
  });

  afterAll(async () => {
    if (testCampaignId) {
      await prisma.callResponse.deleteMany({ where: { callAttempt: { callJob: { campaignId: testCampaignId } } } });
      await prisma.callEvent.deleteMany({ where: { callAttempt: { callJob: { campaignId: testCampaignId } } } });
      await prisma.callAttempt.deleteMany({ where: { callJob: { campaignId: testCampaignId } } });
      await prisma.retryLog.deleteMany({ where: { callJob: { campaignId: testCampaignId } } });
      await prisma.callJob.deleteMany({ where: { campaignId: testCampaignId } });
      await prisma.campaignContact.deleteMany({ where: { campaignId: testCampaignId } });
      await prisma.campaign.deleteMany({ where: { id: testCampaignId } });
    }
    if (testQuestionnaireId) {
      await prisma.questionOption.deleteMany({ where: { question: { questionnaireId: testQuestionnaireId } } });
      await prisma.question.deleteMany({ where: { questionnaireId: testQuestionnaireId } });
      await prisma.questionnaire.deleteMany({ where: { id: testQuestionnaireId } });
    }
    const contactIds = [
      testContactGrantedId,
      testContactPendingId,
      testContactRevokedId,
      testContactExpiredId,
      testContactDncId,
      testSharedNumberContact1Id,
      testSharedNumberContact2Id
    ].filter(Boolean);
    if (contactIds.length > 0) {
      await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
    }
    await prisma.dncRecord.deleteMany({ where: { phoneNumber: sharedPhoneNumber } });
  });

  // =========================================================================
  // 1. DUPLICATE CALL / IDEMPOTENCY ATTACKS
  // =========================================================================
  describe('1. Duplicate Call & Idempotency Hardening', () => {
    it('Scenario A: Duplicate campaign start should not create duplicate CallJobs', async () => {
      // Create fresh draft campaign with 1 contact
      const draftCamp = await prisma.campaign.create({
        data: {
          name: 'Concurrent Start Test',
          status: CampaignStatus.DRAFT,
          callerId: '+6498370000',
          questionnaireId: testQuestionnaireId,
          callingStartTime: '00:00',
          callingEndTime: '23:59',
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6]
        }
      });

      await prisma.campaignContact.create({
        data: {
          campaignId: draftCamp.id,
          contactId: testContactGrantedId,
          status: 'INCLUDED'
        }
      });

      // Send 2 simultaneous transitions to RUNNING
      const [res1, res2] = await Promise.allSettled([
        transitionCampaignStatus(draftCamp.id, CampaignStatus.RUNNING),
        transitionCampaignStatus(draftCamp.id, CampaignStatus.RUNNING)
      ]);

      // At least one must succeed; total CallJobs created must be exactly 1
      const jobs = await prisma.callJob.findMany({
        where: { campaignId: draftCamp.id }
      });

      expect(jobs.length).toBe(1);

      // Clean up
      await prisma.callJob.deleteMany({ where: { campaignId: draftCamp.id } });
      await prisma.campaignContact.deleteMany({ where: { campaignId: draftCamp.id } });
      await prisma.campaign.deleteMany({ where: { id: draftCamp.id } });
    });

    it('Scenario B & C: Worker atomic reservation prevents duplicate call attempt creation on duplicate worker claims', async () => {
      const job = await prisma.callJob.create({
        data: {
          campaignId: testCampaignId,
          contactId: testContactGrantedId,
          status: CallJobStatus.PENDING,
          attempts: 0
        }
      });

      const mockJobPayload: any = {
        id: `bullmq-job-${job.id}`,
        data: {
          campaignId: testCampaignId,
          contactId: testContactGrantedId,
          callJobId: job.id,
          attemptNumber: 1
        }
      };

      // Execute 2 concurrent worker runs on the same CallJob
      const [workerResult1, workerResult2] = await Promise.all([
        callWorker.processCallJob(mockJobPayload),
        callWorker.processCallJob(mockJobPayload)
      ]);

      // Exactly one must succeed and create an attempt; the second must be rejected
      const successfulRuns = [workerResult1, workerResult2].filter((r) => r.success);
      expect(successfulRuns.length).toBe(1);

      const attempts = await prisma.callAttempt.findMany({
        where: { callJobId: job.id }
      });
      expect(attempts.length).toBe(1);

      // Clean up
      await prisma.callEvent.deleteMany({ where: { callAttemptId: attempts[0].id } });
      await prisma.callAttempt.deleteMany({ where: { id: attempts[0].id } });
      await prisma.callJob.deleteMany({ where: { id: job.id } });
    });
  });

  // =========================================================================
  // 2. CONCURRENCY & LIMITS
  // =========================================================================
  describe('2. Concurrency & Limits Hardening', () => {
    it('should strictly block dial when active concurrent calls reaches maxConcurrentCalls (5)', async () => {
      const job = await prisma.callJob.create({
        data: {
          campaignId: testCampaignId,
          contactId: testContactGrantedId,
          status: CallJobStatus.PENDING
        }
      });

      // Create 5 active attempts in progress for this campaign
      const activeAttemptIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const dummyJob = await prisma.callJob.create({
          data: { campaignId: testCampaignId, contactId: testContactGrantedId, status: CallJobStatus.DISPATCHED }
        });
        const att = await prisma.callAttempt.create({
          data: { callJobId: dummyJob.id, status: CallStatus.IN_PROGRESS }
        });
        activeAttemptIds.push(att.id);
      }

      // Check pre-dial safety for a 6th attempt
      const result = await performPreDialSafetyCheck(testCampaignId, testContactGrantedId, job.id);
      expect(result.canDial).toBe(false);
      expect(result.code).toBe('CONCURRENCY_LIMIT_REACHED');

      // Clean up active dummy attempts
      await prisma.callAttempt.deleteMany({ where: { id: { in: activeAttemptIds } } });
      await prisma.callJob.deleteMany({ where: { id: job.id } });
    });

    it('should strictly block dial when budget / maxCost cap is reached', async () => {
      // Temporarily set campaign maxCost to $0.50
      await prisma.campaign.update({
        where: { id: testCampaignId },
        data: { maxCost: 0.50 }
      });

      // Create a completed attempt with 200 seconds ($1.00 cost)
      const dummyJob = await prisma.callJob.create({
        data: { campaignId: testCampaignId, contactId: testContactGrantedId, status: CallJobStatus.COMPLETED }
      });
      const att = await prisma.callAttempt.create({
        data: { callJobId: dummyJob.id, status: CallStatus.COMPLETED, durationSeconds: 200 }
      });

      const nextJob = await prisma.callJob.create({
        data: { campaignId: testCampaignId, contactId: testContactGrantedId, status: CallJobStatus.PENDING }
      });

      const result = await performPreDialSafetyCheck(testCampaignId, testContactGrantedId, nextJob.id);
      expect(result.canDial).toBe(false);
      expect(result.code).toBe('MAX_COST_REACHED');

      // Restore campaign maxCost
      await prisma.campaign.update({
        where: { id: testCampaignId },
        data: { maxCost: 100.0 }
      });

      await prisma.callAttempt.deleteMany({ where: { id: att.id } });
      await prisma.callJob.deleteMany({ where: { id: dummyJob.id } });
      await prisma.callJob.deleteMany({ where: { id: nextJob.id } });
    });
  });

  // =========================================================================
  // 3. STRICT CONSENT ENFORCEMENT
  // =========================================================================
  describe('3. Strict Consent Enforcement Hardening', () => {
    it('should ALLOW dialing for GRANTED consent', async () => {
      const job = await prisma.callJob.create({
        data: { campaignId: testCampaignId, contactId: testContactGrantedId, status: CallJobStatus.PENDING }
      });
      const result = await performPreDialSafetyCheck(testCampaignId, testContactGrantedId, job.id);
      expect(result.canDial).toBe(true);
      expect(result.code).toBe('OK');
      await prisma.callJob.deleteMany({ where: { id: job.id } });
    });

    it('should STRICTLY BLOCK dialing for PENDING consent', async () => {
      const job = await prisma.callJob.create({
        data: { campaignId: testCampaignId, contactId: testContactPendingId, status: CallJobStatus.PENDING }
      });
      const result = await performPreDialSafetyCheck(testCampaignId, testContactPendingId, job.id);
      expect(result.canDial).toBe(false);
      expect(result.code).toBe('CONSENT_REVOKED');
      expect(result.reason).toContain('Explicit GRANTED consent is required');
      await prisma.callJob.deleteMany({ where: { id: job.id } });
    });

    it('should STRICTLY BLOCK dialing for REVOKED consent', async () => {
      const job = await prisma.callJob.create({
        data: { campaignId: testCampaignId, contactId: testContactRevokedId, status: CallJobStatus.PENDING }
      });
      const result = await performPreDialSafetyCheck(testCampaignId, testContactRevokedId, job.id);
      expect(result.canDial).toBe(false);
      expect(result.code).toBe('CONSENT_REVOKED');
      await prisma.callJob.deleteMany({ where: { id: job.id } });
    });

    it('should STRICTLY BLOCK dialing for EXPIRED consent', async () => {
      const job = await prisma.callJob.create({
        data: { campaignId: testCampaignId, contactId: testContactExpiredId, status: CallJobStatus.PENDING }
      });
      const result = await performPreDialSafetyCheck(testCampaignId, testContactExpiredId, job.id);
      expect(result.canDial).toBe(false);
      expect(result.code).toBe('CONSENT_REVOKED');
      await prisma.callJob.deleteMany({ where: { id: job.id } });
    });
  });

  // =========================================================================
  // 4. DNC PRE-DIAL RE-CHECK & SHARED PHONE SUPPRESSION
  // =========================================================================
  describe('4. DNC Pre-Dial & Multi-Contact Registry Suppression', () => {
    it('should immediately block dial if contact is added to DNC after job was queued', async () => {
      const job = await prisma.callJob.create({
        data: { campaignId: testCampaignId, contactId: testContactGrantedId, status: CallJobStatus.PENDING }
      });

      // Contact is updated to isDoNotCall=true while job in queue
      await prisma.contact.update({
        where: { id: testContactGrantedId },
        data: { isDoNotCall: true }
      });

      const result = await performPreDialSafetyCheck(testCampaignId, testContactGrantedId, job.id);
      expect(result.canDial).toBe(false);
      expect(result.code).toBe('DNC_SUPPRESSED');

      // Restore contact
      await prisma.contact.update({
        where: { id: testContactGrantedId },
        data: { isDoNotCall: false }
      });
      await prisma.callJob.deleteMany({ where: { id: job.id } });
    });

    it('should block dial for ALL contacts sharing a phone number if number is added to DNC registry', async () => {
      // Add sharedPhoneNumber to DNC registry
      await prisma.dncRecord.create({
        data: {
          phoneNumber: sharedPhoneNumber,
          reason: 'Hardening multi-contact test',
          source: 'TEST'
        }
      });

      const job1 = await prisma.callJob.create({
        data: { campaignId: testCampaignId, contactId: testSharedNumberContact1Id, status: CallJobStatus.PENDING }
      });
      const job2 = await prisma.callJob.create({
        data: { campaignId: testCampaignId, contactId: testSharedNumberContact2Id, status: CallJobStatus.PENDING }
      });

      const result1 = await performPreDialSafetyCheck(testCampaignId, testSharedNumberContact1Id, job1.id);
      const result2 = await performPreDialSafetyCheck(testCampaignId, testSharedNumberContact2Id, job2.id);

      expect(result1.canDial).toBe(false);
      expect(result1.code).toBe('DNC_SUPPRESSED');

      expect(result2.canDial).toBe(false);
      expect(result2.code).toBe('DNC_SUPPRESSED');

      await prisma.callJob.deleteMany({ where: { id: { in: [job1.id, job2.id] } } });
      await prisma.dncRecord.deleteMany({ where: { phoneNumber: sharedPhoneNumber } });
    });
  });

  // =========================================================================
  // 5. PAUSE, CANCEL & EMERGENCY STOP HARDENING
  // =========================================================================
  describe('5. Pause, Cancel & Emergency Stop Hardening', () => {
    it('should reject dialing if campaign is PAUSED while job in queue', async () => {
      const job = await prisma.callJob.create({
        data: { campaignId: testCampaignId, contactId: testContactGrantedId, status: CallJobStatus.PENDING }
      });

      await prisma.campaign.update({
        where: { id: testCampaignId },
        data: { status: CampaignStatus.PAUSED }
      });

      const result = await performPreDialSafetyCheck(testCampaignId, testContactGrantedId, job.id);
      expect(result.canDial).toBe(false);
      expect(result.code).toBe('CAMPAIGN_NOT_RUNNING');

      // Restore RUNNING
      await prisma.campaign.update({
        where: { id: testCampaignId },
        data: { status: CampaignStatus.RUNNING }
      });
      await prisma.callJob.deleteMany({ where: { id: job.id } });
    });

    it('Emergency Stop: Pauses all running campaigns and prevents any subsequent dial execution', async () => {
      const job = await prisma.callJob.create({
        data: { campaignId: testCampaignId, contactId: testContactGrantedId, status: CallJobStatus.PENDING }
      });

      // Execute Emergency Stop
      const stopResult = await emergencyStopAllCampaigns({ reason: 'Security Hardening Test' });
      expect(stopResult.stoppedCount).toBeGreaterThanOrEqual(1);

      // Verify campaign is now PAUSED in DB
      const updatedCamp = await prisma.campaign.findUnique({ where: { id: testCampaignId } });
      expect(updatedCamp?.status).toBe(CampaignStatus.PAUSED);

      // Worker pre-dial check must now strictly reject
      const result = await performPreDialSafetyCheck(testCampaignId, testContactGrantedId, job.id);
      expect(result.canDial).toBe(false);
      expect(result.code).toBe('CAMPAIGN_NOT_RUNNING');

      // Restore RUNNING
      await prisma.campaign.update({
        where: { id: testCampaignId },
        data: { status: CampaignStatus.RUNNING }
      });
      await prisma.callJob.deleteMany({ where: { id: job.id } });
    });
  });

  // =========================================================================
  // 6. WEBHOOK IDEMPOTENCY & OUT-OF-ORDER EVENT ORDERING
  // =========================================================================
  describe('6. Webhook Idempotency & Out-of-Order Safety', () => {
    it('should ignore late non-terminal webhook when call is already in terminal status (COMPLETED)', async () => {
      const job = await prisma.callJob.create({
        data: { campaignId: testCampaignId, contactId: testContactGrantedId, status: CallJobStatus.DISPATCHED }
      });

      const attempt = await prisma.callAttempt.create({
        data: {
          callJobId: job.id,
          status: CallStatus.COMPLETED,
          durationSeconds: 45,
          providerCallId: 'CA_HARDENING_TERMINAL_001'
        }
      });

      // Receive a late "in-progress" status webhook callback
      await voiceWebhookService.handleStatusCallback(attempt.id, {
        CallSid: 'CA_HARDENING_TERMINAL_001',
        CallStatus: 'in-progress',
        SequenceNumber: '99'
      });

      // Status must remain COMPLETED and not regress to IN_PROGRESS
      const rechecked = await prisma.callAttempt.findUnique({
        where: { id: attempt.id }
      });
      expect(rechecked?.status).toBe(CallStatus.COMPLETED);
      expect(rechecked?.durationSeconds).toBe(45);

      // Clean up
      await prisma.callEvent.deleteMany({ where: { callAttemptId: attempt.id } });
      await prisma.callAttempt.deleteMany({ where: { id: attempt.id } });
      await prisma.callJob.deleteMany({ where: { id: job.id } });
    });

    it('should deduplicate webhook events with same providerEventId', async () => {
      const job = await prisma.callJob.create({
        data: { campaignId: testCampaignId, contactId: testContactGrantedId, status: CallJobStatus.DISPATCHED }
      });

      const attempt = await prisma.callAttempt.create({
        data: {
          callJobId: job.id,
          status: CallStatus.IN_PROGRESS,
          providerCallId: 'CA_HARDENING_DEDUP_001'
        }
      });

      const payload = {
        CallSid: 'CA_HARDENING_DEDUP_001',
        CallStatus: 'completed',
        CallDuration: '30',
        SequenceNumber: '1'
      };

      // Send twice
      await voiceWebhookService.handleStatusCallback(attempt.id, payload);
      await voiceWebhookService.handleStatusCallback(attempt.id, payload);

      // Verify only 1 TWILIO_COMPLETED event is recorded
      const events = await prisma.callEvent.findMany({
        where: {
          callAttemptId: attempt.id,
          eventType: 'TWILIO_COMPLETED'
        }
      });
      expect(events.length).toBe(1);

      // Clean up
      await prisma.callEvent.deleteMany({ where: { callAttemptId: attempt.id } });
      await prisma.callAttempt.deleteMany({ where: { id: attempt.id } });
      await prisma.callJob.deleteMany({ where: { id: job.id } });
    });
  });

  // =========================================================================
  // 7. RETRY DEDUPLICATION & COMPLETED CALL PROTECTION
  // =========================================================================
  describe('7. Retry Deduplication & Completed Call Protection', () => {
    it('should NEVER schedule a retry for a COMPLETED call', async () => {
      const job = await prisma.callJob.create({
        data: { campaignId: testCampaignId, contactId: testContactGrantedId, status: CallJobStatus.DISPATCHED, attempts: 1 }
      });

      const attempt = await prisma.callAttempt.create({
        data: { callJobId: job.id, status: CallStatus.COMPLETED, durationSeconds: 60 }
      });

      const retryRes = await evaluateAndScheduleRetry(attempt.id, CallStatus.COMPLETED);
      expect(retryRes.shouldRetry).toBe(false);
      expect(retryRes.reason).toContain('completed successfully');

      const updatedJob = await prisma.callJob.findUnique({ where: { id: job.id } });
      expect(updatedJob?.status).toBe(CallJobStatus.COMPLETED);

      await prisma.callAttempt.deleteMany({ where: { id: attempt.id } });
      await prisma.callJob.deleteMany({ where: { id: job.id } });
    });

    it('should prevent duplicate retry scheduling for the same attempt number', async () => {
      const job = await prisma.callJob.create({
        data: { campaignId: testCampaignId, contactId: testContactGrantedId, status: CallJobStatus.DISPATCHED, attempts: 1 }
      });

      const attempt = await prisma.callAttempt.create({
        data: { callJobId: job.id, status: CallStatus.BUSY }
      });

      // Schedule retry #1
      const retry1 = await evaluateAndScheduleRetry(attempt.id, CallStatus.BUSY, 'BUSY');
      expect(retry1.shouldRetry).toBe(true);

      // Duplicate schedule attempt
      const retry2 = await evaluateAndScheduleRetry(attempt.id, CallStatus.BUSY, 'BUSY');
      expect(retry2.shouldRetry).toBe(false);
      expect(retry2.reason).toContain('already scheduled');

      // Verify only 1 retry log exists
      const logs = await prisma.retryLog.findMany({
        where: { callJobId: job.id }
      });
      expect(logs.length).toBe(1);

      await prisma.retryLog.deleteMany({ where: { callJobId: job.id } });
      await prisma.callAttempt.deleteMany({ where: { id: attempt.id } });
      await prisma.callJob.deleteMany({ where: { id: job.id } });
    });
  });

  // =========================================================================
  // 8. AUTHORIZATION & RBAC ON TELEPHONY CONTROLS
  // =========================================================================
  describe('8. Telephony Authorization & RBAC', () => {
    it('should reject unauthenticated calls to start campaign', async () => {
      const res = await request(app).post(`/api/campaigns/${testCampaignId}/start`);
      expect(res.status).toBe(401);
    });

    it('should reject unauthenticated calls to emergency stop', async () => {
      const res = await request(app).post('/api/campaigns/emergency-stop');
      expect(res.status).toBe(401);
    });

    it('should reject operator role from calling emergency stop (requires ADMIN/SUPER_ADMIN)', async () => {
      const res = await request(app)
        .post('/api/campaigns/emergency-stop')
        .set('Authorization', `Bearer ${operatorToken}`);
      expect(res.status).toBe(403);
    });

    it('should allow admin role to execute emergency stop', async () => {
      const res = await request(app)
        .post('/api/campaigns/emergency-stop')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
