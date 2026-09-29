import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function run() {
  const jobs = await p.callJob.findMany({ orderBy: { updatedAt: 'desc' }, take: 1, include: { attemptsList: true } });
  console.log('--- LATEST JOB ---');
  console.log(JSON.stringify(jobs, null, 2));

  const contact = await p.contact.findFirst();
  console.log('--- CONTACT ---');
  console.log(JSON.stringify(contact, null, 2));
}
run().finally(() => p.$disconnect());
