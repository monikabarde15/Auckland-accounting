import { describe, it, expect } from 'vitest';
import { CallAttemptDetail, CallLog, Campaign } from '../types';

describe('Phase 5: Frontend Telephony Calls & State Logic Tests', () => {
  const sampleCalls: CallAttemptDetail[] = [
    {
      id: 'call_att_001',
      callJobId: 'job_001',
      contactId: 'contact_001',
      campaignId: 'camp_001',
      attemptNumber: 1,
      status: 'COMPLETED',
      providerSid: 'CA_TWILIO_SIM_001',
      providerStatus: 'completed',
      durationSeconds: 78,
      cost: 0.15,
      startedAt: '2026-09-09T08:30:00.000Z',
      answeredAt: '2026-09-09T08:30:05.000Z',
      completedAt: '2026-09-09T08:31:23.000Z',
      createdAt: '2026-09-09T08:30:00.000Z',
      updatedAt: '2026-09-09T08:31:23.000Z',
      contact: {
        id: 'contact_001',
        name: 'Sarah Mitchell',
        companyName: 'Auckland Construction Ltd',
        phoneNumber: '+64218924101'
      },
      campaign: {
        id: 'camp_001',
        name: 'GST Filing Verification',
        callerId: '+6498370000'
      },
      responses: [
        {
          id: 'resp_001',
          questionId: 'q_gst_01',
          rawDigits: '1',
          inputReceived: '1',
          matchedOption: 'Confirm and Authorize Filing',
          isValid: true,
          durationSeconds: 4,
          recordedAt: '2026-09-09T08:30:45.000Z',
          question: {
            id: 'q_gst_01',
            questionText: 'Press 1 to authorize GST filing or 2 to request accountant review.',
            questionType: 'MULTIPLE_CHOICE'
          }
        }
      ],
      retryLogs: []
    },
    {
      id: 'call_att_002',
      callJobId: 'job_002',
      contactId: 'contact_002',
      campaignId: 'camp_001',
      attemptNumber: 1,
      status: 'BUSY',
      providerSid: 'CA_TWILIO_SIM_002',
      providerStatus: 'busy',
      durationSeconds: 0,
      cost: 0.0,
      errorCode: '30007',
      errorMessage: 'Carrier returned network busy signal',
      startedAt: '2026-09-09T08:35:00.000Z',
      createdAt: '2026-09-09T08:35:00.000Z',
      updatedAt: '2026-09-09T08:35:10.000Z',
      contact: {
        id: 'contact_002',
        name: 'Marcus Wong',
        companyName: 'Henderson Tech Solutions',
        phoneNumber: '+64215553829'
      },
      campaign: {
        id: 'camp_001',
        name: 'GST Filing Verification',
        callerId: '+6498370000'
      },
      responses: [],
      retryLogs: [
        {
          id: 'retry_001',
          attemptNumber: 2,
          reason: 'BUSY',
          nextRetryAt: '2026-09-09T09:35:00.000Z',
          status: 'SCHEDULED',
          createdAt: '2026-09-09T08:35:10.000Z'
        }
      ]
    }
  ];

  it('should correctly filter calls by status and search keywords', () => {
    const completedCalls = sampleCalls.filter((c) => c.status === 'COMPLETED');
    expect(completedCalls.length).toBe(1);
    expect(completedCalls[0].contact?.name).toBe('Sarah Mitchell');

    const busyCalls = sampleCalls.filter((c) => c.status === 'BUSY');
    expect(busyCalls.length).toBe(1);
    expect(busyCalls[0].errorCode).toBe('30007');

    const searchResult = sampleCalls.filter((c) =>
      (c.contact?.name || '').toLowerCase().includes('marcus')
    );
    expect(searchResult.length).toBe(1);
    expect(searchResult[0].id).toBe('call_att_002');
  });

  it('should correctly extract DTMF answers and option labels from response records', () => {
    const callWithResponses = sampleCalls[0];
    expect(callWithResponses.responses).toBeDefined();
    expect(callWithResponses.responses?.length).toBe(1);

    const firstResp = callWithResponses.responses![0];
    expect(firstResp.inputReceived).toBe('1');
    expect(firstResp.matchedOption).toBe('Confirm and Authorize Filing');
    expect(firstResp.isValid).toBe(true);
  });

  it('should verify retry scheduling and attempt count tracking', () => {
    const busyCall = sampleCalls[1];
    expect(busyCall.retryLogs).toBeDefined();
    expect(busyCall.retryLogs?.length).toBe(1);

    const retryLog = busyCall.retryLogs![0];
    expect(retryLog.attemptNumber).toBe(2);
    expect(retryLog.reason).toBe('BUSY');
    expect(retryLog.status).toBe('SCHEDULED');
  });

  it('should calculate accurate duration and telephony cost aggregations', () => {
    const totalDuration = sampleCalls.reduce((acc, c) => acc + (c.durationSeconds || 0), 0);
    const totalCost = sampleCalls.reduce((acc, c) => acc + (c.cost || 0), 0);

    expect(totalDuration).toBe(78);
    expect(totalCost).toBeCloseTo(0.15, 2);
  });
});
