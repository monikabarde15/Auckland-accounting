import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { validateCampaignForLaunch } from '../src/services/campaignValidationService.js';
import { CampaignStatus, QuestionType, NextAction } from '@prisma/client';

const app = createApp();

let adminToken: string;
let validQuestionnaireId: string;
let invalidQuestionnaireId: string;
let validContactId: string;
let dncContactId: string;

beforeAll(async () => {
  const adminRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@aucklandaccounting.co.nz', password: 'AculaAdmin2026!' });
  adminToken = adminRes.body.data.accessToken;

  // 1. Valid Questionnaire Flow
  const validQ = await prisma.questionnaire.create({
    data: {
      title: 'Pre-launch Test Valid Flow',
      category: 'General',
      questions: {
        create: [
          {
            name: 'Valid Step 1',
            questionText: 'Do you confirm? Press 1 for Yes, 2 for No.',
            type: QuestionType.YES_NO,
            orderNo: 1,
            options: {
              create: [
                { optionKey: '1', optionLabel: 'Yes', nextAction: NextAction.END_CALL },
                { optionKey: '2', optionLabel: 'No', nextAction: NextAction.END_CALL }
              ]
            }
          }
        ]
      }
    },
    include: { questions: true }
  });
  validQuestionnaireId = validQ.id;
  await prisma.questionnaire.update({
    where: { id: validQ.id },
    data: { startingQuestionId: validQ.questions[0].id }
  });

  // 2. Invalid Questionnaire Flow (contains cycle Q1 -> Q1)
  const invalidQ = await prisma.questionnaire.create({
    data: {
      title: 'Pre-launch Test Cyclic Flow',
      category: 'General'
    }
  });
  const cyclicQ = await prisma.question.create({
    data: {
      questionnaireId: invalidQ.id,
      name: 'Cyclic Node',
      questionText: 'Loop prompt',
      type: QuestionType.YES_NO,
      options: {
        create: [
          { optionKey: '1', optionLabel: 'Loop', nextAction: NextAction.CONTINUE }
        ]
      }
    }
  });
  // Update option to point to itself
  await prisma.questionOption.updateMany({
    where: { questionId: cyclicQ.id },
    data: { nextQuestionId: cyclicQ.id }
  });
  await prisma.questionnaire.update({
    where: { id: invalidQ.id },
    data: { startingQuestionId: cyclicQ.id }
  });
  invalidQuestionnaireId = invalidQ.id;

  // 3. Contacts
  let cNormal = await prisma.contact.findFirst({ where: { isDoNotCall: false } });
  if (!cNormal) {
    cNormal = await prisma.contact.create({
      data: { name: 'Valid Client', phoneNumber: '+64211112222', email: 'v@client.co.nz', isDoNotCall: false }
    });
  }
  validContactId = cNormal.id;

  let cDnc = await prisma.contact.findFirst({ where: { isDoNotCall: true } });
  if (!cDnc) {
    cDnc = await prisma.contact.create({
      data: { name: 'DNC Client', phoneNumber: '+64213334444', email: 'dnc@client.co.nz', isDoNotCall: true }
    });
  }
  dncContactId = cDnc.id;
});

