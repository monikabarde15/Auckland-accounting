import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const campaignId = 'cmp_nz_ird_verification';

  // Get active contacts for the campaign
  const contacts = await prisma.campaignContact.findMany({
    where: { campaignId },
    select: { contactId: true }
  });
  
  const validContactIds = contacts.map(c => c.contactId);

  // Cancel any job not in validContactIds
  await prisma.callJob.updateMany({
    where: {
      campaignId,
      contactId: { notIn: validContactIds }
    },
    data: { status: 'CANCELLED' }
  });

  // Check completion
  const pendingJobs = await prisma.callJob.count({
    where: {
      campaignId,
      status: { notIn: ['COMPLETED', 'FAILED', 'CANCELLED'] }
    }
  });

  if (pendingJobs === 0) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'COMPLETED' }
    });
    console.log('Campaign marked as COMPLETED');
  } else {
    console.log(`Still ${pendingJobs} pending jobs`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
