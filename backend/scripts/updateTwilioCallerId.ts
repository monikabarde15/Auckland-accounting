import { prisma } from '../src/services/prisma.js';
import { env } from '../src/config/env.js';

async function updateTwilioCallerId() {
  const twilioNumber = env.TWILIO_PHONE_NUMBER || '+17372508034';
  console.log(`Configuring Twilio Caller ID in database to: ${twilioNumber}`);

  // 1. Update system settings
  const setting = await prisma.systemSetting.upsert({
    where: { key: 'DEFAULT_CALLER_ID' },
    update: {
      value: twilioNumber,
      description: 'Active Twilio Outbound Calling Phone Number'
    },
    create: {
      key: 'DEFAULT_CALLER_ID',
      value: twilioNumber,
      description: 'Active Twilio Outbound Calling Phone Number'
    }
  });
  console.log('SystemSetting DEFAULT_CALLER_ID updated:', setting);

  // 2. Update any existing campaigns with the dummy or stale number
  const campaigns = await prisma.campaign.findMany();
  console.log(`Found ${campaigns.length} campaigns in database.`);

  for (const c of campaigns) {
    if (!c.callerId || c.callerId !== twilioNumber) {
      await prisma.campaign.update({
        where: { id: c.id },
        data: { callerId: twilioNumber }
      });
      console.log(`Updated campaign "${c.name}" caller ID from "${c.callerId}" to "${twilioNumber}"`);
    }
  }

  // 3. Update transfer numbers in questionnaire questions if pointing to dummy/stale numbers
  const questions = await prisma.question.findMany();
  for (const q of questions) {
    if (q.transferPhoneNumber && q.transferPhoneNumber !== twilioNumber) {
      await prisma.question.update({
        where: { id: q.id },
        data: { transferPhoneNumber: twilioNumber }
      });
      console.log(`Updated question "${q.name}" transfer number to "${twilioNumber}"`);
    }
  }

  console.log('Database successfully updated with Twilio caller number.');
}

updateTwilioCallerId()
  .catch((e) => {
    console.error('Error updating caller ID:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
