import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/services/prisma.js';

describe('Phase 3: Contact Groups Integration Tests', () => {
  const app = createApp();

  let superAdminToken: string;
  let adminToken: string;
  let operatorToken: string;
  let testGroupId: string;
  let testContactId1: string;
  let testContactId2: string;

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

    // Create 2 contacts for group testing
    const c1 = await prisma.contact.create({
      data: {
        name: 'Group Test User 1',
        phoneNumber: '+64211110001',
        companyName: 'Group Test Entity 1'
      }
    });
    testContactId1 = c1.id;

    const c2 = await prisma.contact.create({
      data: {
        name: 'Group Test User 2',
        phoneNumber: '+64211110002',
        companyName: 'Group Test Entity 2'
      }
    });
    testContactId2 = c2.id;
  });

  afterAll(async () => {
    if (testGroupId) {
      await prisma.contactGroupMember.deleteMany({ where: { groupId: testGroupId } });
      await prisma.contactGroup.deleteMany({ where: { id: testGroupId } });
    }
    await prisma.contact.deleteMany({
      where: { id: { in: [testContactId1, testContactId2] } }
    });
  });

  describe('Group CRUD & RBAC', () => {
    it('should allow OPERATOR to view groups list', async () => {
      const res = await request(app)
        .get('/api/contacts/groups')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should deny OPERATOR from creating a group (403)', async () => {
      const res = await request(app)
        .post('/api/contacts/groups')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ name: 'Operator Attempt Group' });

      expect(res.status).toBe(403);
    });

    it('should allow ADMIN to create a group', async () => {
      const res = await request(app)
        .post('/api/contacts/groups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Henderson Sole Traders Q3',
          description: 'Sole traders due for interim GST reviews'
        });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('Henderson Sole Traders Q3');
      testGroupId = res.body.data.id;
    });

    it('should reject duplicate group names with 400', async () => {
      const res = await request(app)
        .post('/api/contacts/groups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Henderson Sole Traders Q3' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('already exists');
    });

    it('should update group description', async () => {
      const res = await request(app)
        .put(`/api/contacts/groups/${testGroupId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ description: 'Updated group scope for Q3' });

      expect(res.status).toBe(200);
      expect(res.body.data.description).toBe('Updated group scope for Q3');
    });
  });

  describe('Group Membership Management', () => {
    it('should add contacts to group without duplicates', async () => {
      const res = await request(app)
        .post(`/api/contacts/groups/${testGroupId}/members`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ contactIds: [testContactId1, testContactId2] });

      expect(res.status).toBe(200);
      expect(res.body.data.addedCount).toBe(2);

      // Try adding same contacts again (should skip duplicates)
      const resDuplicate = await request(app)
        .post(`/api/contacts/groups/${testGroupId}/members`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ contactIds: [testContactId1, testContactId2] });

      expect(resDuplicate.status).toBe(200);
      expect(resDuplicate.body.data.addedCount).toBe(0); // 0 added because already present
    });

    it('should view group members', async () => {
      const res = await request(app)
        .get(`/api/contacts/groups/${testGroupId}`)
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.group.memberCount).toBe(2);
      expect(res.body.data.members.length).toBe(2);
      expect(res.body.data.members.some((m: any) => m.id === testContactId1)).toBe(true);
    });

    it('should remove a member from group', async () => {
      const res = await request(app)
        .delete(`/api/contacts/groups/${testGroupId}/members/${testContactId1}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);

      // Verify member count decreased to 1
      const checkRes = await request(app)
        .get(`/api/contacts/groups/${testGroupId}`)
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(checkRes.body.data.group.memberCount).toBe(1);
    });
  });

  describe('Group Deletion', () => {
    it('should allow SUPER_ADMIN to delete group', async () => {
      const res = await request(app)
        .delete(`/api/contacts/groups/${testGroupId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.deletedId).toBe(testGroupId);

      testGroupId = '';
    });
  });
});
