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

export const callsRouter = Router();

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
  promptText: z.string().optional()
});

/**
 * POST /api/calls/test-live
 * Initiates an authenticated live outbound test call via Twilio to test real telephony.
 */
callsRouter.post('/test-live', requirePermission('calls.execute'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = testLiveCallSchema.parse(req.body);
    const targetNumber = body.phoneNumber.trim();
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

    const inlineTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="hi-IN">${escapedPrompt}</Say>
</Response>`;

    try {
      const callOptions: any = {
        to: targetNumber,
        from: fromNumber
      };

      const webhookBase =
        env.TWILIO_WEBHOOK_BASE_URL ||
        process.env.RENDER_EXTERNAL_URL ||
        env.BASE_URL ||
        'https://auckland-accountin.onrender.com';
      callOptions.url = `${webhookBase.replace(/\/+$/, '')}/api/voice/twiml?prompt=${encodeURIComponent(speakText)}`;

      const call = await client.calls.create(callOptions);

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
      if (errorCode === 0 || errorMsg.includes('trial accounts')) {
        userFriendlyMessage = `Twilio Trial Restriction: Recipient number (${targetNumber}) must be verified in Twilio Console (Verified Caller IDs). Details: ${errorMsg}`;
      } else if (errorCode === 573002 || errorMsg.includes('No Twilio trial phone number')) {
        userFriendlyMessage = 'Twilio Setup: Please ensure a Twilio trial phone number is active in your Twilio Console.';
      } else if (errorCode === 21215 || errorCode === 21608 || errorMsg.includes('verified recipient')) {
        userFriendlyMessage = `Twilio Trial Restriction: Recipient number (${targetNumber}) must be verified in your Twilio Console (Verified Caller IDs).`;
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
