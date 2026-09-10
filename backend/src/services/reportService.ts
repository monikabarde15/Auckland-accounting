import { prisma } from './prisma.js';
import { CallStatus, CampaignStatus, Prisma } from '@prisma/client';
import { NotFoundError } from '../errors/AppError.js';

export interface ReportDateFilter {
  startDate?: string;
  endDate?: string;
  campaignId?: string;
}

export interface SummaryReportResult {
  overview: {
    totalCampaigns: number;
    activeCampaigns: number;
    completedCampaigns: number;
    totalContacts: number;
    callableContacts: number;
    dncSuppressedContacts: number;
    totalCallsPlaced: number;
    completedCalls: number;
    transferredCalls: number;
    busyCalls: number;
    noAnswerCalls: number;
    failedCalls: number;
    cancelledCalls: number;
    answerRatePct: number;
    completionRatePct: number;
    failureRatePct: number;
    averageDurationSeconds: number;
    totalDurationSeconds: number;
    totalEstimatedCostNzd: number;
  };
  outcomes: Array<{
    status: string;
    label: string;
    count: number;
    percentage: number;
    color: string;
  }>;
  hourlyVolume: Array<{
    hour: string;
    dialed: number;
    answered: number;
  }>;
  suppression: {
    dncSuppressed: number;
    consentBlocked: number;
    callingHoursBlocked: number;
    budgetLimitReached: number;
    totalSuppressed: number;
  };
  retries: {
    totalRetriesScheduled: number;
    successfulRetries: number;
    exhaustedRetries: number;
  };
}

export interface CampaignReportResult {
  campaign: {
    id: string;
    name: string;
    status: CampaignStatus;
    callerId: string;
    callingStartTime: string;
    callingEndTime: string;
    timezone: string;
    maxCost: number | null;
    maxRetries: number;
    startDate: Date | null;
    endDate: Date | null;
  };
  metrics: {
    totalTargetContacts: number;
    totalJobs: number;
    totalAttempts: number;
    completedCalls: number;
    transferredCalls: number;
    busyCalls: number;
    noAnswerCalls: number;
    failedCalls: number;
    cancelledCalls: number;
    answerRatePct: number;
    completionRatePct: number;
    failureRatePct: number;
    totalDurationSeconds: number;
    averageDurationSeconds: number;
    totalCostNzd: number;
    costBudgetCapNzd: number | null;
    budgetUtilizedPct: number;
  };
  suppression: {
    dncBlocked: number;
    consentBlocked: number;
  };
  questionnaireResponses: Array<{
    questionId: string;
    stepNumber: number;
    questionText: string;
    questionType: string;
    totalResponses: number;
    averageRating?: number | null;
    optionsBreakdown: Array<{
      optionKey: string;
      optionLabel: string;
      count: number;
      percentage: number;
    }>;
  }>;
}

/**
 * Sanitize cell values against CSV Formula Injection (CWE-1236)
 */
export function sanitizeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  let str = String(value);
  // Neutralize formula trigger characters
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  // Escape double quotes
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Build Date-range where clause for CallAttempt
 */
function buildDateFilter(filter?: ReportDateFilter): Prisma.CallAttemptWhereInput {
  const where: Prisma.CallAttemptWhereInput = {};
  if (filter?.startDate || filter?.endDate) {
    where.startedAt = {};
    if (filter.startDate) {
      where.startedAt.gte = new Date(filter.startDate);
    }
    if (filter.endDate) {
      const end = new Date(filter.endDate);
      // If date only (e.g. YYYY-MM-DD), set to end of day
      if (filter.endDate.length === 10) {
        end.setUTCHours(23, 59, 59, 999);
      }
      where.startedAt.lte = end;
    }
  }
  if (filter?.campaignId && filter.campaignId !== 'all') {
    where.callJob = { campaignId: filter.campaignId };
  }
  return where;
}

/**
 * Calculate estimated cost based on duration (NZD $0.04 per minute or fraction thereof)
 */
