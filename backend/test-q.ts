import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const qs = await prisma.question.findMany({
    include: { options: true }
  });
  console.log(JSON.stringify(qs, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
