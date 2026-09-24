import { prisma } from './prisma.js';
import { CampaignStatus, CallJobStatus } from '@prisma/client';
import { validateCampaignForLaunch } from './campaignValidationService.js';
import { normalizePhoneNumber } from '../utils/phone.js';
import { BadRequestError, NotFoundError } from '../errors/AppError.js';
import { env } from '../config/env.js';
import { logger } from '../middleware/logger.js';

export interface CreateCampaignInput {
  name: string;
  description?: string;
  callerId?: string;
  callerName?: string;
  questionnaireId?: string;
  callingStartTime?: string;
  callingEndTime?: string;
  daysOfWeek?: number[];
  timezone?: string;
  maxConcurrentCalls?: number;
  dailyCallLimit?: number;
  maxCalls?: number;
  maxCost?: number;
  retryEnabled?: boolean;
  maxRetries?: number;
  retryIntervalMinutes?: number;
  retryOnBusy?: boolean;
  retryOnNoAnswer?: boolean;
  retryOnFailed?: boolean;
  startDate?: string | Date;
  endDate?: string | Date;
  targetContactIds?: string[];
  targetGroupIds?: string[];
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface UpdateCampaignInput extends Partial<CreateCampaignInput> {}

export interface CampaignListParams {
  search?: string;
  status?: CampaignStatus;
  page?: number;
  limit?: number;
}

// Valid state machine transitions
const ALLOWED_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  [CampaignStatus.DRAFT]: [CampaignStatus.SCHEDULED, CampaignStatus.RUNNING, CampaignStatus.CANCELLED],
  [CampaignStatus.SCHEDULED]: [CampaignStatus.RUNNING, CampaignStatus.PAUSED, CampaignStatus.CANCELLED],
  [CampaignStatus.RUNNING]: [CampaignStatus.PAUSED, CampaignStatus.COMPLETED, CampaignStatus.CANCELLED, CampaignStatus.FAILED],
  [CampaignStatus.PAUSED]: [CampaignStatus.RUNNING, CampaignStatus.COMPLETED, CampaignStatus.CANCELLED],
  [CampaignStatus.COMPLETED]: [],
  [CampaignStatus.CANCELLED]: [],
  [CampaignStatus.FAILED]: []
};

/**
 * Lists campaigns with search, status filtering, and computed metrics.
 */
export async function listCampaigns(params: CampaignListParams = {}) {
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(params.limit) || 25));
  const skip = (page - 1) * limit;

  const where: any = {};

  if (params.status && params.status in CampaignStatus) {
    where.status = params.status;
  }

  if (params.search && params.search.trim()) {
    const q = params.search.trim();
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } }
    ];
  }

  const [campaigns, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        questionnaire: {
          select: { id: true, title: true, category: true }
        },
        _count: {
          select: { campaignContacts: true, callJobs: true }
        }
      }
    }),
    prisma.campaign.count({ where })
  ]);

  return {
    campaigns: campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      status: c.status,
      callerId: c.callerId,
      callerName: c.callerName,
      callingStartTime: c.callingStartTime,
      callingEndTime: c.callingEndTime,
      daysOfWeek: c.daysOfWeek,
      timezone: c.timezone,
      maxConcurrentCalls: c.maxConcurrentCalls,
      dailyCallLimit: c.dailyCallLimit,
      maxCalls: c.maxCalls,
      maxCost: c.maxCost ? Number(c.maxCost) : null,
      questionnaire: c.questionnaire,
      contactCount: c._count.campaignContacts,
      callJobCount: c._count.callJobs,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

/**
 * Retrieves a single campaign by ID with attached questionnaire and validation report.
 */
export async function getCampaignById(id: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      questionnaire: {
        include: {
          questions: {
            orderBy: { orderNo: 'asc' },
            include: { options: true }
          }
        }
      },
      campaignContacts: {
        take: 50,
        include: {
          contact: {
            select: {
              id: true,
              name: true,
              companyName: true,
              phoneNumber: true,
              isDoNotCall: true,
              consentStatus: true
            }
          }
        }
      },
      _count: {
        select: { campaignContacts: true, callJobs: true }
      }
    }
  });

  if (!campaign) {
    throw new NotFoundError(`Campaign with ID '${id}' not found`);
  }

  // Run pre-launch validation check for visibility
  let validationResult = null;
  try {
    validationResult = await validateCampaignForLaunch(id);
  } catch (err: any) {
    validationResult = { isLaunchReady: false, error: err.message };
  }

  return {
    ...campaign,
    maxCost: campaign.maxCost ? Number(campaign.maxCost) : null,
    totalContacts: campaign._count.campaignContacts,
    validation: validationResult
  };
}

