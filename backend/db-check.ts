import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: { url: 'postgresql://postgres.xgfqhshyscqopgynuozg:Data%408434562830@aws-0-ap-south-1.pooler.supabase.com:5432/postgres' }
  }
});

async function main() {
  // Check cmp_nz_ird_verification campaign with questionnaire and questions
  const campaign = await prisma.campaign.findUnique({
    where: { id: 'cmp_nz_ird_verification' },
    include: {
      questionnaire: {
        include: {
          questions: { orderBy: { orderNo: 'asc' }, include: { options: true } }
        }
      }
    }
  });

  if (!campaign) {
    console.log('CAMPAIGN NOT FOUND!');
    return;
  }

  console.log('\n=== CAMPAIGN ===');
  console.log(`  ID: ${campaign.id}`);
  console.log(`  Name: ${campaign.name}`);
  console.log(`  Status: ${campaign.status}`);
  console.log(`  CallerID: ${campaign.callerId}`);
  console.log(`  QuestionnaireID: ${campaign.questionnaireId}`);

  if (!campaign.questionnaire) {
    console.log('\n❌ NO QUESTIONNAIRE LINKED! This is why error plays.');
    return;
  }

  console.log(`\n=== QUESTIONNAIRE: ${campaign.questionnaire.title} ===`);
  console.log(`  ID: ${campaign.questionnaire.id}`);
  console.log(`  Active: ${campaign.questionnaire.isActive}`);
  console.log(`  Questions: ${campaign.questionnaire.questions.length}`);

  campaign.questionnaire.questions.forEach((q, i) => {
    console.log(`\n  Q${i+1}: ${q.questionText}`);
    console.log(`    Type: ${q.questionType} | OrderNo: ${q.orderNo}`);
    if (q.options && q.options.length > 0) {
      q.options.forEach(o => console.log(`    Option: digit=${o.digit} -> ${o.label}`));
    }
  });

  // Check latest call attempts for this campaign
  const attempts = await prisma.callAttempt.findMany({
    where: { callJob: { campaignId: 'cmp_nz_ird_verification' } },
    take: 3,
    orderBy: { id: 'desc' },
    select: { id: true, status: true, hangupCause: true, providerCallId: true }
  });
  console.log('\n=== RECENT ATTEMPTS ===');
  attempts.forEach(a => console.log(`  ${a.id} | status=${a.status} | hangup=${a.hangupCause || 'none'} | sid=${a.providerCallId}`));

  await prisma.$disconnect();
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
