import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { validateQuestionFlow } from '../src/services/flowValidationService.js';
import { QuestionType, NextAction } from '@prisma/client';

const app = createApp();

let adminToken: string;
let operatorToken: string;

beforeAll(async () => {
  const adminRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@aucklandaccounting.co.nz', password: 'AculaAdmin2026!' });
  adminToken = adminRes.body.data.accessToken;

  const opRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'operator@aucklandaccounting.co.nz', password: 'AculaOperator2026!' });
  operatorToken = opRes.body.data.accessToken;
});

describe('Phase 4: Graph Flow Validation Service (Cycle Detection & Graph Analysis)', () => {
  it('should detect a 3-node directed cycle (Q1 -> Q2 -> Q3 -> Q1)', () => {
    const questions = [
      {
        id: 'q1',
        name: 'Question 1',
        questionText: 'Do you agree to continue?',
        type: QuestionType.YES_NO,
        options: [
          { optionKey: '1', optionLabel: 'Yes', nextQuestionId: 'q2', nextAction: NextAction.CONTINUE },
          { optionKey: '2', optionLabel: 'No', nextQuestionId: 'END', nextAction: NextAction.END_CALL }
        ]
      },
      {
        id: 'q2',
        name: 'Question 2',
        questionText: 'Proceed to confirmation?',
        type: QuestionType.YES_NO,
        options: [
          { optionKey: '1', optionLabel: 'Yes', nextQuestionId: 'q3', nextAction: NextAction.CONTINUE },
          { optionKey: '2', optionLabel: 'No', nextQuestionId: 'END', nextAction: NextAction.END_CALL }
        ]
      },
      {
        id: 'q3',
        name: 'Question 3',
        questionText: 'Final confirmation check?',
        type: QuestionType.YES_NO,
        options: [
          // CYCLE POINT: Loops back to q1!
          { optionKey: '1', optionLabel: 'Repeat', nextQuestionId: 'q1', nextAction: NextAction.CONTINUE },
          { optionKey: '2', optionLabel: 'Finish', nextQuestionId: 'END', nextAction: NextAction.END_CALL }
        ]
      }
    ];

    const result = validateQuestionFlow(questions as any, 'q1');

    expect(result.isValid).toBe(false);
    expect(result.summary.hasCycle).toBe(true);
    const cycleError = result.errors.find((e) => e.code === 'PROHIBITED_CYCLE_DETECTED');
    expect(cycleError).toBeDefined();
    expect(cycleError?.message).toContain('cycle detected');
  });

  it('should detect an immediate self-loop cycle (Q1 -> Q1)', () => {
    const questions = [
      {
        id: 'q1',
        name: 'Self Loop Node',
        questionText: 'Press 1 to repeat this prompt indefinitely',
        type: QuestionType.YES_NO,
        options: [
          { optionKey: '1', optionLabel: 'Loop', nextQuestionId: 'q1', nextAction: NextAction.CONTINUE },
          { optionKey: '2', optionLabel: 'Exit', nextQuestionId: 'END', nextAction: NextAction.END_CALL }
        ]
      }
    ];

    const result = validateQuestionFlow(questions as any, 'q1');

    expect(result.isValid).toBe(false);
    expect(result.summary.hasCycle).toBe(true);
  });

  it('should detect unreachable orphan questions disconnected from start node', () => {
    const questions = [
      {
        id: 'q1',
        name: 'Greeting',
        questionText: 'Welcome. Press 1 to complete.',
        type: QuestionType.YES_NO,
        options: [
          { optionKey: '1', optionLabel: 'Complete', nextQuestionId: 'END', nextAction: NextAction.END_CALL }
        ]
      },
      {
        id: 'q2_orphan',
        name: 'Orphan Feedback Question',
        questionText: 'How was your experience today?',
        type: QuestionType.RATING,
        options: []
      }
    ];

    const result = validateQuestionFlow(questions as any, 'q1');

    expect(result.summary.unreachableQuestions).toBe(1);
    const unreachableWarning = result.warnings.find((w) => w.code === 'UNREACHABLE_QUESTION');
    expect(unreachableWarning).toBeDefined();
    expect(unreachableWarning?.message).toContain('Orphan Feedback Question');
  });

  it('should detect broken reference to non-existent question ID', () => {
    const questions = [
      {
        id: 'q1',
        name: 'Main Menu',
        questionText: 'Press 1 for accounts, 2 for missing step.',
        type: QuestionType.YES_NO,
        options: [
          { optionKey: '1', optionLabel: 'Accounts', nextQuestionId: 'END', nextAction: NextAction.END_CALL },
          { optionKey: '2', optionLabel: 'Missing', nextQuestionId: 'non_existent_node_999', nextAction: NextAction.CONTINUE }
        ]
      }
    ];

    const result = validateQuestionFlow(questions as any, 'q1');

    expect(result.isValid).toBe(false);
    const brokenRefError = result.errors.find((e) => e.code === 'BROKEN_REFERENCE');
    expect(brokenRefError).toBeDefined();
    expect(brokenRefError?.message).toContain('non_existent_node_999');
  });

  it('should pass validation for a clean, acyclic question flow with valid terminations', () => {
    const validQuestions = [
      {
        id: 'step1',
        name: 'Step 1 - Consent',
        questionText: 'Do you authorize filing your GST return? Press 1 for Yes, 2 for No.',
        type: QuestionType.YES_NO,
        options: [
          { optionKey: '1', optionLabel: 'Yes', nextQuestionId: 'step2', nextAction: NextAction.CONTINUE },
          { optionKey: '2', optionLabel: 'No', nextQuestionId: 'step3_decline', nextAction: NextAction.CONTINUE }
        ]
      },
      {
        id: 'step2',
        name: 'Step 2 - Reconciled',
        questionText: 'Confirm all accounts are reconciled? Press 1 for Yes.',
        type: QuestionType.YES_NO,
        options: [
          { optionKey: '1', optionLabel: 'Confirmed', nextQuestionId: 'END', nextAction: NextAction.END_CALL },
          { optionKey: '2', optionLabel: 'Need Help', nextQuestionId: 'step3_decline', nextAction: NextAction.CONTINUE }
        ]
      },
      {
        id: 'step3_decline',
        name: 'Step 3 - Closing Advice',
        questionText: 'A staff accountant will contact you tomorrow. Thank you.',
        type: QuestionType.MESSAGE_ONLY,
        options: []
      }
    ];

    const result = validateQuestionFlow(validQuestions as any, 'step1');

    expect(result.isValid).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.summary.hasCycle).toBe(false);
    expect(result.summary.reachableQuestions).toBe(3);
    expect(result.summary.unreachableQuestions).toBe(0);
  });
});

