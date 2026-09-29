import { prisma } from '../prisma.js';
import { CampaignStatus, CallStatus } from '@prisma/client';
import { logger } from '../../middleware/logger.js';
import { normalizePhoneNumber } from '../../utils/phone.js';

export interface PreDialCheckResult {
  canDial: boolean;
  reason?: string;
  code?: 
    | 'OK'
    | 'CAMPAIGN_NOT_RUNNING'
    | 'CONTACT_NOT_FOUND'
    | 'INVALID_PHONE'
    | 'DNC_SUPPRESSED'
    | 'CONSENT_REVOKED'
    | 'OUTSIDE_HOURS'
    | 'CONCURRENCY_LIMIT_REACHED'
    | 'DAILY_LIMIT_REACHED'
    | 'MAX_CALLS_REACHED'
    | 'MAX_COST_REACHED'
    | 'DUPLICATE_ACTIVE_ATTEMPT'
    | 'QUESTIONNAIRE_MISSING';
  campaign?: Record<string, unknown>;
  contact?: Record<string, unknown>;
}

/**
 * Helper to check if current time is within campaign calling hours in target timezone.
 */
export function isWithinCallingHours(
  timezone: string,
  startTime: string, // "09:00"
  endTime: string,   // "17:00"
  daysOfWeek: (number | string)[] // [1, 2, 3] or ["MON", "TUE", ...]
): { allowed: boolean; reason?: string } {
  try {
    const tz = timezone || 'Pacific/Auckland';
    const now = new Date();

    // Format current date/time in campaign timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    const parts = formatter.formatToParts(now);
    const weekdayPart = parts.find((p) => p.type === 'weekday')?.value?.toUpperCase(); // 'MON'
    const hourPart = parts.find((p) => p.type === 'hour')?.value || '00';
    const minutePart = parts.find((p) => p.type === 'minute')?.value || '00';

    const currentFormattedTime = `${hourPart}:${minutePart}`;
    const dayToCode: Record<string, number> = {
      SUN: 0,
      MON: 1,
      TUE: 2,
      WED: 3,
      THU: 4,
      FRI: 5,
      SAT: 6
    };

    const currentDayStr = weekdayPart ? weekdayPart.substring(0, 3).toUpperCase() : '';
    const currentDayNum = dayToCode[currentDayStr];

    // 1. Check active day
    if (daysOfWeek && daysOfWeek.length > 0) {
      const isAllowed = daysOfWeek.some((d) => {
        if (typeof d === 'number') {
          return d === currentDayNum;
        }
        return d.toString().toUpperCase().substring(0, 3) === currentDayStr;
      });

      if (!isAllowed) {
        return {
          allowed: false,
          reason: `Current day (${currentDayStr}) is not in campaign active days: [${daysOfWeek.join(', ')}] in ${tz}`
        };
      }
    }

    // 2. Check time window
    if (startTime && endTime) {
      if (currentFormattedTime < startTime || currentFormattedTime >= endTime) {
        return {
          allowed: false,
          reason: `Current time (${currentFormattedTime}) is outside calling window ${startTime} - ${endTime} in ${tz}`
        };
      }
    }

    return { allowed: true };
  } catch (error) {
    logger.warn({ error: (error as Error).message, timezone }, 'Error checking calling hours fallback to allowed');
    return { allowed: true };
  }
}

/**
 * Performs rigorous 10-point pre-dial verification inside the worker.
 * Must be executed immediately before placing an outbound call.
 */
