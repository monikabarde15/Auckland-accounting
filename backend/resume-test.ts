import { transitionCampaignStatus } from './src/services/campaignService.js';
import { CampaignStatus } from '@prisma/client';
import { logger } from './src/middleware/logger.js';
import { prisma } from './src/services/prisma.js';

async function run() {
  console.log('Testing Resume Transition...');
  try {
    const res = await transitionCampaignStatus('cmp_nz_ird_verification', CampaignStatus.RUNNING);
    console.log('SUCCESS:', res.id, res.status);
    
    // verify the CallJob was updated
    const jobs = await prisma.callJob.findMany({ where: { campaignId: 'cmp_nz_ird_verification' } });
    console.log('JOBS:', JSON.stringify(jobs, null, 2));
  } catch (err) {
    console.error('ERROR:', err);
  }
}
run().finally(() => process.exit(0));
