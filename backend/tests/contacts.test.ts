import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/services/prisma.js';

describe('Phase 3: Contacts API Integration Tests', () => {
  const app = createApp();

  let superAdminToken: string;
  let adminToken: string;
  let operatorToken: string;
  let testContactId: string;

  beforeAll(async () => {
    // Login tokens
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
  });

  afterAll(async () => {
    // Cleanup test contact
    if (testContactId) {
      await prisma.contact.deleteMany({ where: { id: testContactId } });
    }
  });

  describe('Authentication & Authorization Guards', () => {
    it('should return 401 Unauthorized when requesting contacts without a token', async () => {
      const res = await request(app).get('/api/contacts');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should allow OPERATOR to read contacts list', async () => {
      const res = await request(app)
        .get('/api/contacts')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.contacts)).toBe(true);
      expect(res.body.data.pagination).toBeDefined();
    });

    it('should deny OPERATOR from creating contacts (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/contacts')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          name: 'Forbidden Contact',
          phoneNumber: '021 999 8888'
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Contact Creation & Phone Normalization', () => {
    it('should create a contact and automatically normalize NZ phone number to E.164', async () => {
      const res = await request(app)
        .post('/api/contacts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Liam Henderson',
          companyName: 'West Auckland Joinery Ltd',
          phoneNumber: '021 555 4321', // Local NZ format
          email: 'liam@westaucklandjoinery.co.nz',
          entityType: 'COMPANY',
          irdNumber: '098-765-432',
          outstandingBalance: 1250.50,
          tags: ['Joinery', 'GST Filer']
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Liam Henderson');
      expect(res.body.data.phoneNumber).toBe('+64215554321'); // Normalized E.164!
      expect(res.body.data.consentStatus).toBe('GRANTED');
      expect(res.body.data.isDoNotCall).toBe(false);

      testContactId = res.body.data.id;
    });

    it('should reject invalid phone numbers with 400 Bad Request or 422 Unprocessable Entity', async () => {
      // Test invalid phone number that passes basic length but fails normalization
      const res = await request(app)
        .post('/api/contacts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Invalid Phone Person',
          phoneNumber: '999999999999999999' // Invalid country/format
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('phone number');
    });
  });

  describe('Search, Filters & Pagination', () => {
    it('should search contacts by name', async () => {
      const res = await request(app)
        .get('/api/contacts?search=Liam')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.contacts.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.contacts.some((c: any) => c.name.includes('Liam'))).toBe(true);
    });

    it('should search contacts by normalized phone number', async () => {
      const res = await request(app)
        .get('/api/contacts?search=+64215554321')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.contacts.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.contacts[0].phoneNumber).toBe('+64215554321');
    });

    it('should filter contacts by isDoNotCall status', async () => {
      const res = await request(app)
        .get('/api/contacts?isDoNotCall=false')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.contacts.every((c: any) => c.isDoNotCall === false)).toBe(true);
    });
  });

  describe('Contact Details & Consent Audit Timeline', () => {
    it('should retrieve contact by ID with consent records', async () => {
      const res = await request(app)
        .get(`/api/contacts/${testContactId}`)
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(testContactId);
      expect(Array.isArray(res.body.data.consentRecords)).toBe(true);
      expect(res.body.data.consentRecords.length).toBeGreaterThanOrEqual(1);
    });

    it('should record a new consent status update with audit log', async () => {
      const res = await request(app)
        .post(`/api/contacts/${testContactId}/consent`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'REVOKED',
          source: 'CLIENT_PORTAL',
          notes: 'Client opted out of automated promotional campaigns'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.contact.consentStatus).toBe('REVOKED');
      expect(res.body.data.contact.callPermission).toBe(false);

      // Verify consent history endpoint
      const histRes = await request(app)
        .get(`/api/contacts/${testContactId}/consent`)
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(histRes.status).toBe(200);
      expect(histRes.body.data.history[0].status).toBe('REVOKED');
      expect(histRes.body.data.history[0].source).toBe('CLIENT_PORTAL');
    });
  });

  describe('Contact Update & Deletion RBAC', () => {
    it('should update contact details', async () => {
      const res = await request(app)
        .put(`/api/contacts/${testContactId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          outstandingBalance: 800.00,
          companyName: 'West Auckland Joinery Specialists Ltd'
        });

      expect(res.status).toBe(200);
      expect(res.body.data.outstandingBalance).toBe(800.00);
      expect(res.body.data.companyName).toBe('West Auckland Joinery Specialists Ltd');
    });

    it('should deny OPERATOR from deleting contact (403 Forbidden)', async () => {
      const res = await request(app)
        .delete(`/api/contacts/${testContactId}`)
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(403);
    });

    it('should allow SUPER_ADMIN to delete contact', async () => {
      const res = await request(app)
        .delete(`/api/contacts/${testContactId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);

      // Verify contact is gone
      const verifyRes = await request(app)
        .get(`/api/contacts/${testContactId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(verifyRes.status).toBe(404);
      testContactId = ''; // Cleared
    });
  });
});
