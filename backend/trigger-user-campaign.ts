import { PrismaClient } from '@prisma/client';
import { transitionCampaignStatus } from './src/services/campaignService.js';

const prisma = new PrismaClient();

async function run() {
  try {
    const contacts = await prisma.contact.findMany({
      where: { phoneNumber: { contains: '7089526977' } }
    });

    if (contacts.length === 0) {
      console.log('Contact with number 7089526977 not found.');
      process.exit(1);
    }

    const contact = contacts[0];
    console.log('Found contact:', contact.phoneNumber);

    const campaignContacts = await prisma.campaignContact.findMany({
      where: { contactId: contact.id },
      include: { campaign: true }
    });

    if (campaignContacts.length === 0) {
      console.log('No campaigns found for this contact.');
      process.exit(1);
    }

    const campaignId = campaignContacts[0].campaignId;
    console.log('Found campaign:', campaignId, campaignContacts[0].campaign.name);

    console.log('Transitioning campaign to RUNNING...');
    await transitionCampaignStatus(campaignId, 'RUNNING', { userId: 'system' });
    console.log('Campaign triggered successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

run();
