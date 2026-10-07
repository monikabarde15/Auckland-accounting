const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const events = await prisma.callEvent.findMany({ 
    where: { callAttemptId: 'cmuxt1hp50004d72dgrji49vu' }, 
    orderBy: { createdAt: 'asc' } 
  });
  console.log(JSON.stringify(events, null, 2));
}

run().catch(console.error).finally(()=>prisma.$disconnect());