export function calculateCallCost(durationSeconds: number): number {
  if (!durationSeconds || durationSeconds <= 0) return 0;
  const minutes = Math.ceil(durationSeconds / 60);
  return Number((minutes * 0.04).toFixed(2));
}

/**
 * Global Summary Report for Operations Dashboard & Analytics
 */
export async function getSummaryReport(filter?: ReportDateFilter): Promise<SummaryReportResult> {
  const attemptWhere = buildDateFilter(filter);

  // 1. Run parallel DB aggregations
  const [
    totalCampaigns,
    activeCampaigns,
    completedCampaigns,
    totalContacts,
    dncContactsCount,
    consentBlockedContactsCount,
    attempts,
    retryLogs,
    budgetLimitEvents
  ] = await Promise.all([
    prisma.campaign.count(),
    prisma.campaign.count({ where: { status: CampaignStatus.RUNNING } }),
    prisma.campaign.count({ where: { status: CampaignStatus.COMPLETED } }),
    prisma.contact.count(),
    prisma.contact.count({ where: { isDoNotCall: true } }),
    prisma.contact.count({ where: { consentStatus: { not: 'GRANTED' } } }),
    prisma.callAttempt.findMany({
      where: attemptWhere,
      select: {
        id: true,
        status: true,
        durationSeconds: true,
        startedAt: true,
        hangupCause: true
      }
    }),
    prisma.retryLog.findMany({
      select: {
        id: true,
        attemptNumber: true,
        reason: true,
        callJob: { select: { status: true } }
      }
    }),
    prisma.callEvent.count({
      where: { eventType: 'MAX_COST_REACHED' }
    })
  ]);

  const totalCallsPlaced = attempts.length;
  let completedCalls = 0;
  let transferredCalls = 0;
  let busyCalls = 0;
  let noAnswerCalls = 0;
  let failedCalls = 0;
  let cancelledCalls = 0;
  let totalDurationSeconds = 0;
  let totalEstimatedCostNzd = 0;

  // Initialize 24-hour distribution
  const hourlyCounts: Record<string, { dialed: number; answered: number }> = {};
  for (let h = 9; h <= 18; h++) {
    const hh = h < 10 ? `0${h}:00` : `${h}:00`;
    hourlyCounts[hh] = { dialed: 0, answered: 0 };
  }

  for (const a of attempts) {
    totalDurationSeconds += a.durationSeconds;
    totalEstimatedCostNzd += calculateCallCost(a.durationSeconds);

    if (a.status === CallStatus.COMPLETED) {
      if (a.hangupCause === 'TRANSFER_SUCCESS' || a.hangupCause === 'TRANSFERRED') {
        transferredCalls++;
      } else {
        completedCalls++;
      }
    } else if (a.status === CallStatus.BUSY) {
      busyCalls++;
    } else if (a.status === CallStatus.NO_ANSWER) {
      noAnswerCalls++;
    } else if (a.status === CallStatus.FAILED) {
      failedCalls++;
    } else if (a.status === CallStatus.CANCELLED) {
      cancelledCalls++;
    }

    // Hourly binning in Pacific/Auckland time (UTC+12 or UTC+13)
    const localDate = new Date(a.startedAt.toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
    const hourNum = localDate.getHours();
    const hourKey = `${hourNum < 10 ? '0' : ''}${hourNum}:00`;
    if (hourlyCounts[hourKey]) {
      hourlyCounts[hourKey].dialed++;
      if (a.status === CallStatus.COMPLETED || a.status === CallStatus.IN_PROGRESS) {
        hourlyCounts[hourKey].answered++;
      }
    }
  }

  const answeredTotal = completedCalls + transferredCalls;
  const answerRatePct = totalCallsPlaced > 0 ? Number(((answeredTotal / totalCallsPlaced) * 100).toFixed(1)) : 0;
  const completionRatePct = totalCallsPlaced > 0 ? Number(((completedCalls / totalCallsPlaced) * 100).toFixed(1)) : 0;
  const failureRatePct = totalCallsPlaced > 0 ? Number(((failedCalls / totalCallsPlaced) * 100).toFixed(1)) : 0;
  const averageDurationSeconds = totalCallsPlaced > 0 ? Math.round(totalDurationSeconds / totalCallsPlaced) : 0;
  const callableContacts = Math.max(0, totalContacts - dncContactsCount - consentBlockedContactsCount);

  const outcomes = [
    {
      status: 'COMPLETED',
      label: 'Completed Flow',
      count: completedCalls,
      percentage: totalCallsPlaced > 0 ? Number(((completedCalls / totalCallsPlaced) * 100).toFixed(1)) : 0,
      color: '#16a34a'
    },
    {
      status: 'TRANSFERRED',
      label: 'Transferred to Staff',
      count: transferredCalls,
      percentage: totalCallsPlaced > 0 ? Number(((transferredCalls / totalCallsPlaced) * 100).toFixed(1)) : 0,
      color: '#0f2e4a'
    },
    {
      status: 'BUSY',
      label: 'Busy Line',
      count: busyCalls,
      percentage: totalCallsPlaced > 0 ? Number(((busyCalls / totalCallsPlaced) * 100).toFixed(1)) : 0,
      color: '#d97706'
    },
    {
      status: 'NO_ANSWER',
      label: 'No Answer',
      count: noAnswerCalls,
      percentage: totalCallsPlaced > 0 ? Number(((noAnswerCalls / totalCallsPlaced) * 100).toFixed(1)) : 0,
      color: '#94a3b8'
    },
    {
      status: 'FAILED',
      label: 'Failed Connection',
      count: failedCalls,
      percentage: totalCallsPlaced > 0 ? Number(((failedCalls / totalCallsPlaced) * 100).toFixed(1)) : 0,
      color: '#dc2626'
    }
  ];

  const hourlyVolume = Object.entries(hourlyCounts).map(([hour, val]) => ({
    hour,
    dialed: val.dialed,
    answered: val.answered
  }));

  const successfulRetries = retryLogs.filter((r) => r.callJob?.status === 'COMPLETED').length;
  const exhaustedRetries = retryLogs.filter((r) => r.callJob?.status === 'FAILED').length;

  return {
    overview: {
      totalCampaigns,
      activeCampaigns,
      completedCampaigns,
      totalContacts,
      callableContacts,
      dncSuppressedContacts: dncContactsCount,
      totalCallsPlaced,
      completedCalls,
      transferredCalls,
      busyCalls,
      noAnswerCalls,
      failedCalls,
      cancelledCalls,
      answerRatePct,
      completionRatePct,
      failureRatePct,
      averageDurationSeconds,
      totalDurationSeconds,
      totalEstimatedCostNzd: Number(totalEstimatedCostNzd.toFixed(2))
    },
    outcomes,
    hourlyVolume,
    suppression: {
      dncSuppressed: dncContactsCount,
      consentBlocked: consentBlockedContactsCount,
      callingHoursBlocked: 0,
      budgetLimitReached: budgetLimitEvents,
      totalSuppressed: dncContactsCount + consentBlockedContactsCount
    },
    retries: {
      totalRetriesScheduled: retryLogs.length,
      successfulRetries,
      exhaustedRetries
    }
  };
}

/**
 * Detailed Campaign-level Report with IVR response aggregations
 */
export async function getCampaignReport(campaignId: string, filter?: ReportDateFilter): Promise<CampaignReportResult> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      questionnaire: {
        include: {
          questions: {
            orderBy: { orderNo: 'asc' },
            include: { options: true }
          }
        }
      },
      questions: {
        orderBy: { orderNo: 'asc' },
        include: { options: true }
      },
      _count: {
        select: {
          campaignContacts: true,
          callJobs: true
        }
      }
    }
  });

  if (!campaign) {
    throw new NotFoundError(`Campaign with ID '${campaignId}' not found`);
  }

  const attemptWhere: Prisma.CallAttemptWhereInput = {
    callJob: { campaignId }
  };

  if (filter?.startDate || filter?.endDate) {
    attemptWhere.startedAt = {};
    if (filter.startDate) attemptWhere.startedAt.gte = new Date(filter.startDate);
    if (filter.endDate) {
      const end = new Date(filter.endDate);
      if (filter.endDate.length === 10) end.setUTCHours(23, 59, 59, 999);
      attemptWhere.startedAt.lte = end;
    }
  }

  const [attempts, responses, dncSuppressedCount] = await Promise.all([
    prisma.callAttempt.findMany({
      where: attemptWhere,
      select: {
        id: true,
        status: true,
        durationSeconds: true,
        hangupCause: true
      }
    }),
    prisma.callResponse.findMany({
      where: {
        callAttempt: { callJob: { campaignId } }
      },
      select: {
        questionId: true,
        responseValue: true,
        responseText: true,
        isValid: true
      }
    }),
    prisma.campaignContact.count({
      where: {
        campaignId,
        status: 'EXCLUDED_DNC'
      }
    })
  ]);

  const totalAttempts = attempts.length;
  let completedCalls = 0;
  let transferredCalls = 0;
  let busyCalls = 0;
  let noAnswerCalls = 0;
  let failedCalls = 0;
  let cancelledCalls = 0;
  let totalDurationSeconds = 0;
  let totalCostNzd = 0;

  for (const a of attempts) {
    totalDurationSeconds += a.durationSeconds;
    totalCostNzd += calculateCallCost(a.durationSeconds);
    if (a.status === CallStatus.COMPLETED) {
      if (a.hangupCause === 'TRANSFER_SUCCESS' || a.hangupCause === 'TRANSFERRED') {
        transferredCalls++;
      } else {
        completedCalls++;
      }
    } else if (a.status === CallStatus.BUSY) {
      busyCalls++;
    } else if (a.status === CallStatus.NO_ANSWER) {
      noAnswerCalls++;
    } else if (a.status === CallStatus.FAILED) {
      failedCalls++;
    } else if (a.status === CallStatus.CANCELLED) {
      cancelledCalls++;
    }
  }

  const answeredTotal = completedCalls + transferredCalls;
  const answerRatePct = totalAttempts > 0 ? Number(((answeredTotal / totalAttempts) * 100).toFixed(1)) : 0;
  const completionRatePct = totalAttempts > 0 ? Number(((completedCalls / totalAttempts) * 100).toFixed(1)) : 0;
  const failureRatePct = totalAttempts > 0 ? Number(((failedCalls / totalAttempts) * 100).toFixed(1)) : 0;
  const averageDurationSeconds = totalAttempts > 0 ? Math.round(totalDurationSeconds / totalAttempts) : 0;
  const maxCostNum = campaign.maxCost ? Number(campaign.maxCost) : null;
  const budgetUtilizedPct = maxCostNum && maxCostNum > 0 ? Number(((totalCostNzd / maxCostNum) * 100).toFixed(1)) : 0;

  // Aggregate questions from attached Questionnaire or direct campaign questions
  const questionsList = campaign.questionnaire?.questions || campaign.questions || [];

  const questionnaireResponses = questionsList.map((q) => {
    const qResponses = responses.filter((r) => r.questionId === q.id);
    const totalQResponses = qResponses.length;

    let averageRating: number | null = null;
    if (q.type === 'RATING' && totalQResponses > 0) {
      const numericSum = qResponses.reduce((acc, curr) => acc + (parseFloat(curr.responseValue) || 0), 0);
      averageRating = Number((numericSum / totalQResponses).toFixed(1));
    }

    const optionsBreakdown = q.options.map((opt) => {
      const matchCount = qResponses.filter(
        (r) => r.responseValue === opt.optionKey || (r.responseText && r.responseText === opt.optionLabel)
      ).length;
      return {
        optionKey: opt.optionKey,
        optionLabel: opt.optionLabel,
        count: matchCount,
        percentage: totalQResponses > 0 ? Number(((matchCount / totalQResponses) * 100).toFixed(1)) : 0
      };
    });

    return {
      questionId: q.id,
      stepNumber: q.orderNo,
      questionText: q.questionText,
      questionType: q.type,
      totalResponses: totalQResponses,
      averageRating,
      optionsBreakdown
    };
  });

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      callerId: campaign.callerId,
      callingStartTime: campaign.callingStartTime,
      callingEndTime: campaign.callingEndTime,
      timezone: campaign.timezone,
      maxCost: maxCostNum,
      maxRetries: campaign.maxRetries,
      startDate: campaign.startDate,
      endDate: campaign.endDate
    },
    metrics: {
      totalTargetContacts: campaign._count.campaignContacts,
      totalJobs: campaign._count.callJobs,
      totalAttempts,
      completedCalls,
      transferredCalls,
      busyCalls,
      noAnswerCalls,
      failedCalls,
      cancelledCalls,
      answerRatePct,
      completionRatePct,
      failureRatePct,
      totalDurationSeconds,
      averageDurationSeconds,
      totalCostNzd: Number(totalCostNzd.toFixed(2)),
      costBudgetCapNzd: maxCostNum,
      budgetUtilizedPct
    },
    suppression: {
      dncBlocked: dncSuppressedCount,
      consentBlocked: 0
    },
    questionnaireResponses
  };
}

