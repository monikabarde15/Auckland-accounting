import { prisma } from './src/services/prisma.js';

async function run() {
  const jobs = await prisma.callJob.findMany({
    where: { campaignId: 'cmp_nz_ird_verification' },
    include: {
      contact: true,
      attemptsList: true
    }
  });
  console.log(JSON.stringify(jobs, null, 2));
}

run().finally(() => process.exit(0));
