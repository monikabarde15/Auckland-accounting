import { prisma } from './services/prisma.js';

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      isActive: true,
      userRoles: {
        include: { role: true }
      }
    }
  });

  console.log('Users in DB:', JSON.stringify(users, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
