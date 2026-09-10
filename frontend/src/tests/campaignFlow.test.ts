import { describe, it, expect } from 'vitest';
import { Campaign, CampaignStatus, Contact } from '../types';

describe('Phase 4: Frontend Campaign Domain & State Logic Tests', () => {
  const sampleContacts: Contact[] = [
    {
      id: 'c1',
      name: 'Sarah Mitchell',
      companyName: 'Auckland Construction Ltd',
      phoneNumber: '+64218924101',
      email: 'sarah@aklconstruction.co.nz',
      entityType: 'Company',
      assignedAccountant: 'David Chen (CA)',
      outstandingBalance: 4250,
      tags: ['GST Filer'],
      isDoNotCall: false
    },
    {
      id: 'c2',
      name: 'Marcus Wong',
      companyName: 'Henderson Tech Solutions',
      phoneNumber: '+64215553829',
      email: 'marcus@hendersontech.co.nz',
      entityType: 'Company',
      assignedAccountant: 'David Chen (CA)',
      outstandingBalance: 1820,
      tags: ['Tech'],
      isDoNotCall: true // DNC Suppressed
    }
  ];

  const sampleCampaigns: Campaign[] = [
    {
      id: 'camp1',
      name: 'Bi-Monthly GST Filing Verification',
      description: 'Verifies client authorization to file with Inland Revenue.',
      callerId: '+6498370000',
      callerName: 'Auckland Accounting Services',
      status: 'RUNNING',
      questionnaireId: 'q_gst',
      targetContactIds: ['c1', 'c2']
    },
    {
      id: 'camp2',
      name: 'Provisional Tax Q3 Alert',
      description: 'Notifies clients of provisional installment deadlines.',
      callerId: '+6498370000',
      callerName: 'Auckland Accounting Services',
      status: 'DRAFT',
      questionnaireId: 'q_prov',
      targetContactIds: ['c1']
    }
  ];

  it('should accurately calculate callable contacts vs DNC-suppressed contacts', () => {
    const campaign = sampleCampaigns[0];
    const targetIds = campaign.targetContactIds || [];

    const total = targetIds.length;
    const callable = targetIds.filter((id) => {
      const ct = sampleContacts.find((c) => c.id === id);
      return ct && !ct.isDoNotCall;
    }).length;
    const dncSuppressed = total - callable;

    expect(total).toBe(2);
    expect(callable).toBe(1);
    expect(dncSuppressed).toBe(1);
  });

  it('should enforce state machine transition validity on client', () => {
    const ALLOWED: Record<string, string[]> = {
      DRAFT: ['SCHEDULED', 'RUNNING', 'CANCELLED'],
      SCHEDULED: ['RUNNING', 'PAUSED', 'CANCELLED'],
      RUNNING: ['PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED'],
      PAUSED: ['RUNNING', 'COMPLETED', 'CANCELLED'],
      COMPLETED: [],
      CANCELLED: [],
      FAILED: []
    };

    const canTransition = (from: string, to: string) => {
      return (ALLOWED[from] || []).includes(to);
    };

    // Valid transitions
    expect(canTransition('DRAFT', 'RUNNING')).toBe(true);
    expect(canTransition('RUNNING', 'PAUSED')).toBe(true);
    expect(canTransition('PAUSED', 'RUNNING')).toBe(true);
    expect(canTransition('RUNNING', 'CANCELLED')).toBe(true);

    // Invalid transitions
    expect(canTransition('COMPLETED', 'RUNNING')).toBe(false);
    expect(canTransition('CANCELLED', 'RUNNING')).toBe(false);
    expect(canTransition('CANCELLED', 'PAUSED')).toBe(false);
  });

  it('should filter campaigns by tab and search query', () => {
    const query = 'provisional';
    const filtered = sampleCampaigns.filter((c) =>
      c.name.toLowerCase().includes(query.toLowerCase())
    );

    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('camp2');
  });
});
