import twilio from 'twilio';
import { env } from '../src/config/env.js';

async function testLiveCall() {
  const targetNumber = process.argv[2];
  const fromNumber = env.TWILIO_PHONE_NUMBER || '+17372508034';

  console.log('================================================================');
  console.log('         ACULA TELEPHONY — SINGLE-NUMBER PILOT TEST CALL        ');
  console.log('================================================================\n');

  if (!targetNumber) {
    console.error('❌ Error: Recipient phone number is required.');
    console.error('Usage: npm run test:live-call -- <phone_number_in_e164>');
    process.exit(1);
  }

  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    console.error('❌ Error: TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set in backend/.env');
    process.exit(1);
  }

  console.log(`From (Caller ID): ${fromNumber}`);
  console.log(`To (Recipient)  : ${targetNumber}`);
  console.log('\nInitiating outbound call via Twilio Voice API...');

  try {
    const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

    // For trial accounts, Twilio requires an approved webhook URL
    const webhookUrl = env.TWILIO_WEBHOOK_BASE_URL && env.TWILIO_WEBHOOK_BASE_URL.startsWith('https://')
      ? `${env.TWILIO_WEBHOOK_BASE_URL}/api/voice/twiml`
      : 'https://webhooks.twilio.com/v1/Voice/Template/voice_speech_recognition';

    const call = await client.calls.create({
      to: targetNumber,
      from: fromNumber,
      url: webhookUrl
    });

    console.log('\n✅ Outbound call placed successfully!');
    console.log(`Call SID : ${call.sid}`);
    console.log(`Status   : ${call.status}`);
    console.log(`Direction: ${call.direction}`);
    console.log('\nYour phone should ring shortly. Listen to the NZ voice prompt and test pressing a key.');
    console.log('================================================================\n');
  } catch (err) {
    const error = err as Error;
    console.error('\n❌ Call initiation failed:', error.message);
    process.exit(1);
  }
}

testLiveCall().catch(console.error);
