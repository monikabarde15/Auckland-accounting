import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { CampaignStatus } from '@prisma/client';

const app = createApp();

let adminToken: string;
let operatorToken: string;
let testQuestionnaireId: string;
let testContactId: string;
let testDncContactId: string;

beforeAll(async () => {
  const adminRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@aucklandaccounting.co.nz', password: 'AculaAdmin2026!' });
  adminToken = adminRes.body.data.accessToken;

  const opRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'operator@aucklandaccounting.co.nz', password: 'AculaOperator2026!' });
  operatorToken = opRes.body.data.accessToken;

  // Fetch or create a test questionnaire with 1 valid terminating question
  let q = await prisma.questionnaire.findFirst({
    where: { title: 'GST Filing Verification & Submission Reminder' },
    include: { questions: true }
  });
  if (!q) {
    q = await prisma.questionnaire.create({
      data: {
        title: 'GST Filing Verification & Submission Reminder',
        category: 'Tax & Compliance',
        questions: {
          create: {
            questionText: 'Please verify your GST return.',
            type: 'YES_NO',
            orderNo: 1,
            options: {
              create: [
                { optionLabel: 'Yes', optionKey: '1', nextAction: 'END_CALL' },
                { optionLabel: 'No', optionKey: '2', nextAction: 'END_CALL' }
              ]
            }
          }
        }
      },
      include: { questions: true }
    });
  } else if (!q.questions || q.questions.length === 0) {
    await prisma.question.create({
      data: {
        questionnaireId: q.id,
        questionText: 'Please verify your GST return.',
        type: 'YES_NO',
        orderNo: 1,
        options: {
          create: [
            { optionLabel: 'Yes', optionKey: '1', nextAction: 'END_CALL' },
            { optionLabel: 'No', optionKey: '2', nextAction: 'END_CALL' }
          ]
        }
      }
    });
  }
  testQuestionnaireId = q.id;

  // Create dedicated contacts for campaign tests
  const callable = await prisma.contact.create({
    data: {
      name: 'Campaigns Test Dedicated Contact',
      phoneNumber: `+6421${Date.now().toString().slice(-7)}`,
      email: `camp_${Date.now()}@test.co.nz`,
      isDoNotCall: false,
      consentStatus: 'GRANTED'
    }
  });
  testContactId = callable.id;

  const dncContact = await prisma.contact.create({
    data: {
      name: 'Campaigns Test DNC Contact',
      phoneNumber: `+6422${Date.now().toString().slice(-7)}`,
      email: `dnc_${Date.now()}@test.co.nz`,
      isDoNotCall: true,
      consentStatus: 'REVOKED'
    }
  });
  testDncContactId = dncContact.id;
});

describe('Phase 4: Campaign Management & State Machine (/api/campaigns)', () => {
  let createdCampaignId: string;

  it('should list campaigns with pagination', async () => {
    const res = await request(app)
      .get('/api/campaigns')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.campaigns)).toBe(true);
    expect(res.body.data.pagination).toBeDefined();
  });

  it('should create a campaign in DRAFT status (ADMIN role)', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Provisional Tax Q3 Reminder Campaign',
        description: 'Automated notification for upcoming IRD provisional tax installments.',
        callerId: '+6498370000',
        callingStartTime: '09:00',
        callingEndTime: '17:30',
        daysOfWeek: [1, 2, 3, 4, 5],
        timezone: 'Pacific/Auckland',
        maxConcurrentCalls: 5,
        dailyCallLimit: 100,
        maxCost: 250.0,
        questionnaireId: testQuestionnaireId
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.name).toBe('Provisional Tax Q3 Reminder Campaign');
    createdCampaignId = res.body.data.id;
  });

  it('should reject unauthenticated request with 401 Unauthorized', async () => {
    const res = await request(app).get('/api/campaigns');
    expect(res.status).toBe(401);
  });

  it('should block OPERATOR from creating campaigns with 403 Forbidden', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        name: 'Unauthorized Operator Campaign'
      });

    expect(res.status).toBe(403);
  });

  it('should attach contacts and automatically designate DNC numbers as EXCLUDED_DNC', async () => {
    const res = await request(app)
      .post(`/api/campaigns/${createdCampaignId}/contacts`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        contactIds: [testContactId, testDncContactId]
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.addedCount).toBe(2);

    // Verify in database that DNC contact was excluded
    const campaignContacts = await prisma.campaignContact.findMany({
      where: { campaignId: createdCampaignId }
    });

    const normal = campaignContacts.find((cc) => cc.contactId === testContactId);
    const dnc = campaignContacts.find((cc) => cc.contactId === testDncContactId);

    expect(normal?.status).toBe('PENDING');
    expect(dnc?.status).toBe('EXCLUDED_DNC');
  });

  it('should support valid state transitions: DRAFT -> RUNNING -> PAUSED -> RUNNING -> CANCELLED', async () => {
    // 1. Start campaign: DRAFT -> RUNNING
    const startRes = await request(app)
      .post(`/api/campaigns/${createdCampaignId}/start`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(startRes.status).toBe(200);
    expect(startRes.body.data.status).toBe('RUNNING');

    // 2. Pause campaign: RUNNING -> PAUSED
    const pauseRes = await request(app)
      .post(`/api/campaigns/${createdCampaignId}/pause`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(pauseRes.status).toBe(200);
    expect(pauseRes.body.data.status).toBe('PAUSED');

    // 3. Resume campaign: PAUSED -> RUNNING
    const resumeRes = await request(app)
      .post(`/api/campaigns/${createdCampaignId}/resume`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resumeRes.status).toBe(200);
    expect(resumeRes.body.data.status).toBe('RUNNING');

    // 4. Cancel campaign: RUNNING -> CANCELLED
    const cancelRes = await request(app)
      .post(`/api/campaigns/${createdCampaignId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.status).toBe('CANCELLED');
  });

  it('should strictly reject invalid state transition (CANCELLED -> RUNNING) with 400 Bad Request', async () => {
    const res = await request(app)
      .post(`/api/campaigns/${createdCampaignId}/start`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Invalid campaign state transition');
  });
});
