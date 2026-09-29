import { prisma } from './src/services/prisma.js';
import { transitionCampaignStatus } from './src/services/campaignService.js';
import { CampaignStatus } from '@prisma/client';

async function run() {
  console.log('Clearing stuck attempts...');
  await prisma.callAttempt.updateMany({
    where: { status: { in: ['INITIATED', 'QUEUED'] } },
    data: { status: 'FAILED', hangupCause: 'Cleared stuck attempt' }
  });
  
  await prisma.callJob.updateMany({
    where: { status: { in: ['DISPATCHED', 'FAILED', 'COMPLETED'] } },
    data: { status: 'PENDING', attempts: 0 }
  });

  console.log('Pausing campaign...');
  await transitionCampaignStatus('cmp_nz_ird_verification', CampaignStatus.PAUSED);

  console.log('Resuming campaign (triggering calls)...');
  await transitionCampaignStatus('cmp_nz_ird_verification', CampaignStatus.RUNNING);

  console.log('Waiting 15 seconds for background call worker to finish dial...');
  await new Promise(r => setTimeout(r, 15000));
  console.log('Done!');
}
run().finally(() => process.exit(0));
