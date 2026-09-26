import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { CampaignStatus, CallStatus, CallJobStatus, QuestionType, NextAction } from '@prisma/client';
import { performPreDialSafetyCheck } from '../src/services/dialer/dialerSafetyCheck.js';

describe('Phase 7: Full End-to-End Acceptance Integration Test (Spec §62)', () => {
  const app = createApp();

  let adminToken: string;
  let e2eContactId: string;
  let e2eGroupId: string;
  let e2eQuestionnaireId: string;
  let e2eQuestionId: string;
  let e2eCampaignId: string;
  let e2eCallJobId: string;
  let e2eCallAttemptId: string;

  beforeAll(async () => {
    // 1. Admin Login
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@aucklandaccounting.co.nz', password: 'AculaAdmin2026!' });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.data.accessToken;
  });

  afterAll(async () => {
    // Cleanup in reverse dependency order
    if (e2eCallAttemptId) {
      await prisma.callResponse.deleteMany({ where: { callAttemptId: e2eCallAttemptId } });
      await prisma.callEvent.deleteMany({ where: { callAttemptId: e2eCallAttemptId } });
      await prisma.callAttempt.deleteMany({ where: { id: e2eCallAttemptId } });
    }
    if (e2eCallJobId) {
      await prisma.retryLog.deleteMany({ where: { callJobId: e2eCallJobId } });
      await prisma.callJob.deleteMany({ where: { id: e2eCallJobId } });
    }
    if (e2eCampaignId) {
      await prisma.campaignContact.deleteMany({ where: { campaignId: e2eCampaignId } });
      await prisma.campaign.deleteMany({ where: { id: e2eCampaignId } });
    }
    if (e2eQuestionnaireId) {
      await prisma.questionOption.deleteMany({ where: { question: { questionnaireId: e2eQuestionnaireId } } });
      await prisma.question.deleteMany({ where: { questionnaireId: e2eQuestionnaireId } });
      await prisma.questionnaire.deleteMany({ where: { id: e2eQuestionnaireId } });
    }
    if (e2eContactId) {
      await prisma.contactGroupMember.deleteMany({ where: { contactId: e2eContactId } });
      await prisma.contact.deleteMany({ where: { id: e2eContactId } });
    }
    if (e2eGroupId) {
      await prisma.contactGroup.deleteMany({ where: { id: e2eGroupId } });
    }
  });

  it('Step 1: Contact Creation & Group Assignment with E.164 Normalization', async () => {
    const runSuffix = Date.now().toString().slice(-6);
    // Create Group
    const groupRes = await request(app)
      .post('/api/contacts/groups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `E2E Acceptance VIP Clients ${runSuffix}`, description: 'Clients for E2E testing' });
    expect(groupRes.status).toBe(201);
    e2eGroupId = groupRes.body.data.id;

    // Create Contact with NZ mobile number needing normalization
    const contactRes = await request(app)
      .post('/api/contacts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Sarah Connor ${runSuffix}`,
        phoneNumber: '021 777 9999', // Non-standard format to test normalization
        email: `sarah.connor.${runSuffix}@example.co.nz`,
        companyName: 'Cyberdyne Systems NZ',
        consentStatus: 'GRANTED',
        isDoNotCall: false,
        groupIds: [e2eGroupId]
      });

    expect(contactRes.status).toBe(201);
    expect(contactRes.body.data.phoneNumber).toBe('+64217779999'); // E.164 Normalized
    expect(contactRes.body.data.consentStatus).toBe('GRANTED');
    expect(contactRes.body.data.isDoNotCall).toBe(false);
    e2eContactId = contactRes.body.data.id;
  });

  it('Step 2: Dynamic Questionnaire Builder & Branching Flow Graph', async () => {
    const runSuffix = Date.now().toString().slice(-6);
    const qRes = await request(app)
      .post('/api/questionnaires')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: `E2E Annual Review & Survey Flow ${runSuffix}`,
        description: 'End-to-End acceptance IVR questionnaire',
        category: 'Tax & Compliance'
      });
    expect(qRes.status).toBe(201);
    e2eQuestionnaireId = qRes.body.data.id;

    // Add Step 1: Multiple Choice
    const step1Res = await request(app)
      .post(`/api/questionnaires/${e2eQuestionnaireId}/questions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        questionText: 'Have you approved your provisional tax schedule? Press 1 for Yes, 2 for No.',
        name: 'Tax Schedule Approval',
        type: QuestionType.MULTIPLE_CHOICE,
        orderNo: 1,
        options: [
          { optionKey: '1', optionLabel: 'Approved Schedule', nextAction: NextAction.CONTINUE },
          { optionKey: '2', optionLabel: 'Needs Discussion', nextAction: NextAction.CONTINUE }
        ]
      });
    expect(step1Res.status).toBe(201);
    e2eQuestionId = step1Res.body.data.id;

    // Validate questionnaire graph
    const valRes = await request(app)
      .post(`/api/questionnaires/${e2eQuestionnaireId}/validate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(valRes.status).toBe(200);
    expect(valRes.body.data.isValid).toBe(true);
    expect(valRes.body.data.summary.hasCycle).toBe(false);
  });

  it('Step 3: Campaign Configuration & Pre-Launch Validation Engine', async () => {
    const runSuffix = Date.now().toString().slice(-6);
    // Create Campaign (24/7 window so pre-dial safety test passes regardless of current hour)
    const campRes = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `E2E Annual Tax Verification Campaign ${runSuffix}`,
        callerId: '+6498370000',
        callingStartTime: '00:00',
        callingEndTime: '23:59',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        timezone: 'Pacific/Auckland',
        maxConcurrentCalls: 5,
        maxCost: 100.0,
        questionnaireId: e2eQuestionnaireId,
        targetGroupIds: [e2eGroupId]
      });
    expect(campRes.status).toBe(201);
    expect(campRes.body.data.status).toBe(CampaignStatus.DRAFT);
    e2eCampaignId = campRes.body.data.id;

    // Run 4-Tier Pre-Launch Validation
    const valRes = await request(app)
      .post(`/api/campaigns/${e2eCampaignId}/validate`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(valRes.status).toBe(200);
    expect(valRes.body.data.isLaunchReady).toBe(true);
    expect(valRes.body.data.summary.totalContacts).toBe(1);
    expect(valRes.body.data.summary.callableContacts).toBe(1);
    expect(valRes.body.data.summary.flowValid).toBe(true);
  });

  it('Step 4: Campaign State Transition to RUNNING and CallJob Generation', async () => {
    const startRes = await request(app)
      .post(`/api/campaigns/${e2eCampaignId}/start`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(startRes.status).toBe(200);
    expect(startRes.body.data.status).toBe(CampaignStatus.RUNNING);

    // Verify CallJob created in PostgreSQL
    const job = await prisma.callJob.findFirst({
      where: { campaignId: e2eCampaignId, contactId: e2eContactId }
    });
    expect(job).toBeDefined();
    expect([CallJobStatus.PENDING, CallJobStatus.DISPATCHED]).toContain(job?.status);
    e2eCallJobId = job!.id;
  });

  it('Step 5: Pre-Dial 10-Point Safety Gate Verification', async () => {
    const safetyCheck = await performPreDialSafetyCheck(e2eCampaignId, e2eContactId, e2eCallJobId);
    expect(safetyCheck.canDial).toBe(true);
    expect(safetyCheck.code).toBe('OK');
    expect(safetyCheck.campaign.status).toBe(CampaignStatus.RUNNING);
    expect(safetyCheck.contact.consentStatus).toBe('GRANTED');
    expect(safetyCheck.contact.isDoNotCall).toBe(false);
  });

  it('Step 6: Telephony Simulation, TwiML Generation & IVR Gather Webhook Lifecycle', async () => {
    // 1. Create CallAttempt
    const attempt = await prisma.callAttempt.create({
      data: {
        callJobId: e2eCallJobId,
        providerCallId: 'CA_E2E_PSTN_SIM_001',
        status: CallStatus.INITIATED,
        startedAt: new Date()
      }
    });
    e2eCallAttemptId = attempt.id;

    // 2. Answer Webhook (/api/voice/twiml)
    const twimlRes = await request(app)
      .post('/api/voice/twiml')
      .query({ callAttemptId: e2eCallAttemptId })
      .send({ CallSid: 'CA_E2E_PSTN_SIM_001', CallStatus: 'in-progress' });

    expect(twimlRes.status).toBe(200);
    expect(twimlRes.headers['content-type']).toContain('text/xml');
    expect(twimlRes.text).toContain('voice="Polly.Aria"');
    expect(twimlRes.text).toContain('Have you approved your provisional tax schedule?');
    expect(twimlRes.text).toContain('<Gather');

    // 3. DTMF Gather Webhook (/api/voice/gather) -> Client presses '1'
    const gatherRes = await request(app)
      .post('/api/voice/gather')
      .query({ callAttemptId: e2eCallAttemptId, questionId: e2eQuestionId })
      .send({ Digits: '1' });

    expect(gatherRes.status).toBe(200);
    expect(gatherRes.headers['content-type']).toContain('text/xml');

    // Verify response persisted in PostgreSQL
    const savedResponse = await prisma.callResponse.findFirst({
      where: { callAttemptId: e2eCallAttemptId, questionId: e2eQuestionId }
    });
    expect(savedResponse).toBeDefined();
    expect(savedResponse?.responseValue).toBe('1');
    expect(savedResponse?.isValid).toBe(true);

    // 4. Status Webhook (/api/voice/status) -> Call Completed with 90s duration
    const statusRes = await request(app)
      .post('/api/voice/status')
      .query({ callAttemptId: e2eCallAttemptId })
      .send({
        CallSid: 'CA_E2E_PSTN_SIM_001',
        CallStatus: 'completed',
        CallDuration: '90',
        SequenceNumber: '1'
      });
    expect(statusRes.status).toBe(200);

    // Verify terminal status recorded
    const finalAttempt = await prisma.callAttempt.findUnique({
      where: { id: e2eCallAttemptId }
    });
    expect(finalAttempt?.status).toBe(CallStatus.COMPLETED);
    expect(finalAttempt?.durationSeconds).toBe(90);
  });

  it('Step 7: Reporting, Call History & Diagnostics Verification', async () => {
    // Call History Inspector
    const callRes = await request(app)
      .get(`/api/calls/${e2eCallAttemptId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(callRes.status).toBe(200);
    expect(callRes.body.data.id).toBe(e2eCallAttemptId);
    expect(callRes.body.data.status).toBe(CallStatus.COMPLETED);
    expect(callRes.body.data.cost).toBe(0.08); // 90s => 2 billed minutes = $0.08 NZD
    expect(callRes.body.data.responses.length).toBe(1);
    expect(callRes.body.data.responses[0].responseValue).toBe('1');

    // Campaign Report
    const reportRes = await request(app)
      .get(`/api/reports/campaigns/${e2eCampaignId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(reportRes.status).toBe(200);
    expect(reportRes.body.data.metrics.completedCalls).toBe(1);
    expect(reportRes.body.data.metrics.answerRatePct).toBe(100);
    expect(reportRes.body.data.metrics.totalCostNzd).toBe(0.08);
    expect(reportRes.body.data.questionnaireResponses.length).toBe(1);
    expect(reportRes.body.data.questionnaireResponses[0].optionsBreakdown[0].count).toBe(1);
  });

  it('Step 8: Global Emergency Stop Halts All Operations', async () => {
    const stopRes = await request(app)
      .post('/api/campaigns/emergency-stop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'E2E Acceptance Emergency Stop Test' });

    expect(stopRes.status).toBe(200);
    expect(stopRes.body.success).toBe(true);

    const checkCampaign = await prisma.campaign.findUnique({
      where: { id: e2eCampaignId }
    });
    expect(checkCampaign?.status).toBe(CampaignStatus.PAUSED);

    // Verify pre-dial safety check now strictly blocks any dial
    const postStopSafety = await performPreDialSafetyCheck(e2eCampaignId, e2eContactId);
    expect(postStopSafety.canDial).toBe(false);
    expect(postStopSafety.code).toBe('CAMPAIGN_NOT_RUNNING');
  });
});
