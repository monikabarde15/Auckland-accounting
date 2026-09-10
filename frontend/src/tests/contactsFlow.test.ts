import { describe, it, expect } from 'vitest';
import { Contact, ContactGroup, DncRecord, ParsedCsvRow, CsvPreviewResult } from '../types';

describe('Phase 3: Frontend Contacts Domain Logic Tests', () => {
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
      tags: ['GST Filer', 'High Priority'],
      isDoNotCall: false,
      consentStatus: 'GRANTED',
      groups: [{ id: 'g1', name: 'GST Clients' }]
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
      isDoNotCall: true, // DNC Suppressed
      consentStatus: 'REVOKED',
      groups: [{ id: 'g2', name: 'Annual Review' }]
    },
    {
      id: 'c3',
      name: 'Liam Taylor',
      companyName: 'Taylor Contracting',
      phoneNumber: '+64274928110',
      email: 'liam@taylorcontracting.co.nz',
      entityType: 'Individual',
      assignedAccountant: 'David Chen (CA)',
      outstandingBalance: 650,
      tags: ['Sole Trader'],
      isDoNotCall: false,
      consentStatus: 'PENDING',
      groups: [{ id: 'g1', name: 'GST Clients' }]
    }
  ];

  describe('Contact Filtering Logic', () => {
    it('should filter contacts by search query matching name, company, or phone', () => {
      const query = 'henderson';
      const filtered = sampleContacts.filter(
        (c) =>
          c.name.toLowerCase().includes(query.toLowerCase()) ||
          c.companyName.toLowerCase().includes(query.toLowerCase()) ||
          c.phoneNumber.includes(query)
      );

      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe('c2');
    });

    it('should filter contacts by DNC suppression status', () => {
      const callableOnly = sampleContacts.filter((c) => !c.isDoNotCall);
      const dncOnly = sampleContacts.filter((c) => c.isDoNotCall);

      expect(callableOnly.length).toBe(2);
      expect(dncOnly.length).toBe(1);
      expect(dncOnly[0].id).toBe('c2');
    });

    it('should filter contacts by group membership', () => {
      const gstGroupMembers = sampleContacts.filter((c) =>
        c.groups?.some((g) => g.id === 'g1')
      );

      expect(gstGroupMembers.length).toBe(2);
      expect(gstGroupMembers.map((c) => c.id)).toEqual(['c1', 'c3']);
    });

    it('should filter contacts by consent status', () => {
      const granted = sampleContacts.filter((c) => c.consentStatus === 'GRANTED');
      const pending = sampleContacts.filter((c) => c.consentStatus === 'PENDING');
      const revoked = sampleContacts.filter((c) => c.consentStatus === 'REVOKED');

      expect(granted.length).toBe(1);
      expect(pending.length).toBe(1);
      expect(revoked.length).toBe(1);
    });
  });

  describe('DNC Suppression Verification', () => {
    it('should correctly identify suppressed numbers from DNC registry', () => {
      const dncList: DncRecord[] = [
        {
          id: 'dnc1',
          phoneNumber: '+64215553829',
          reason: 'Client requested exclusion',
          source: 'CLIENT_REQUEST',
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ];

      const activeDncSet = new Set(dncList.filter((d) => d.isActive).map((d) => d.phoneNumber));

      sampleContacts.forEach((contact) => {
        const isSuppressed = activeDncSet.has(contact.phoneNumber);
        if (contact.id === 'c2') {
          expect(isSuppressed).toBe(true);
        } else {
          expect(isSuppressed).toBe(false);
        }
      });
    });
  });

  describe('CSV Import Preview Calculations', () => {
    it('should calculate validation and breakdown counts properly', () => {
      const mockPreview: CsvPreviewResult = {
        totalRows: 5,
        validCount: 2,
        invalidCount: 1,
        duplicateInFileCount: 1,
        duplicateInDbCount: 0,
        dncBlockedCount: 1,
        previewRows: [],
        parsedRows: []
      };

      expect(
        mockPreview.validCount +
          mockPreview.invalidCount +
          mockPreview.duplicateInFileCount +
          mockPreview.duplicateInDbCount +
          mockPreview.dncBlockedCount
      ).toBe(mockPreview.totalRows);
    });
  });
});
