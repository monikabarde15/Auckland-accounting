import 'dotenv/config';
import { prisma } from '../src/services/prisma.js';
import { QuestionType, NextAction } from '@prisma/client';

async function seedQuestionnaires() {
  console.log('--- Seeding Practice Questionnaires & Settings into Supabase ---');

  const superAdmin = await prisma.user.findUnique({
    where: { email: 'superadmin@aucklandaccounting.co.nz' }
  });

  // 1. Settings
  const settings = [
    { key: 'CALLING_HOURS_START', value: '09:00', description: 'Outbound dialing start time' },
    { key: 'CALLING_HOURS_END', value: '18:00', description: 'Outbound dialing cutoff time' },
    { key: 'DEFAULT_TIMEZONE', value: 'Pacific/Auckland', description: 'Auckland practice timezone' },
    { key: 'DEFAULT_CALLER_ID', value: '+17372508034', description: 'Practice Caller ID' }
  ];

  for (const s of settings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: s
    });
  }

  // 2. GST Questionnaire
  let gstQuestionnaire = await prisma.questionnaire.findFirst({
    where: { title: 'GST Filing Verification & Submission Reminder' }
  });

  if (!gstQuestionnaire) {
    gstQuestionnaire = await prisma.questionnaire.create({
      data: {
        title: 'GST Filing Verification & Submission Reminder',
        description: 'Practice flow verifying client declaration for IRD GST return filing.',
        category: 'Tax & Compliance',
        createdById: superAdmin?.id,
        questions: {
          create: [
            {
              name: 'Greeting & Verification',
              questionText: 'Kia Ora, this is Auckland Accounting Services calling regarding your GST return. Press 1 to confirm submission, or 2 to request a callback.',
              type: QuestionType.YES_NO,
              orderNo: 1,
              timeoutSeconds: 7,
              retryCount: 2,
              options: {
                create: [
                  { optionKey: '1', optionLabel: 'Yes, proceed', nextAction: NextAction.CONTINUE },
                  { optionKey: '2', optionLabel: 'No, call back later', nextAction: NextAction.END_CALL }
                ]
              }
            }
          ]
        }
      }
    });
    console.log('✅ Created questionnaire:', gstQuestionnaire.title);
  }

  console.log('🎉 Supabase practice flows ready!');
  await prisma.$disconnect();
}

seedQuestionnaires().catch(console.error);
