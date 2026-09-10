import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('Acula RBAC Authorization Tests (Workstream A)', () => {
  const app = createApp();

  let superAdminToken: string;
  let adminToken: string;
  let operatorToken: string;

  beforeAll(async () => {
    // Login as Super Admin
    const saRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'superadmin@aucklandaccounting.co.nz',
        password: 'AculaSuperAdmin2026!'
      });
    superAdminToken = saRes.body.data.accessToken;

    // Login as Admin
    const admRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'admin@aucklandaccounting.co.nz',
        password: 'AculaAdmin2026!'
      });
    adminToken = admRes.body.data.accessToken;

    // Login as Operator
    const opRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'operator@aucklandaccounting.co.nz',
        password: 'AculaOperator2026!'
      });
    operatorToken = opRes.body.data.accessToken;
  });

  describe('Strict 401 vs 403 Authorization Boundary', () => {
    const dummyCuid = 'cmtl9nekr000gv4nss8msqa99';

    it('should return 401 Unauthorized when request has no credentials', async () => {
      const res = await request(app)
        .patch(`/api/auth/users/${dummyCuid}/status`)
        .send({ isActive: false });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 403 Forbidden when Operator attempts Super Admin action', async () => {
      const res = await request(app)
        .patch(`/api/auth/users/${dummyCuid}/status`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ isActive: false });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('Access denied');
    });

    it('should return 403 Forbidden when Admin attempts Super Admin action', async () => {
      const res = await request(app)
        .patch(`/api/auth/users/${dummyCuid}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('should allow Super Admin through authorization gate', async () => {
      const res = await request(app)
        .patch(`/api/auth/users/${dummyCuid}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ isActive: false });

      // Because dummyCuid does not exist in DB, it passes 403 authorization check and reaches DB query, returning 404 Not Found
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
