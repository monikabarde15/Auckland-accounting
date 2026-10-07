import { renderQuestionTwiml } from './src/services/ivr/ivrEngine.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const xml = await renderQuestionTwiml('cmuxq1cqh000ken2c4dgmoi3o', 'cmumkp8sy0003u0pwe5pa8ife');
    console.log('SUCCESS XML:', xml);
  } catch (err) {
    console.error('ERROR GENERATING XML:', err);
  }
}

main().finally(() => prisma.$disconnect());
