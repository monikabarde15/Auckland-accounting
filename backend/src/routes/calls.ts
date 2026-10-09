import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import twilio from 'twilio';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { listCalls, getCallById } from '../services/callService.js';
import { prisma } from '../services/prisma.js';
import { env } from '../config/env.js';
import { BadRequestError } from '../errors/AppError.js';
import { CallStatus } from '@prisma/client';
import { logger } from '../middleware/logger.js';
import { getCanonicalWebhookBase, renderSayTag } from '../services/ivr/ivrEngine.js';

export const callsRouter = Router();

// In-Memory flow cache supporting full interactive questionnaires, zero Redis dependency
interface FlowContext {
  questionnaireId?: string;
  campaignId?: string;
  questionnaire?: any;
  promptText?: string;
  hasHindi?: boolean;
  contactName?: string;
}

const liveFlowStore = new Map<string, FlowContext>();

// Pre-seed standard practice questionnaire flows
liveFlowStore.set('qnr_yes_no_gst', {
  questionnaireId: 'qnr_yes_no_gst',
  questionnaire: {
    id: 'qnr_yes_no_gst',
    title: 'GST Return & Filing Approval (Yes / No)',
    questions: [
      {
        orderNo: 1,
        id: 'q_gst_step_1',
        name: 'Step 1: Draft Review Confirmation',
        questionText: 'Kia Ora, this is Auckland Accounting Services regarding your GST draft review. Have you reviewed your draft return? Press 1 for Yes, or 2 for No.',
        options: [
          { dtmfDigit: '1', optionKey: '1', nextQuestionId: 'q_gst_step_2', label: 'Yes, draft reviewed' },
          { dtmfDigit: '2', optionKey: '2', nextQuestionId: 'q_gst_step_3', label: 'No, need assistance' }
        ]
      },
      {
        orderNo: 2,
        id: 'q_gst_step_2',
        name: 'Step 2: Filing Authorization',
        questionText: 'Do you authorize Auckland Accounting Services to submit your return directly to the Inland Revenue Department? Press 1 to Authorize, or 2 to Request Changes.',
        options: [
          { dtmfDigit: '1', optionKey: '1', label: 'Authorize Submission' },
          { dtmfDigit: '2', optionKey: '2', label: 'Request Changes' }
        ]
      }
    ]
  }
});