/**
 * Generate RFC 4180 CSV Export of filtered Call Records with Formula Injection Protection
 */
export async function exportCallsCsv(filter?: ReportDateFilter): Promise<string> {
  const where = buildDateFilter(filter);

  const attempts = await prisma.callAttempt.findMany({
    where,
    orderBy: { startedAt: 'desc' },
    include: {
      callJob: {
        include: {
          campaign: { select: { name: true, callerId: true } },
          contact: { select: { name: true, companyName: true, phoneNumber: true, irdNumber: true } }
        }
      },
      responses: {
        select: { responseValue: true, responseText: true, inputMethod: true }
      }
    }
  });

  const headers = [
    'Call ID',
    'Provider Call SID',
    'Contact Name',
    'Company',
    'Phone Number',
    'IRD Number',
    'Campaign Name',
    'Caller ID',
    'Status',
    'Hangup Cause',
    'Duration (Seconds)',
    'Cost (NZD)',
    'Started At (UTC)',
    'Ended At (UTC)',
    'Responses Captured'
  ];

  const rows = attempts.map((a) => {
    const cost = calculateCallCost(a.durationSeconds);
    const respSummary = a.responses.map((r) => `${r.responseValue}${r.responseText ? ` (${r.responseText})` : ''}`).join('; ');

    return [
      sanitizeCsvCell(a.id),
      sanitizeCsvCell(a.providerCallId || 'SIMULATED'),
      sanitizeCsvCell(a.callJob.contact.name),
      sanitizeCsvCell(a.callJob.contact.companyName || ''),
      sanitizeCsvCell(a.callJob.contact.phoneNumber),
      sanitizeCsvCell(a.callJob.contact.irdNumber || ''),
      sanitizeCsvCell(a.callJob.campaign.name),
      sanitizeCsvCell(a.callJob.campaign.callerId),
      sanitizeCsvCell(a.status),
      sanitizeCsvCell(a.hangupCause || ''),
      sanitizeCsvCell(a.durationSeconds),
      sanitizeCsvCell(`$${cost.toFixed(2)}`),
      sanitizeCsvCell(a.startedAt ? a.startedAt.toISOString() : ''),
      sanitizeCsvCell(a.endedAt ? a.endedAt.toISOString() : ''),
      sanitizeCsvCell(respSummary)
    ].join(',');
  });

  return [headers.map((h) => `"${h}"`).join(','), ...rows].join('\r\n');
}

