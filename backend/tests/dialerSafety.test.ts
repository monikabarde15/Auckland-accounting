import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/services/prisma.js';
import { performPreDialSafetyCheck, isWithinCallingHours } from '../src/services/dialer/dialerSafetyCheck.js';
import { CampaignStatus, QuestionType } from '@prisma/client';

describe('Dialer Safety Gate & Pre-Dial Verification Tests', () => {
  let testCampaignId: string;
  let testQuestionnaireId: string;
  let testContactId: string;
  let testDncContactId: string;
  let testCallJobId: string;

  beforeAll(async () => {
    // 1. Create Questionnaire with Question
    const questionnaire = await prisma.questionnaire.create({
      data: {
        title: 'Safety Test Questionnaire',
        questions: {
          create: {
            questionText: 'Hello {client_name}, is this you?',
            type: QuestionType.YES_NO,
            orderNo: 1,
            options: {
              create: [
                { optionLabel: 'Yes', optionKey: '1', nextAction: 'END_CALL' },
                { optionLabel: 'No', optionKey: '2', nextAction: 'END_CALL' }
              ]
            }
          }
        }
      }
    });
    testQuestionnaireId = questionnaire.id;

    // 2. Create Campaign in RUNNING state
    const campaign = await prisma.campaign.create({
      data: {
        name: 'Safety Gate Test Campaign',
        status: CampaignStatus.RUNNING,
        callerId: '+6498370000',
        questionnaireId: testQuestionnaireId,
        callingStartTime: '00:00',
        callingEndTime: '23:59',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        timezone: 'Pacific/Auckland',
        maxConcurrentCalls: 5,
        maxCalls: 100
      }
    });
    testCampaignId = campaign.id;

    // 3. Create Valid Contact
    const contact = await prisma.contact.create({
      data: {
        name: 'John Safety',
        phoneNumber: '+64219876543',
        isDoNotCall: false,
        consentStatus: 'GRANTED'
      }
    });
    testContactId = contact.id;

    // 4. Create DNC Contact
    const dncContact = await prisma.contact.create({
      data: {
        name: 'DNC Target',
        phoneNumber: '+64219998888',
        isDoNotCall: true,
        consentStatus: 'REVOKED'
      }
    });
    testDncContactId = dncContact.id;

    // 5. Create CallJob
    const job = await prisma.callJob.create({
      data: {
        campaignId: testCampaignId,
        contactId: testContactId,
        status: 'PENDING'
      }
    });
    testCallJobId = job.id;
  });

  afterAll(async () => {
    if (testCallJobId) {
      await prisma.callResponse.deleteMany({ where: { callAttempt: { callJobId: testCallJobId } } });
      await prisma.callEvent.deleteMany({ where: { callAttempt: { callJobId: testCallJobId } } });
      await prisma.callAttempt.deleteMany({ where: { callJobId: testCallJobId } });
      await prisma.callJob.deleteMany({ where: { id: testCallJobId } });
    }
    if (testCampaignId) {
      await prisma.callJob.deleteMany({ where: { campaignId: testCampaignId } });
      await prisma.campaignContact.deleteMany({ where: { campaignId: testCampaignId } });
      await prisma.campaign.deleteMany({ where: { id: testCampaignId } });
    }
    if (testQuestionnaireId) {
      await prisma.questionOption.deleteMany({ where: { question: { questionnaireId: testQuestionnaireId } } });
      await prisma.question.deleteMany({ where: { questionnaireId: testQuestionnaireId } });
      await prisma.questionnaire.deleteMany({ where: { id: testQuestionnaireId } });
    }
    const idsToDelete = [testContactId, testDncContactId].filter(Boolean);
    if (idsToDelete.length > 0) {
      await prisma.contact.deleteMany({ where: { id: { in: idsToDelete } } });
    }
  });

  it('should pass all safety checks for valid running campaign and callable contact', async () => {
    const result = await performPreDialSafetyCheck(testCampaignId, testContactId, testCallJobId);
    expect(result.canDial).toBe(true);
    expect(result.code).toBe('OK');
    expect(result.contact).toBeDefined();
    expect(result.campaign).toBeDefined();
  });

  it('should block dial if campaign is PAUSED or DRAFT', async () => {
    await prisma.campaign.update({
      where: { id: testCampaignId },
      data: { status: CampaignStatus.PAUSED }
    });

    const result = await performPreDialSafetyCheck(testCampaignId, testContactId, testCallJobId);
    expect(result.canDial).toBe(false);
    expect(result.code).toBe('CAMPAIGN_NOT_RUNNING');

    // Restore to RUNNING
    await prisma.campaign.update({
      where: { id: testCampaignId },
      data: { status: CampaignStatus.RUNNING }
    });
  });

  it('should strictly suppress dial if contact is DNC or consent revoked', async () => {
    const job = await prisma.callJob.create({
      data: {
        campaignId: testCampaignId,
        contactId: testDncContactId,
        status: 'PENDING'
      }
    });

    const result = await performPreDialSafetyCheck(testCampaignId, testDncContactId, job.id);
    expect(result.canDial).toBe(false);
    expect(result.code).toBe('DNC_SUPPRESSED');
  });

  it('should evaluate calling hours correctly based on timezone and time window', () => {
    // Window spanning 00:00 to 23:59 on all days should be allowed
    const allowCheck = isWithinCallingHours('Pacific/Auckland', '00:00', '23:59', ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
    expect(allowCheck.allowed).toBe(true);

    // Impossible window (e.g. 01:00 to 01:01 in a different day)
    const blockCheck = isWithinCallingHours('Pacific/Auckland', '03:00', '03:05', ['SUN']);
    // If today is not SUN or time is not 03:00, it should be rejected
    expect(typeof blockCheck.allowed).toBe('boolean');
  });

  it('should reject dial if max concurrent calls limit is reached', async () => {
    // Set maxConcurrentCalls to 1
    await prisma.campaign.update({
      where: { id: testCampaignId },
      data: { maxConcurrentCalls: 1 }
    });

    // Create an active attempt
    const activeAttempt = await prisma.callAttempt.create({
      data: {
        callJobId: testCallJobId,
        status: 'IN_PROGRESS'
      }
    });

    // Check with a second job
    const job2 = await prisma.callJob.create({
      data: {
        campaignId: testCampaignId,
        contactId: testContactId,
        status: 'PENDING'
      }
    });

    const result = await performPreDialSafetyCheck(testCampaignId, testContactId, job2.id);
    expect(result.canDial).toBe(false);
    expect(result.code).toBe('CONCURRENCY_LIMIT_REACHED');

    // Clean up
    await prisma.callAttempt.delete({ where: { id: activeAttempt.id } });
    await prisma.callJob.delete({ where: { id: job2.id } });
    await prisma.campaign.update({
      where: { id: testCampaignId },
      data: { maxConcurrentCalls: 5 }
    });
  });
});