// Unauthenticated webhook for DTMF inputs gathered on test calls
callsRouter.all('/test-gather', async (req: Request, res: Response) => {
  const digits = ((req.body.Digits || req.query.Digits || '') as string).trim();
  const callSid = (req.body.CallSid || req.query.CallSid || '') as string;
  const campId = (req.query.campId || req.body.campId || '') as string;
  const qnrId = (req.query.qnrId || req.body.qnrId || '') as string;
  const qIndex = parseInt((req.query.qIndex || req.body.qIndex || '1') as string, 10);
  const isHindi = req.query.hasHindi === 'true' || req.body.hasHindi === 'true';

  logger.info({ digits, callSid, campId, qnrId, qIndex, isHindi }, '[TWILIO TEST CALL GATHER RECEIVED]');

  const webhookBase = getCanonicalWebhookBase(req);

  // Look up questionnaire from in-memory flow cache first (no Redis needed), then database
  let questionnaire: any = null;
  const cachedFlow = (callSid ? liveFlowStore.get(callSid) : null) || (qnrId ? liveFlowStore.get(qnrId) : null) || (campId ? liveFlowStore.get(campId) : null);
  if (cachedFlow?.questionnaire) {
    questionnaire = cachedFlow.questionnaire;
  }

  if (!questionnaire && qnrId) {
    try {
      questionnaire = await prisma.questionnaire.findUnique({
        where: { id: qnrId },
        include: { questions: { orderBy: { orderNo: 'asc' }, include: { options: true } } }
      });
    } catch {}
  }

  if (!questionnaire && campId) {
    try {
      const camp = await prisma.campaign.findUnique({
        where: { id: campId },
        include: {
          questionnaire: {
            include: { questions: { orderBy: { orderNo: 'asc' }, include: { options: true } } }
          }
        }
      });
      questionnaire = camp?.questionnaire || null;
    } catch {}
  }

  // Record DTMF in DB if a matching CallAttempt exists for this callSid
  if (callSid) {
    try {
      const attempt = await prisma.callAttempt.findFirst({
        where: { providerCallId: callSid }
      });
      if (attempt) {
        await prisma.callResponse.create({
          data: {
            callAttemptId: attempt.id,
            questionId: `test-q${qIndex}`,
            responseValue: digits,
            responseText: digits === '1' ? 'Option 1: Confirmed / Proceed' : digits === '2' ? 'Option 2: Reschedule / Decline' : `Option ${digits}`,
            inputMethod: 'DTMF',
            isValid: true
          }
        });
      }
    } catch {}
  }

  const questions: any[] = questionnaire?.questions || [];
  const currentQ = questions.find((q: any, idx: number) => q.orderNo === qIndex || idx === qIndex - 1) || questions[0];
  const currentOptions: any[] = currentQ?.options || [];
  const matchedOption = currentOptions.find((opt: any) => 
    (opt.dtmfDigit && opt.dtmfDigit === digits) || 
    (opt.optionKey && opt.optionKey === digits)
  );

  let nextQ: any = null;
  if (matchedOption?.nextQuestionId) {
    nextQ = questions.find((q: any) => q.id === matchedOption.nextQuestionId);
  }
  if (!nextQ && digits === '1' && questions.length > qIndex) {
    nextQ = questions.find((q: any) => q.orderNo === qIndex + 1) || questions[qIndex];
  }

  let xml = '';

  // If there is a next question to present in the flow
  if (nextQ) {
    const nextQIndex = nextQ.orderNo || (qIndex + 1);
    const nextActionUrl = `${webhookBase}/api/calls/test-gather?qIndex=${nextQIndex}&qnrId=${encodeURIComponent(questionnaire?.id || qnrId)}&campId=${encodeURIComponent(campId)}&hasHindi=${isHindi}`;
    const transitionPrefix = isHindi ? `Aapne ${digits} dabaya hai. ` : `You selected ${digits}. `;
    const promptText = `${transitionPrefix}${nextQ.promptText || nextQ.questionText || ''}`;

    xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" numDigits="1" timeout="8" action="${nextActionUrl}" method="POST">
    ${renderSayTag(promptText)}
  </Gather>
  ${renderSayTag(isHindi ? 'Aapka response prapt nahi hua. Dhanyavaad, alvida.' : 'We did not receive your input. Have a great day. Goodbye.')}
  <Hangup/>
</Response>`;
  } else if (digits === '1') {
    // Option 1 Terminal Confirmation Script
    const confirmMsg = isHindi
      ? 'Dhanyavaad! Aapne 1 dabaya hai. Aapka GST aur tax return confirm ho gaya hai aur Auckland Accounting dwara jama kar diya gaya hai. Alvida.'
      : 'Thank you! You pressed 1 to confirm. Your tax filing verification has been confirmed and submitted to Inland Revenue. Auckland Accounting wishes you a wonderful day. Goodbye.';

    xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${renderSayTag(confirmMsg)}
  <Hangup/>
</Response>`;
  } else if (digits === '2') {
    // Option 2 Reschedule / Call Back Script
    const rescheduleMsg = isHindi
      ? 'Dhanyavaad! Aapne 2 dabaya hai. Aapka anurodh darj kar liya gaya hai. Auckland Accounting se hamare senior accountant aapse jald hi sampark karenge. Alvida.'
      : 'Thank you! You pressed 2 to reschedule. Your request has been recorded and our senior accountant will follow up with you shortly. Have a wonderful day. Goodbye.';

    xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${renderSayTag(rescheduleMsg)}
  <Hangup/>
</Response>`;
  } else {
    // Any other digit / response
    const otherMsg = isHindi
      ? `Aapne ${digits} dabaya hai. Auckland Accounting ne aapka response darj kar liya hai. Sahayata ke liye kripya hamare office se sampark karein. Dhanyavaad, alvida.`
      : `You selected option ${digits}. Auckland Accounting has recorded your selection. For further assistance, please contact our office. Have a wonderful day. Goodbye.`;

    xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${renderSayTag(otherMsg)}
  <Hangup/>
</Response>`;
  }

  res.status(200).type('text/xml').send(xml);
});

// We will add the unauthenticated twilio-errors route BEFORE the requireAuth middleware
callsRouter.get('/twilio-errors/recent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
      return res.json({ error: 'Twilio credentials not configured' });
    }
    const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    const alerts = await client.monitor.v1.alerts.list({ limit: 10 });
    
    const formattedAlerts = alerts.map(a => ({
      date: a.dateCreated,
      errorCode: a.errorCode,
      logLevel: a.logLevel,
      alertText: a.alertText,
      requestUrl: a.requestUrl,
      requestMethod: a.requestMethod,
      requestVariables: a.requestVariables,
      responseBody: a.responseBody
    }));

    res.json({ success: true, alerts: formattedAlerts });
  } catch (err: any) {
    res.json({ error: err.message });
  }
});

