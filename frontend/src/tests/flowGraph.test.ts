import { describe, it, expect } from 'vitest';
import { validateFlowGraph } from '../utils/flowValidator';
import { Question } from '../types';

describe('Phase 4: Frontend Flow Graph Analysis Tests', () => {
  it('should detect a 2-node cycle (Q1 -> Q2 -> Q1)', () => {
    const questions: Question[] = [
      {
        id: 'q1',
        name: 'Step 1',
        type: 'yes_no',
        promptText: 'First question prompt',
        timeoutSeconds: 6,
        maxRetries: 2,
        options: [
          { id: 'opt1', dtmfDigit: '1', label: 'Go to 2', nextQuestionId: 'q2' }
        ]
      },
      {
        id: 'q2',
        name: 'Step 2',
        type: 'yes_no',
        promptText: 'Second question prompt',
        timeoutSeconds: 6,
        maxRetries: 2,
        options: [
          { id: 'opt2', dtmfDigit: '1', label: 'Go to 1', nextQuestionId: 'q1' } // CYCLE!
        ]
      }
    ];

    const result = validateFlowGraph(questions, 'q1');

    expect(result.isValid).toBe(false);
    expect(result.summary.hasCycle).toBe(true);
    const cycleErr = result.errors.find((e) => e.code === 'PROHIBITED_CYCLE_DETECTED');
    expect(cycleErr).toBeDefined();
    expect(cycleErr?.message).toContain('Step 1 ? Step 2 ? Step 1');
  });

  it('should detect unreachable questions', () => {
    const questions: Question[] = [
      {
        id: 'q1',
        name: 'Main Step',
        type: 'yes_no',
        promptText: 'Hello from main step',
        timeoutSeconds: 6,
        maxRetries: 2,
        options: [
          { id: 'opt1', dtmfDigit: '1', label: 'Done', nextQuestionId: 'END' }
        ]
      },
      {
        id: 'q_orphan',
        name: 'Disconnected Step',
        type: 'yes_no',
        promptText: 'Nobody links here',
        timeoutSeconds: 6,
        maxRetries: 2,
        options: []
      }
    ];

    const result = validateFlowGraph(questions, 'q1');

    expect(result.summary.unreachableQuestions).toBe(1);
    const unreach = result.warnings.find((w) => w.code === 'UNREACHABLE_QUESTION');
    expect(unreach).toBeDefined();
    expect(unreach?.message).toContain('Disconnected Step');
  });

  it('should detect broken question destinations', () => {
    const questions: Question[] = [
      {
        id: 'q1',
        name: 'Start Step',
        type: 'yes_no',
        promptText: 'Choose',
        timeoutSeconds: 6,
        maxRetries: 2,
        options: [
          { id: 'opt1', dtmfDigit: '1', label: 'Invalid Node', nextQuestionId: 'ghost_node_123' }
        ]
      }
    ];

    const result = validateFlowGraph(questions, 'q1');

    expect(result.isValid).toBe(false);
    const broken = result.errors.find((e) => e.code === 'BROKEN_REFERENCE');
    expect(broken).toBeDefined();
    expect(broken?.message).toContain('ghost_node_123');
  });

  it('should pass validation for a clean terminating flow', () => {
    const questions: Question[] = [
      {
        id: 'q1',
        name: 'Step 1 - Greeting',
        type: 'yes_no',
        promptText: 'Do you want to proceed?',
        timeoutSeconds: 6,
        maxRetries: 2,
        options: [
          { id: 'opt1', dtmfDigit: '1', label: 'Yes', nextQuestionId: 'q2' },
          { id: 'opt2', dtmfDigit: '2', label: 'No', nextQuestionId: 'END' }
        ]
      },
      {
        id: 'q2',
        name: 'Step 2 - Details',
        type: 'message_only',
        promptText: 'Your details have been confirmed. Goodbye.',
        timeoutSeconds: 5,
        maxRetries: 0,
        options: []
      }
    ];

    const result = validateFlowGraph(questions, 'q1');

    expect(result.isValid).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.summary.hasCycle).toBe(false);
    expect(result.summary.reachableQuestions).toBe(2);
    expect(result.summary.unreachableQuestions).toBe(0);
  });

  it('should accept REPEAT as a valid menu repetition target', () => {
    const questions: Question[] = [
      {
        id: 'q1',
        name: 'Step 1 - Menu',
        type: 'multiple_choice',
        promptText: 'Press 1 for Sales, 2 for Support, 9 to Repeat.',
        timeoutSeconds: 6,
        maxRetries: 2,
        options: [
          { id: 'opt1', dtmfDigit: '1', label: 'Sales', nextQuestionId: 'q2' },
          { id: 'opt2', dtmfDigit: '2', label: 'Support', nextQuestionId: 'END' },
          { id: 'opt9', dtmfDigit: '9', label: 'Repeat Menu', nextQuestionId: 'REPEAT' }
        ]
      },
      {
        id: 'q2',
        name: 'Step 2 - Sales Done',
        type: 'message_only',
        promptText: 'Thank you.',
        timeoutSeconds: 5,
        maxRetries: 0,
        options: []
      }
    ];

    const result = validateFlowGraph(questions, 'q1');

    expect(result.isValid).toBe(true);
    expect(result.errors.length).toBe(0);
  });
});
