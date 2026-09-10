import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { QuestionType, CampaignStatus, CallStatus, CallJobStatus } from '@prisma/client';

describe('Twilio Voice Webhook & Idempotency Tests', () => {
  const app = createApp();
  let testCampaignId: string;
  let testQuestionnaireId: string;
  let testQuestionId: string;
  let testContactId: string;
  let testCallJobId: string;
  let testCallAttemptId: string;

  beforeAll(async () => {
    const questionnaire = await prisma.questionnaire.create({
      data: {
        title: 'Webhook Test Questionnaire',
        questions: {
          create: {
            questionText: 'Press 1 for Sales, 2 for Support',
            type: QuestionType.MULTIPLE_CHOICE,
            orderNo: 1,
            options: {
              create: [
                { optionLabel: 'Sales', optionKey: '1', nextAction: 'END_CALL' },
                { optionLabel: 'Support', optionKey: '2', nextAction: 'END_CALL' }
              ]
            }
          }
        }
      },
      include: { questions: true }
    });
    testQuestionnaireId = questionnaire.id;
    testQuestionId = questionnaire.questions[0].id;

    const campaign = await prisma.campaign.create({
      data: {
        name: 'Webhook Test Campaign',
        status: CampaignStatus.RUNNING,
        callerId: '+6498370000',
        questionnaireId: testQuestionnaireId
      }
    });
    testCampaignId = campaign.id;

    const contact = await prisma.contact.create({
      data: {
        name: 'Webhook Tester',
        phoneNumber: '+64214445555',
        isDoNotCall: false,
        consentStatus: 'GRANTED'
      }
    });
    testContactId = contact.id;

    const job = await prisma.callJob.create({
      data: {
        campaignId: testCampaignId,
        contactId: testContactId,
        status: CallJobStatus.DISPATCHED
      }
    });
    testCallJobId = job.id;

    const attempt = await prisma.callAttempt.create({
      data: {
        callJobId: testCallJobId,
        status: CallStatus.INITIATED
      }
    });
    testCallAttemptId = attempt.id;
  });

  afterAll(async () => {
    if (testCallAttemptId) {
      await prisma.callResponse.deleteMany({ where: { callAttemptId: testCallAttemptId } });
      await prisma.callEvent.deleteMany({ where: { callAttemptId: testCallAttemptId } });
      await prisma.callAttempt.deleteMany({ where: { id: testCallAttemptId } });
    }
    if (testCallJobId) {
      await prisma.callJob.deleteMany({ where: { id: testCallJobId } });
    }
    if (testCampaignId) {
      await prisma.campaign.deleteMany({ where: { id: testCampaignId } });
    }
    if (testQuestionnaireId) {
      await prisma.questionOption.deleteMany({ where: { question: { questionnaireId: testQuestionnaireId } } });
      await prisma.question.deleteMany({ where: { questionnaireId: testQuestionnaireId } });
      await prisma.questionnaire.deleteMany({ where: { id: testQuestionnaireId } });
    }
    if (testContactId) {
      await prisma.contact.deleteMany({ where: { id: testContactId } });
    }
  });

  it('POST /api/voice/twiml should return valid XML TwiML and transition call attempt to IN_PROGRESS', async () => {
    const res = await request(app)
      .post('/api/voice/twiml')
      .query({ callAttemptId: testCallAttemptId })
      .send({ CallSid: 'CA_TEST_TWIML_001', CallStatus: 'in-progress' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/xml');
    expect(res.text).toContain('<Response>');
    expect(res.text).toContain('<Gather');

    const updated = await prisma.callAttempt.findUnique({
      where: { id: testCallAttemptId }
    });
    expect(updated?.status).toBe(CallStatus.IN_PROGRESS);
  });

  it('POST /api/voice/gather should handle DTMF and branch to next action', async () => {
    const res = await request(app)
      .post('/api/voice/gather')
      .query({ callAttemptId: testCallAttemptId, questionId: testQuestionId })
      .send({ Digits: '1' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/xml');
    expect(res.text).toContain('Thank you for your response');
    expect(res.text).toContain('<Hangup/>');
  });

  it('POST /api/voice/status should idempotently process status callbacks and avoid duplicate events', async () => {
    const payload = {
      CallSid: 'CA_TEST_STATUS_001',
      CallStatus: 'completed',
      CallDuration: '45',
      SequenceNumber: '1'
    };

    // First Delivery
    const res1 = await request(app)
      .post('/api/voice/status')
      .query({ callAttemptId: testCallAttemptId })
      .send(payload);

    expect(res1.status).toBe(200);

    const attempt = await prisma.callAttempt.findUnique({
      where: { id: testCallAttemptId }
    });
    expect(attempt?.status).toBe(CallStatus.COMPLETED);
    expect(attempt?.durationSeconds).toBe(45);

    // Duplicate Delivery (same CallSid & SequenceNumber)
    const res2 = await request(app)
      .post('/api/voice/status')
      .query({ callAttemptId: testCallAttemptId })
      .send(payload);

    expect(res2.status).toBe(200);

    // Ensure only 1 completed event was created
    const events = await prisma.callEvent.findMany({
      where: {
        callAttemptId: testCallAttemptId,
        eventType: 'TWILIO_COMPLETED'
      }
    });
    expect(events.length).toBe(1);
  });
});