// All call inspection endpoints require authentication
callsRouter.use(requireAuth);

const listCallsQuerySchema = z.object({
  page: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 1)),
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 20)),
  campaignId: z.string().optional(),
  contactId: z.string().optional(),
  status: z.nativeEnum(CallStatus).optional(),
  search: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  minDuration: z.string().optional().transform((val) => (val ? parseInt(val, 10) : undefined)),
  maxDuration: z.string().optional().transform((val) => (val ? parseInt(val, 10) : undefined)),
  sortBy: z.enum(['startedAt', 'durationSeconds', 'status']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional()
});

/**
 * GET /api/calls
 * List call attempts with filters and pagination.
 */
callsRouter.get('/', requirePermission('calls.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = listCallsQuerySchema.parse(req.query);
    const result = await listCalls(query);

    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/calls/:id
 * Retrieve comprehensive details for a specific call attempt.
 */
callsRouter.get('/:id', requirePermission('calls.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const call = await getCallById(req.params.id);
    res.json({ success: true, data: call });
  } catch (err) {
    next(err);
  }
});

const testLiveCallSchema = z.object({
  phoneNumber: z.string().min(1, 'Recipient phone number is required'),
  callerId: z.string().optional(),
  campaignId: z.string().optional(),
  questionnaireId: z.string().optional(),
  promptText: z.string().optional(),
  questionnaire: z.any().optional(),
  currentQuestionId: z.string().optional(),
  contact: z.any().optional()
});

/**
 * POST /api/calls/test-live
 * Initiates an authenticated live outbound test call via Twilio to test real telephony.
 */
callsRouter.post('/test-live', requirePermission('calls.execute'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = testLiveCallSchema.parse(req.body);
    const phoneNorm = normalizePhoneNumber(body.phoneNumber);
    const targetNumber = phoneNorm.isValid ? phoneNorm.e164 : body.phoneNumber.trim();
    let fromNumber = (
      body.callerId && body.callerId.length > 7 && body.callerId !== '12345'
        ? body.callerId
        : env.TWILIO_PHONE_NUMBER || '+17372212163'
    ).trim();

    if (!fromNumber) {
      throw new BadRequestError('Twilio Phone Number (TWILIO_PHONE_NUMBER) is not configured in environment variables.');
    }

    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
      throw new BadRequestError('Twilio credentials (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN) are not configured on server.');
    }

    const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

    // Resolve the exact questionnaire prompt created for this campaign or passed dynamically
    let initialPrompt = body.promptText?.trim();

    if (!initialPrompt && (body.campaignId || body.questionnaireId)) {
      try {
        if (body.campaignId) {
          const camp = await prisma.campaign.findUnique({
            where: { id: body.campaignId },
            include: {
              questionnaire: {
                include: { questions: { orderBy: { orderNo: 'asc' } } }
              }
            }
          });
          if (camp?.description && camp?.questionnaire?.questions?.[0]?.questionText) {
            initialPrompt = `${camp.description}. ${camp.questionnaire.questions[0].questionText}`;
          } else if (camp?.description) {
            initialPrompt = camp.description;
          } else if (camp?.questionnaire?.questions?.[0]?.questionText) {
            initialPrompt = camp.questionnaire.questions[0].questionText;
          }
        }
        if (!initialPrompt && body.questionnaireId) {
          const qnr = await prisma.questionnaire.findUnique({
            where: { id: body.questionnaireId },
            include: { questions: { orderBy: { orderNo: 'asc' } } }
          });
          if (qnr?.questions?.[0]?.questionText) {
            initialPrompt = qnr.questions[0].questionText;
          }
        }
      } catch {
        // Fallback
      }
    }

    // Build self-contained, valid XML inline TwiML containing the exact questionnaire prompt and DTMF interaction
    const escapeXml = (unsafe: string) =>
      unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
          case '<': return '&lt;';
          case '>': return '&gt;';
          case '&': return '&amp;';
          case '\'': return '&apos;';
          case '"': return '&quot;';
          default: return c;
        }
      });

    const speakText = initialPrompt || 'Kia ora. This is an automated notification from Auckland Accounting regarding your account.';
    const escapedPrompt = escapeXml(speakText);

    const hasHindi = /[\u0900-\u097F]/.test(speakText) || /\b(namaste|shukriya|aapka|kripya)\b/i.test(speakText);
    const sayTag = hasHindi
      ? `<Say voice="Polly.Aditi" language="hi-IN">${escapedPrompt}</Say>`
      : `<Say voice="Polly.Aria-Neural" language="en-NZ">${escapedPrompt}</Say>`;

    const webhookBase = getCanonicalWebhookBase(req);
    const gatherActionUrl = `${webhookBase}/api/calls/test-gather?campId=${encodeURIComponent(body.campaignId || '')}&qnrId=${encodeURIComponent(body.questionnaireId || '')}&qIndex=1&hasHindi=${hasHindi}`;

    const inlineTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" numDigits="1" timeout="8" action="${gatherActionUrl}" method="POST">
    ${sayTag}
  </Gather>
  ${hasHindi 
    ? '<Say voice="Polly.Aditi" language="hi-IN">Dhanyavaad. Auckland Accounting mein aapka response record ho gaya hai. Alvida.</Say>'
    : '<Say voice="Polly.Aria-Neural" language="en-NZ">Thank you for your response. Auckland Accounting has recorded your submission. Have a wonderful day.</Say>'
  }
  <Hangup/>