/**
 * Generate RFC 4180 CSV Export of Campaign Performance & Questionnaire Breakdown
 */
export async function exportCampaignReportCsv(campaignId: string): Promise<string> {
  const report = await getCampaignReport(campaignId);

  const lines: string[] = [];
  lines.push(`"Auckland Accounting Services Ltd - Campaign Performance Report"`);
  lines.push(`"Generated At (UTC)",${sanitizeCsvCell(new Date().toISOString())}`);
  lines.push(`"Campaign Name",${sanitizeCsvCell(report.campaign.name)}`);
  lines.push(`"Status",${sanitizeCsvCell(report.campaign.status)}`);
  lines.push(`"Caller CLI",${sanitizeCsvCell(report.campaign.callerId)}`);
  lines.push(`"Timezone",${sanitizeCsvCell(report.campaign.timezone)}`);
  lines.push('');

  lines.push('"Operational Metric","Value"');
  lines.push(`"Total Target Contacts",${sanitizeCsvCell(report.metrics.totalTargetContacts)}`);
  lines.push(`"Total Call Attempts",${sanitizeCsvCell(report.metrics.totalAttempts)}`);
  lines.push(`"Completed Calls",${sanitizeCsvCell(report.metrics.completedCalls)}`);
  lines.push(`"Transferred to Staff",${sanitizeCsvCell(report.metrics.transferredCalls)}`);
  lines.push(`"Busy Lines",${sanitizeCsvCell(report.metrics.busyCalls)}`);
  lines.push(`"No Answer",${sanitizeCsvCell(report.metrics.noAnswerCalls)}`);
  lines.push(`"Failed Connections",${sanitizeCsvCell(report.metrics.failedCalls)}`);
  lines.push(`"Answer Rate",${sanitizeCsvCell(`${report.metrics.answerRatePct}%`)}`);
  lines.push(`"Completion Rate",${sanitizeCsvCell(`${report.metrics.completionRatePct}%`)}`);
  lines.push(`"Total Duration (sec)",${sanitizeCsvCell(report.metrics.totalDurationSeconds)}`);
  lines.push(`"Average Duration (sec)",${sanitizeCsvCell(report.metrics.averageDurationSeconds)}`);
  lines.push(`"Total Spend (NZD)",${sanitizeCsvCell(`$${report.metrics.totalCostNzd.toFixed(2)}`)}`);
  lines.push(`"Budget Cap (NZD)",${sanitizeCsvCell(report.metrics.costBudgetCapNzd ? `$${report.metrics.costBudgetCapNzd.toFixed(2)}` : 'None')}`);
  lines.push(`"Budget Utilized",${sanitizeCsvCell(`${report.metrics.budgetUtilizedPct}%`)}`);
  lines.push(`"DNC Suppressed Contacts",${sanitizeCsvCell(report.suppression.dncBlocked)}`);
  lines.push('');

  lines.push('"Questionnaire Responses Breakdown"');
  lines.push('"Step","Question Text","Type","Total Responses","Option Key","Option Label","Selection Count","Percentage"');

  for (const q of report.questionnaireResponses) {
    if (q.optionsBreakdown.length === 0) {
      lines.push(
        [
          sanitizeCsvCell(q.stepNumber),
          sanitizeCsvCell(q.questionText),
          sanitizeCsvCell(q.questionType),
          sanitizeCsvCell(q.totalResponses),
          '""',
          '""',
          '0',
          '"0%"'
        ].join(',')
      );
    } else {
      for (const opt of q.optionsBreakdown) {
        lines.push(
          [
            sanitizeCsvCell(q.stepNumber),
            sanitizeCsvCell(q.questionText),
            sanitizeCsvCell(q.questionType),
            sanitizeCsvCell(q.totalResponses),
            sanitizeCsvCell(opt.optionKey),
            sanitizeCsvCell(opt.optionLabel),
            sanitizeCsvCell(opt.count),
            sanitizeCsvCell(`${opt.percentage}%`)
          ].join(',')
        );
      }
    }
  }

  return lines.join('\r\n');
}
