import { Router, Request, Response } from 'express';
import { voiceWebhookService, TwilioWebhookPayload } from '../services/voiceWebhookService.js';
import { twilioService } from '../services/twilio/twilioService.js';
import { logger } from '../middleware/logger.js';

export const voiceRouter = Router();

/**
 * Middleware to validate Twilio cryptographic signature.
 */
function requireTwilioSignature(req: Request, res: Response, next: () => void) {
  const signature = req.headers['x-twilio-signature'] as string | undefined;
  const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
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
voiceRouter.all('/twiml', async (req: Request, res: Response) => {
  const callAttemptId = (req.query.callAttemptId || req.body.callAttemptId) as string;
  const questionId = (req.query.questionId || req.body.questionId) as string | undefined;
  const prompt = (req.query.prompt || req.body.prompt) as string | undefined;
  const campaignId = (req.query.campaignId || req.body.campaignId) as string | undefined;
  const payload: TwilioWebhookPayload = { ...(req.query as Record<string, string>), ...(req.body as Record<string, string>) };

  try {
    // 1. Direct dynamic test call with custom campaign prompt
    if (prompt || (!callAttemptId && campaignId)) {
      const speakText = prompt || 'Kia ora. This is an automated message from Auckland Accounting regarding your account.';
      const baseUrl = process.env.TWILIO_WEBHOOK_BASE_URL || `https://${req.get('host')}`;
      const actionUrl = `${baseUrl}/api/voice/gather?campaignId=${encodeURIComponent(campaignId || '')}`;
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${actionUrl}" method="POST" timeout="10">
    <Say>${speakText.replace(/[<>&]/g, '')}</Say>
  </Gather>
</Response>`;
      res.type('text/xml').send(xml);
      return;
    }

    if (!callAttemptId) {
      res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Aria-Neural" language="en-NZ">Kia ora, thank you for calling Auckland Accounting.</Say><Hangup/></Response>');
      return;
    }

    const xml = await voiceWebhookService.handleCallConnect(callAttemptId, questionId, payload);
    res.type('text/xml').send(xml);
  } catch (error) {
    logger.error({ error: (error as Error).message, callAttemptId }, 'Error rendering initial TwiML');
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Aria-Neural" language="en-NZ">Kia ora. Auckland Accounting campaign connected.</Say><Hangup/></Response>');
  }
});

/**
 * Handles gathered DTMF digits from Twilio IVR.
 */
voiceRouter.post('/gather', async (req: Request, res: Response) => {
  const callAttemptId = (req.query.callAttemptId || req.body.callAttemptId) as string;
  const questionId = (req.query.questionId || req.body.questionId) as string;
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
  <Say voice="Polly.Aria-Neural" language="en-NZ">${confirmationText}</Say>
  <Pause length="1"/>
  <Say voice="Polly.Aria-Neural" language="en-NZ">Have a wonderful day. Goodbye.</Say>
  <Hangup/>
</Response>`;
      res.type('text/xml').send(xml);
      return;
    }

    const xml = await voiceWebhookService.handleGather(callAttemptId, questionId, payload);
    res.type('text/xml').send(xml);
  } catch (error) {
    logger.error({ error: (error as Error).message, callAttemptId, questionId }, 'Error handling IVR gather');
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Aria-Neural" language="en-NZ">Thank you for your response. Goodbye.</Say><Hangup/></Response>');
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
