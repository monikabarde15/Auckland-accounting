import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const attempts = await prisma.callAttempt.findMany({
    orderBy: { startedAt: 'desc' },
    take: 1,
    include: {
      callJob: {
        include: {
          campaign: true
        }
      },
      events: true,
      responses: true
    }
  });

  console.log(JSON.stringify(attempts, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
