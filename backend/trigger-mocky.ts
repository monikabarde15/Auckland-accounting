import twilio from 'twilio';
import { env } from './src/config/env.js';

async function run() {
  const inlineTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Aria-Neural" language="en-NZ">Practice outbound calling campaign. Kia Ora, this is Auckland Accounting Services calling regarding your GST return.</Say>
  <Gather input="dtmf" numDigits="1" timeout="8">
    <Say voice="Polly.Aria-Neural" language="en-NZ">Please press 1 to confirm, or press 2 to request a callback from your accountant.</Say>
  </Gather>
  <Say voice="Polly.Aria-Neural" language="en-NZ">Thank you for your response. Auckland Accounting has recorded your submission. Have a wonderful day.</Say>
  <Hangup/>
</Response>`;

  console.log('Creating Mocky endpoint...');
  const mockyResponse = await fetch('https://run.mocky.io/api/mock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 200,
      content: inlineTwiml,
      content_type: 'text/xml',
      charset: 'UTF-8'
    })
  });

  const mockyData = await mockyResponse.json();
  const webhookUrl = mockyData.link;
  console.log('Mocky URL created:', webhookUrl);

  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  const targetNumber = '+917089526977';

  console.log('Placing direct Twilio call via Mocky...');
  const call = await client.calls.create({
    to: targetNumber,
    from: env.TWILIO_PHONE_NUMBER || '+17372508034',
    url: webhookUrl
  });

  console.log('Successfully placed call!', call.sid);
}

run().catch(console.error).finally(() => process.exit(0));
