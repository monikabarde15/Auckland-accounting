import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/services/prisma.js';

describe('Phase 3: Do-Not-Call (DNC) Registry & Suppression Tests', () => {
  const app = createApp();

  let superAdminToken: string;
  let adminToken: string;
  let operatorToken: string;
  let testDncId: string;
  let testContactId: string;

  const testPhoneRaw = '021 777 9999';
  const testPhoneE164 = '+64217779999';

  beforeAll(async () => {
    const [sa, adm, op] = await Promise.all([
      request(app).post('/api/auth/login').send({
        email: 'superadmin@aucklandaccounting.co.nz',
        password: 'AculaSuperAdmin2026!'
      }),
      request(app).post('/api/auth/login').send({
        email: 'admin@aucklandaccounting.co.nz',
        password: 'AculaAdmin2026!'
      }),
      request(app).post('/api/auth/login').send({
        email: 'operator@aucklandaccounting.co.nz',
        password: 'AculaOperator2026!'
      })
    ]);

    superAdminToken = sa.body.data.accessToken;
    adminToken = adm.body.data.accessToken;
    operatorToken = op.body.data.accessToken;

    // Create a contact that starts as callable (isDoNotCall = false)
    const c = await prisma.contact.create({
      data: {
        name: 'DNC Test Client',
        companyName: 'Waitakere Landscaping',
        phoneNumber: testPhoneE164,
        isDoNotCall: false,
        callPermission: true
      }
    });
    testContactId = c.id;
  });

  afterAll(async () => {
    if (testDncId) {
      await prisma.dncRecord.deleteMany({ where: { id: testDncId } });
    }
    if (testContactId) {
      await prisma.contact.deleteMany({ where: { id: testContactId } });
    }
    await prisma.dncRecord.deleteMany({ where: { phoneNumber: testPhoneE164 } });
  });

  describe('DNC Addition & Automatic Contact Suppression', () => {
    it('should allow ADMIN to add a phone number to DNC registry using local format', async () => {
      const res = await request(app)
        .post('/api/dnc')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          phoneNumber: testPhoneRaw, // '021 777 9999'
          reason: 'Customer requested exclusion during call',
          source: 'CLIENT_REQUEST'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.phoneNumber).toBe(testPhoneE164); // Stored in canonical E.164!
      expect(res.body.data.isActive).toBe(true);

      testDncId = res.body.data.id;
    });

    it('should automatically synchronize existing contacts with that number to isDoNotCall = true', async () => {
      const contact = await prisma.contact.findUnique({
        where: { id: testContactId }
      });

      expect(contact).toBeDefined();
      expect(contact?.isDoNotCall).toBe(true); // Automatically suppressed by backend!
    });

    it('should confirm suppression via /api/dnc/check/:phoneNumber', async () => {
      const res = await request(app)
        .get(`/api/dnc/check/${encodeURIComponent(testPhoneRaw)}`)
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.isSuppressed).toBe(true);
      expect(res.body.data.normalizedPhone).toBe(testPhoneE164);
    });
  });

  describe('DNC Listing & Search', () => {
    it('should list DNC records with pagination', async () => {
      const res = await request(app)
        .get('/api/dnc')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.records)).toBe(true);
      expect(res.body.data.pagination).toBeDefined();
      expect(res.body.data.records.some((r: any) => r.phoneNumber === testPhoneE164)).toBe(true);
    });

    it('should search DNC records by number or keyword', async () => {
      const res = await request(app)
        .get('/api/dnc?search=7779999')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.records.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('DNC Removal & Audit Logging', () => {
    it('should deny OPERATOR from removing a number from DNC (403)', async () => {
      const res = await request(app)
        .delete(`/api/dnc/${testDncId}`)
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(403);
    });

    it('should allow SUPER_ADMIN to remove number from DNC suppression list', async () => {
      const res = await request(app)
        .delete(`/api/dnc/${testDncId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);

      // Verify number is no longer suppressed
      const checkRes = await request(app)
        .get(`/api/dnc/check/${encodeURIComponent(testPhoneE164)}`)
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(checkRes.body.data.isSuppressed).toBe(false);
    });

    it('should record audit log for DNC actions', async () => {
      const logs = await prisma.auditLog.findMany({
        where: {
          action: { in: ['DNC_ADDED', 'DNC_REMOVED'] },
          entityId: testDncId
        }
      });

      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs.some((l) => l.action === 'DNC_ADDED')).toBe(true);
    });
  });
});