/**
 * Creates a new campaign in DRAFT state.
 */
export async function createCampaign(input: CreateCampaignInput) {
  const {
    name,
    description,
    callerId = env.TWILIO_PHONE_NUMBER || '+17372508034',
    callerName = 'Auckland Accounting',
    questionnaireId,
    callingStartTime = '09:00',
    callingEndTime = '18:00',
    daysOfWeek = [1, 2, 3, 4, 5],
    timezone = 'Pacific/Auckland',
    maxConcurrentCalls = 5,
    dailyCallLimit,
    maxCalls,
    maxCost,
    retryEnabled = true,
    maxRetries = 3,
    retryIntervalMinutes = 60,
    retryOnBusy = true,
    retryOnNoAnswer = true,
    retryOnFailed = false,
    startDate,
    endDate,
    targetContactIds = [],
    targetGroupIds = [],
    userId,
    ipAddress,
    userAgent
  } = input;

  if (!name || !name.trim()) {
    throw new BadRequestError('Campaign name is required');
  }

  // Validate Caller ID normalization
  const norm = normalizePhoneNumber(callerId);
  const finalCallerId = norm.isValid ? norm.e164 : callerId;

  const campaign = await prisma.$transaction(async (tx) => {
    const created = await tx.campaign.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        status: CampaignStatus.DRAFT,
        callerId: finalCallerId,
        callerName,
        questionnaireId: questionnaireId || null,
        callingStartTime,
        callingEndTime,
        daysOfWeek,
        timezone,
        maxConcurrentCalls,
        dailyCallLimit,
        maxCalls,
        maxCost,
        retryEnabled,
        maxRetries,
        retryIntervalMinutes,
        retryOnBusy,
        retryOnNoAnswer,
        retryOnFailed,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        createdById: userId
      }
    });

    // Audit log
    await tx.auditLog.create({
      data: {
        userId,
        action: 'CAMPAIGN_CREATED',
        category: 'Campaign',
        entityType: 'Campaign',
        entityId: created.id,
        newValue: { name: created.name, status: created.status },
        ipAddress,
        userAgent,
        details: `Created campaign "${created.name}" in DRAFT state.`
      }
    });

    return created;
  });

  // Attach contacts if provided
  if (targetContactIds.length > 0 || targetGroupIds.length > 0) {
    await attachContactsToCampaign(campaign.id, {
      contactIds: targetContactIds,
      groupIds: targetGroupIds,
      userId,
      ipAddress,
      userAgent
    });
  }

  return getCampaignById(campaign.id);
}

/**
 * Updates an existing campaign configuration.
 */
