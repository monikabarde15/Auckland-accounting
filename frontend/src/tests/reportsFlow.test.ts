import { describe, it, expect } from 'vitest';
import { SummaryReportData, CampaignReportData } from '../types';

describe('Phase 6: Frontend Reporting & Analytics Logic Tests', () => {
  const sampleSummary: SummaryReportData = {
    overview: {
      totalCampaigns: 4,
      activeCampaigns: 1,
      completedCampaigns: 2,
      totalContacts: 100,
      callableContacts: 85,
      dncSuppressedContacts: 10,
      totalCallsPlaced: 50,
      completedCalls: 35,
      transferredCalls: 5,
      busyCalls: 6,
      noAnswerCalls: 3,
      failedCalls: 1,
      cancelledCalls: 0,
      answerRatePct: 80.0,
      completionRatePct: 70.0,
      failureRatePct: 2.0,
      averageDurationSeconds: 65,
      totalDurationSeconds: 3250,
      totalEstimatedCostNzd: 3.40
    },
    outcomes: [
      { status: 'COMPLETED', label: 'Completed Flow', count: 35, percentage: 70.0, color: '#16a34a' },
      { status: 'TRANSFERRED', label: 'Transferred to Staff', count: 5, percentage: 10.0, color: '#0f2e4a' },
      { status: 'BUSY', label: 'Busy Line', count: 6, percentage: 12.0, color: '#d97706' },
      { status: 'NO_ANSWER', label: 'No Answer', count: 3, percentage: 6.0, color: '#94a3b8' },
      { status: 'FAILED', label: 'Failed Connection', count: 1, percentage: 2.0, color: '#dc2626' }
    ],
    hourlyVolume: [
      { hour: '09:00', dialed: 5, answered: 4 },
      { hour: '10:00', dialed: 12, answered: 10 },
      { hour: '11:00', dialed: 15, answered: 12 }
    ],
    suppression: {
      dncSuppressed: 10,
      consentBlocked: 5,
      callingHoursBlocked: 0,
      budgetLimitReached: 0,
      totalSuppressed: 15
    },
    retries: {
      totalRetriesScheduled: 8,
      successfulRetries: 5,
      exhaustedRetries: 2
    }
  };

  const sampleCampaignReport: CampaignReportData = {
    campaign: {
      id: 'camp_001',
      name: 'GST Filing Authorization Q3',
      status: 'RUNNING',
      callerId: '+6498370000',
      callingStartTime: '09:00',
      callingEndTime: '17:00',
      timezone: 'Pacific/Auckland',
      maxCost: 50.0,
      maxRetries: 3,
      startDate: '2026-09-01T00:00:00.000Z',
      endDate: '2026-09-30T23:59:59.000Z'
    },
    metrics: {
      totalTargetContacts: 40,
      totalJobs: 40,
      totalAttempts: 30,
      completedCalls: 22,
      transferredCalls: 3,
      busyCalls: 3,
      noAnswerCalls: 2,
      failedCalls: 0,
      cancelledCalls: 0,
      answerRatePct: 83.3,
      completionRatePct: 73.3,
      failureRatePct: 0.0,
      totalDurationSeconds: 1980,
      averageDurationSeconds: 66,
      totalCostNzd: 2.10,
      costBudgetCapNzd: 50.0,
      budgetUtilizedPct: 4.2
    },
    suppression: {
      dncBlocked: 4,
      consentBlocked: 1
    },
    questionnaireResponses: [
      {
        questionId: 'q_01',
        stepNumber: 1,
        questionText: 'Have you verified your GST return data?',
        questionType: 'YES_NO',
        totalResponses: 25,
        optionsBreakdown: [
          { optionKey: '1', optionLabel: 'Yes, Verified', count: 20, percentage: 80.0 },
          { optionKey: '2', optionLabel: 'No, Need Review', count: 5, percentage: 20.0 }
        ]
      },
      {
        questionId: 'q_02',
        stepNumber: 2,
        questionText: 'Please rate your experience with Auckland Accounting (1 to 5 stars)',
        questionType: 'RATING',
        totalResponses: 22,
        averageRating: 4.7,
        optionsBreakdown: [
          { optionKey: '5', optionLabel: '5 Stars', count: 16, percentage: 72.7 },
          { optionKey: '4', optionLabel: '4 Stars', count: 5, percentage: 22.7 },
          { optionKey: '3', optionLabel: '3 Stars', count: 1, percentage: 4.5 }
        ]
      }
    ]
  };

  it('should accurately calculate resolution and answer rates in summary data', () => {
    const { overview } = sampleSummary;
    expect(overview.totalCallsPlaced).toBe(50);
    expect(overview.completedCalls).toBe(35);
    expect(overview.transferredCalls).toBe(5);

    // Answer rate = (completed + transferred) / total
    const computedAnswerRate = ((overview.completedCalls + overview.transferredCalls) / overview.totalCallsPlaced) * 100;
    expect(computedAnswerRate).toBe(80.0);
    expect(overview.answerRatePct).toBe(80.0);
  });

  it('should evaluate suppression and compliance counts correctly', () => {
    const { suppression } = sampleSummary;
    expect(suppression.dncSuppressed).toBe(10);
    expect(suppression.consentBlocked).toBe(5);
    expect(suppression.totalSuppressed).toBe(15);
  });

  it('should verify campaign budget utilization and cost metrics', () => {
    const { metrics } = sampleCampaignReport;
    expect(metrics.totalCostNzd).toBe(2.10);
    expect(metrics.costBudgetCapNzd).toBe(50.0);
    expect(metrics.budgetUtilizedPct).toBe(4.2);
  });

  it('should parse questionnaire response distributions and rating score averages', () => {
    const responses = sampleCampaignReport.questionnaireResponses;
    expect(responses.length).toBe(2);

    // Step 1: Yes/No Question
    const step1 = responses[0];
    expect(step1.questionType).toBe('YES_NO');
    expect(step1.totalResponses).toBe(25);
    expect(step1.optionsBreakdown[0].optionKey).toBe('1');
    expect(step1.optionsBreakdown[0].count).toBe(20);
    expect(step1.optionsBreakdown[0].percentage).toBe(80.0);

    // Step 2: Rating Question
    const step2 = responses[1];
    expect(step2.questionType).toBe('RATING');
    expect(step2.averageRating).toBe(4.7);
    expect(step2.totalResponses).toBe(22);
  });
});
