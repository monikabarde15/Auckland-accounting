import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const job = await prisma.callJob.findFirst({
    include: {
      campaign: true,
      attemptsList: {
        orderBy: { startedAt: 'desc' },
        take: 1
      }
    }
  });

  console.log(`Campaign Status: ${job?.campaign?.status}`);
  console.log(`Job Status: ${job?.status}`);
  if (job?.attemptsList.length) {
    const attempt = job.attemptsList[0];
    console.log(`Attempt Status: ${attempt.status}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
