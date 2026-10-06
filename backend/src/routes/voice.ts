import { Router, Request, Response } from 'express';
import { voiceWebhookService, TwilioWebhookPayload } from '../services/voiceWebhookService.js';
import { twilioService } from '../services/twilio/twilioService.js';
import { logger } from '../middleware/logger.js';

export const voiceRouter = Router();

/**
 * Resolves the canonical public URL for this request.
 * Behind Render/Vercel/nginx proxies, req.protocol is 'http' even though
 * the public-facing URL is 'https'. We must use TWILIO_WEBHOOK_BASE_URL
 * or X-Forwarded-Proto to reconstruct the correct URL for signature validation.
 */
function getPublicUrl(req: Request): string {
  const rawBaseUrl = process.env.TWILIO_WEBHOOK_BASE_URL;
  const webhookBase = (typeof rawBaseUrl === 'string' ? rawBaseUrl.trim() : '').replace(/\/+$/, '');
  if (webhookBase && webhookBase.startsWith('https://')) {
    // Use the configured base URL — guaranteed to match what Twilio signed
    return `${webhookBase}${req.originalUrl}`;
  }
  // Fallback: honour X-Forwarded-Proto header set by reverse proxies
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}${req.originalUrl}`;
}

/**
 * Middleware to validate Twilio cryptographic signature.
 */
function requireTwilioSignature(req: Request, res: Response, next: () => void) {
  const signature = req.headers['x-twilio-signature'] as string | undefined;
  const fullUrl = getPublicUrl(req);
  const params = { ...(req.query as Record<string, string>), ...(req.body as Record<string, string>) };

  if (!twilioService.validateWebhookSignature(signature, fullUrl, params)) {
    logger.warn({ url: fullUrl, ip: req.ip }, 'Rejected invalid Twilio webhook signature');
    res.status(403).type('text/plain').send('Forbidden: Invalid Twilio Signature');
    return;
  }
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
      const rawBaseUrl = process.env.TWILIO_WEBHOOK_BASE_URL;
      const baseUrl = (typeof rawBaseUrl === 'string' ? rawBaseUrl.trim() : `https://${req.get('host')}`).replace(/\/+$/, '');
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
 */
voiceRouter.post('/gather/:callAttemptId?/:questionId?', async (req: Request, res: Response) => {
  const callAttemptId = (req.params.callAttemptId || req.query.callAttemptId || req.body.callAttemptId) as string;
  const questionId = (req.params.questionId || req.query.questionId || req.body.questionId) as string;
  const digits = (req.body.Digits || req.query.Digits || '') as string;
  const payload: TwilioWebhookPayload = { ...(req.query as Record<string, string>), ...(req.body as Record<string, string>) };

  try {
    if (!callAttemptId) {
      const confirmationText = digits === '1'
        ? 'Thank you. Your confirmation has been recorded successfully.'
        : digits === '2'
        ? 'Thank you. We have noted your response.'
        : `Thank you. You pressed ${digits}. Your response has been recorded.`;

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${confirmationText}</Say>
  <Pause length="1"/>
  <Say voice="alice">Have a wonderful day. Goodbye.</Say>
  <Hangup/>
</Response>`;
      res.type('text/xml').send(xml);
      return;
    }

    const xml = await voiceWebhookService.handleGather(callAttemptId, questionId, payload);
    res.type('text/xml').send(xml);
  } catch (error) {
    logger.error({ error: (error as Error).message, callAttemptId, questionId }, 'Error handling IVR gather');
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Thank you for your response. Goodbye.</Say><Hangup/></Response>');
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
