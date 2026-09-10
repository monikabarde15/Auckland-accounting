import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../src/app.js';

describe('Zod Validation & Standardization Tests', () => {
  const app = createApp();

  it('should return 422 with field-level details when payload is invalid', async () => {
    const res = await request(app)
      .post('/api/auth/validate-credentials')
      .send({
        email: 'invalid-email-string',
        password: 'short'
      });

    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(res.body.error).toHaveProperty('message', 'Request validation failed');
    expect(Array.isArray(res.body.error.details)).toBe(true);

    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toContain('email');
    expect(fields).toContain('password');
  });

  it('should return 200 when payload satisfies schema', async () => {
    const res = await request(app)
      .post('/api/auth/validate-credentials')
      .send({
        email: 'test.admin@aucklandaccounting.co.nz',
        password: 'valid-password-1234'
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body.data).toHaveProperty('email', 'test.admin@aucklandaccounting.co.nz');
  });

  it('should reject invalid environment configuration safely', () => {
    const testSchema = z.object({
      NODE_ENV: z.enum(['development', 'test', 'production']),
      PORT: z.coerce.number().min(1000).max(65535),
      DATABASE_URL: z.string().url()
    });

    const invalidResult = testSchema.safeParse({
      NODE_ENV: 'invalid_env',
      PORT: 'invalid_port',
      DATABASE_URL: 'not-a-url'
    });

    expect(invalidResult.success).toBe(false);
  });
});
