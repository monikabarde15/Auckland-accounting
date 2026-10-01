const twilio = require('twilio');

async function main() {
  const accounts = [
    { name: 'YAML_CREDS', sid: 'AC59c3627e754f0a43addb43756a45891a', token: '5f7ecad671a8325bef816b5f0ceeac47' },
    { name: 'DOTENV_CREDS', sid: 'ACf7c3901bff0f72144d7abc82cab61840', token: 'e096d2eaf775af92faff24f70c35b89a' }
  ];

  for (const acc of accounts) {
    try {
      const client = twilio(acc.sid, acc.token);
      const calls = await client.calls.list({limit: 2});
      console.log(`--- ${acc.name} ---`);
      for (const call of calls) {
        console.log(`Call to: ${call.to} | Status: ${call.status} | Date: ${call.dateCreated}`);
        const notifs = await client.calls(call.sid).notifications.list({limit: 1});
        if (notifs.length > 0) {
          console.log(`  Error: ${notifs[0].errorCode} - ${notifs[0].messageText}`);
          console.log(`  URL: ${notifs[0].requestUrl}`);
        } else {
          console.log(`  No error notifications.`);
        }
      }
    } catch(e) {
      console.log(`Failed for ${acc.name}:`, e.message);
    }
  }
}
main();
