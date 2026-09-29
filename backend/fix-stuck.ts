import { prisma } from './src/services/prisma.js';

async function run() {
  await prisma.callAttempt.updateMany({
    where: { status: { in: ['INITIATED', 'QUEUED'] } },
    data: { status: 'FAILED', hangupCause: 'Cleared stuck attempt' }
  });
  await prisma.callJob.updateMany({
    where: { status: { in: ['DISPATCHED', 'FAILED', 'COMPLETED'] } },
    data: { status: 'PENDING', attempts: 0 }
  });
  console.log('Fixed stuck attempts including QUEUED');
}
run().finally(() => process.exit(0));
