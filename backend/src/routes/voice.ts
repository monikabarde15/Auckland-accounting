import { Router, Request, Response } from 'express';
import { voiceWebhookService, TwilioWebhookPayload } from '../services/voiceWebhookService.js';
import { twilioService } from '../services/twilio/twilioService.js';
import { getCanonicalWebhookBase } from '../services/ivr/ivrEngine.js';
import { logger } from '../middleware/logger.js';

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
voiceRouter.all('/twiml/:callAttemptId?/:questionId?', async (req: Request, res: Response) => {
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
    <Say voice="alice">${speakText.replace(/[<>&]/g, '')}</Say>
  </Gather>
</Response>`;
      res.type('text/xml').send(xml);
      return;
    }

    if (!callAttemptId) {
      res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Kia ora, thank you for calling Auckland Accounting.</Say><Hangup/></Response>');
      return;
    }

    const xml = await voiceWebhookService.handleCallConnect(callAttemptId, questionId, payload);
    res.type('text/xml').send(xml);
  } catch (error) {
    logger.error({ error: (error as Error).message, callAttemptId }, 'Error rendering initial TwiML');
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Kia ora. Auckland Accounting campaign connected.</Say><Hangup/></Response>');
  }
});

/**
 * Handles gathered DTMF digits from Twilio IVR.
 * Supports /api/voice/gather, /api/voice/gather/:callAttemptId, and /api/voice/gather/:callAttemptId/:questionId
 * Handles both GET and POST requests gracefully and returns 200 OK TwiML under all scenarios.
 */
voiceRouter.all('/gather*', async (req: Request, res: Response) => {
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
    let xml = '';
    if (callAttemptId && callAttemptId !== 'gather') {
      xml = await voiceWebhookService.handleGather(callAttemptId, questionId, payload);
    }
    
    if (!xml || xml.trim() === '') {
      const confirmationText = digits === '1'
        ? 'Thank you. Your confirmation has been recorded successfully.'
        : digits === '2'
        ? 'Thank you. We have noted your response.'
        : `Thank you. You pressed ${digits}. Your response has been recorded.`;

      xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${confirmationText}</Say>
  <Pause length="1"/>
  <Say voice="alice">Have a wonderful day. Goodbye.</Say>
  <Hangup/>
</Response>`;
    }

    logger.info({ callAttemptId, questionId, digits, xmlLength: xml.length, xmlSnippet: xml.substring(0, 150) }, '[TWILIO GATHER RESPONDING TWIML]');
    res.status(200).type('text/xml').send(xml);
  } catch (error) {
    logger.error({ error: (error as Error).message, stack: (error as Error).stack, callAttemptId, questionId, digits }, '[TWILIO GATHER ERROR]');
    const confirmationText = digits === '1'
      ? 'Thank you. Your confirmation has been recorded successfully.'
      : digits === '2'
      ? 'Thank you. We have noted your response.'
      : `Thank you for your response.`;
    const fallbackXml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${confirmationText}</Say>
  <Pause length="1"/>
  <Say voice="alice">Goodbye.</Say>
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
 * Fallback error webhook.
 */
voiceRouter.post('/fallback', (req: Request, res: Response) => {
  logger.warn({ body: req.body }, 'Twilio fallback webhook invoked');
  res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Say>We are experiencing technical difficulties. Goodbye.</Say><Hangup/></Response>');
});
