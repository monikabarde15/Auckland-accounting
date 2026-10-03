import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from backend/.env and root .env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const sanitizeString = (val: unknown) => {
  if (typeof val === 'string' && val.trim() === '') {
    return undefined;
  }
  return val;
};

const sanitizeBaseUrl = (val: unknown) => {
  if (typeof val !== 'string' || !val.trim() || val === '/' || !val.startsWith('http')) {
    return process.env.TWILIO_WEBHOOK_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5000';
  }
  return val;
};

export const envSchema = z
  .object({
    NODE_ENV: z.preprocess(sanitizeString, z.enum(['development', 'test', 'production']).default('development')),
    PORT: z.preprocess(sanitizeString, z.coerce.number().default(5000)),
    DATABASE_URL: z.preprocess(
      sanitizeString,
      z.string().default('postgresql://postgres:postgres@127.0.0.1:5432/auckland_accounting_db?schema=public')
    ),
    REDIS_HOST: z.preprocess(sanitizeString, z.string().default('127.0.0.1')),
    REDIS_PORT: z.preprocess(sanitizeString, z.coerce.number().default(6379)),
    REDIS_PASSWORD: z.preprocess(sanitizeString, z.string().optional().default('')),
    JWT_SECRET: z.preprocess(
      sanitizeString,
      z.string().min(16).default('development-jwt-secret-min-16-chars')
    ),
    JWT_REFRESH_SECRET: z.preprocess(
      sanitizeString,
      z.string().min(16).default('development-refresh-secret-min-16-chars')
    ),
    TWILIO_ACCOUNT_SID: z.preprocess(sanitizeString, z.string().optional()),
    TWILIO_AUTH_TOKEN: z.preprocess(sanitizeString, z.string().optional()),
    TWILIO_PHONE_NUMBER: z.preprocess(sanitizeString, z.string().optional()),
    TWILIO_WEBHOOK_BASE_URL: z.preprocess(sanitizeString, z.string().optional()),
    ENABLE_LIVE_CALLING: z.preprocess((val) => {
      if (typeof val === 'string') {
        return val.toLowerCase() === 'true' || val === '1';
      }
      if (typeof val === 'boolean') return val;
      return false;
    }, z.boolean().default(false)),
    CALL_WORKER_CONCURRENCY: z.preprocess(sanitizeString, z.coerce.number().min(1).max(50).default(5)),
    BASE_URL: z.preprocess(sanitizeBaseUrl, z.string().url()),
    LOG_LEVEL: z.preprocess(sanitizeString, z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'))
  })
  .superRefine((data, ctx) => {
    // Production Security Invariants
    if (data.NODE_ENV === 'production') {
      if (data.JWT_SECRET === 'development-jwt-secret-min-16-chars' || data.JWT_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_SECRET'],
          message: 'Production requires a high-entropy JWT_SECRET with at least 32 characters.'
        });
      }
      if (data.JWT_REFRESH_SECRET === 'development-refresh-secret-min-16-chars' || data.JWT_REFRESH_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_REFRESH_SECRET'],
          message: 'Production requires a high-entropy JWT_REFRESH_SECRET with at least 32 characters.'
        });
      }
    }

    // Live Telephony Prerequisites
    if (data.ENABLE_LIVE_CALLING) {
      if (!data.TWILIO_ACCOUNT_SID || !data.TWILIO_ACCOUNT_SID.startsWith('AC')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['TWILIO_ACCOUNT_SID'],
          message: 'Valid TWILIO_ACCOUNT_SID (starts with AC) is required when ENABLE_LIVE_CALLING=true.'
        });
      }
      if (!data.TWILIO_AUTH_TOKEN || data.TWILIO_AUTH_TOKEN.length < 16) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['TWILIO_AUTH_TOKEN'],
          message: 'Valid TWILIO_AUTH_TOKEN is required when ENABLE_LIVE_CALLING=true.'
        });
      }
      if (!data.TWILIO_PHONE_NUMBER) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['TWILIO_PHONE_NUMBER'],
          message: 'TWILIO_PHONE_NUMBER is required when ENABLE_LIVE_CALLING=true.'
        });
      }
      if (!data.TWILIO_WEBHOOK_BASE_URL || !data.TWILIO_WEBHOOK_BASE_URL.startsWith('https://')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['TWILIO_WEBHOOK_BASE_URL'],
          message: 'TWILIO_WEBHOOK_BASE_URL must be a secure HTTPS URL when ENABLE_LIVE_CALLING=true.'
        });
      }
    }
  });

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnvConfig(rawEnv: Record<string, any> = process.env): EnvConfig {
  const result = envSchema.safeParse(rawEnv);
  if (!result.success) {
    const formatted = result.error.format();
    const errorMsg = `Invalid environment configuration:\n${JSON.stringify(formatted, null, 2)}`;
    if (process.env.NODE_ENV !== 'test') {
      console.error(errorMsg);
    }
    throw new Error(errorMsg);
  }
  return result.data;
}

export const env = validateEnvConfig(process.env);
