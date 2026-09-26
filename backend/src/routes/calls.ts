import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import twilio from 'twilio';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { listCalls, getCallById } from '../services/callService.js';
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
  campaignId: z.string().optional()
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

    // For trial accounts, Twilio requires an approved webhook URL
    const webhookUrl =
      env.TWILIO_WEBHOOK_BASE_URL && env.TWILIO_WEBHOOK_BASE_URL.startsWith('https://')
        ? `${env.TWILIO_WEBHOOK_BASE_URL}/api/voice/twiml`
        : 'https://webhooks.twilio.com/v1/Voice/Template/voice_speech_recognition';

    const call = await client.calls.create({
      to: targetNumber,
      from: fromNumber,
      url: webhookUrl
    });

    res.json({
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
          from: '+17372508034'
        }
      });
    }

    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
      throw new BadRequestError('Twilio credentials not configured.');
    }
    const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    const twilioCall = await client.calls(callSid).fetch();

    return res.json({
      success: true,
      data: {
        callSid: twilioCall.sid,
        status: twilioCall.status, // 'queued' | 'ringing' | 'in-progress' | 'completed' | 'busy' | 'failed' | 'no-answer' | 'canceled'
        duration: twilioCall.duration ? parseInt(twilioCall.duration, 10) : 0,
        startTime: twilioCall.startTime,
        endTime: twilioCall.endTime,
        to: twilioCall.to,
        from: twilioCall.from
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
