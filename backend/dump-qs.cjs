const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const qs = await prisma.question.findMany({ 
    where: { campaignId: 'cmp_nz_gst_q1' },
    include: { options: true }
  });
  console.log(JSON.stringify(qs, null, 2));
}

run().catch(console.error).finally(()=>prisma.$disconnect());
