import twilio from 'twilio';
import { env } from './src/config/env.js';

async function run() {
  const prompt = 'Practice outbound calling campaign. Kia Ora, this is Auckland Accounting Services calling regarding your GST return.';
  const webhookUrl = `https://sjcwb-2405-201-301e-8838-701d-2c47-fbcf-c2ae.run.pinggy-free.link/api/voice/twiml?prompt=${encodeURIComponent(prompt)}`;

  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  const targetNumber = '+917089526977';

  console.log('Placing direct Twilio call via Pinggy webhook bypass...');
  const call = await client.calls.create({
    to: targetNumber,
    from: env.TWILIO_PHONE_NUMBER || '+17372508034',
    url: webhookUrl
  });

  console.log('Successfully placed call!', call.sid);
}

run().catch(console.error).finally(() => process.exit(0));
