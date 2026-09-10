import { prisma } from './prisma.js';
import { CallStatus, Prisma } from '@prisma/client';
import { NotFoundError } from '../errors/AppError.js';
import { calculateCallCost } from './reportService.js';

export interface ListCallsQuery {
  page?: number;
  limit?: number;
  campaignId?: string;
  contactId?: string;
  status?: CallStatus;
  search?: string;
  startDate?: string;
  endDate?: string;
  minDuration?: number;
  maxDuration?: number;
  sortBy?: 'startedAt' | 'durationSeconds' | 'status';
  sortOrder?: 'asc' | 'desc';
}

export async function listCalls(query: ListCallsQuery) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;

  const where: Prisma.CallAttemptWhereInput = {};
  const callJobWhere: Prisma.CallJobWhereInput = {};

  if (query.campaignId && query.campaignId !== 'all') {
    callJobWhere.campaignId = query.campaignId;
  }

  if (query.contactId) {
    callJobWhere.contactId = query.contactId;
  }

  if (query.status) {
    where.status = query.status;
  }

  if (query.startDate || query.endDate) {
    where.startedAt = {};
    if (query.startDate) {
      where.startedAt.gte = new Date(query.startDate);
    }
    if (query.endDate) {
      const end = new Date(query.endDate);
      if (query.endDate.length === 10) {
        end.setUTCHours(23, 59, 59, 999);
      }
      where.startedAt.lte = end;
    }
  }

  if (query.minDuration !== undefined || query.maxDuration !== undefined) {
    where.durationSeconds = {};
    if (query.minDuration !== undefined) {
      where.durationSeconds.gte = query.minDuration;
    }
    if (query.maxDuration !== undefined) {
      where.durationSeconds.lte = query.maxDuration;
    }
  }

  if (query.search) {
    const term = query.search.trim();
    callJobWhere.contact = {
      OR: [
        { name: { contains: term, mode: 'insensitive' } },
        { phoneNumber: { contains: term, mode: 'insensitive' } },
        { companyName: { contains: term, mode: 'insensitive' } }
      ]
    };
  }

  if (Object.keys(callJobWhere).length > 0) {
    where.callJob = callJobWhere;
  }

  const orderBy: Prisma.CallAttemptOrderByWithRelationInput = {};
  const sortField = query.sortBy || 'startedAt';
  const sortDirection = query.sortOrder || 'desc';
  orderBy[sortField] = sortDirection;

  const [total, attempts] = await Promise.all([
    prisma.callAttempt.count({ where }),
    prisma.callAttempt.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: {
        callJob: {
          include: {
            campaign: { select: { id: true, name: true, callerId: true } },
            contact: {
              select: {
                id: true,
                name: true,
                phoneNumber: true,
                companyName: true,
                isDoNotCall: true,
                consentStatus: true
              }
            }
          }
        },
        _count: {
          select: { responses: true, events: true }
        }
      }
    })
  ]);

  return {
    data: attempts.map((a) => {
      const cost = calculateCallCost(a.durationSeconds);
      return {
        id: a.id,
        callJobId: a.callJobId,
        providerCallId: a.providerCallId,
        status: a.status,
        startedAt: a.startedAt,
        endedAt: a.endedAt,
        durationSeconds: a.durationSeconds,
        cost,
        hangupCause: a.hangupCause,
        campaign: a.callJob.campaign,
        contact: a.callJob.contact,
        attemptsCount: a.callJob.attempts,
        responsesCount: a._count.responses,
        eventsCount: a._count.events
      };
    }),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

export async function getCallById(id: string) {
  const attempt = await prisma.callAttempt.findUnique({
    where: { id },
    include: {
      callJob: {
        include: {
          campaign: {
            select: {
              id: true,
              name: true,
              callerId: true,
              status: true,
              questionnaireId: true,
              maxRetries: true,
              timezone: true
            }
          },
          contact: true,
          retryLogs: {
            orderBy: { createdAt: 'desc' }
          }
        }
      },
      responses: {
        orderBy: { answeredAt: 'asc' },
        include: {
          question: {
            select: {
              id: true,
              questionText: true,
              type: true,
              orderNo: true,
              options: true
            }
          }
        }
      },
      events: {
        orderBy: { createdAt: 'asc' }
      }
    }
  });

  if (!attempt) {
    throw new NotFoundError(`Call attempt with ID '${id}' not found`);
  }

  const cost = calculateCallCost(attempt.durationSeconds);

  return {
    id: attempt.id,
    callJobId: attempt.callJobId,
    providerCallId: attempt.providerCallId,
    status: attempt.status,
    startedAt: attempt.startedAt,
    endedAt: attempt.endedAt,
    durationSeconds: attempt.durationSeconds,
    cost,
    hangupCause: attempt.hangupCause,
    providerResponse: attempt.providerResponse,
    campaign: attempt.callJob.campaign,
    contact: attempt.callJob.contact,
    attemptsCount: attempt.callJob.attempts,
    responses: attempt.responses.map((r) => {
      const matchedOption = r.question?.options.find((opt) => opt.optionKey === r.responseValue);
      return {
        id: r.id,
        questionId: r.questionId,
        questionText: r.question?.questionText || 'Question',
        questionType: r.question?.type,
        responseValue: r.responseValue,
        responseText: r.responseText || matchedOption?.optionLabel || null,
        inputMethod: r.inputMethod,
        isValid: r.isValid,
        answeredAt: r.answeredAt
      };
    }),
    events: attempt.events.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      providerEventId: e.providerEventId,
      payload: e.payloadJson,
      createdAt: e.createdAt
    })),
    retryLogs: attempt.callJob.retryLogs.map((rl) => ({
      id: rl.id,
      attemptNumber: rl.attemptNumber,
      reason: rl.reason,
      scheduledRetryAt: rl.scheduledRetryAt,
      createdAt: rl.createdAt
    }))
  };
}
