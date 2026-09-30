import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const campaign = await prisma.campaign.findFirst({
    where: { name: 'Inland Revenue ID & Security Verification' },
    include: {
      callJobs: {
        include: {
          attemptsList: {
            orderBy: { startedAt: 'desc' },
            take: 1
          }
        }
      }
    }
  });

  if (!campaign) {
    console.log('Campaign not found');
    return;
  }

  console.log(`Campaign ID: ${campaign.id}`);
  console.log(`Campaign Status: ${campaign.status}`);
  for (const job of campaign.callJobs) {
    console.log(` Job ID: ${job.id} | Status: ${job.status}`);
    if (job.attemptsList.length) {
      console.log(`  Last Attempt Status: ${job.attemptsList[0].status}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
