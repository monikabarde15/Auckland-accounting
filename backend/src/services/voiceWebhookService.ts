import { prisma } from './prisma.js';
import { CallStatus, CallJobStatus } from '@prisma/client';
import { logger } from '../middleware/logger.js';
import { renderQuestionTwiml, processGatheredResponse } from './ivr/ivrEngine.js';
import { evaluateAndScheduleRetry } from './retry/retryService.js';

export interface TwilioWebhookPayload {
  CallSid?: string;
  CallStatus?: string;
  Digits?: string;
  CallDuration?: string;
  From?: string;
  To?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
  SequenceNumber?: string;
  [key: string]: string | undefined;
}

export class VoiceWebhookService {
  /**
   * Handles call answer and serves the initial questionnaire TwiML.
   */
  public async handleCallConnect(
    callAttemptId: string,
    questionId?: string,
    payload: TwilioWebhookPayload = {}
  ): Promise<string> {
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
                    questions: {
                      orderBy: { orderNo: 'asc' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!attempt) {
      logger.warn({ callAttemptId }, 'CallAttempt not found for /api/voice/twiml');
      return '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Error loading session. Goodbye.</Say><Hangup/></Response>';
    }

    const TERMINAL_CALL_STATUSES: CallStatus[] = [
      CallStatus.COMPLETED,
      CallStatus.FAILED,
      CallStatus.BUSY,
      CallStatus.NO_ANSWER,
      CallStatus.CANCELLED
    ];

    // Background update: do NOT block Twilio webhook response so call connects instantly (<100ms)
    setImmediate(async () => {
      try {
        const updateData: {
          status?: CallStatus;
          providerCallId?: string | null;
          providerResponse?: object;
        } = {
          providerCallId: payload.CallSid || attempt.providerCallId,
          providerResponse: (payload as object) || undefined
        };

        if (!TERMINAL_CALL_STATUSES.includes(attempt.status)) {
          updateData.status = CallStatus.IN_PROGRESS;
        }

        await prisma.callAttempt.update({
          where: { id: callAttemptId },
          data: updateData
        });

        await prisma.callJob.update({
          where: { id: attempt.callJobId },
          data: { status: CallJobStatus.DISPATCHED }
        });

        await prisma.callEvent.create({
          data: {
            callAttemptId,
            eventType: 'CALL_ANSWERED',
            payloadJson: (payload as object) || {}
          }
        });
      } catch (err) {
        logger.warn({ err, callAttemptId }, 'Background update for call connect failed');
      }
    });

    // Identify target starting question
    let targetQuestionId = questionId;
    if (!targetQuestionId) {
      const qList = attempt.callJob.campaign.questionnaire?.questions || [];
      if (qList.length === 0) {
        return '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">No questions configured. Goodbye.</Say><Hangup/></Response>';
      }
      targetQuestionId = qList[0].id;
    }

    return renderQuestionTwiml(callAttemptId, targetQuestionId, 0, attempt);
  }

  /**
   * Handles DTMF digits gathered during IVR execution.
   */
  public async handleGather(
    callAttemptId: string,
    questionId: string,
    payload: TwilioWebhookPayload
  ): Promise<string> {
    const digits = payload.Digits || '';

    // Record Event in background so Twilio response is not delayed
    setImmediate(async () => {
      try {
        await prisma.callEvent.create({
          data: {
            callAttemptId,
            eventType: 'DTMF_GATHERED',
            payloadJson: { questionId, digits, ...payload }
          }
        });
      } catch (err) {
        logger.warn({ err, callAttemptId }, 'Background DTMF callEvent recording failed');
      }
    });

    return processGatheredResponse(callAttemptId, questionId, digits);
  }

  /**
   * Handles Twilio status callbacks (initiated, ringing, answered, completed, busy, etc.).
   */
  public async handleStatusCallback(
    callAttemptId: string,
    payload: TwilioWebhookPayload
  ): Promise<void> {
    const callSid = payload.CallSid;
    const rawStatus = (payload.CallStatus || '').toLowerCase();
    const duration = parseInt(payload.CallDuration || '0', 10);
    const eventId = callSid ? `${callSid}-${rawStatus}-${payload.SequenceNumber || Date.now()}` : undefined;

    // Idempotency: Check if this provider event was already recorded
    if (eventId) {
      const existing = await prisma.callEvent.findUnique({
        where: { providerEventId: eventId }
      });
      if (existing) {
        logger.info({ eventId, callAttemptId }, 'Duplicate webhook status event ignored');
        return;
      }
    }

    const statusMap: Record<string, CallStatus> = {
      queued: CallStatus.QUEUED,
      initiated: CallStatus.INITIATED,
      ringing: CallStatus.RINGING,
      'in-progress': CallStatus.IN_PROGRESS,
      completed: CallStatus.COMPLETED,
      busy: CallStatus.BUSY,
      'no-answer': CallStatus.NO_ANSWER,
      failed: CallStatus.FAILED,
      canceled: CallStatus.CANCELLED
    };

    const mappedStatus = statusMap[rawStatus] || CallStatus.IN_PROGRESS;

    const attempt = await prisma.callAttempt.findUnique({
      where: { id: callAttemptId }
    });

    if (!attempt) {
      logger.warn({ callAttemptId, rawStatus }, 'CallAttempt not found for status callback');
      return;
    }

    const TERMINAL_CALL_STATUSES: CallStatus[] = [
      CallStatus.COMPLETED,
      CallStatus.FAILED,
      CallStatus.BUSY,
      CallStatus.NO_ANSWER,
      CallStatus.CANCELLED
    ];

    // Out-of-order check: If current state is terminal, do NOT allow regression to a non-terminal status
    const isCurrentTerminal = TERMINAL_CALL_STATUSES.includes(attempt.status);
    const isIncomingTerminal = TERMINAL_CALL_STATUSES.includes(mappedStatus);

    if (isCurrentTerminal && !isIncomingTerminal) {
      logger.info(
        { callAttemptId, currentStatus: attempt.status, incomingStatus: mappedStatus },
        'Out-of-order webhook ignored: attempted regression of terminal status'
      );
      // Still log event for audit trail
      await prisma.callEvent.create({
        data: {
          callAttemptId,
          eventType: `TWILIO_${rawStatus.toUpperCase()}_IGNORED_OUT_OF_ORDER`,
          providerEventId: eventId,
          payloadJson: (payload as object) || {}
        }
      });
      return;
    }

    // Save event and update status
    await prisma.$transaction(async (tx) => {
      await tx.callEvent.create({
        data: {
          callAttemptId,
          eventType: `TWILIO_${rawStatus.toUpperCase()}`,
          providerEventId: eventId,
          payloadJson: (payload as object) || {}
        }
      });

      const updateData: {
        status: CallStatus;
        durationSeconds?: number;
        endedAt?: Date;
        hangupCause?: string;
      } = { status: mappedStatus };

      if (duration > 0) {
        updateData.durationSeconds = duration;
      }

      if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(rawStatus)) {
        updateData.endedAt = new Date();
        updateData.hangupCause = payload.ErrorCode || payload.ErrorMessage || rawStatus;
      }

      await tx.callAttempt.update({
        where: { id: callAttemptId },
        data: updateData
      });
    });

    // Check retry eligibility if call ended in failure (and was not already retried)
    if (['busy', 'no-answer', 'failed'].includes(rawStatus)) {
      await evaluateAndScheduleRetry(callAttemptId, mappedStatus, payload.ErrorMessage || rawStatus);
    } else if (rawStatus === 'completed') {
      await evaluateAndScheduleRetry(callAttemptId, CallStatus.COMPLETED);
    }
  }
}

export const voiceWebhookService = new VoiceWebhookService();
