import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.campaignContact.findMany({ where: { campaignId: 'cmp_nz_ird_verification' } }).then(console.log).finally(() => prisma.$disconnect());
