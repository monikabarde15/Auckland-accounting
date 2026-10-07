import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  const attempt = await prisma.callAttempt.findFirst({
    orderBy: { id: 'desc' },
    include: { events: { orderBy: { createdAt: 'asc' } } }
  });

  if (!attempt) return console.log('No attempts found');
  
  console.log(`Attempt ID: ${attempt.id}`);
  console.log(`Status: ${attempt.status}`);
  for (const ev of attempt.events) {
    console.log(`- ${ev.createdAt.toISOString()} | ${ev.eventType} | ${JSON.stringify(ev.payloadJson).substring(0, 50)}`);
  }
}
run();
