import { prisma } from './src/services/prisma.js';
async function main() {
  const camp = await prisma.campaign.findUnique({
    where: { id: 'cmp_nz_ird_verification' },
    include: { questionnaire: { include: { questions: true } } }
  });
  console.log(JSON.stringify(camp?.questionnaire, null, 2));
}
main().finally(() => process.exit(0));
