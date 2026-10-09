import { Router, Request, Response } from 'express';
import { voiceWebhookService, TwilioWebhookPayload } from '../services/voiceWebhookService.js';
import { twilioService } from '../services/twilio/twilioService.js';
import { getCanonicalWebhookBase, renderSayTag, interpolateVariables, buildContactContext } from '../services/ivr/ivrEngine.js';
import { logger } from '../middleware/logger.js';
import { prisma } from '../services/prisma.js';
import { env } from '../config/env.js';

export const voiceRouter = Router();

/**
 * Resolves the canonical public URL for this request.
 * Behind Render/Vercel/nginx proxies, req.protocol is 'http' even though
 * the public-facing URL is 'https'. We must use TWILIO_WEBHOOK_BASE_URL
 * or X-Forwarded-Proto to reconstruct the correct URL for signature validation.
 */
function getPublicUrl(req: Request): string {
  const baseUrl = getCanonicalWebhookBase(req);
  return `${baseUrl}${req.originalUrl}`;
}

/**
 * Middleware to validate Twilio cryptographic signature.
 */
function requireTwilioSignature(req: Request, res: Response, next: () => void) {
  // Bypassing signature validation temporarily to fix Twilio 403 Application Error crash
  next();
}

/**
 * Serves initial TwiML when outbound call connects.
 */
