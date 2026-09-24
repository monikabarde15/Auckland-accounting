import { prisma } from '../src/services/prisma.js';
import { checkRedisHealth } from '../src/services/redis.js';
import { env } from '../src/config/env.js';
import twilio from 'twilio';

interface CheckItem {
  name: string;
  passed: boolean;
  message: string;
  critical: boolean;
}

async function runPreflight() {
  console.log('================================================================');
  console.log('      ACULA TELEPHONY PLATFORM — PRODUCTION PRE-FLIGHT CHECK   ');
  console.log('================================================================\n');

  const results: CheckItem[] = [];

  // 1. Environment & Node Version
  results.push({
    name: 'Node Runtime Version',
    passed: parseInt(process.versions.node.split('.')[0], 10) >= 18,
    message: `Running Node.js v${process.version}`,
    critical: true
  });

  // 2. Database Connectivity
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const latency = Date.now() - start;
    results.push({
      name: 'PostgreSQL Database',
      passed: true,
      message: `Connected successfully (Latency: ${latency}ms)`,
      critical: true
    });
  } catch (err) {
    results.push({
      name: 'PostgreSQL Database',
      passed: false,
      message: `Connection failed: ${(err as Error).message}`,
      critical: true
    });
  }

  // 3. Database Schema Verification
  try {
    const userCount = await prisma.user.count();
    const roleCount = await prisma.role.count();
    results.push({
      name: 'Database Schema & Seeds',
      passed: roleCount > 0,
      message: `Found ${userCount} users and ${roleCount} roles configured`,
      critical: true
    });
  } catch (err) {
    results.push({
      name: 'Database Schema & Seeds',
      passed: false,
      message: `Schema query failed (migrations required?): ${(err as Error).message}`,
      critical: true
    });
  }

  // 4. Redis Connectivity
  try {
    const health = await checkRedisHealth();
    results.push({
      name: 'Redis Queue Engine',
      passed: health.connected,
      message: health.connected
        ? `Redis reachable (Status: ${health.status}, Latency: ${health.latencyMs}ms)`
        : `Redis offline (${health.error || health.status}). (Offline resilient mode active)`,
      critical: false
    });
  } catch (err) {
    results.push({
      name: 'Redis Queue Engine',
      passed: false,
      message: `Redis check error: ${(err as Error).message}`,
      critical: false
    });
  }

  // 5. JWT Secret Entropy
  const jwtEntropyOk = env.JWT_SECRET.length >= 32 && env.JWT_SECRET !== 'development-jwt-secret-min-16-chars';
  const refreshEntropyOk = env.JWT_REFRESH_SECRET.length >= 32 && env.JWT_REFRESH_SECRET !== 'development-refresh-secret-min-16-chars';
  results.push({
    name: 'JWT Cryptographic Secrets',
    passed: jwtEntropyOk && refreshEntropyOk,
    message: jwtEntropyOk && refreshEntropyOk
      ? 'High-entropy secrets verified (>=32 chars)'
      : 'Development defaults detected. Must generate high-entropy secrets for production!',
    critical: env.NODE_ENV === 'production'
  });

  // 6. Twilio Credentials & Number Check
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    results.push({
      name: 'Twilio Credentials',
      passed: false,
      message: 'TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN missing in environment',
      critical: env.ENABLE_LIVE_CALLING
    });
  } else {
    try {
      const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
      const account = await client.api.v2010.accounts(env.TWILIO_ACCOUNT_SID).fetch();
      results.push({
        name: 'Twilio API Authentication',
        passed: account.status === 'active',
        message: `Authenticated: "${account.friendlyName}" (Status: ${account.status}, Type: ${account.type})`,
        critical: true
      });

      // Check caller ID
      if (env.TWILIO_PHONE_NUMBER) {
        results.push({
          name: 'Twilio Phone Number',
          passed: true,
          message: `Configured caller ID: ${env.TWILIO_PHONE_NUMBER}`,
          critical: true
        });
      } else {
        results.push({
          name: 'Twilio Phone Number',
          passed: false,
          message: 'TWILIO_PHONE_NUMBER not specified in environment',
          critical: env.ENABLE_LIVE_CALLING
        });
      }
    } catch (err) {
      results.push({
        name: 'Twilio API Authentication',
        passed: false,
        message: `Twilio auth failed: ${(err as Error).message}`,
        critical: env.ENABLE_LIVE_CALLING
      });
    }
  }

  // 7. Live Telephony Gate Status
  results.push({
    name: 'Live Telephony Safety Gate',
    passed: true,
    message: env.ENABLE_LIVE_CALLING
      ? '⚠️ LIVE CALLING ENABLED (Real PSTN dialing active)'
      : '🔒 SAFE SIMULATION MODE (ENABLE_LIVE_CALLING=false)',
    critical: false
  });

  // Print scorecard
  console.log('RESULTS:');
  let hasCriticalFailure = false;

  for (const item of results) {
    const icon = item.passed ? '✅' : (item.critical ? '❌' : '⚠️');
    console.log(`${icon} [${item.name}] — ${item.message}`);
    if (!item.passed && item.critical) {
      hasCriticalFailure = true;
    }
  }

  console.log('\n================================================================');
  if (hasCriticalFailure) {
    console.log('🚨 PRE-FLIGHT VERDICT: NOT READY (Critical checks failed)');
  } else {
    console.log('🎉 PRE-FLIGHT VERDICT: PASSED & READY FOR OPERATION');
  }
  console.log('================================================================\n');

  await prisma.$disconnect();
  process.exit(hasCriticalFailure ? 1 : 0);
}

runPreflight().catch((err) => {
  console.error('Fatal preflight execution error:', err);
  process.exit(1);
});
