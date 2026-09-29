import { prisma } from './src/services/prisma.js';

async function run() {
  await prisma.campaign.update({
    where: { id: 'cmp_nz_ird_verification' },
    data: {
      timezone: 'Asia/Kolkata',
      callingStartTime: '16:00',
      callingEndTime: '18:30'
    }
  });
  console.log('Time window updated to IST 4:00 PM - 6:30 PM!');
}

run().finally(() => process.exit(0));