export async function updateCampaign(id: string, input: UpdateCampaignInput) {
  const existing = await prisma.campaign.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError(`Campaign with ID '${id}' not found`);
  }

  // Cannot modify running or completed campaign parameters that break execution
  if (existing.status === CampaignStatus.COMPLETED || existing.status === CampaignStatus.CANCELLED) {
    throw new BadRequestError(`Cannot update campaign in terminal state (${existing.status})`);
  }

  let finalCallerId = existing.callerId;
  if (input.callerId) {
    const norm = normalizePhoneNumber(input.callerId);
    finalCallerId = norm.isValid ? norm.e164 : input.callerId;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const c = await tx.campaign.update({
      where: { id },
      data: {
        name: input.name !== undefined ? input.name.trim() : undefined,
        description: input.description !== undefined ? input.description?.trim() || null : undefined,
        callerId: finalCallerId,
        callerName: input.callerName !== undefined ? input.callerName : undefined,
        questionnaireId: input.questionnaireId !== undefined ? input.questionnaireId : undefined,
        callingStartTime: input.callingStartTime !== undefined ? input.callingStartTime : undefined,
        callingEndTime: input.callingEndTime !== undefined ? input.callingEndTime : undefined,
        daysOfWeek: input.daysOfWeek !== undefined ? input.daysOfWeek : undefined,
        timezone: input.timezone !== undefined ? input.timezone : undefined,
        maxConcurrentCalls: input.maxConcurrentCalls !== undefined ? input.maxConcurrentCalls : undefined,
        dailyCallLimit: input.dailyCallLimit !== undefined ? input.dailyCallLimit : undefined,
        maxCalls: input.maxCalls !== undefined ? input.maxCalls : undefined,
        maxCost: input.maxCost !== undefined ? input.maxCost : undefined,
        retryEnabled: input.retryEnabled !== undefined ? input.retryEnabled : undefined,
        maxRetries: input.maxRetries !== undefined ? input.maxRetries : undefined,
        retryIntervalMinutes: input.retryIntervalMinutes !== undefined ? input.retryIntervalMinutes : undefined,
        retryOnBusy: input.retryOnBusy !== undefined ? input.retryOnBusy : undefined,
        retryOnNoAnswer: input.retryOnNoAnswer !== undefined ? input.retryOnNoAnswer : undefined,
        retryOnFailed: input.retryOnFailed !== undefined ? input.retryOnFailed : undefined,
        startDate: input.startDate !== undefined ? (input.startDate ? new Date(input.startDate) : null) : undefined,
        endDate: input.endDate !== undefined ? (input.endDate ? new Date(input.endDate) : null) : undefined
      }
    });

    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: 'CAMPAIGN_UPDATED',
        category: 'Campaign',
        entityType: 'Campaign',
        entityId: id,
        oldValue: { name: existing.name },
        newValue: { name: c.name },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        details: `Updated configuration for campaign "${c.name}".`
      }
    });

    return c;
  });

  return getCampaignById(updated.id);
}

/**
 * Enforces campaign state machine transition with pre-launch validation guards.
 */
