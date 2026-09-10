import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/services/prisma.js';

describe('Phase 3: Multi-Step CSV Import Integration Tests', () => {
  const app = createApp();

  let adminToken: string;
  let operatorToken: string;
  let testGroupId: string;
  const importedPhoneNumbers: string[] = [];

  beforeAll(async () => {
    const [adm, op] = await Promise.all([
      request(app).post('/api/auth/login').send({
        email: 'admin@aucklandaccounting.co.nz',
        password: 'AculaAdmin2026!'
      }),
      request(app).post('/api/auth/login').send({
        email: 'operator@aucklandaccounting.co.nz',
        password: 'AculaOperator2026!'
      })
    ]);

    adminToken = adm.body.data.accessToken;
    operatorToken = op.body.data.accessToken;

    // Create target group for import
    const grp = await prisma.contactGroup.create({
      data: {
        name: 'CSV Test Batch Group',
        description: 'Temporary group for CSV testing'
      }
    });
    testGroupId = grp.id;

    // Add a number to DNC list to test suppression during CSV import
    await prisma.dncRecord.upsert({
      where: { phoneNumber: '+64219991111' },
      update: { isActive: true },
      create: {
        phoneNumber: '+64219991111',
        reason: 'Pre-existing DNC suppression',
        isActive: true
      }
    });
  });

  afterAll(async () => {
    if (testGroupId) {
      await prisma.contactGroupMember.deleteMany({ where: { groupId: testGroupId } });
      await prisma.contactGroup.deleteMany({ where: { id: testGroupId } });
    }
    if (importedPhoneNumbers.length > 0) {
      await prisma.contact.deleteMany({
        where: { phoneNumber: { in: importedPhoneNumbers } }
      });
    }
    await prisma.dncRecord.deleteMany({ where: { phoneNumber: '+64219991111' } });
  });

  const sampleCsvData = `Name,Company,Phone,Email,Entity Type,Balance,Due Date
Alice Robinson,Robinson Bakery Ltd,021 888 1001,alice@robinsonbakery.co.nz,Company,1500.00,2026-09-28
Bob Walker,Walker Transport,021 888 1002,bob@walkertransport.co.nz,Company,3200.50,2026-09-28
Invalid Guy,Bad Phone Entity,123,invalid@badphone.co.nz,Company,0.00,2026-09-28
Suppressed Person,Blocked Inc,021 999 1111,dnc@blocked.co.nz,Company,500.00,2026-09-28
Alice Duplicate,Duplicate In File,021 888 1001,alice.dup@robinson.co.nz,Company,1500.00,2026-09-28`;

  let previewData: any;

  describe('Step 1: CSV Preview, Normalization & Validation', () => {
    it('should deny OPERATOR from previewing CSV import (403)', async () => {
      const res = await request(app)
        .post('/api/contacts/import/preview')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ csvContent: sampleCsvData });

      expect(res.status).toBe(403);
    });

    it('should parse CSV and return accurate validation & deduplication breakdown', async () => {
      const res = await request(app)
        .post('/api/contacts/import/preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ csvContent: sampleCsvData });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      previewData = data;

      expect(data.totalRows).toBe(5);
      expect(data.validCount).toBe(2); // Alice Robinson & Bob Walker
      expect(data.invalidCount).toBe(1); // Invalid Guy (bad phone: 123)
      expect(data.dncBlockedCount).toBe(1); // Suppressed Person (+64219991111 on DNC)
      expect(data.duplicateInFileCount).toBe(1); // Alice Duplicate (same phone in file)

      expect(data.previewRows.length).toBe(5);
      expect(data.previewRows[0].normalizedPhone).toBe('+64218881001');
      expect(data.previewRows[1].normalizedPhone).toBe('+64218881002');
      expect(data.previewRows[2].status).toBe('INVALID_DATA');
      expect(data.previewRows[3].status).toBe('DNC_BLOCKED');
      expect(data.previewRows[4].status).toBe('DUPLICATE_IN_FILE');
    });
  });

  describe('Step 2: CSV Import Confirmation & Transactional Commit', () => {
    it('should commit valid rows and assign them to target group', async () => {
      const res = await request(app)
        .post('/api/contacts/import/confirm')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          rows: previewData.parsedRows,
          targetGroupId: testGroupId,
          duplicateStrategy: 'SKIP'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const summary = res.body.data;
      expect(summary.totalRows).toBe(5);
      expect(summary.importedCount).toBe(3); // 2 valid + 1 DNC blocked (imported with isDoNotCall = true)
      expect(summary.skippedCount).toBe(1); // 1 duplicate skipped
      expect(summary.errorsCount).toBe(1); // 1 invalid skipped

      importedPhoneNumbers.push('+64218881001', '+64218881002', '+64219991111');

      // Verify contact in database
      const bob = await prisma.contact.findFirst({
        where: { phoneNumber: '+64218881002' }
      });
      expect(bob).toBeDefined();
      expect(bob?.name).toBe('Bob Walker');
      expect(bob?.isDoNotCall).toBe(false);

      // Verify DNC blocked contact is marked isDoNotCall = true in DB
      const dncContact = await prisma.contact.findFirst({
        where: { phoneNumber: '+64219991111' }
      });
      expect(dncContact).toBeDefined();
      expect(dncContact?.isDoNotCall).toBe(true);
      expect(dncContact?.consentStatus).toBe('REVOKED');

      // Verify group membership
      const members = await prisma.contactGroupMember.findMany({
        where: { groupId: testGroupId }
      });
      expect(members.length).toBeGreaterThanOrEqual(3);

      // Verify audit log
      const auditLog = await prisma.auditLog.findFirst({
        where: { action: 'CONTACTS_IMPORTED' },
        orderBy: { timestamp: 'desc' }
      });
      expect(auditLog).toBeDefined();
      expect(auditLog?.details).toContain('Batch CSV imported');
    });
  });
});
