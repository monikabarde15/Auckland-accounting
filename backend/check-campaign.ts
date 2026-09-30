import { prisma } from './src/services/prisma.js';
import { performPreDialSafetyCheck } from './src/services/dialer/dialerSafetyCheck.js';

async function run() {
  try {
    console.log("Checking campaign...");
    const campaign = await prisma.campaign.findUnique({
      where: { id: 'cmp_nz_ird_verification' },
      include: {
        callJobs: {
          include: {
            attemptsList: true
          }
        }
      }
    });
    
    if (!campaign) {
      console.log("Campaign not found.");
      return;
    }
    
    console.log("Campaign status:", campaign.status);
    console.log("Timezone:", campaign.timezone);
    
    const jobs = campaign.callJobs;
    if (jobs.length > 0) {
      const job = jobs[0];
      console.log("Job status:", job.status);
      console.log("Running dialer safety check for job:", job.id);
      const result = await performPreDialSafetyCheck(campaign.id, job.contactId, job.id);
      console.log("Check result:", JSON.stringify(result, null, 2));
    } else {
      console.log("No jobs found");
    }
  } catch (error) {
    console.error("Error occurred:", error);
  }
}

run().then(() => {
  console.log("Done");
  process.exit(0);
});