describe('Phase 4: Questionnaire REST API Endpoints (/api/questionnaires)', () => {
  let createdQuestionnaireId: string;

  it('should list questionnaires for authenticated users', async () => {
    const res = await request(app)
      .get('/api/questionnaires')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('should create a new questionnaire (ADMIN role)', async () => {
    const res = await request(app)
      .post('/api/questionnaires')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'PAYE Employer Monthly Verification Flow',
        description: 'Verifies employee hours and PAYE deductions before submission.',
        category: 'Payroll & PAYE'
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe('PAYE Employer Monthly Verification Flow');
    createdQuestionnaireId = res.body.data.id;
  });

  it('should block OPERATOR role from creating questionnaire (403 Forbidden)', async () => {
    const res = await request(app)
      .post('/api/questionnaires')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        title: 'Unauthorized Flow',
        category: 'Audit'
      });

    expect(res.status).toBe(403);
  });

  it('should add questions with branching options to the questionnaire', async () => {
    const res = await request(app)
      .post(`/api/questionnaires/${createdQuestionnaireId}/questions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'PAYE Confirmation Question',
        questionText: 'Have all payroll schedules for the month been finalized? Press 1 for Yes, 2 for No.',
        type: 'YES_NO',
        orderNo: 1,
        options: [
          { optionKey: '1', optionLabel: 'Yes, Finalized', nextAction: 'END_CALL' },
          { optionKey: '2', optionLabel: 'No, Pending', nextAction: 'END_CALL' }
        ]
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('PAYE Confirmation Question');
  });

  it('should run graph validation on the questionnaire via POST /validate', async () => {
    const res = await request(app)
      .post(`/api/questionnaires/${createdQuestionnaireId}/validate`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isValid).toBe(true);
  });
});
