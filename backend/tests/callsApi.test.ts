import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { CampaignStatus, CallStatus, CallJobStatus } from '@prisma/client';

describe('Calls Inspection & Emergency Stop API Tests', () => {
  const app = createApp();
  let adminToken: string;
  let operatorToken: string;
  let testCampaignId: string;
  let testContactId: string;
  let testCallJobId: string;
  let testCallAttemptId: string;

  beforeAll(async () => {
    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@aucklandaccounting.co.nz', password: 'AculaAdmin2026!' });
    adminToken = adminRes.body.data.accessToken;

    const opRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'operator@aucklandaccounting.co.nz', password: 'AculaOperator2026!' });
    operatorToken = opRes.body.data.accessToken;

    const campaign = await prisma.campaign.create({
      data: {
        name: 'Calls Inspection Campaign',
        status: CampaignStatus.RUNNING,
        callerId: '+6498370000'
      }
    });
    testCampaignId = campaign.id;

    const contact = await prisma.contact.create({
      data: {
        name: 'David Test',
        phoneNumber: '+64218881234',
        companyName: 'Auckland Motors'
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
        status: CallStatus.COMPLETED,
        durationSeconds: 120,
        providerCallId: 'CA_TEST_CALLS_API_001'
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
    if (testContactId) {
      await prisma.contact.deleteMany({ where: { id: testContactId } });
    }
  });

  it('GET /api/calls should reject unauthenticated requests with 401', async () => {
    const res = await request(app).get('/api/calls');
    expect(res.status).toBe(401);
  });

  it('GET /api/calls should return paginated list of calls with filters', async () => {
    const res = await request(app)
      .get('/api/calls')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ campaignId: testCampaignId });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].id).toBe(testCallAttemptId);
    expect(res.body.data[0].contact.name).toBe('David Test');
  });

  it('GET /api/calls/:id should return detailed call object with relations', async () => {
    const res = await request(app)
      .get(`/api/calls/${testCallAttemptId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(testCallAttemptId);
    expect(res.body.data.campaign.name).toBe('Calls Inspection Campaign');
    expect(res.body.data.responses).toBeDefined();
    expect(res.body.data.events).toBeDefined();
  });

  it('POST /api/campaigns/emergency-stop should pause all running campaigns for Admin', async () => {
    const res = await request(app)
      .post('/api/campaigns/emergency-stop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Unit Test Emergency Pause' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.stoppedCount).toBeGreaterThanOrEqual(1);

    const checkCampaign = await prisma.campaign.findUnique({
      where: { id: testCampaignId }
    });
    expect(checkCampaign?.status).toBe(CampaignStatus.PAUSED);
  });

  it('POST /api/campaigns/emergency-stop should return 403 Forbidden for Operator role', async () => {
    const res = await request(app)
      .post('/api/campaigns/emergency-stop')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ reason: 'Operator unauthorized emergency stop' });

    expect(res.status).toBe(403);
  });
});
