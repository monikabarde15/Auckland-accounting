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

export function getCanonicalWebhookBase(): string {
  return 'https://auckland-accountin.onrender.com';
}

/**
 * Generates TwiML XML string for an individual question in the graph.
 */
export async function renderQuestionTwiml(
  callAttemptId: string,
  questionId: string,
  retryCount: number = 0,
  preloadedAttempt?: any
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

  const escapedPrompt = escapeXml(promptText);

  // 1. MESSAGE_ONLY / ANNOUNCEMENT
  if (question.type === QuestionType.MESSAGE_ONLY) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${escapedPrompt}</Say>
  <Hangup/>
</Response>`;
  }

  // 2. TRANSFER
  if (question.type === QuestionType.TRANSFER) {
    const transferNumber = question.transferPhoneNumber || env.TWILIO_PHONE_NUMBER || '';
    const statusUrl = escapeXml(`${webhookBase}/api/voice/status?callAttemptId=${encodeURIComponent(callAttemptId)}`);
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${escapedPrompt}</Say>
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
    <Say voice="alice">${escapedPrompt}</Say>
  </Gather>
  <Say voice="alice">We did not receive your input. Goodbye.</Say>
  <Hangup/>
</Response>`;
  }

  // 4. YES_NO / MULTIPLE_CHOICE / RATING
  const numDigits = 1;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" numDigits="${numDigits}" timeout="${question.timeoutSeconds || 6}" action="${gatherActionUrl}" method="POST">
    <Say voice="alice">${escapedPrompt}</Say>
  </Gather>
  <Say voice="alice">We did not receive your response. Goodbye.</Say>
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

  // If question is not found or this was a general call, respond gracefully
  if (!question) {
    const confirmationText = cleanDigits === '1'
      ? 'Thank you. Your confirmation has been recorded successfully.'
      : cleanDigits === '2'
      ? 'Thank you. We have noted your response.'
      : `Thank you. You pressed ${cleanDigits}. Your response has been recorded.`;

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${confirmationText}</Say>
  <Pause length="1"/>
  <Say voice="alice">Have a wonderful day. Goodbye.</Say>
  <Hangup/>
</Response>`;
  }

  // If no option matched and it was a strict choice question
  if (!matchedOption && question.type !== QuestionType.NUMERIC && question.type !== QuestionType.RATING) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">That is an invalid selection. Let us try once more.</Say>
  <Redirect method="POST">${webhookBase}/api/voice/twiml/${encodeURIComponent(callAttemptId)}/${encodeURIComponent(questionId)}</Redirect>
</Response>`;
  }

  // Determine Next Action
  const nextAction = matchedOption?.nextAction || NextAction.CONTINUE;
  const nextQuestionId = matchedOption?.nextQuestionId;

  if (nextAction === NextAction.END_CALL) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Thank you for your response. Have a great day. Goodbye.</Say>
  <Hangup/>
</Response>`;
  }

  if (nextAction === NextAction.TRANSFER) {
    const transferNumber = question.transferPhoneNumber || env.TWILIO_PHONE_NUMBER || '';
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Transferring you now. Please hold.</Say>
  <Dial callerId="${attempt?.callJob?.campaign?.callerId || ''}">${transferNumber}</Dial>
</Response>`;
  }

  // Continue to Next Question
  if (nextQuestionId) {
    return renderQuestionTwiml(callAttemptId, nextQuestionId);
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
        return renderQuestionTwiml(callAttemptId, nextSequential.id);
      }
    } catch (err) {
      logger.warn({ err }, 'Error looking up next sequential question');
    }
  }

  // End of questionnaire
  const finalMessage = cleanDigits === '1'
    ? 'Thank you. Your confirmation has been recorded successfully.'
    : cleanDigits === '2'
    ? 'Thank you. We have recorded your selection.'
    : `Thank you for your response.`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${finalMessage} Thank you for calling Auckland Accounting. Goodbye.</Say>
  <Hangup/>
</Response>`;
}
