import { PrismaClient } from '@prisma/client';
import { renderQuestionTwiml } from './src/services/ivr/ivrEngine.js';

const prisma = new PrismaClient();

async function run() {
  const attempt = await prisma.callAttempt.findFirst({
    orderBy: { id: 'desc' },
    include: {
      callJob: {
        include: {
          campaign: {
            include: {
              questionnaire: {
                include: { questions: { orderBy: { orderNo: 'asc' } } }
              }
            }
          },
          contact: true
        }
      }
    }
  });

  if (!attempt) {
    console.log('No attempts found');
    return;
  }

  const q = attempt.callJob.campaign?.questionnaire?.questions?.[0];
  if (q) {
    const xml = await renderQuestionTwiml(attempt.id, q.id, 0, attempt);
    console.log(xml);
  } else {
    console.log('No questions found');
  }
}
run();
