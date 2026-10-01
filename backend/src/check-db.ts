import { prisma } from './services/prisma.js';

async function main() {
  const attempts = await prisma.callAttempt.findMany({
    take: 10,
    orderBy: { startedAt: 'desc' },
    include: {
      callJob: {
        include: {
          contact: true,
          campaign: true
        }
      },
      events: true
    }
  });

  console.log('Total attempts:', attempts.length);
  for (const a of attempts) {
    console.log(`\nAttempt ID: ${a.id}`);
    console.log(`Status: ${a.status} | StartedAt: ${a.startedAt?.toISOString()}`);
    console.log(`ProviderCallId: ${a.providerCallId} | HangupCause: ${a.hangupCause}`);
    console.log(`Contact: ${a.callJob?.contact?.name} (${a.callJob?.contact?.phone})`);
    console.log(`Campaign: ${a.callJob?.campaign?.title}`);
    console.log(`Events (${a.events.length}):`);
    for (const e of a.events) {
      console.log(`  - [${e.createdAt.toISOString()}] ${e.eventType}: ${JSON.stringify(e.payloadJson)}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
