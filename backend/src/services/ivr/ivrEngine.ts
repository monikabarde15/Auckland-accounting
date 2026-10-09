import { prisma } from '../prisma.js';
import { QuestionType, NextAction, InputMethod } from '@prisma/client';
import { env } from '../../config/env.js';
import { logger } from '../../middleware/logger.js';

export interface InterpolationContext {
  client_name?: string;
  company_name?: string;
  balance?: string;
  due_date?: string;
  assigned_accountant?: string;
  ird_number?: string;
  [key: string]: string | undefined;
}

export function escapeXml(unsafe: string | null | undefined): string {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Replaces dynamic placeholders like {client_name}, {balance} in prompts.
 */
export function interpolateVariables(text: string, context: InterpolationContext): string {
  if (!text) return '';
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    const val = context[key];
    if (val !== undefined && val !== null && val !== '') {
      return String(val);
    }
    // Safe fallbacks for common variables
    if (key === 'client_name') return 'valued client';
    if (key === 'company_name') return 'Auckland Accounting Services';
    if (key === 'balance') return 'your current balance';
    if (key === 'due_date') return 'the due date';
    return match;
  });
}

/**
 * Builds interpolation context from contact record.
 */
export function buildContactContext(contact: {
  name: string;
  companyName?: string | null;
  outstandingBalance?: unknown;
  dueDate?: Date | null;
  assignedAccountant?: string | null;
  irdNumber?: string | null;
}): InterpolationContext {
  let formattedBalance = '';
  if (contact.outstandingBalance !== undefined && contact.outstandingBalance !== null) {
    const num = Number(contact.outstandingBalance);
    formattedBalance = isNaN(num) ? String(contact.outstandingBalance) : `$${num.toFixed(2)}`;
  }

  let formattedDueDate = '';
  if (contact.dueDate) {
    formattedDueDate = new Date(contact.dueDate).toLocaleDateString('en-NZ', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  return {
    client_name: contact.name,
    company_name: contact.companyName || 'Auckland Accounting Services Ltd',
    balance: formattedBalance || '$0.00',
    due_date: formattedDueDate || 'upcoming',
    assigned_accountant: contact.assignedAccountant || 'Senior Accountant',
    ird_number: contact.irdNumber || ''
  };
}

export function getCanonicalWebhookBase(req?: any): string {
  // 1. Explicitly configured Twilio Webhook URL always wins
  if (env.TWILIO_WEBHOOK_BASE_URL) return env.TWILIO_WEBHOOK_BASE_URL;

  // 2. If called within an Express request context, dynamically infer the host
  if (req) {
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    if (host) {
      return `${proto}://${host}`;
    }
  }

  // 3. Fallback to computed BASE_URL (from env variables)
  if (env.BASE_URL && !env.BASE_URL.includes('localhost')) {
    return env.BASE_URL;
  }

  // 4. Hard fallback to the user's specific Render production domain
  return 'https://auckland-accountin.onrender.com';
}

export function renderSayTag(text: string): string {
  const escaped = escapeXml(text);
  const isHindi = /[\u0900-\u097F]/.test(text) || /\b(namaste|shukriya|dhanyavaad|aapka|aapne|kripya|alvida|dabaye|vikalp|chuna|darj)\b/i.test(text);
  if (isHindi) {
    return `<Say voice="Polly.Aditi" language="hi-IN">${escaped}</Say>`;
  }
  return `<Say voice="Polly.Aria-Neural" language="en-NZ">${escaped}</Say>`;
}

/**
 * Generates TwiML XML string for an individual question in the graph.
 */
export async function renderQuestionTwiml(
  callAttemptId: string,
  questionId: string,
  retryCount: number = 0,
  preloadedAttempt?: any,
  transitionPhrase?: string
): Promise<string> {
  const attempt = preloadedAttempt || (await prisma.callAttempt.findUnique({
    where: { id: callAttemptId },
    include: {
      callJob: {
        include: {
          campaign: true,
          contact: true
        }
      }
    }
  }));

  if (!attempt) {
    return '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Error loading call details. Goodbye.</Say><Hangup/></Response>';
  }

  const question =
    preloadedAttempt?.callJob?.campaign?.questionnaire?.questions?.find((q: any) => q.id === questionId) ||
    (await prisma.question.findUnique({
      where: { id: questionId },
      include: { options: true }
    }));

  if (!question) {
    return '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Questionnaire completed. Thank you for your time. Goodbye.</Say><Hangup/></Response>';
  }

  const context = buildContactContext(attempt.callJob.contact);
  let promptText = interpolateVariables(question.questionText, context);
  
  // Prepend campaign script/description if this is the first question and not a placeholder
  if (
    question.orderNo === 1 &&
    attempt.callJob.campaign.description &&
    !attempt.callJob.campaign.description.toLowerCase().includes('practice outbound calling campaign')
  ) {
    const introText = interpolateVariables(attempt.callJob.campaign.description, context);
    promptText = `${introText}. ${promptText}`;
  }

  const webhookBase = getCanonicalWebhookBase();
  const rawGatherUrl = `${webhookBase}/api/voice/gather/${encodeURIComponent(callAttemptId)}/${encodeURIComponent(questionId)}`;
  const gatherActionUrl = escapeXml(rawGatherUrl);

  if (transitionPhrase) {
    promptText = `${transitionPhrase} ${promptText}`;
  }

  const escapedPrompt = escapeXml(promptText);

  // Safely log the bot's speech so it shows in the live console immediately
  if (callAttemptId) {
    try {
      await prisma.callResponse.create({
        data: {
          callAttemptId,
          questionId: questionId + '-bot-speak',
          responseValue: 'BOT',
          responseText: `(Bot speaking): ${promptText}`,
          inputMethod: 'DTMF',
          isValid: true
        }
      });
    } catch (e) {}
  }

  // 1. MESSAGE_ONLY / ANNOUNCEMENT
  if (question.type === QuestionType.MESSAGE_ONLY) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${renderSayTag(promptText)}
  <Hangup/>
</Response>`;
  }

  // 2. TRANSFER
  if (question.type === QuestionType.TRANSFER) {
    const transferNumber = question.transferPhoneNumber || env.TWILIO_PHONE_NUMBER || '';
    const statusUrl = escapeXml(`${webhookBase}/api/voice/status?callAttemptId=${encodeURIComponent(callAttemptId)}`);
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${renderSayTag(promptText)}
  <Dial callerId="${escapeXml(attempt.callJob?.campaign?.callerId || '')}" action="${statusUrl}">${escapeXml(transferNumber)}</Dial>
</Response>`;
  }

  // 3. NUMERIC INPUT
  if (question.type === QuestionType.NUMERIC) {
    const maxDigits = question.maxDigits || 10;
    const finishKey = escapeXml(question.finishOnKey || '#');
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" numDigits="${maxDigits}" finishOnKey="${finishKey}" timeout="${question.timeoutSeconds || 8}" action="${gatherActionUrl}" method="POST">
    ${renderSayTag(promptText)}
  </Gather>
  ${renderSayTag('We did not receive your input. Goodbye.')}
  <Hangup/>
</Response>`;
  }

  // 4. YES_NO / MULTIPLE_CHOICE / RATING
  const numDigits = 1;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" numDigits="${numDigits}" timeout="${question.timeoutSeconds || 8}" action="${gatherActionUrl}" method="POST">
    ${renderSayTag(promptText)}
  </Gather>
  ${renderSayTag('We did not receive your response. Goodbye.')}
  <Hangup/>
</Response>`;
}

/**
 * Processes gathered DTMF input, records response, and determines the next step in the graph.
 */
export async function processGatheredResponse(
  callAttemptId: string,
  questionId: string,
  digits: string
): Promise<string> {
  const cleanDigits = (digits || '').trim();
  const webhookBase = getCanonicalWebhookBase();

  let attempt = null;
  if (callAttemptId) {
    try {
      attempt = await prisma.callAttempt.findUnique({
        where: { id: callAttemptId },
        include: {
          callJob: {
            include: {
              campaign: true,
              contact: true
            }
          }
        }
      });
    } catch (err) {
      logger.warn({ err, callAttemptId }, 'Error fetching callAttempt in processGatheredResponse');
    }
  }

  let question = null;
  if (questionId) {
    try {
      question = await prisma.question.findUnique({
        where: { id: questionId },
        include: { options: true }
      });
    } catch (err) {
      logger.warn({ err, questionId }, 'Error fetching question in processGatheredResponse');
    }
  }

  // Match option from DTMF if question exists
  let matchedOption = question?.options?.find((opt) => opt.optionKey === cleanDigits);

  if (!matchedOption && question?.type === QuestionType.YES_NO) {
    if (cleanDigits === '1') {
      matchedOption = question.options.find((o) => o.optionLabel.toLowerCase().includes('yes') || o.optionKey === '1') || question.options[0];
    } else if (cleanDigits === '2') {
      matchedOption = question.options.find((o) => o.optionLabel.toLowerCase().includes('no') || o.optionKey === '2') || question.options[1];
    }
  }

  // Record response in database safely without throwing errors to Twilio
  if (callAttemptId && questionId) {
    try {
      await prisma.callResponse.create({
        data: {
          callAttemptId,
          questionId,
          responseValue: cleanDigits,
          responseText: matchedOption?.optionLabel || cleanDigits,
          inputMethod: InputMethod.DTMF,
          isValid: Boolean(matchedOption || question?.type === QuestionType.NUMERIC || question?.type === QuestionType.RATING)
        }
      });
    } catch (err) {
      logger.warn({ err, callAttemptId, questionId }, 'Could not record callResponse in database');
    }
  }

  logger.info(
    { callAttemptId, questionId, digits: cleanDigits, matchedOption: matchedOption?.optionLabel },
    'Recorded questionnaire response'
  );

  const isHindiContext = 
    /[\u0900-\u097F]/.test(question?.questionText || '') ||
    /\b(namaste|shukriya|dhanyavaad|aapka|kripya)\b/i.test(question?.questionText || '') ||
    /\b(namaste|shukriya|dhanyavaad|aapka|kripya)\b/i.test(attempt?.callJob?.campaign?.description || '');

  // If question is not found or this was a general call, respond gracefully with the full script
  if (!question) {
    let confirmationText = '';
    if (isHindiContext) {
      confirmationText = cleanDigits === '1'
        ? 'Dhanyavaad! Aapne 1 dabaya hai. Aapka GST aur tax return confirm ho gaya hai aur Auckland Accounting dwara jama kar diya gaya hai. Alvida.'
        : cleanDigits === '2'
        ? 'Dhanyavaad! Aapne 2 dabaya hai. Aapka anurodh darj kar liya gaya hai. Auckland Accounting se hamare senior accountant aapse jald hi sampark karenge. Alvida.'
        : `Aapne ${cleanDigits} dabaya hai. Auckland Accounting ne aapka response darj kar liya hai. Sahayata ke liye kripya hamare office se sampark karein. Dhanyavaad, alvida.`;
    } else {
      confirmationText = cleanDigits === '1'
        ? 'Thank you! You pressed 1 to confirm. Your tax filing verification has been confirmed and submitted to Inland Revenue. Auckland Accounting wishes you a wonderful day. Goodbye.'
        : cleanDigits === '2'
        ? 'Thank you! You pressed 2 to reschedule. Your request has been recorded and our senior accountant will follow up with you shortly. Have a wonderful day. Goodbye.'
        : `You selected option ${cleanDigits}. Auckland Accounting has recorded your selection. For further assistance, please contact our office. Have a wonderful day. Goodbye.`;
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${renderSayTag(confirmationText)}
  <Hangup/>
</Response>`;
  }

  // If no option matched (e.g. user pressed 3, 4, 5 etc. or other key), deliver graceful response script just like test call
  if (!matchedOption && question.type !== QuestionType.NUMERIC && question.type !== QuestionType.RATING) {
    const responseScript = isHindiContext
      ? `Aapne ${cleanDigits || 'kuch'} dabaya hai. Auckland Accounting ne aapka response darj kar liya hai. Sahayata ke liye kripya hamare office se sampark karein. Dhanyavaad, alvida.`
      : `You selected option ${cleanDigits || 'an unlisted key'}. Auckland Accounting has recorded your response. For further assistance, please contact our office. Have a wonderful day. Goodbye.`;

    if (callAttemptId) {
      try {
        await prisma.callResponse.create({
          data: {
            callAttemptId,
            questionId: questionId + '-response',
            responseValue: cleanDigits || 'OTHER',
            responseText: `(User input ${cleanDigits}): ${responseScript}`,
            inputMethod: 'DTMF',
            isValid: true
          }
        });
      } catch (e) {}
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${renderSayTag(responseScript)}
  <Hangup/>
</Response>`;
  }

  // Determine Next Action
  const nextAction = matchedOption?.nextAction || NextAction.CONTINUE;
  const nextQuestionId = matchedOption?.nextQuestionId;

  if (nextAction === NextAction.END_CALL) {
    let endScript = '';
    if (isHindiContext) {
      endScript = cleanDigits === '1'
        ? 'Dhanyavaad! Aapne 1 dabaya hai. Aapka GST aur tax return confirm ho gaya hai aur Auckland Accounting dwara jama kar diya gaya hai. Alvida.'
        : cleanDigits === '2'
        ? 'Dhanyavaad! Aapne 2 dabaya hai. Aapka anurodh darj kar liya gaya hai. Auckland Accounting se hamare senior accountant aapse jald hi sampark karenge. Alvida.'
        : `Aapne ${cleanDigits} dabaya hai. Auckland Accounting ne aapka response darj kar liya hai. Alvida.`;
    } else {
      endScript = cleanDigits === '1' 
        ? 'Thank you! You pressed 1 to confirm. Your tax filing verification has been confirmed and submitted to Inland Revenue. Auckland Accounting wishes you a wonderful day. Goodbye.'
        : cleanDigits === '2'
        ? 'Thank you! You pressed 2 to reschedule. Your request has been recorded and our senior accountant will follow up with you shortly. Have a wonderful day. Goodbye.'
        : `You selected option ${cleanDigits}. Auckland Accounting has recorded your selection. Have a wonderful day. Goodbye.`;
    }
      
    if (callAttemptId) {
      try {
        await prisma.callResponse.create({
          data: {
            callAttemptId,
            questionId: questionId + '-end-action',
            responseValue: 'END',
            responseText: `(System Final Message): ${endScript}`,
            inputMethod: 'DTMF',
            isValid: true
          }
        });
      } catch (e) {}
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${renderSayTag(endScript)}
  <Hangup/>
</Response>`;
  }

  if (nextAction === NextAction.TRANSFER) {
    const transferNumber = question.transferPhoneNumber || env.TWILIO_PHONE_NUMBER || '';
    const transferMsg = isHindiContext 
      ? 'Aapki call hamare accountant ko transfer ki ja rahi hai. Kripya line par bane rahein.'
      : 'Transferring you now. Please hold.';
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${renderSayTag(transferMsg)}
  <Dial callerId="${attempt?.callJob?.campaign?.callerId || ''}">${transferNumber}</Dial>
</Response>`;
  }

  // Continue to Next Question
  if (nextQuestionId) {
    const transitionPhrase = matchedOption?.optionLabel 
      ? (isHindiContext ? `Aapne chuna: ${matchedOption.optionLabel}.` : `You selected ${matchedOption.optionLabel}.`)
      : (isHindiContext ? 'Dhanyavaad.' : 'Thank you.');
    return renderQuestionTwiml(callAttemptId, nextQuestionId, 0, attempt, transitionPhrase);
  }

  // If no explicit nextQuestionId, attempt to find next question in sequence
  if (question.questionnaireId) {
    try {
      const nextSequential = await prisma.question.findFirst({
        where: {
          questionnaireId: question.questionnaireId,
          orderNo: { gt: question.orderNo }
        },
        orderBy: { orderNo: 'asc' }
      });

      if (nextSequential) {
        const transitionPhrase = matchedOption?.optionLabel 
          ? (isHindiContext ? `Aapne chuna: ${matchedOption.optionLabel}.` : `You selected ${matchedOption.optionLabel}.`)
          : (isHindiContext ? 'Dhanyavaad.' : 'Thank you.');
        return renderQuestionTwiml(callAttemptId, nextSequential.id, 0, attempt, transitionPhrase);
      }
    } catch (err) {
      logger.warn({ err }, 'Error looking up next sequential question');
    }
  }

  // End of questionnaire
  let finalScriptToSay = '';
  if (isHindiContext) {
    finalScriptToSay = cleanDigits === '1'
      ? 'Dhanyavaad! Aapne 1 dabaya hai. Aapka GST aur tax return confirm ho gaya hai aur Auckland Accounting dwara jama kar diya gaya hai. Alvida.'
      : cleanDigits === '2'
      ? 'Dhanyavaad! Aapne 2 dabaya hai. Aapka anurodh darj kar liya gaya hai. Auckland Accounting se hamare senior accountant aapse jald hi sampark karenge. Alvida.'
      : `Aapne ${cleanDigits} dabaya hai. Auckland Accounting ne aapka response darj kar liya hai. Alvida.`;
  } else {
    finalScriptToSay = cleanDigits === '1'
      ? 'Thank you! You pressed 1 to confirm. Your tax filing verification has been confirmed and submitted to Inland Revenue. Auckland Accounting wishes you a wonderful day. Goodbye.'
      : cleanDigits === '2'
      ? 'Thank you! You pressed 2 to reschedule. Your request has been recorded and our senior accountant will follow up with you shortly. Have a wonderful day. Goodbye.'
      : `You selected option ${cleanDigits}. Auckland Accounting has recorded your selection. Have a wonderful day. Goodbye.`;
  }

  if (callAttemptId) {
    try {
      await prisma.callResponse.create({
        data: {
          callAttemptId,
          questionId: questionId + '-end',
          responseValue: 'END',
          responseText: `(System Final Message): ${finalScriptToSay}`,
          inputMethod: 'DTMF',
          isValid: true
        }
      });
    } catch (e) {}
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${renderSayTag(finalScriptToSay)}
  <Hangup/>
</Response>`;
}
