import twilio from 'twilio';
import { env } from './src/config/env.js';

async function run() {
  const webhookUrl = `https://chjhm-2405-201-301e-8838-701d-2c47-fbcf-c2ae.run.pinggy-free.link/twiml`;

  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  const targetNumber = '+917089526977';

  console.log('Placing direct Twilio call via Mock 5001 webhook...');
  const call = await client.calls.create({
    to: targetNumber,
    from: env.TWILIO_PHONE_NUMBER || '+17372508034',
    url: webhookUrl
  });

  console.log('Successfully placed call!', call.sid);
}

run().catch(console.error).finally(() => process.exit(0));