describe('Phase 4: Campaign Pre-Launch Validation Engine', () => {
  it('should FAIL pre-launch validation when campaign has 0 attached contacts', async () => {
    const campaign = await prisma.campaign.create({
      data: {
        name: 'Empty Contacts Campaign',
        status: CampaignStatus.DRAFT,
        questionnaireId: validQuestionnaireId,
        callingStartTime: '09:00',
        callingEndTime: '17:00'
      }
    });

    const result = await validateCampaignForLaunch(campaign.id);

    expect(result.isLaunchReady).toBe(false);
    const audienceCheck = result.checks.find((c) => c.id === 'CONTACTS_AUDIENCE');
    expect(audienceCheck).toBeDefined();
    expect(audienceCheck?.status).toBe('FAIL');
    expect(audienceCheck?.message).toContain('No contacts attached');
  });

  it('should FAIL pre-launch validation when 100% of attached contacts are DNC suppressed', async () => {
    const campaign = await prisma.campaign.create({
      data: {
        name: 'DNC Blocked Campaign',
        status: CampaignStatus.DRAFT,
        questionnaireId: validQuestionnaireId,
        callingStartTime: '09:00',
        callingEndTime: '17:00'
      }
    });

    await prisma.campaignContact.create({
      data: {
        campaignId: campaign.id,
        contactId: dncContactId,
        status: 'EXCLUDED_DNC'
      }
    });

    const result = await validateCampaignForLaunch(campaign.id);

    expect(result.isLaunchReady).toBe(false);
    const complianceCheck = result.checks.find((c) => c.id === 'CONTACTS_CALLABLE');
    expect(complianceCheck).toBeDefined();
    expect(complianceCheck?.status).toBe('FAIL');
    expect(complianceCheck?.message).toContain('Do-Not-Call (DNC) suppression');
  });

  it('should FAIL pre-launch validation when calling hours are inverted', async () => {
    const campaign = await prisma.campaign.create({
      data: {
        name: 'Inverted Hours Campaign',
        status: CampaignStatus.DRAFT,
        questionnaireId: validQuestionnaireId,
        callingStartTime: '18:00', // start after end
        callingEndTime: '09:00'
      }
    });

    await prisma.campaignContact.create({
      data: {
        campaignId: campaign.id,
        contactId: validContactId,
        status: 'PENDING'
      }
    });

    const result = await validateCampaignForLaunch(campaign.id);

    expect(result.isLaunchReady).toBe(false);
    const hoursCheck = result.checks.find((c) => c.id === 'CONFIG_CALLING_HOURS');
    expect(hoursCheck?.status).toBe('FAIL');
  });

  it('should FAIL pre-launch validation when question flow contains graph cycle', async () => {
    const campaign = await prisma.campaign.create({
      data: {
        name: 'Cyclic Flow Campaign',
        status: CampaignStatus.DRAFT,
        questionnaireId: invalidQuestionnaireId,
        callingStartTime: '09:00',
        callingEndTime: '17:00'
      }
    });

    await prisma.campaignContact.create({
      data: {
        campaignId: campaign.id,
        contactId: validContactId,
        status: 'PENDING'
      }
    });

    const result = await validateCampaignForLaunch(campaign.id);

    expect(result.isLaunchReady).toBe(false);
    const flowCheck = result.checks.find((c) => c.id === 'FLOW_GRAPH_VALID');
    expect(flowCheck?.status).toBe('FAIL');
    expect(flowCheck?.message).toContain('cycle detected');
  });

  it('should PASS pre-launch validation and return isLaunchReady: true for fully compliant campaign', async () => {
    const campaign = await prisma.campaign.create({
      data: {
        name: 'Compliant Production Campaign',
        status: CampaignStatus.DRAFT,
        callerId: '+6498370000',
        questionnaireId: validQuestionnaireId,
        callingStartTime: '09:00',
        callingEndTime: '17:00',
        daysOfWeek: [1, 2, 3, 4, 5],
        maxConcurrentCalls: 5
      }
    });

    await prisma.campaignContact.create({
      data: {
        campaignId: campaign.id,
        contactId: validContactId,
        status: 'PENDING'
      }
    });

    const result = await validateCampaignForLaunch(campaign.id);

    expect(result.isLaunchReady).toBe(true);
    expect(result.summary.callableContacts).toBe(1);
    expect(result.summary.flowValid).toBe(true);
    expect(result.checks.every((c) => c.status !== 'FAIL')).toBe(true);
  });

  it('should block starting campaign via POST /api/campaigns/:id/start when pre-launch validation fails', async () => {
    // Campaign with no contacts
    const campaign = await prisma.campaign.create({
      data: {
        name: 'Unlaunchable Campaign',
        status: CampaignStatus.DRAFT,
        questionnaireId: validQuestionnaireId
      }
    });

    const res = await request(app)
      .post(`/api/campaigns/${campaign.id}/start`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Pre-launch validation failed');
  });
});
