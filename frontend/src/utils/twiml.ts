import { Questionnaire, Question } from '../types';

/**
 * Generates valid TwiML (Twilio Voice XML) for a dynamic IVR Questionnaire.
 * Auckland Accounting Services Ltd outbound telephony format.
 */
export function generateTwiML(questionnaire: Questionnaire, baseUrl: string = 'https://api.aucklandaccounting.co.nz/ivr'): string {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<Response>\n`;
  xml += `  <!-- Questionnaire: ${escapeXml(questionnaire.title)} -->\n`;
  xml += `  <!-- Category: ${questionnaire.category} -->\n`;
  xml += `  <!-- Auckland Accounting Services Ltd - 25 Semillon Ave, Henderson 0612 -->\n\n`;

  // Start with starting question
  const startQ = questionnaire.questions.find((q) => q.id === questionnaire.startingQuestionId) || questionnaire.questions[0];

  if (startQ) {
    xml += renderQuestionTwiML(startQ, baseUrl);
  } else {
    xml += `  <Say voice="Polly.Aria-Neural" language="en-NZ">Thank you for calling Auckland Accounting Services Ltd. Goodbye.</Say>\n`;
    xml += `  <Hangup/>\n`;
  }

  xml += `</Response>`;
  return xml;
}

function renderQuestionTwiML(q: Question, baseUrl: string): string {
  let block = '';

  if (q.type === 'message_only') {
    block += `  <!-- Step: ${escapeXml(q.name)} -->\n`;
    block += `  <Say voice="Polly.Aria-Neural" language="en-NZ">${escapeXml(q.promptText)}</Say>\n`;
    if (q.defaultNextQuestionId && q.defaultNextQuestionId !== 'END') {
      block += `  <Redirect>${baseUrl}/question/${q.defaultNextQuestionId}</Redirect>\n`;
    } else {
      block += `  <Hangup/>\n`;
    }
  } else if (q.type === 'transfer') {
    block += `  <!-- Transfer: ${escapeXml(q.name)} -->\n`;
    block += `  <Say voice="Polly.Aria-Neural" language="en-NZ">${escapeXml(q.promptText)}</Say>\n`;
    block += `  <Dial callerId="+6498370000" timeout="25">\n`;
    block += `    <Number>${q.transferPhoneNumber || '+6498370000'}</Number>\n`;
    block += `  </Dial>\n`;
  } else if (q.type === 'numeric') {
    block += `  <!-- Numeric Input: ${escapeXml(q.name)} -->\n`;
    const numDigits = q.maxDigits || 6;
    const finishOnKey = q.finishOnKey || '#';
    block += `  <Gather action="${baseUrl}/response?qId=${q.id}" method="POST" input="dtmf speech" numDigits="${numDigits}" finishOnKey="${finishOnKey}" timeout="${q.timeoutSeconds}">\n`;
    block += `    <Say voice="Polly.Aria-Neural" language="en-NZ">${escapeXml(q.promptText)}</Say>\n`;
    block += `  </Gather>\n`;
    block += `  <Say voice="Polly.Aria-Neural" language="en-NZ">We did not receive your input. ${escapeXml(q.retryPromptText || 'Goodbye.')}</Say>\n`;
    block += `  <Hangup/>\n`;
  } else {
    // yes_no, rating_1_5, multiple_choice
    block += `  <!-- Interactive Choice: ${escapeXml(q.name)} -->\n`;
    block += `  <Gather action="${baseUrl}/response?qId=${q.id}" method="POST" input="dtmf speech" numDigits="1" timeout="${q.timeoutSeconds}">\n`;
    block += `    <Say voice="Polly.Aria-Neural" language="en-NZ">${escapeXml(q.promptText)}</Say>\n`;
    block += `  </Gather>\n`;
    block += `  <!-- Timeout fallback -->\n`;
    block += `  <Say voice="Polly.Aria-Neural" language="en-NZ">${escapeXml(q.retryPromptText || 'We did not detect a response. Please call us back on 09 837 0000.')}</Say>\n`;
    block += `  <Hangup/>\n`;
  }

  return block;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/[<]/g, '&lt;')
    .replace(/[>]/g, '&gt;')
    .replace(/[&]/g, '&amp;')
    .replace(/["']/g, '&apos;');
}