export async function performPreDialSafetyCheck(
  campaignId: string,
  contactId: string,
  callJobId: string
): Promise<PreDialCheckResult> {
  // 1. Fetch Campaign with Questionnaires
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      questionnaire: {
        include: {
          questions: { select: { id: true } }
        }
      }
    }
  });

  if (!campaign) {
    return { canDial: false, code: 'CAMPAIGN_NOT_RUNNING', reason: `Campaign ${campaignId} does not exist` };
  }

  // 2. Verify Campaign State
  if (campaign.status !== CampaignStatus.RUNNING) {
    return {
      canDial: false,
      code: 'CAMPAIGN_NOT_RUNNING',
      reason: `Campaign is not in RUNNING state (current: ${campaign.status})`,
      campaign: { id: campaign.id, name: campaign.name, status: campaign.status }
    };
  }

  // 3. Verify Questionnaire
  if (!campaign.questionnaireId || !campaign.questionnaire || campaign.questionnaire.questions.length === 0) {
    return {
      canDial: false,
      code: 'QUESTIONNAIRE_MISSING',
      reason: 'Campaign has no valid questionnaire assigned or questionnaire is empty'
    };
  }

  // 4. Fetch Contact
  const contact = await prisma.contact.findUnique({
    where: { id: contactId }
  });

  if (!contact) {
    return { canDial: false, code: 'CONTACT_NOT_FOUND', reason: `Contact ${contactId} not found` };
  }

  // 5. Phone Validity
  const phoneNorm = normalizePhoneNumber(contact.phoneNumber);
  if (!phoneNorm.isValid) {
    return {
      canDial: false,
      code: 'INVALID_PHONE',
      reason: `Contact phone number '${contact.phoneNumber}' is not a valid E.164 number`
    };
  }

  // 6. DNC Re-check (Database flag & DNC Registry)
  if (contact.isDoNotCall) {
    return {
      canDial: false,
      code: 'DNC_SUPPRESSED',
      reason: `Contact is marked Do-Not-Call (isDoNotCall=true)`
    };
  }

  const dncRecord = await prisma.dncRecord.findUnique({
    where: { phoneNumber: phoneNorm.e164 }
  });

  if (dncRecord) {
    // Automatically update contact record for consistency
    await prisma.contact.update({
      where: { id: contact.id },
      data: { isDoNotCall: true }
    });

    return {
      canDial: false,
      code: 'DNC_SUPPRESSED',
      reason: `Phone number ${phoneNorm.e164} is registered in DNC suppression list`
    };
  }

  // 7. Strict Consent Check (Must be explicitly GRANTED)
  if (contact.consentStatus !== 'GRANTED') {
    return {
      canDial: false,
      code: 'CONSENT_REVOKED',
      reason: `Contact consent status is '${contact.consentStatus || 'UNSPECIFIED'}'. Explicit GRANTED consent is required for automated dialing.`
    };
  }

  // 8. Calling Hours & Timezone Enforcement
  const hoursCheck = isWithinCallingHours(
    campaign.timezone,
    campaign.callingStartTime,
    campaign.callingEndTime,
    campaign.daysOfWeek
  );

  if (!hoursCheck.allowed) {
    return {
      canDial: false,
      code: 'OUTSIDE_HOURS',
      reason: hoursCheck.reason
    };
  }

  // 9. Atomic Concurrency Check (Active calls in progress for this campaign)
  const activeAttempts = await prisma.callAttempt.count({
    where: {
      callJob: { campaignId },
      status: {
        in: [
          CallStatus.QUEUED,
          CallStatus.INITIATED,
          CallStatus.RINGING,
          CallStatus.ANSWERED,
          CallStatus.IN_PROGRESS
        ]
      }
    }
  });

  if (activeAttempts >= campaign.maxConcurrentCalls) {
    return {
      canDial: false,
      code: 'CONCURRENCY_LIMIT_REACHED',
      reason: `Campaign reached max concurrent calls limit (${activeAttempts}/${campaign.maxConcurrentCalls})`
    };
  }

  // 10. Campaign Limits (maxCalls, dailyCallLimit, maxCost)
  if (campaign.maxCalls) {
    const totalCompleted = await prisma.callAttempt.count({
      where: {
        callJob: { campaignId },
        status: { in: [CallStatus.COMPLETED, CallStatus.FAILED, CallStatus.BUSY, CallStatus.NO_ANSWER] }
      }
    });

    if (totalCompleted >= campaign.maxCalls) {
      return {
        canDial: false,
        code: 'MAX_CALLS_REACHED',
        reason: `Campaign reached maximum allowed calls cap (${totalCompleted}/${campaign.maxCalls})`
      };
    }
  }

  if (campaign.dailyCallLimit) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const callsToday = await prisma.callAttempt.count({
      where: {
        callJob: { campaignId },
        startedAt: { gte: startOfToday }
      }
    });

    if (callsToday >= campaign.dailyCallLimit) {
      return {
        canDial: false,
        code: 'DAILY_LIMIT_REACHED',
        reason: `Campaign reached daily call limit (${callsToday}/${campaign.dailyCallLimit})`
      };
    }
  }

  if (campaign.maxCost) {
    const costAgg = await prisma.callAttempt.aggregate({
      where: {
        callJob: { campaignId }
      },
      _sum: { durationSeconds: true }
    });
    // Calculate cost based on duration or explicit provider cost recorded
    const totalDuration = costAgg._sum.durationSeconds || 0;
    const estimatedCost = totalDuration * 0.005; // $0.30/min NZD rate
    const maxCostNum = Number(campaign.maxCost);

    if (estimatedCost >= maxCostNum) {
      return {
        canDial: false,
        code: 'MAX_COST_REACHED',
        reason: `Campaign reached maximum allowed cost limit (Spent ~$${estimatedCost.toFixed(2)} / Cap $${maxCostNum.toFixed(2)} NZD)`
      };
    }
  }

  // 11. Duplicate Active Attempt & Completed Job Check
  if (callJobId) {
    const callJob = await prisma.callJob.findUnique({
      where: { id: callJobId }
    });

    if (callJob && (callJob.status === 'COMPLETED' || callJob.status === 'CANCELLED')) {
      return {
        canDial: false,
        code: 'DUPLICATE_ACTIVE_ATTEMPT',
        reason: `Call job ${callJobId} is already in terminal state (${callJob.status})`
      };
    }

    // AUTO-HEAL: Clear any stuck attempts older than 2 minutes before checking
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    await prisma.callAttempt.updateMany({
      where: {
        callJobId,
        status: {
          in: [
            CallStatus.QUEUED,
            CallStatus.INITIATED,
            CallStatus.RINGING,
            CallStatus.ANSWERED,
            CallStatus.IN_PROGRESS
          ]
        },
        startedAt: { lt: twoMinutesAgo }
      },
      data: {
        status: 'FAILED',
        hangupCause: 'Auto-cleared stuck attempt'
      }
    });

    const duplicateActive = await prisma.callAttempt.findFirst({
      where: {
        callJobId,
        status: {
          in: [
            CallStatus.QUEUED,
            CallStatus.INITIATED,
            CallStatus.RINGING,
            CallStatus.ANSWERED,
            CallStatus.IN_PROGRESS
          ]
        }
      }
    });

    if (duplicateActive) {
      return {
        canDial: false,
        code: 'DUPLICATE_ACTIVE_ATTEMPT',
        reason: `Call job ${callJobId} already has an active call attempt (${duplicateActive.id})`
      };
    }
  }

  return {
    canDial: true,
    code: 'OK',
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      callerId: campaign.callerId,
      questionnaireId: campaign.questionnaireId
    },
    contact: {
      id: contact.id,
      name: contact.name,
      phoneNumber: phoneNorm.e164,
      companyName: contact.companyName,
      consentStatus: contact.consentStatus,
      isDoNotCall: contact.isDoNotCall,
      outstandingBalance: contact.outstandingBalance,
      dueDate: contact.dueDate
    }
  };
}
