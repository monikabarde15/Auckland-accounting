import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { CampaignStatus, QuestionType, NextAction } from '@prisma/client';
import { rbacService } from '../src/services/rbacService.js';

describe('Dynamic Role & Permission Management Integration Tests (Spec §4, §62)', () => {
  const app = createApp();

  let superAdminToken: string;
  let adminToken: string;
  let operatorToken: string;

  let superAdminRoleId: string;
  let adminRoleId: string;
  let operatorRoleId: string;

  let initialAdminPermKeys: string[] = [];
  let initialOperatorPermKeys: string[] = [];

  let testQuestionnaireId: string;
  let testCampaignId: string;

  beforeAll(async () => {
    // 1. Log in all 3 test user personas
    const [saRes, admRes, opRes] = await Promise.all([
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

    expect(saRes.status).toBe(200);
    expect(admRes.status).toBe(200);
    expect(opRes.status).toBe(200);

    superAdminToken = saRes.body.data.accessToken;
    adminToken = admRes.body.data.accessToken;
    operatorToken = opRes.body.data.accessToken;

    // 2. Fetch role IDs and record initial permissions for cleanup
    const roles = await prisma.role.findMany();
    superAdminRoleId = roles.find((r) => r.name === 'SUPER_ADMIN')!.id;
    adminRoleId = roles.find((r) => r.name === 'ADMIN')!.id;
    operatorRoleId = roles.find((r) => r.name === 'OPERATOR')!.id;

    const adminRole = await rbacService.getRoleById(adminRoleId);
    initialAdminPermKeys = adminRole.permissionKeys;
    const operatorRole = await rbacService.getRoleById(operatorRoleId);
    initialOperatorPermKeys = operatorRole.permissionKeys;

    // 3. Create test contact with consent
    let contact = await prisma.contact.findFirst({ where: { isDoNotCall: false } });
    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          name: 'RBAC Dynamic Test Client',
          phoneNumber: '+64215556677',
          email: 'rbac.test@client.co.nz',
          isDoNotCall: false
        }
      });
    }

    // 4. Create test questionnaire and campaign for dynamic execution tests
    const questionnaire = await prisma.questionnaire.create({
      data: {
        title: `Dynamic RBAC Test Flow ${Date.now()}`,
        questions: {
          create: {
            name: 'Consent Check',
            questionText: 'Do you confirm your tax return?',
            type: QuestionType.YES_NO,
            orderNo: 1,
            options: {
              create: [
                { optionKey: '1', optionLabel: 'Yes', nextAction: NextAction.END_CALL },
                { optionKey: '2', optionLabel: 'No', nextAction: NextAction.END_CALL }
              ]
            }
          }
        }
      },
      include: { questions: true }
    });
    testQuestionnaireId = questionnaire.id;

    await prisma.questionnaire.update({
      where: { id: testQuestionnaireId },
      data: { startingQuestionId: questionnaire.questions[0].id }
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: `Dynamic RBAC Test Campaign ${Date.now()}`,
        status: CampaignStatus.DRAFT,
        callerId: '+6498370000',
        callingStartTime: '00:00',
        callingEndTime: '23:59',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        questionnaireId: testQuestionnaireId
      }
    });
    testCampaignId = campaign.id;

    await prisma.campaignContact.create({
      data: {
        campaignId: testCampaignId,
        contactId: contact.id,
        status: 'PENDING'
      }
    });
  });

  afterAll(async () => {
    // Reset admin & operator permissions to default seeded state
    rbacService.invalidatePermissionCache();

    if (testCampaignId) {
      await prisma.campaignContact.deleteMany({ where: { campaignId: testCampaignId } });
      await prisma.callJob.deleteMany({ where: { campaignId: testCampaignId } });
      await prisma.campaign.deleteMany({ where: { id: testCampaignId } });
    }
    if (testQuestionnaireId) {
      await prisma.questionOption.deleteMany({ where: { question: { questionnaireId: testQuestionnaireId } } });
      await prisma.question.deleteMany({ where: { questionnaireId: testQuestionnaireId } });
      await prisma.questionnaire.deleteMany({ where: { id: testQuestionnaireId } });
    }
  });

  describe('1. Roles & Permissions Discovery API', () => {
    it('SUPER_ADMIN can list all available system permissions grouped by module', async () => {
      const res = await request(app)
        .get('/api/roles/permissions')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.permissions)).toBe(true);
      expect(res.body.data.permissions.length).toBeGreaterThanOrEqual(25);
      expect(res.body.data.grouped).toBeDefined();
      expect(res.body.data.grouped['Campaigns & Calling']).toBeDefined();
      expect(res.body.data.grouped['Contacts & CRM']).toBeDefined();
    });

    it('SUPER_ADMIN can list all roles with user counts and assigned permissions', async () => {
      const res = await request(app)
        .get('/api/roles')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.roles)).toBe(true);

      const superAdminRole = res.body.data.roles.find((r: any) => r.name === 'SUPER_ADMIN');
      const adminRole = res.body.data.roles.find((r: any) => r.name === 'ADMIN');
      const opRole = res.body.data.roles.find((r: any) => r.name === 'OPERATOR');

      expect(superAdminRole).toBeDefined();
      expect(superAdminRole.isSystemProtected).toBe(true);
      expect(adminRole).toBeDefined();
      expect(adminRole.isSystemProtected).toBe(false);
      expect(opRole).toBeDefined();
      expect(opRole.isSystemProtected).toBe(false);
    });

    it('ADMIN is denied from accessing Roles & Permissions management (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/roles')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('OPERATOR is denied from accessing Roles & Permissions management (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/roles')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('2. Dynamic Permission Enforcement: ADMIN Campaign Launch', () => {
    it('Initial State: ADMIN has "campaigns.start" and can transition campaign to RUNNING', async () => {
      // Ensure admin has campaigns.start and campaigns.manage
      const currentRole = await rbacService.getRoleById(adminRoleId);
      const needed = ['campaigns.start', 'campaigns.manage', 'campaigns.view'];
      const missing = needed.filter((k) => !currentRole.permissionKeys.includes(k));
      if (missing.length > 0) {
        await rbacService.updateRolePermissions(
          adminRoleId,
          [...currentRole.permissionKeys, ...missing],
          'test-setup',
          'SUPER_ADMIN'
        );
      }

      // Reset campaign to DRAFT
      await prisma.campaign.update({
        where: { id: testCampaignId },
        data: { status: CampaignStatus.DRAFT }
      });

      const res = await request(app)
        .post(`/api/campaigns/${testCampaignId}/start`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(CampaignStatus.RUNNING);
    });

    it('SUPER_ADMIN revokes "campaigns.start" from ADMIN', async () => {
      const currentRole = await rbacService.getRoleById(adminRoleId);
      // Filter out both campaigns.start and campaigns.manage wildcard
      const filteredKeys = currentRole.permissionKeys.filter(
        (k) => k !== 'campaigns.start' && k !== 'campaigns.manage' && k !== 'all.manage' && k !== '*'
      );

      const res = await request(app)
        .put(`/api/roles/${adminRoleId}/permissions`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ permissions: filteredKeys });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.role.permissionKeys).not.toContain('campaigns.start');

      // Verify audit log created
      const auditEntry = await prisma.auditLog.findFirst({
        where: { action: 'ROLE_PERMISSIONS_UPDATED', entityId: adminRoleId },
        orderBy: { timestamp: 'desc' }
      });
      expect(auditEntry).toBeDefined();
      expect(auditEntry?.details).toContain('campaigns.start');
    });

    it('ADMIN is immediately BLOCKED from starting campaigns (403 Forbidden)', async () => {
      // Reset campaign to DRAFT
      await prisma.campaign.update({
        where: { id: testCampaignId },
        data: { status: CampaignStatus.DRAFT }
      });

      const res = await request(app)
        .post(`/api/campaigns/${testCampaignId}/start`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('campaigns.start');
    });

    it('SUPER_ADMIN re-grants "campaigns.start" to ADMIN', async () => {
      const currentRole = await rbacService.getRoleById(adminRoleId);
      const restoredKeys = [...currentRole.permissionKeys, 'campaigns.start', 'campaigns.manage'];

      const res = await request(app)
        .put(`/api/roles/${adminRoleId}/permissions`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ permissions: restoredKeys });

      expect(res.status).toBe(200);
      expect(res.body.data.role.permissionKeys).toContain('campaigns.start');
    });

    it('ADMIN can now start campaign again (200 OK)', async () => {
      // Reset campaign to DRAFT
      await prisma.campaign.update({
        where: { id: testCampaignId },
        data: { status: CampaignStatus.DRAFT }
      });

      const res = await request(app)
        .post(`/api/campaigns/${testCampaignId}/start`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(CampaignStatus.RUNNING);
    });
  });

  describe('3. Dynamic Permission Enforcement: OPERATOR Report Export', () => {
    it('Initial State: OPERATOR lacks "reports.export" and is blocked from exporting calls CSV (403 Forbidden)', async () => {
      // Ensure operator does NOT have reports.export
      const currentRole = await rbacService.getRoleById(operatorRoleId);
      const filteredKeys = currentRole.permissionKeys.filter((k) => k !== 'reports.export');
      await rbacService.updateRolePermissions(
        operatorRoleId,
        filteredKeys,
        'test-setup',
        'SUPER_ADMIN'
      );

      const res = await request(app)
        .get('/api/reports/export/calls')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('reports.export');
    });

    it('SUPER_ADMIN dynamically grants "reports.export" to OPERATOR', async () => {
      const currentRole = await rbacService.getRoleById(operatorRoleId);
      const newKeys = [...currentRole.permissionKeys, 'reports.export'];

      const res = await request(app)
        .put(`/api/roles/${operatorRoleId}/permissions`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ permissions: newKeys });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.role.permissionKeys).toContain('reports.export');
    });

    it('OPERATOR can now export calls CSV immediately (200 OK)', async () => {
      const res = await request(app)
        .get('/api/reports/export/calls')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
    });
  });

  describe('4. Security Safeguards & SUPER_ADMIN Protection', () => {
    it('Attempting to modify SUPER_ADMIN permissions is strictly rejected (400 Bad Request)', async () => {
      const res = await request(app)
        .put(`/api/roles/${superAdminRoleId}/permissions`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ permissions: ['contacts.view'] });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('SUPER_ADMIN permissions are system-protected');
    });

    it('ADMIN cannot modify OPERATOR or ADMIN permissions (403 Forbidden)', async () => {
      const res = await request(app)
        .put(`/api/roles/${operatorRoleId}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ permissions: ['contacts.view'] });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('SUPER_ADMIN always retains unrestricted access regardless of permission configuration', async () => {
      // SUPER_ADMIN can execute any action (e.g. view reports, export, delete campaign, etc.)
      const res = await request(app)
        .get('/api/reports/summary')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  afterAll(async () => {
    // Restore baseline permissions for ADMIN and OPERATOR to keep test DB clean
    if (adminRoleId && initialAdminPermKeys.length > 0) {
      await rbacService.updateRolePermissions(adminRoleId, initialAdminPermKeys, 'test-cleanup', 'SUPER_ADMIN');
    }
    if (operatorRoleId && initialOperatorPermKeys.length > 0) {
      await rbacService.updateRolePermissions(operatorRoleId, initialOperatorPermKeys, 'test-cleanup', 'SUPER_ADMIN');
    }
  });
});