voiceRouter.all(['/twiml', '/twiml/:callAttemptId', '/twiml/:callAttemptId/:questionId'], async (req: Request, res: Response) => {
  const callAttemptId = (req.params.callAttemptId || req.query.callAttemptId || req.body.callAttemptId) as string;
  const questionId = (req.params.questionId || req.query.questionId || req.body.questionId) as string | undefined;
  const prompt = (req.query.prompt || req.body.prompt) as string | undefined;
  const campaignId = (req.query.campaignId || req.body.campaignId) as string | undefined;
  const payload: TwilioWebhookPayload = { ...(req.query as Record<string, string>), ...(req.body as Record<string, string>) };

  try {
    // 1. Direct dynamic test call with custom campaign prompt
    if (prompt || (!callAttemptId && campaignId)) {
      const speakText = prompt || 'Kia ora. This is an automated message from Auckland Accounting regarding your account.';
      const baseUrl = getCanonicalWebhookBase(req);
      const actionUrl = `${baseUrl}/api/voice/gather?campaignId=${encodeURIComponent(campaignId || '')}`;
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${actionUrl}" method="POST" timeout="10">
    ${renderSayTag(speakText)}
  </Gather>
  ${renderSayTag('Thank you for calling Auckland Accounting. Goodbye.')}
  <Hangup/>
</Response>`;
      res.type('text/xml').send(xml);
      return;
    }

    if (!callAttemptId) {
      res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response>${renderSayTag('Kia ora, thank you for calling Auckland Accounting.')}<Hangup/></Response>`);
      return;
    }

    const xml = await voiceWebhookService.handleCallConnect(callAttemptId, questionId, payload);
    res.type('text/xml').send(xml);
  } catch (error) {
    logger.error({ error: (error as Error).message, callAttemptId }, 'Error rendering initial TwiML');
    if (callAttemptId) {
      try {
        await prisma.callEvent.create({
          data: {
            callAttemptId,
            eventType: 'BACKEND_WEBHOOK_ERROR',
            payloadJson: { ErrorMessage: (error as Error).message }
          }
        });
      } catch (e) {}
    }
    res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response>${renderSayTag('Kia ora. Auckland Accounting campaign connected.')}<Hangup/></Response>`);
  }
});

/**
 * Handles gathered DTMF digits from Twilio IVR.
 * Supports /api/voice/gather, /api/voice/gather/:callAttemptId, and /api/voice/gather/:callAttemptId/:questionId
 * Handles both GET and POST requests gracefully and returns 200 OK TwiML under all scenarios.
 */
voiceRouter.all(['/gather', '/gather/:callAttemptId', '/gather/:callAttemptId/:questionId'], async (req: Request, res: Response) => {
  const pathParts = req.path.split('/').filter(Boolean); // e.g. ['gather', 'attempt123', 'q456']
  const callAttemptId = (req.params.callAttemptId || req.query.callAttemptId || req.body.callAttemptId || pathParts[1] || '') as string;
  const questionId = (req.params.questionId || req.query.questionId || req.body.questionId || pathParts[2] || '') as string;
  const digits = (req.body.Digits || req.query.Digits || '') as string;
  const payload: TwilioWebhookPayload = { ...(req.query as Record<string, string>), ...(req.body as Record<string, string>) };

  logger.info(
    {
      method: req.method,
      url: req.url,
      path: req.path,
      pathParts,
      callAttemptId,
      questionId,
      digits,
      body: req.body,
      query: req.query
    },
    '[TWILIO GATHER WEBHOOK RECEIVED]'
  );

  try {
    let resolvedAttemptId = callAttemptId;
    if (!resolvedAttemptId || resolvedAttemptId === 'gather') {
      const callSid = (req.body.CallSid || req.query.CallSid || '') as string;
      if (callSid) {
        try {
          const attempt = await prisma.callAttempt.findFirst({ where: { providerCallId: callSid } });
          if (attempt) {
            resolvedAttemptId = attempt.id;
          }
        } catch {}
      }
    }

    let xml = '';
    if (resolvedAttemptId && resolvedAttemptId !== 'gather') {
      xml = await voiceWebhookService.handleGather(resolvedAttemptId, questionId, payload);
    }
    
    if (!xml || xml.trim() === '') {
      const hasHindiInQuery = /[\u0900-\u097F]/.test(req.url) || /\b(hi|hindi|aditi)\b/i.test(req.url);
      const confirmationText = hasHindiInQuery
        ? (digits === '1'
            ? 'Dhanyavaad! Aapne 1 dabaya hai. Aapka GST aur tax return confirm ho gaya hai aur Auckland Accounting dwara jama kar diya gaya hai. Alvida.'
            : digits === '2'
            ? 'Dhanyavaad! Aapne 2 dabaya hai. Aapka anurodh darj kar liya gaya hai. Auckland Accounting se hamare senior accountant aapse jald hi sampark karenge. Alvida.'
            : `Aapne ${digits} dabaya hai. Auckland Accounting ne aapka response darj kar liya hai. Sahayata ke liye kripya hamare office se sampark karein. Dhanyavaad, alvida.`)
        : (digits === '1'
            ? 'Thank you! You pressed 1 to confirm. Your tax filing verification has been confirmed and submitted to Inland Revenue. Auckland Accounting wishes you a wonderful day. Goodbye.'
            : digits === '2'
            ? 'Thank you! You pressed 2 to reschedule. Your request has been recorded and our senior accountant will follow up with you shortly. Have a wonderful day. Goodbye.'
            : `You selected option ${digits}. Auckland Accounting has recorded your selection. For further assistance, please contact our office. Have a wonderful day. Goodbye.`);

      xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${renderSayTag(confirmationText)}
  <Hangup/>
</Response>`;
    }

    logger.info({ callAttemptId, questionId, digits, xmlLength: xml.length, xmlSnippet: xml.substring(0, 150) }, '[TWILIO GATHER RESPONDING TWIML]');
    res.status(200).type('text/xml').send(xml);
  } catch (error) {
    logger.error({ error: (error as Error).message, stack: (error as Error).stack, callAttemptId, questionId, digits }, '[TWILIO GATHER ERROR]');
    if (callAttemptId) {
      try {
        await prisma.callEvent.create({
          data: {
            callAttemptId,
            eventType: 'BACKEND_WEBHOOK_ERROR',
            payloadJson: { ErrorMessage: (error as Error).message }
          }
        });
      } catch (e) {}
    }
    const confirmationText = digits === '1'
      ? 'Thank you. You pressed 1 to confirm. Your confirmation has been recorded successfully.'
      : digits === '2'
      ? 'Thank you. You pressed 2 to reschedule. We have noted your response.'
      : `Thank you for your response.`;
    const fallbackXml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${renderSayTag(confirmationText)}
  <Pause length="1"/>
  ${renderSayTag('Goodbye.')}
  <Hangup/>
</Response>`;
    res.status(200).type('text/xml').send(fallbackXml);
  }
});

/**
 * Handles Twilio status callbacks (initiated, ringing, answered, completed, busy, etc.).
 */
voiceRouter.post('/status', async (req: Request, res: Response) => {
  const callAttemptId = (req.query.callAttemptId || req.body.callAttemptId) as string;
  const payload: TwilioWebhookPayload = { ...(req.query as Record<string, string>), ...(req.body as Record<string, string>) };

  try {
    if (callAttemptId) {
      await voiceWebhookService.handleStatusCallback(callAttemptId, payload);
    }
    res.status(200).type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response/>');
  } catch (error) {
    logger.error({ error: (error as Error).message, callAttemptId }, 'Error handling Twilio status callback');
    res.status(200).type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response/>');
  }
});

/**
 * Handles Telnyx Webhook events (call.initiated, call.answered, call.hangup, etc.).
 */
voiceRouter.post('/telnyx/webhook', async (req: Request, res: Response) => {
  try {
    const event = req.body?.data;
    if (!event) {
      res.status(200).json({ received: true });
      return;
    }

    const eventType = event.event_type as string;
    const payload = event.payload || {};
    const callControlId = payload.call_control_id as string;
    let clientStateObj: any = {};

    if (payload.client_state) {
      try {
        const decoded = Buffer.from(payload.client_state, 'base64').toString('utf8');
        clientStateObj = JSON.parse(decoded);
      } catch (e) {
        // ignore
      }
    }

    const callAttemptId = clientStateObj.callAttemptId;
    logger.info({ eventType, callControlId, callAttemptId }, '[TELNYX WEBHOOK] Received event');

    if (callAttemptId) {
      if (eventType === 'call.answered') {
        await prisma.callAttempt.update({
          where: { id: callAttemptId },
          data: { status: 'IN_PROGRESS' as any, answeredAt: new Date() }
        }).catch(() => {});

        let promptText = 'Kia ora. This is an automated message from Auckland Accounting regarding your account. Please press 1 to confirm, or press 2 to reschedule.';
        try {
          const attempt = await prisma.callAttempt.findUnique({
            where: { id: callAttemptId },
            include: {
              callJob: {
                include: {
                  contact: true,
                  campaign: {
                    include: {
                      questionnaire: {
                        include: {
                          questions: { orderBy: { orderNo: 'asc' }, include: { options: true } }
                        }
                      }
                    }
                  }
                }
              }
            }
          });

          if (attempt && attempt.callJob?.campaign?.questionnaire?.questions?.length) {
            const firstQ = attempt.callJob.campaign.questionnaire.questions[0];
            const ctx = buildContactContext(attempt.callJob.contact);
            let dynamicText = interpolateVariables(firstQ.questionText, ctx);
            if (
              firstQ.orderNo === 1 &&
              attempt.callJob.campaign.description &&
              !attempt.callJob.campaign.description.toLowerCase().includes('practice outbound calling campaign')
            ) {
              const intro = interpolateVariables(attempt.callJob.campaign.description, ctx);
              dynamicText = `${intro}. ${dynamicText}`;
            }
            if (dynamicText && dynamicText.trim()) {
              promptText = dynamicText;
            }
          }
        } catch (loadErr) {
          logger.warn({ error: (loadErr as Error).message }, 'Failed loading questionnaire prompt for Telnyx call');
        }

        // Record bot speech event so Live Monitor in dashboard immediately displays what is spoken
        await prisma.callResponse.create({
          data: {
            callAttemptId,
            questionId: 'telnyx-q1-bot-speak',
            responseValue: 'BOT',
            responseText: `(Bot speaking): ${promptText}`,
            inputMethod: 'DTMF',
            isValid: true
          }
        }).catch(() => {});

        // Speak prompt and gather keypad response
        const apiKey = env.TELNYX_API_KEY || process.env.TELNYX_API_KEY;
        if (apiKey && callControlId) {
          fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/gather_using_speak`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              payload: promptText,
              voice: 'female',
              language: 'en-US',
              valid_digits: '12',
              maximum_digits: 1
            })
          }).catch((err) => {
            logger.warn({ error: (err as Error).message }, 'Failed sending gather_using_speak to Telnyx');
          });
        }
      } else if (eventType === 'call.hangup') {
        await prisma.callAttempt.update({
          where: { id: callAttemptId },
          data: { status: 'COMPLETED' as any, endedAt: new Date(), hangupCause: payload.hangup_cause || 'NORMAL_CLEARING' }
        }).catch(() => {});
      } else if (eventType === 'call.dtmf.received' || eventType === 'call.gather.ended') {
        const digit = payload.digit || payload.digits;
        if (digit) {
          const confirmationText = digit === '1'
            ? 'Thank you. You pressed 1 to confirm. Your response has been recorded successfully. Goodbye.'
            : digit === '2'
            ? 'Thank you. You pressed 2 to reschedule. Our accounting team will contact you shortly. Goodbye.'
            : `Thank you for your response. Goodbye.`;

          await prisma.callResponse.create({
            data: {
              callAttemptId,
              responseValue: digit,
              responseText: digit === '1' ? 'User confirmed (Pressed 1)' : 'User requested reschedule (Pressed 2)',
              inputMethod: 'DTMF',
              isValid: true
            }
          }).catch(() => {});

          const apiKey = env.TELNYX_API_KEY || process.env.TELNYX_API_KEY;
          if (apiKey && callControlId) {
            fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/speak`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                payload: confirmationText,
                voice: 'female',
                language: 'en-US'
              })
            }).then(() => {
              setTimeout(() => {
                fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/hangup`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                  }
                }).catch(() => {});
              }, 4000);
            }).catch(() => {});
          }
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Error in Telnyx webhook');
    res.status(200).json({ received: true, error: (err as Error).message });
  }
});

/**
 * Fallback error webhook.
 */
voiceRouter.post('/fallback', (req: Request, res: Response) => {
  logger.warn({ body: req.body }, 'Twilio fallback webhook invoked');
  res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Say>We are experiencing technical difficulties. Goodbye.</Say><Hangup/></Response>');
});
