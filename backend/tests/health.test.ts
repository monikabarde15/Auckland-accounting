import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { checkDatabaseHealth } from '../src/services/prisma.js';
import { checkRedisHealth } from '../src/services/redis.js';

describe('Acula Backend Foundation Tests', () => {
  const app = createApp();

  describe('GET /api/health', () => {
    it('should return 200 with standard health telemetry shape', async () => {
      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('data');
      expect(res.body.data).toHaveProperty('service', 'acula-api');
      expect(res.body.data).toHaveProperty('version', '1.0.0');
      expect(res.body.data).toHaveProperty('database');
      expect(res.body.data.database).toHaveProperty('connected', true);
      expect(res.body.data.database).toHaveProperty('status', 'healthy');
      expect(res.body.data).toHaveProperty('redis');
      // Redis is resilient: whether connected or unavailable, it reports status cleanly
      expect(['healthy', 'unavailable']).toContain(res.body.data.redis.status);
    });

    it('should include x-request-id in response headers', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers).toHaveProperty('x-request-id');
      expect(typeof res.headers['x-request-id']).toBe('string');
    });

    it('should preserve incoming x-request-id header', async () => {
      const customId = 'test-client-trace-12345';
      const res = await request(app)
        .get('/api/health')
        .set('x-request-id', customId);

      expect(res.headers['x-request-id']).toBe(customId);
    });
  });

  describe('Protected Foundation: GET /api/auth/me', () => {
    it('should reject unauthenticated request with 401 Unauthorized in standard envelope', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required. Session or Bearer token missing.'
        }
      });
    });
  });

  describe('404 Route Handling', () => {
    it('should return standardized 404 response for unknown routes', async () => {
      const res = await request(app).get('/api/non-existent-endpoint');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Cannot GET /api/non-existent-endpoint'
        }
      });
    });
  });

  describe('Database & Redis Service Health', () => {
    it('checkDatabaseHealth should return connected: true for PostgreSQL', async () => {
      const dbHealth = await checkDatabaseHealth();
      expect(dbHealth.connected).toBe(true);
      expect(dbHealth.status).toBe('healthy');
      expect(typeof dbHealth.latencyMs).toBe('number');
    });

    it('checkRedisHealth should report status without throwing unhandled exceptions', async () => {
      const redisHealth = await checkRedisHealth();
      expect(typeof redisHealth.connected).toBe('boolean');
      expect(typeof redisHealth.status).toBe('string');
    });
  });
});
