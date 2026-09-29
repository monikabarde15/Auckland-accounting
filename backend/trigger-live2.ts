import twilio from 'twilio';
import { env } from './src/config/env.js';
import { prisma } from './src/services/prisma.js';

async function run() {
  console.log('Fetching script from database...');
  let prompt = 'Practice outbound calling campaign. Kia Ora, this is Auckland Accounting Services calling regarding your GST return.';
  
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: 'cmp_nz_ird_verification' },
      include: {
        questionnaire: {
          include: { questions: { orderBy: { orderNo: 'asc' } } }
        }
      }
    });

    if (campaign?.description) prompt = campaign.description;
    if (campaign?.questionnaire?.questions?.[0]) {
      prompt += '. ' + campaign.questionnaire.questions[0].questionText;
    }
  } catch (err) {
    console.log('Using default prompt due to DB error');
  }
  
  prompt = prompt.replace(/\{client_name\}/g, 'Valued Client')
                 .replace(/\{company_name\}/g, 'Auckland Accounting Services Ltd')
                 .replace(/\{balance\}/g, '$0.00');

  console.log('Using prompt:', prompt);

  const escapeXml = (unsafe: string) =>
      unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
          case '<': return '&lt;';
          case '>': return '&gt;';
          case '&': return '&amp;';
          case '\'': return '&apos;';
          case '"': return '&quot;';
          default: return c;
        }
      });

  const escapedPrompt = escapeXml(prompt);

  const inlineTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Aria-Neural" language="en-NZ">${escapedPrompt}</Say>
  <Gather input="dtmf" numDigits="1" timeout="8">
    <Say voice="Polly.Aria-Neural" language="en-NZ">Please press 1 to confirm, or press 2 to request a callback from your accountant.</Say>
  </Gather>
  <Say voice="Polly.Aria-Neural" language="en-NZ">Thank you for your response. Auckland Accounting has recorded your submission. Have a wonderful day.</Say>
  <Hangup/>
</Response>`;

  const twimletUrl = `http://twimlets.com/echo?Twiml=${encodeURIComponent(inlineTwiml)}`;

  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  const targetNumber = '+917089526977';

  console.log('Placing direct Twilio call via Twimlets...');
  const call = await client.calls.create({
    to: targetNumber,
    from: env.TWILIO_PHONE_NUMBER || '+17372508034',
    url: twimletUrl
  });

  console.log('Successfully placed call!', call.sid);
}

run().catch(console.error).finally(() => process.exit(0));
