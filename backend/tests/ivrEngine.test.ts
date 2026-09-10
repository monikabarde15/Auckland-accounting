import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/services/prisma.js';
import {
  interpolateVariables,
  buildContactContext,
  renderQuestionTwiml,
  processGatheredResponse
} from '../src/services/ivr/ivrEngine.js';
import { QuestionType, CampaignStatus, CallJobStatus, CallStatus } from '@prisma/client';

describe('Dynamic IVR Runtime Engine Tests', () => {
  let testCampaignId: string;
  let testQuestionnaireId: string;
  let testQuestionId: string;
  let testContactId: string;
  let testCallJobId: string;
  let testCallAttemptId: string;

  beforeAll(async () => {
    // 1. Create Questionnaire with multiple types
    const questionnaire = await prisma.questionnaire.create({
      data: {
        title: 'IVR Runtime Engine Test',
        questions: {
          create: [
            {
              questionText: 'Hello {client_name}, your balance of {balance} is due on {due_date}. Press 1 to confirm payment, or 2 to transfer.',
              type: QuestionType.YES_NO,
              orderNo: 1,
              options: {
                create: [
                  { optionLabel: 'Confirm Payment', optionKey: '1', nextAction: 'END_CALL' },
                  { optionLabel: 'Transfer', optionKey: '2', nextAction: 'TRANSFER' }
                ]
              }
            },
            {
              questionText: 'Please enter your 4 digit account code followed by hash.',
              type: QuestionType.NUMERIC,
              orderNo: 2,
              maxDigits: 4,
              finishOnKey: '#'
            },
            {
              questionText: 'Thank you for your cooperation with {company_name}.',
              type: QuestionType.MESSAGE_ONLY,
              orderNo: 3
            }
          ]
        }
      },
      include: { questions: { include: { options: true } } }
    });
    testQuestionnaireId = questionnaire.id;
    testQuestionId = questionnaire.questions[0].id;

    // 2. Create Campaign
    const campaign = await prisma.campaign.create({
      data: {
        name: 'IVR Engine Campaign',
        status: CampaignStatus.RUNNING,
        callerId: '+6498370000',
        questionnaireId: testQuestionnaireId
      }
    });
    testCampaignId = campaign.id;

    // 3. Create Contact
    const contact = await prisma.contact.create({
      data: {
        name: 'Sarah Connor',
        companyName: 'Cyberdyne Systems NZ',
        phoneNumber: '+64215551234',
        outstandingBalance: 1450.50,
        dueDate: new Date('2026-10-31')
      }
    });
    testContactId = contact.id;

    // 4. Create Job & Attempt
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
        status: CallStatus.IN_PROGRESS
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

  it('should interpolate dynamic variables accurately from contact context', () => {
    const context = {
      client_name: 'John Doe',
      company_name: 'Auckland Accounting',
      balance: '$500.00',
      due_date: '20 October 2026'
    };

    const template = 'Greetings {client_name}, your balance is {balance} from {company_name}.';
    const result = interpolateVariables(template, context);

    expect(result).toBe('Greetings John Doe, your balance is $500.00 from Auckland Accounting.');
  });

  it('should build contact context correctly with formatted currency and dates', () => {
    const contact = {
      name: 'Alice Smith',
      companyName: 'Smith Ltd',
      outstandingBalance: 750,
      dueDate: new Date('2026-12-15')
    };

    const ctx = buildContactContext(contact);
    expect(ctx.client_name).toBe('Alice Smith');
    expect(ctx.company_name).toBe('Smith Ltd');
    expect(ctx.balance).toBe('$750.00');
  });

  it('should render compliant TwiML XML with <Gather> and <Say>', async () => {
    const twiml = await renderQuestionTwiml(testCallAttemptId, testQuestionId);

    expect(twiml).toContain('<Response>');
    expect(twiml).toContain('<Gather');
    expect(twiml).toContain('<Say');
    expect(twiml).toContain('Sarah Connor');
    expect(twiml).toContain('$1450.50');
  });

  it('should process gathered DTMF digits and record CallResponse in database', async () => {
    const nextTwiml = await processGatheredResponse(testCallAttemptId, testQuestionId, '1');

    expect(nextTwiml).toContain('Thank you for your response');
    expect(nextTwiml).toContain('<Hangup/>');

    // Check database response persistence
    const savedResponses = await prisma.callResponse.findMany({
      where: { callAttemptId: testCallAttemptId }
    });

    expect(savedResponses.length).toBeGreaterThan(0);
    expect(savedResponses[0].responseValue).toBe('1');
    expect(savedResponses[0].responseText).toBe('Confirm Payment');
    expect(savedResponses[0].isValid).toBe(true);
  });
});
