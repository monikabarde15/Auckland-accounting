import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { CampaignStatus, CallStatus, CallJobStatus, QuestionType } from '@prisma/client';
import { sanitizeCsvCell, calculateCallCost } from '../src/services/reportService.js';

describe('Reports & Analytics API Suite (Phase 6)', () => {
  const app = createApp();
  let adminToken: string;
  let operatorToken: string;

  let testCampaignId: string;
  let testContactId: string;
  let testQuestionnaireId: string;
  let testQuestionId: string;
  let testCallJobId: string;
  let testAttemptCompletedId: string;
  let testAttemptBusyId: string;

  beforeAll(async () => {
    // 1. Auth logins
    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@aucklandaccounting.co.nz', password: 'AculaAdmin2026!' });
    adminToken = adminRes.body.data.accessToken;

    const opRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'operator@aucklandaccounting.co.nz', password: 'AculaOperator2026!' });
    operatorToken = opRes.body.data.accessToken;

    // 2. Create Questionnaire & Question
    const questionnaire = await prisma.questionnaire.create({
      data: {
        title: 'Reports Analytics Test Survey',
        category: 'Tax & Compliance',
        questions: {
          create: {
            questionText: 'Have you filed your GST returns for this period?',
            name: 'GST Filing Step',
            type: QuestionType.MULTIPLE_CHOICE,
            orderNo: 1,
            options: {
              create: [
                { optionKey: '1', optionLabel: 'Filed Already' },
                { optionKey: '2', optionLabel: 'Need Assistance' }
              ]
            }
          }
        }
      },
      include: { questions: true }
    });
    testQuestionnaireId = questionnaire.id;
    testQuestionId = questionnaire.questions[0].id;

    // 3. Create Campaign
    const campaign = await prisma.campaign.create({
      data: {
        name: 'Phase 6 Test Campaign',
        status: CampaignStatus.RUNNING,
        callerId: '+6498370000',
        maxCost: 100.0,
        questionnaireId: testQuestionnaireId
      }
    });
    testCampaignId = campaign.id;

    // 4. Create Contact
    const contact = await prisma.contact.create({
      data: {
        name: '=CmdTest Contact', // Test CSV formula injection defense
        companyName: 'Auckland Business Ltd',
        phoneNumber: '+64219998888'
      }
    });
    testContactId = contact.id;

    // 5. Create Call Jobs & Attempts
    const job = await prisma.callJob.create({
      data: {
        campaignId: testCampaignId,
        contactId: testContactId,
        status: CallJobStatus.COMPLETED
      }
    });
    testCallJobId = job.id;

    // Completed Call Attempt
    const attemptComp = await prisma.callAttempt.create({
      data: {
        callJobId: testCallJobId,
        status: CallStatus.COMPLETED,
        durationSeconds: 150, // 2.5 min => 3 min billed = $0.12
        startedAt: new Date()
      }
    });
    testAttemptCompletedId = attemptComp.id;

    // Record response
    await prisma.callResponse.create({
      data: {
        callAttemptId: testAttemptCompletedId,
        questionId: testQuestionId,
        responseValue: '1',
        responseText: 'Filed Already'
      }
    });

    // Busy Call Attempt
    const attemptBusy = await prisma.callAttempt.create({
      data: {
        callJobId: testCallJobId,
        status: CallStatus.BUSY,
        durationSeconds: 15,
        startedAt: new Date()
      }
    });
    testAttemptBusyId = attemptBusy.id;

    // Retry Log
    await prisma.retryLog.create({
      data: {
        callJobId: testCallJobId,
        attemptNumber: 2,
        reason: 'BUSY',
        scheduledRetryAt: new Date(Date.now() + 3600000)
      }
    });
  });

  afterAll(async () => {
    if (testCallJobId) {
      await prisma.callResponse.deleteMany({ where: { callAttempt: { callJobId: testCallJobId } } });
      await prisma.retryLog.deleteMany({ where: { callJobId: testCallJobId } });
      await prisma.callAttempt.deleteMany({ where: { callJobId: testCallJobId } });
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

  describe('CSV Sanitization Unit Logic', () => {
    it('should prefix dangerous formula triggers with a single quote', () => {
      expect(sanitizeCsvCell('=SUM(A1:A10)')).toBe('"\'=SUM(A1:A10)"');
      expect(sanitizeCsvCell('+cmd|')).toBe('"\' +cmd|"'.replace(' ', ''));
      expect(sanitizeCsvCell('-100')).toBe('"\' -100"'.replace(' ', ''));
      expect(sanitizeCsvCell('@trigger')).toBe('"\'@trigger"');
    });

    it('should correctly escape quotes and normal strings', () => {
      expect(sanitizeCsvCell('Normal Text')).toBe('"Normal Text"');
      expect(sanitizeCsvCell('Hello "World"')).toBe('"Hello ""World"""');
      expect(sanitizeCsvCell(null)).toBe('""');
    });
  });

  describe('Call Cost Calculation Unit Logic', () => {
    it('should calculate $0.04 per minute or fraction thereof', () => {
      expect(calculateCallCost(0)).toBe(0);
      expect(calculateCallCost(10)).toBe(0.04);
      expect(calculateCallCost(60)).toBe(0.04);
      expect(calculateCallCost(61)).toBe(0.08);
      expect(calculateCallCost(120)).toBe(0.08);
      expect(calculateCallCost(150)).toBe(0.12);
    });
  });

  describe('GET /api/reports/summary', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/reports/summary');
      expect(res.status).toBe(401);
    });

    it('should return summary metrics for Admin', async () => {
      const res = await request(app)
        .get('/api/reports/summary')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.overview).toBeDefined();
      expect(res.body.data.overview.totalCallsPlaced).toBeGreaterThanOrEqual(2);
      expect(res.body.data.overview.completedCalls).toBeGreaterThanOrEqual(1);
      expect(res.body.data.overview.busyCalls).toBeGreaterThanOrEqual(1);
      expect(res.body.data.outcomes).toBeDefined();
      expect(res.body.data.hourlyVolume).toBeDefined();
      expect(res.body.data.suppression).toBeDefined();
      expect(res.body.data.retries).toBeDefined();
    });

    it('should allow Operator to read summary metrics', async () => {
      const res = await request(app)
        .get('/api/reports/summary')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.overview).toBeDefined();
    });

    it('should filter summary by campaignId', async () => {
      const res = await request(app)
        .get('/api/reports/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ campaignId: testCampaignId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.overview.totalCallsPlaced).toBe(2);
      expect(res.body.data.overview.completedCalls).toBe(1);
      expect(res.body.data.overview.busyCalls).toBe(1);
    });
  });

  describe('GET /api/reports/campaigns/:id', () => {
    it('should return 404 for non-existent campaign ID', async () => {
      const res = await request(app)
        .get('/api/reports/campaigns/non-existent-campaign-id')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('should return detailed campaign report with questionnaire responses breakdown', async () => {
      const res = await request(app)
        .get(`/api/reports/campaigns/${testCampaignId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.campaign.name).toBe('Phase 6 Test Campaign');
      expect(res.body.data.metrics.totalAttempts).toBe(2);
      expect(res.body.data.metrics.completedCalls).toBe(1);
      expect(res.body.data.metrics.busyCalls).toBe(1);
      expect(res.body.data.metrics.answerRatePct).toBe(50);
      expect(res.body.data.metrics.costBudgetCapNzd).toBe(100.0);
      expect(res.body.data.questionnaireResponses.length).toBeGreaterThan(0);

      const firstQuestion = res.body.data.questionnaireResponses[0];
      expect(firstQuestion.questionId).toBe(testQuestionId);
      expect(firstQuestion.totalResponses).toBe(1);
      expect(firstQuestion.optionsBreakdown[0].optionKey).toBe('1');
      expect(firstQuestion.optionsBreakdown[0].count).toBe(1);
      expect(firstQuestion.optionsBreakdown[0].percentage).toBe(100);
    });
  });

  describe('CSV Exports', () => {
    it('GET /api/reports/export/calls should return CSV with formula protection', async () => {
      const res = await request(app)
        .get('/api/reports/export/calls')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ campaignId: testCampaignId });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('Call ID');
      expect(res.text).toContain('Phase 6 Test Campaign');
      // Verify formula trigger is sanitized with single quote
      expect(res.text).toContain('"\'=CmdTest Contact"');
    });

    it('GET /api/reports/export/campaign/:id should return campaign performance CSV', async () => {
      const res = await request(app)
        .get(`/api/reports/export/campaign/${testCampaignId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('Auckland Accounting Services Ltd - Campaign Performance Report');
      expect(res.text).toContain('Phase 6 Test Campaign');
      expect(res.text).toContain('Questionnaire Responses Breakdown');
    });
  });
});
