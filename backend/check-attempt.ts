import { prisma } from './src/services/prisma.js';

async function run() {
  const attempt = await prisma.callAttempt.findUnique({
    where: { id: 'cmul5wwv50002u0d8j742mg9u' }
  });
  console.log(JSON.stringify(attempt, null, 2));
}

run().finally(() => process.exit(0));