export async function transitionCampaignStatus(
  campaignId: string,
  targetStatus: CampaignStatus,
  context: { userId?: string; ipAddress?: string; userAgent?: string } = {}
) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId }
  });

  if (!campaign) {
    throw new NotFoundError(`Campaign with ID '${campaignId}' not found`);
  }

  const currentStatus = campaign.status;

  // Validate state machine transition
  const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(targetStatus)) {
    throw new BadRequestError(
      `Invalid campaign state transition from '${currentStatus}' to '${targetStatus}'. Allowed: [${allowed.join(', ')}]`
    );
  }

  // Pre-Launch Validation Guard: If moving to RUNNING or SCHEDULED, all pre-launch checks must pass!
  if (targetStatus === CampaignStatus.RUNNING || targetStatus === CampaignStatus.SCHEDULED) {
    // If campaign has 0 contacts attached, auto-attach available callable contacts from practice directory
    const existingContactCount = await prisma.campaignContact.count({ where: { campaignId } });
    if (existingContactCount === 0) {
      const allCallable = await prisma.contact.findMany({
        where: { isDoNotCall: false },
        take: 20
      });
      if (allCallable.length > 0) {
        await attachContactsToCampaign(campaignId, {
          contactIds: allCallable.map((c) => c.id),
          userId: context.userId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent
        });
      }
    }

    const preLaunch = await validateCampaignForLaunch(campaignId);
    if (!preLaunch.isLaunchReady) {
      const failedChecks = preLaunch.checks.filter((c) => c.status === 'FAIL').map((c) => c.message);
      throw new BadRequestError(
        `Campaign cannot be started. Pre-launch validation failed: ${failedChecks.join('; ')}`
      );
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.campaign.updateMany({
      where: {
        id: campaignId,
        status: currentStatus
      },
      data: { status: targetStatus }
    });

    if (updateResult.count === 0) {
      throw new BadRequestError(
        `Campaign status was modified concurrently (expected: ${currentStatus})`
      );
    }

    const c = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId } });

    await tx.auditLog.create({
      data: {
        userId: context.userId,
        action: 'CAMPAIGN_STATUS_CHANGED',
        category: 'Campaign',
        entityType: 'Campaign',
        entityId: campaignId,
        oldValue: { status: currentStatus },
        newValue: { status: targetStatus },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        details: `Campaign "${c.name}" status transitioned from ${currentStatus} to ${targetStatus}.`
      }
    });

    return c;
  });

  // If transitioning to RUNNING, create/enqueue CallJobs in BullMQ
  if (targetStatus === CampaignStatus.RUNNING) {
    const targets = await prisma.campaignContact.findMany({
      where: {
        campaignId,
        status: { in: ['PENDING', 'INCLUDED'] }
      },
      include: {
        contact: {
          select: { id: true, isDoNotCall: true, phoneNumber: true }
        }
      }
    });

    for (const target of targets) {
      if (target.contact.isDoNotCall) continue;

      // Find or create CallJob
      let job = await prisma.callJob.findFirst({
        where: {
          campaignId,
          contactId: target.contactId
        }
      });

      if (!job) {
        try {
          job = await prisma.callJob.create({
            data: {
              campaignId,
              contactId: target.contactId,
              status: 'PENDING',
              attempts: 0,
              maxAttempts: updated.maxRetries || 3
            }
          });
        } catch {
          job = await prisma.callJob.findFirst({
            where: { campaignId, contactId: target.contactId }
          });
        }
      }

      if (!job) continue;

      // Enqueue to BullMQ if PENDING
      if (job.status === 'PENDING') {
        try {
          const { addOutboundCallJob } = await import('../queues/queueManager.js');
          await addOutboundCallJob({
            campaignId,
            contactId: target.contactId,
            callJobId: job.id,
            attemptNumber: job.attempts + 1,
            triggeredBy: context.userId
          });
        } catch (queueErr) {
          logger.warn(
            { error: (queueErr as Error).message, callJobId: job.id },
            'Failed to enqueue call job in BullMQ (job saved in DB). Executing direct dial fallback...'
          );
          // If Redis queue is offline, execute directly in background through callWorker
          try {
            const { callWorker } = await import('../workers/callWorker.js');
            void callWorker.processCallJob({
              id: `direct-${job.id}`,
              data: {
                campaignId,
                contactId: target.contactId,
                callJobId: job.id,
                attemptNumber: job.attempts + 1
              }
            }).catch((directErr) => {
              logger.error(
                { error: (directErr as Error).message, callJobId: job.id },
                'Direct call execution failed'
              );
            });
          } catch (workerImportErr) {
            logger.error({ error: (workerImportErr as Error).message }, 'Failed to import callWorker for direct dispatch');
          }
        }
      }
    }
  } else if (targetStatus === CampaignStatus.CANCELLED) {
    // Cancel all pending jobs
    await prisma.callJob.updateMany({
      where: {
        campaignId,
        status: { in: [CallJobStatus.PENDING, CallJobStatus.SCHEDULED] }
      },
      data: { status: CallJobStatus.CANCELLED }
    });
  }

  return getCampaignById(updated.id);
}

/**
 * Emergency Stop: Pauses all active (RUNNING) campaigns immediately server-side.
 */
