import twilio from 'twilio';
import { env } from './src/config/env.js';

const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

async function run() {
  const alerts = await client.monitor.v1.alerts.list({ limit: 5 });
  for (const alert of alerts) {
    console.log(`Time: ${alert.dateCreated}`);
    console.log(`Error Code: ${alert.errorCode}`);
    console.log(`Alert Text: ${alert.alertText}`);
    console.log(`Request URL: ${alert.requestUrl}`);
    console.log(`---`);
  }
}
run().catch(console.error);
