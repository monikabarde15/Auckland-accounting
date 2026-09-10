import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { hashPassword } from '../src/utils/password.js';

describe('Acula Authentication Tests (Workstream A)', () => {
  const app = createApp();
  let superAdminToken: string;
  let superAdminCookie: string;
  let testUserId: string;

  beforeAll(async () => {
    // Ensure test user exists
    const testUser = await prisma.user.upsert({
      where: { email: 'auth_test_user@aucklandaccounting.co.nz' },
      update: {
        passwordHash: await hashPassword('TestPass123!'),
        isActive: true
      },
      create: {
        email: 'auth_test_user@aucklandaccounting.co.nz',
        name: 'Auth Test User',
        passwordHash: await hashPassword('TestPass123!'),
        isActive: true
      }
    });
    testUserId = testUser.id;
  });

  afterAll(async () => {
    // Clean up test sessions and test user
    await prisma.session.deleteMany({ where: { userId: testUserId } });
    await prisma.user.deleteMany({ where: { email: 'auth_test_user@aucklandaccounting.co.nz' } });
  });

  describe('POST /api/auth/login', () => {
    it('should successfully authenticate with valid credentials and return access token + HttpOnly cookie', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'superadmin@aucklandaccounting.co.nz',
          password: 'AculaSuperAdmin2026!'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe('superadmin@aucklandaccounting.co.nz');
      expect(res.body.data.user.role).toBe('SUPER_ADMIN');
      expect(res.body.data.user.passwordHash).toBeUndefined();
      expect(res.body.data.accessToken).toBeDefined();

      // Check cookie
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const refreshCookie = Array.isArray(cookies) ? cookies.find((c: string) => c.includes('__acula_refresh')) : cookies;
      expect(refreshCookie).toContain('__acula_refresh=');
      expect(refreshCookie).toContain('HttpOnly');

      superAdminToken = res.body.data.accessToken;
      superAdminCookie = refreshCookie;
    });

    it('should reject invalid password with 401 Unauthorized and generic error', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'superadmin@aucklandaccounting.co.nz',
          password: 'WrongPassword999!'
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message).toBe('Invalid email or password');
    });

    it('should reject nonexistent email with 401 without revealing user nonexistence', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'doesnotexist@aucklandaccounting.co.nz',
          password: 'AnyPassword123!'
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message).toBe('Invalid email or password');
    });

    it('should reject deactivated user account', async () => {
      // Temporarily deactivate test user
      await prisma.user.update({
        where: { id: testUserId },
        data: { isActive: false }
      });

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'auth_test_user@aucklandaccounting.co.nz',
          password: 'TestPass123!'
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');

      // Reactivate test user
      await prisma.user.update({
        where: { id: testUserId },
        data: { isActive: true }
      });
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return 200 with safe profile for authenticated user', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe('superadmin@aucklandaccounting.co.nz');
      expect(res.body.data.user.role).toBe('SUPER_ADMIN');
      expect(res.body.data.user.passwordHash).toBeUndefined();
    });

    it('should reject unauthenticated request with 401 Unauthorized', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject tampered or invalid token with 401 Unauthorized', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid.tampered.token');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/auth/refresh & POST /api/auth/logout', () => {
    it('should successfully rotate token on refresh using cookie', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [superAdminCookie]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();

      const newCookies = res.headers['set-cookie'];
      expect(newCookies).toBeDefined();
    });

    it('should successfully logout and invalidate refresh session', async () => {
      // 1. Login to get fresh session
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'auth_test_user@aucklandaccounting.co.nz',
          password: 'TestPass123!'
        });
      expect(loginRes.status).toBe(200);
      const sessionCookie = loginRes.headers['set-cookie'];

      // 2. Logout
      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', sessionCookie);
      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.success).toBe(true);

      // 3. Subsequent refresh with the logged out cookie must fail
      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', sessionCookie);
      expect(refreshRes.status).toBe(401);
      expect(refreshRes.body.success).toBe(false);
    });
  });
});