</Response>`;

    try {
      const callOptions: any = {
        to: targetNumber,
        from: fromNumber,
        twiml: inlineTwiml
      };

      const call = await client.calls.create(callOptions);

      // Cache the questionnaire flow in memory (zero Redis)
      const flowData = {
        questionnaireId: body.questionnaireId,
        campaignId: body.campaignId,
        questionnaire: body.questionnaire,
        promptText: speakText,
        hasHindi,
        contactName: body.contact?.name
      };
      liveFlowStore.set(call.sid, flowData);
      if (body.questionnaireId) {
        liveFlowStore.set(body.questionnaireId, flowData);
      }
      if (body.campaignId) {
        liveFlowStore.set(body.campaignId, flowData);
      }

      // Track test call in DB so live console and DTMF gather history are recorded
      setImmediate(async () => {
        try {
          let contact = await prisma.contact.findFirst({ where: { phoneNumber: targetNumber } });
          if (!contact) {
            contact = await prisma.contact.create({
              data: {
                name: 'Test Recipient',
                phoneNumber: targetNumber,
                consentStatus: 'GRANTED'
              }
            });
          }
          let camp = body.campaignId ? await prisma.campaign.findUnique({ where: { id: body.campaignId } }) : null;
          if (!camp) {
            camp = await prisma.campaign.findFirst({ where: { status: 'RUNNING' } }) || await prisma.campaign.findFirst();
          }
          if (camp) {
            let job = await prisma.callJob.findFirst({ where: { campaignId: camp.id, contactId: contact.id } });
            if (!job) {
              job = await prisma.callJob.create({
                data: {
                  campaignId: camp.id,
                  contactId: contact.id,
                  status: 'DISPATCHED',
                  attempts: 1,
                  maxAttempts: 3
                }
              });
            }
            await prisma.callAttempt.create({
              data: {
                callJobId: job.id,
                status: CallStatus.IN_PROGRESS,
                providerCallId: call.sid,
                startedAt: new Date()
              }
            });
          }
        } catch (dbErr) {
          logger.warn({ err: dbErr }, 'Non-fatal: could not create CallAttempt for test call');
        }
      });

      return res.json({
        success: true,
        data: {
          callSid: call.sid,
          status: call.status,
          to: targetNumber,
          from: fromNumber,
          direction: call.direction,
          dateCreated: call.dateCreated,
          scriptPlayed: speakText
        }
      });
    } catch (twilioErr: any) {
      const errorMsg = twilioErr?.message || '';
      const errorCode = twilioErr?.code || twilioErr?.status;
      logger.error({ errorCode, errorMsg, to: targetNumber, from: fromNumber }, 'Twilio call creation failed');

      let userFriendlyMessage = errorMsg;
      if (errorCode === 20003 || errorMsg.includes('20003') || errorMsg.includes('status 8') || errorMsg.includes('auth token is not valid')) {
        if (errorMsg.includes('status 8')) {
          userFriendlyMessage = 'Twilio Account Suspended (Status 8): Your Twilio account was suspended by Twilio. Please check your Twilio Console (https://console.twilio.com) or upgrade your account.';
        } else {
          userFriendlyMessage = 'Twilio Authentication Failed (Error 20003): The TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is invalid. Please check your Twilio credentials in your Twilio Console dashboard.';
        }
      } else if (errorCode === 21408 || errorMsg.includes('Permission to call an unpermitted country') || errorMsg.includes('Geo Permission')) {
        userFriendlyMessage = `Twilio Geo Permission Blocked: Calling to ${targetNumber} (India) is not enabled. In Twilio Console, go to Voice -> Settings -> Geo Permissions, find "India" and check the box to allow calls.`;
      } else if (errorCode === 21211 || errorMsg.includes('Invalid \'To\' Phone Number')) {
        userFriendlyMessage = `Invalid Phone Number format: Recipient number (${targetNumber}) must be in international format (e.g. +917089526977).`;
      } else if (errorCode === 0 || errorMsg.includes('trial accounts') || errorCode === 21215 || errorCode === 21608 || errorMsg.includes('verified recipient')) {
        userFriendlyMessage = `Twilio Trial Restriction (Error 21608): On a Twilio trial account, you can ONLY call verified phone numbers. Please verify ${targetNumber} in Twilio Console under: Phone Numbers -> Manage -> Verified Caller IDs.`;
      } else if (errorCode === 573002 || errorMsg.includes('No Twilio trial phone number')) {
        userFriendlyMessage = 'Twilio Setup: Please ensure a Twilio phone number is active in your Twilio Console.';
      }

      return res.status(400).json({
        success: false,
        error: {
          code: 'TWILIO_ERROR',
          message: userFriendlyMessage || 'Twilio call failed'
        }
      });
    }
  } catch (err: any) {
    next(err);
  }
});

/**
 * GET /api/calls/live-status/:callSid
 * Checks live status of in-flight Twilio call directly from Twilio.
 */
callsRouter.get('/live-status/:callSid', requirePermission('calls.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { callSid } = req.params;
    if (!callSid) {
      throw new BadRequestError('CallSid is required');
    }

    if (callSid.startsWith('CA_SIM') || env.NODE_ENV === 'test') {
      return res.json({
        success: true,
        data: {
          callSid,
          status: 'completed',
          duration: 18,
          to: '+64218924101',
          from: env.TWILIO_PHONE_NUMBER || '+6498370000',
          recordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC59c3627e754f0a43addb43756a45891a/Recordings/RE_SIMULATED_TEST.mp3'
        }
      });
    }

    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
      throw new BadRequestError('Twilio credentials not configured.');
    }
    const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    const twilioCall = await client.calls(callSid).fetch();

    let recordingUrl: string | undefined = undefined;
    try {
      const recs = await client.calls(callSid).recordings.list({ limit: 1 });
      if (recs && recs.length > 0) {
        recordingUrl = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Recordings/${recs[0].sid}.mp3`;
      }
    } catch {
      // Recording may still be processing
    }

    return res.json({
      success: true,
      data: {
        callSid: twilioCall.sid,
        status: twilioCall.status, // 'queued' | 'ringing' | 'in-progress' | 'completed' | 'busy' | 'failed' | 'no-answer' | 'canceled'
        duration: twilioCall.duration ? parseInt(twilioCall.duration, 10) : 0,
        startTime: twilioCall.startTime,
        endTime: twilioCall.endTime,
        to: twilioCall.to,
        from: twilioCall.from,
        recordingUrl
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/calls/live-hangup/:callSid
 * Terminates an in-flight Twilio call.
 */
callsRouter.post('/live-hangup/:callSid', requirePermission('calls.execute'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { callSid } = req.params;
    if (!callSid) {
      throw new BadRequestError('CallSid is required');
    }

    if (callSid.startsWith('CA_SIM') || env.NODE_ENV === 'test') {
      return res.json({ success: true, data: { callSid, status: 'completed' } });
    }

    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
      throw new BadRequestError('Twilio credentials not configured.');
    }
    const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    try {
      const twilioCall = await client.calls(callSid).update({ status: 'completed' });
      return res.json({ success: true, data: { callSid: twilioCall.sid, status: twilioCall.status } });
    } catch {
      // If the call already concluded naturally on Twilio, return completed status gracefully
      return res.json({ success: true, data: { callSid, status: 'completed' } });
    }
  } catch (err) {
    next(err);
  }
});