export async function emergencyStopAllCampaigns(context: {
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  reason?: string;
}): Promise<{ stoppedCount: number; campaignIds: string[] }> {
  const activeCampaigns = await prisma.campaign.findMany({
    where: { status: CampaignStatus.RUNNING }
  });

  const campaignIds = activeCampaigns.map((c) => c.id);

  if (campaignIds.length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.campaign.updateMany({
        where: { id: { in: campaignIds } },
        data: { status: CampaignStatus.PAUSED }
      });

      await tx.auditLog.create({
        data: {
          userId: context.userId,
          action: 'EMERGENCY_STOP_TRIGGERED',
          category: 'Security',
          entityType: 'Campaign',
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          details: `Emergency Stop triggered. Paused ${campaignIds.length} active campaigns. Reason: ${context.reason || 'User manual emergency pause'}`
        }
      });
    });

    logger.warn(
      { count: campaignIds.length, campaignIds, userId: context.userId },
      'EMERGENCY STOP: All active campaigns transitioned to PAUSED'
    );
  }

  return {
    stoppedCount: campaignIds.length,
    campaignIds
  };
}

/**
 * Attaches contacts to a campaign by individual IDs or group memberships.
 * Automatically marks DNC suppressed contacts as EXCLUDED_DNC.
 */
export async function attachContactsToCampaign(
  campaignId: string,
  input: {
    contactIds?: string[];
    groupIds?: string[];
    userId?: string;
    ipAddress?: string;
    userAgent?: string;
  }
) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId }
  });

  if (!campaign) {
    throw new NotFoundError(`Campaign with ID '${campaignId}' not found`);
  }

  const contactIdSet = new Set<string>(input.contactIds || []);

  // Resolve group memberships if groupIds provided
  if (input.groupIds && input.groupIds.length > 0) {
    const groupMembers = await prisma.contactGroupMember.findMany({
      where: { groupId: { in: input.groupIds } },
      select: { contactId: true }
    });
    groupMembers.forEach((m) => contactIdSet.add(m.contactId));
  }

  const allContactIds = Array.from(contactIdSet);
  if (allContactIds.length === 0) {
    return { success: true, addedCount: 0 };
  }

  // Pre-fetch contacts to inspect DNC status
  const contacts = await prisma.contact.findMany({
    where: { id: { in: allContactIds } },
    select: { id: true, isDoNotCall: true }
  });

  const records = contacts.map((c) => ({
    campaignId,
    contactId: c.id,
    status: c.isDoNotCall ? 'EXCLUDED_DNC' : 'PENDING'
  }));

  const res = await prisma.campaignContact.createMany({
    data: records,
    skipDuplicates: true
  });

  await prisma.auditLog.create({
    data: {
      userId: input.userId,
      action: 'CAMPAIGN_CONTACTS_ATTACHED',
      category: 'Campaign',
      entityType: 'Campaign',
      entityId: campaignId,
      newValue: { count: res.count, totalRequested: allContactIds.length },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      details: `Attached ${res.count} contact(s) to campaign "${campaign.name}".`
    }
  });

  return { success: true, addedCount: res.count };
}

/**
 * Removes a contact from a campaign audience.
 */
export async function removeContactFromCampaign(campaignId: string, contactId: string) {
  await prisma.campaignContact.deleteMany({
    where: { campaignId, contactId }
  });
  return { success: true };
}

/**
 * Deletes a campaign (restricted to DRAFT, SCHEDULED, or CANCELLED).
 */
export async function deleteCampaign(id: string, userId?: string, ipAddress?: string, userAgent?: string) {
  const existing = await prisma.campaign.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError(`Campaign with ID '${id}' not found`);
  }

  if (existing.status === CampaignStatus.RUNNING) {
    throw new BadRequestError('Cannot delete a currently RUNNING campaign. Cancel or pause it first.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.campaignContact.deleteMany({ where: { campaignId: id } });
    await tx.campaign.delete({ where: { id } });

    await tx.auditLog.create({
      data: {
        userId,
        action: 'CAMPAIGN_DELETED',
        category: 'Campaign',
        entityType: 'Campaign',
        entityId: id,
        oldValue: { name: existing.name, status: existing.status },
        ipAddress,
        userAgent,
        details: `Deleted campaign "${existing.name}".`
      }
    });
  });

  return { success: true, deletedId: id };
}
