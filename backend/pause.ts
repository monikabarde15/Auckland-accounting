import { prisma } from './src/services/prisma.js';
async function main() {
  await prisma.campaign.update({
    where: { id: 'cmp_nz_ird_verification' },
    data: { status: 'PAUSED' }
  });
  console.log('Set campaign to PAUSED');
}
main().finally(() => process.exit(0));
