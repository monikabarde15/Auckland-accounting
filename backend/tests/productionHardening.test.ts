import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { createApp } from '../src/app.js';
import { validateEnvConfig, envSchema } from '../src/config/env.js';
import { createDatabaseSnapshot } from '../src/utils/dbBackup.js';

describe('Phase 7: Production Hardening, Environment & Infrastructure Verification', () => {
  const app = createApp();

  describe('1. Production Environment Schema & Invariants', () => {
    it('should default ENABLE_LIVE_CALLING to false if unspecified', () => {
      const parsed = envSchema.safeParse({
        NODE_ENV: 'development',
        PORT: 5000,
        DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/auckland_accounting_db?schema=public'
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.ENABLE_LIVE_CALLING).toBe(false);
      }
    });

    it('should REJECT development JWT secret in production mode', () => {
      const parsed = envSchema.safeParse({
        NODE_ENV: 'production',
        PORT: 5000,
        DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/auckland_accounting_db?schema=public',
        JWT_SECRET: 'development-jwt-secret-min-16-chars', // Dev default
        JWT_REFRESH_SECRET: 'a-random-production-secret-of-32-chars-length'
      });
      expect(parsed.success).toBe(false);
    });

    it('should REJECT short (<32 chars) JWT secrets in production mode', () => {
      const parsed = envSchema.safeParse({
        NODE_ENV: 'production',
        PORT: 5000,
        DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/auckland_accounting_db?schema=public',
        JWT_SECRET: 'short-secret-20-chars',
        JWT_REFRESH_SECRET: 'short-refresh-secret-20-chars'
      });
      expect(parsed.success).toBe(false);
    });

    it('should ACCEPT strong (>=32 chars) cryptographic secrets in production mode', () => {
      const parsed = envSchema.safeParse({
        NODE_ENV: 'production',
        PORT: 5000,
        DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/auckland_accounting_db?schema=public',
        JWT_SECRET: 'very-strong-production-access-token-secret-key-32-chars',
        JWT_REFRESH_SECRET: 'very-strong-production-refresh-token-secret-key-32-chars'
      });
      expect(parsed.success).toBe(true);
    });

    it('should REJECT ENABLE_LIVE_CALLING=true when Twilio credentials are missing or invalid', () => {
      const parsed = envSchema.safeParse({
        NODE_ENV: 'development',
        ENABLE_LIVE_CALLING: 'true'
        // Missing TWILIO_ACCOUNT_SID, AUTH_TOKEN, PHONE_NUMBER, WEBHOOK_BASE_URL
      });
      expect(parsed.success).toBe(false);
    });

    it('should ACCEPT ENABLE_LIVE_CALLING=true only with complete valid Twilio configuration', () => {
      const parsed = envSchema.safeParse({
        NODE_ENV: 'development',
        ENABLE_LIVE_CALLING: 'true',
        TWILIO_ACCOUNT_SID: 'AC1234567890abcdef1234567890abcdef',
        TWILIO_AUTH_TOKEN: 'authtoken1234567890123456',
        TWILIO_PHONE_NUMBER: '+6498370000',
        TWILIO_WEBHOOK_BASE_URL: 'https://acula.aucklandaccounting.co.nz'
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe('2. Production Health Probes (Liveness & Readiness)', () => {
    it('GET /api/health/live should return 200 OK for PM2/Kubernetes liveness probe', async () => {
      const res = await request(app).get('/api/health/live');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.uptime).toBeDefined();
      expect(res.body.timestamp).toBeDefined();
    });

    it('GET /api/health/ready should return 200 OK when database is healthy', async () => {
      const res = await request(app).get('/api/health/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
      expect(res.body.database).toBe('connected');
    });

    it('GET /api/health should return sanitized telemetry without secret leaks', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.service).toBe('acula-api');
      expect(res.body.data.version).toBe('1.0.0');

      // Verify zero credentials or connection strings leaked
      const bodyString = JSON.stringify(res.body);
      expect(bodyString).not.toContain('postgres://');
      expect(bodyString).not.toContain('postgresql://');
      expect(bodyString).not.toContain('password');
      expect(bodyString).not.toContain('jwt');
      expect(bodyString).not.toContain('secret');
    });
  });

  describe('3. Production Security Headers & Pipeline Integrity', () => {
    it('should include Helmet security headers on all responses', async () => {
      const res = await request(app).get('/');
      expect(res.headers['x-dns-prefetch-control']).toBeDefined();
      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('should handle unmapped routes with standardized 404 JSON envelope', async () => {
      const res = await request(app).get('/api/unmapped-endpoint-path');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('4. Automated Database Backup & Snapshot Utility', () => {
    const testBackupDir = path.resolve(process.cwd(), 'backups-test-temp');

    afterAll(() => {
      if (fs.existsSync(testBackupDir)) {
        fs.rmSync(testBackupDir, { recursive: true, force: true });
      }
    });

    it('should generate verifiable database snapshot with SHA-256 checksum', async () => {
      const result = await createDatabaseSnapshot(testBackupDir);

      expect(result.success).toBe(true);
      expect(result.filename).toContain('acula_db_snapshot_');
      expect(result.sizeBytes).toBeGreaterThan(0);
      expect(result.sha256Checksum.length).toBe(64); // SHA-256 hex string
      expect(result.tableCount).toBeGreaterThanOrEqual(10);
      expect(result.totalRecords).toBeGreaterThan(0);
      expect(fs.existsSync(result.filepath)).toBe(true);
    });
  });
});
