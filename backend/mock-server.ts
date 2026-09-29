import express from 'express';
const app = express();

const inlineTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Aria-Neural" language="en-NZ">Practice outbound calling campaign. Kia Ora, this is Auckland Accounting Services calling regarding your GST return. Press 1 to confirm submission, or 2 to request a callback.</Say>
  <Gather input="dtmf" numDigits="1" timeout="8">
    <Say voice="Polly.Aria-Neural" language="en-NZ">Please press 1 to confirm, or press 2 to request a callback from your accountant.</Say>
  </Gather>
  <Say voice="Polly.Aria-Neural" language="en-NZ">Thank you for your response. Auckland Accounting has recorded your submission. Have a wonderful day.</Say>
  <Hangup/>
</Response>`;

app.all('/twiml', (req, res) => {
  console.log('Received request for TwiML!');
  res.type('text/xml').send(inlineTwiml);
});

app.listen(5001, () => {
  console.log('Mock TwiML server listening on port 5001');
});
