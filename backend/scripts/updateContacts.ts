import { prisma } from '../src/services/prisma.js';
import { ConsentStatus, EntityType } from '@prisma/client';

async function updateContacts() {
  console.log('--- Updating Contacts in Database ---');

  // 1. Remove dummy contacts
  const deleted = await prisma.contact.deleteMany({});
  console.log(`Deleted ${deleted.count} existing contacts.`);

  // 2. Add real contact for Om Prakash Sir (+918210543772)
  const contact = await prisma.contact.create({
    data: {
      name: 'Om Prakash Sir',
      phoneNumber: '+918210543772',
      email: 'omprakash@aucklandaccounting.co.nz',
      companyName: 'Auckland Accounting Practice Client',
      entityType: EntityType.INDIVIDUAL,
      irdNumber: '821-054-377',
      outstandingBalance: 0.0,
      assignedAccountant: 'David Chen (CA)',
      isDoNotCall: false,
      consentStatus: ConsentStatus.GRANTED,
      consentTimestamp: new Date(),
      consentSource: 'Direct Client Authorization'
    }
  });

  console.log('✅ Created real contact:');
  console.log({
    id: contact.id,
    name: contact.name,
    phoneNumber: contact.phoneNumber,
    company: contact.companyName
  });

  await prisma.$disconnect();
}

updateContacts().catch(console.error);
