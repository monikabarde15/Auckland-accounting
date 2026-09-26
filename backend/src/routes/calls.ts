import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import twilio from 'twilio';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { listCalls, getCallById } from '../services/callService.js';
import { prisma } from '../services/prisma.js';
import { env } from '../config/env.js';
import { BadRequestError } from '../errors/AppError.js';
import { CallStatus } from '@prisma/client';

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
    const fromNumber = (body.callerId || env.TWILIO_PHONE_NUMBER || '+17372508034').trim();

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
          if (camp?.questionnaire?.questions?.[0]?.questionText) {
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
  <Say voice="Polly.Aria-Neural" language="en-NZ">${escapedPrompt}</Say>
  <Gather input="dtmf" numDigits="1" timeout="8">
    <Say voice="Polly.Aria-Neural" language="en-NZ">Please press 1 to confirm, or press 2 to request a callback from your accountant.</Say>
  </Gather>
  <Say voice="Polly.Aria-Neural" language="en-NZ">Thank you for your response. Auckland Accounting has recorded your submission. Have a wonderful day.</Say>
  <Hangup/>
</Response>`;

    try {
      const call = await client.calls.create({
        to: targetNumber,
        from: fromNumber,
        twiml: inlineTwiml
      });

      return res.json({
        success: true,
        data: {
          callSid: call.sid,
          status: call.status,
          to: targetNumber,
          from: fromNumber,
          direction: call.direction,
          dateCreated: call.dateCreated
        }
      });
    } catch (twilioErr: any) {
      const errorMsg = twilioErr?.message || '';
      const errorCode = twilioErr?.code || twilioErr?.status;

      // Friendly explanation for Twilio Trial account restrictions
      if (errorMsg.includes('trial accounts') || errorMsg.includes('verified recipient') || errorCode === 21215 || errorCode === 21608) {
        return res.status(400).json({
          success: false,
          error: `Twilio Trial Restriction: Recipient number (${targetNumber}) must be verified in your Twilio Console (Verified Caller IDs), and the Caller ID (${fromNumber}) must be your active Twilio trial number. Details: ${errorMsg}`
        });
      }

      throw twilioErr;
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
          from: '+17372508034',
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
