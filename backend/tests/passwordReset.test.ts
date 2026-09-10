import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/services/prisma.js';
import { hashPassword } from '../src/utils/password.js';

describe('Acula Password Reset Workflow Tests (Workstream A)', () => {
  const app = createApp();
  const resetEmail = 'reset_test_user@aucklandaccounting.co.nz';
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.upsert({
      where: { email: resetEmail },
      update: {
        passwordHash: await hashPassword('InitialPass123!'),
        isActive: true
      },
      create: {
        email: resetEmail,
        name: 'Reset Test User',
        passwordHash: await hashPassword('InitialPass123!'),
        isActive: true
      }
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.passwordResetToken.deleteMany({ where: { userId } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('should return neutral confirmation on forgot-password request', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: resetEmail });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toContain('If an account exists');
    expect(res.body.data.developmentToken).toBeDefined();
  });

  it('should return neutral confirmation for nonexistent user to prevent enumeration', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'ghost_account_99@aucklandaccounting.co.nz' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toContain('If an account exists');
  });

  it('should complete password reset with valid token and invalidate token after use', async () => {
    // 1. Request reset
    const forgotRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: resetEmail });
    const token = forgotRes.body.data.developmentToken;
    expect(token).toBeDefined();

    // 2. Perform reset
    const resetRes = await request(app)
      .post('/api/auth/reset-password')
      .send({
        token,
        password: 'NewStrongPassword2026!'
      });

    expect(resetRes.status).toBe(200);
    expect(resetRes.body.success).toBe(true);

    // 3. Attempt reuse of same token must be rejected
    const reuseRes = await request(app)
      .post('/api/auth/reset-password')
      .send({
        token,
        password: 'AnotherPassword2026!'
      });

    expect(reuseRes.status).toBe(400);
    expect(reuseRes.body.success).toBe(false);

    // 4. Verify login succeeds with new password
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: resetEmail,
        password: 'NewStrongPassword2026!'
      });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.success).toBe(true);
  });

  it('should reject reset request with invalid token', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({
        token: 'invalid-nonexistent-token-hex-1234567890',
        password: 'ValidPassword123!'
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
