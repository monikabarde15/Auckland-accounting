import { prisma } from '../src/services/prisma.js';
import { env } from '../src/config/env.js';

async function main() {
  console.log('================================================================');
  console.log('               CURRENT DATABASE CONNECTION INSPECTION           ');
  console.log('================================================================\n');

  // Obfuscate database password in output for safety
  const safeDbUrl = env.DATABASE_URL.replace(/:([^@:]+)@/, ':****@');
  console.log(`Connecting to: ${safeDbUrl}\n`);

  try {
    const [
      users,
      roles,
      permissions,
      contacts,
      groups,
      campaigns,
      questionnaires,
      callAttempts,
      dncRecords,
      auditLogs
    ] = await Promise.all([
      prisma.user.count(),
      prisma.role.count(),
      prisma.permission.count(),
      prisma.contact.count(),
      prisma.contactGroup.count(),
      prisma.campaign.count(),
      prisma.questionnaire.count(),
      prisma.callAttempt.count(),
      prisma.dncRecord.count(),
      prisma.auditLog.count()
    ]);

    console.log('📊 DATABASE TABLE INVENTORY & ROW COUNTS:');
    console.log('----------------------------------------------------------------');
    console.log(`  Users                   : ${users}`);
    console.log(`  Roles                   : ${roles}`);
    console.log(`  Permissions             : ${permissions}`);
    console.log(`  Contacts                : ${contacts}`);
    console.log(`  Contact Groups          : ${groups}`);
    console.log(`  Campaigns               : ${campaigns}`);
    console.log(`  Questionnaires (IVR)    : ${questionnaires}`);
    console.log(`  Call Attempts & Logs    : ${callAttempts}`);
    console.log(`  DNC Suppression Records : ${dncRecords}`);
    console.log(`  System Audit Logs       : ${auditLogs}`);
    console.log('----------------------------------------------------------------\n');

    // Sample users
    const sampleUsers = await prisma.user.findMany({
      select: {
        email: true,
        name: true,
        userRoles: { select: { role: { select: { name: true } } } },
        createdAt: true
      },
      take: 5
    });

    console.log('👥 CONFIGURED SYSTEM USERS:');
    sampleUsers.forEach((u) => {
      const roleNames = u.userRoles.map((r) => r.role.name).join(', ') || 'None';
      console.log(`  • ${u.name} (${u.email}) [Roles: ${roleNames}]`);
    });

    console.log('\n================================================================');
    console.log('✅ DATABASE CONNECTION & TABLES VERIFIED SUCCESSFULLY');
    console.log('================================================================\n');
  } catch (err) {
    console.error('❌ Database inspection failed:', (err as Error).message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
