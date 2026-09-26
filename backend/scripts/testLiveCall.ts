import twilio from 'twilio';
import { env } from '../src/config/env.js';

async function testLiveCall() {
  const targetNumber = process.argv[2];
  let fromNumber = env.TWILIO_PHONE_NUMBER || '+17372508034';

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

  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

  try {
    const acc = await client.api.v2010.accounts(env.TWILIO_ACCOUNT_SID).fetch();
    console.log(`Twilio Account: ${acc.friendlyName} | Status: ${acc.status} | Type: ${acc.type}`);

    const incoming = await client.incomingPhoneNumbers.list();
    console.log(`Active Incoming Phone Numbers (${incoming.length}):`);
    incoming.forEach(n => console.log(`  - Phone: ${n.phoneNumber}, Name: ${n.friendlyName}`));

    const outgoing = await client.outgoingCallerIds.list();
    console.log(`Verified Caller IDs / Recipient Numbers (${outgoing.length}):`);
    outgoing.forEach(n => console.log(`  - Phone: ${n.phoneNumber}, Name: ${n.friendlyName}`));

    if (incoming.length === 0) {
      console.log('\n⚠️ No active Twilio phone number found on this account.');
      console.log('Attempting to provision a free trial phone number...');
      try {
        const available = await client.availablePhoneNumbers('US').local.list({ limit: 1 });
        if (available.length > 0) {
          const newNum = await client.incomingPhoneNumbers.create({ phoneNumber: available[0].phoneNumber });
          console.log(`✅ Successfully assigned Twilio Trial Number: ${newNum.phoneNumber}`);
          fromNumber = newNum.phoneNumber;
        }
      } catch (err: any) {
        console.log('Could not automatically provision number via API:', err.message);
        console.log('👉 Please click "Get a trial number" in your Twilio Console dashboard: https://console.twilio.com');
      }
    } else {
      fromNumber = incoming[0].phoneNumber;
    }
  } catch (e: any) {
    console.warn('Could not list numbers:', e.message);
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
