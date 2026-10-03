import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ datasources: { db: { url: 'postgresql://postgres.xgfqhshyscqopgynuozg:Data%408434562830@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true' } } });
async function run() {
  await prisma.campaign.updateMany({
    data: { callingStartTime: '00:00', callingEndTime: '23:59', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }
  });
  console.log('Campaign hours updated to 24/7');
}
run();
