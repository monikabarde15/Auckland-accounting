import { prisma } from './prisma.js';
import { validateQuestionFlow, FlowValidationResult } from './flowValidationService.js';
import { normalizePhoneNumber } from '../utils/phone.js';

export interface PreLaunchValidationCheck {
  id: string;
  category: 'CAMPAIGN' | 'CONTACTS' | 'QUESTION_FLOW' | 'COMPLIANCE';
  name: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  message: string;
  details?: any;
}

export interface CampaignPreLaunchResult {
  isLaunchReady: boolean;
  campaignId: string;
  campaignName: string;
  checks: PreLaunchValidationCheck[];
  summary: {
    totalContacts: number;
    callableContacts: number;
    dncSuppressedContacts: number;
    flowValid: boolean;
    flowErrorCount: number;
    flowWarningCount: number;
  };
}

/**
 * Executes exhaustive pre-launch checks for a campaign before it can transition
 * into SCHEDULED or RUNNING state.
 */
export async function validateCampaignForLaunch(campaignId: string): Promise<CampaignPreLaunchResult> {
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
      campaignContacts: {
        include: {
          contact: true
        }
      }
    }
  });

  if (!campaign) {
    throw new Error(`Campaign '${campaignId}' not found`);
  }

  const checks: PreLaunchValidationCheck[] = [];

  // -------------------------------------------------------------
  // Category 1: Campaign Configuration
  // -------------------------------------------------------------
  if (!campaign.name || !campaign.name.trim()) {
    checks.push({
      id: 'CONFIG_NAME',
      category: 'CAMPAIGN',
      name: 'Campaign Name',
      status: 'FAIL',
      message: 'Campaign name cannot be blank.'
    });
  } else {
    checks.push({
      id: 'CONFIG_NAME',
      category: 'CAMPAIGN',
      name: 'Campaign Name',
      status: 'PASS',
      message: `Campaign name configured as "${campaign.name}".`
    });
  }

  // Caller ID check
  const phoneNorm = normalizePhoneNumber(campaign.callerId);
  if (!phoneNorm.isValid) {
    checks.push({
      id: 'CONFIG_CALLER_ID',
      category: 'CAMPAIGN',
      name: 'Outbound Caller ID',
      status: 'FAIL',
      message: `Invalid Caller ID '${campaign.callerId}'. Must be a valid E.164 phone number.`
    });
  } else {
    checks.push({
      id: 'CONFIG_CALLER_ID',
      category: 'CAMPAIGN',
      name: 'Outbound Caller ID',
      status: 'PASS',
      message: `Caller ID valid (${phoneNorm.e164}).`
    });
  }

  // Calling Hours & Window
  const [startH, startM] = campaign.callingStartTime.split(':').map(Number);
  const [endH, endM] = campaign.callingEndTime.split(':').map(Number);
  const startMins = startH * 60 + (startM || 0);
  const endMins = endH * 60 + (endM || 0);

  if (isNaN(startMins) || isNaN(endMins) || startMins >= endMins) {
    checks.push({
      id: 'CONFIG_CALLING_HOURS',
      category: 'CAMPAIGN',
      name: 'Calling Hours Window',
      status: 'FAIL',
      message: `Invalid calling window (${campaign.callingStartTime} to ${campaign.callingEndTime}). Start time must precede end time.`
    });
  } else {
    checks.push({
      id: 'CONFIG_CALLING_HOURS',
      category: 'CAMPAIGN',
      name: 'Calling Hours Window',
      status: 'PASS',
      message: `Calling window configured: ${campaign.callingStartTime} - ${campaign.callingEndTime} (${campaign.timezone}).`
    });
  }

  // Active Days of Week
  if (!campaign.daysOfWeek || campaign.daysOfWeek.length === 0) {
    checks.push({
      id: 'CONFIG_DAYS',
      category: 'CAMPAIGN',
      name: 'Calling Days of Week',
      status: 'FAIL',
      message: 'At least one active calling day must be selected.'
    });
  } else {
    checks.push({
      id: 'CONFIG_DAYS',
      category: 'CAMPAIGN',
      name: 'Calling Days of Week',
      status: 'PASS',
      message: `${campaign.daysOfWeek.length} calling days configured.`
    });
  }

  // Concurrency Limit
  if (campaign.maxConcurrentCalls < 1 || campaign.maxConcurrentCalls > 50) {
    checks.push({
      id: 'CONFIG_CONCURRENCY',
      category: 'CAMPAIGN',
      name: 'Simultaneous Call Concurrency',
      status: 'FAIL',
      message: `Concurrency limit must be between 1 and 50 (currently ${campaign.maxConcurrentCalls}).`
    });
  } else {
    checks.push({
      id: 'CONFIG_CONCURRENCY',
      category: 'CAMPAIGN',
      name: 'Simultaneous Call Concurrency',
      status: 'PASS',
      message: `Concurrency set to ${campaign.maxConcurrentCalls} simultaneous calls.`
    });
  }

  // -------------------------------------------------------------
  // Category 2: Audience Contacts & DNC Suppression
  // -------------------------------------------------------------
  const totalContacts = campaign.campaignContacts.length;
  let callableCount = 0;
  let dncSuppressedCount = 0;

  if (totalContacts === 0) {
    checks.push({
      id: 'CONTACTS_AUDIENCE',
      category: 'CONTACTS',
      name: 'Target Audience Contacts',
      status: 'FAIL',
      message: 'No contacts attached to campaign. Audience must contain at least 1 contact.'
    });
  } else {
    // Check DNC suppression
    for (const cc of campaign.campaignContacts) {
      if (cc.contact.isDoNotCall || cc.status === 'EXCLUDED_DNC') {
        dncSuppressedCount++;
      } else {
        callableCount++;
      }
    }

    if (callableCount === 0) {
      checks.push({
        id: 'CONTACTS_CALLABLE',
        category: 'COMPLIANCE',
        name: 'DNC Compliance & Callable Contacts',
        status: 'FAIL',
        message: `All ${totalContacts} attached contacts are registered on Do-Not-Call (DNC) suppression or marked non-callable.`
      });
    } else if (dncSuppressedCount > 0) {
      checks.push({
        id: 'CONTACTS_CALLABLE',
        category: 'COMPLIANCE',
        name: 'DNC Compliance & Callable Contacts',
        status: 'WARN',
        message: `${callableCount} contacts callable. ${dncSuppressedCount} contact(s) suppressed by DNC policy.`
      });
    } else {
      checks.push({
        id: 'CONTACTS_CALLABLE',
        category: 'COMPLIANCE',
        name: 'DNC Compliance & Callable Contacts',
        status: 'PASS',
        message: `All ${callableCount} contacts are callable and cleared by compliance.`
      });
    }
  }

  // -------------------------------------------------------------
  // Category 3: Question Flow Validation
  // -------------------------------------------------------------
  const flowQuestions =
    campaign.questionnaire?.questions && campaign.questionnaire.questions.length > 0
      ? campaign.questionnaire.questions
      : campaign.questions;

  const startingId = campaign.questionnaire?.startingQuestionId || flowQuestions[0]?.id;

  let flowValidation: FlowValidationResult = {
    isValid: false,
    errors: [],
    warnings: [],
    summary: {
      totalQuestions: 0,
      reachableQuestions: 0,
      unreachableQuestions: 0,
      terminalQuestions: 0,
      hasCycle: false
    }
  };

  if (!flowQuestions || flowQuestions.length === 0) {
    checks.push({
      id: 'FLOW_QUESTIONS_EXIST',
      category: 'QUESTION_FLOW',
      name: 'Question Flow Linkage',
      status: 'FAIL',
      message: 'No questions or questionnaire flow associated with this campaign.'
    });
  } else {
    flowValidation = validateQuestionFlow(flowQuestions as any, startingId);

    if (!flowValidation.isValid) {
      const errorSummary = flowValidation.errors.map((e) => e.message).join('; ');
      checks.push({
        id: 'FLOW_GRAPH_VALID',
        category: 'QUESTION_FLOW',
        name: 'IVR Graph & Branching Integrity',
        status: 'FAIL',
        message: `Flow contains ${flowValidation.errors.length} error(s): ${errorSummary}`,
        details: flowValidation.errors
      });
    } else {
      checks.push({
        id: 'FLOW_GRAPH_VALID',
        category: 'QUESTION_FLOW',
        name: 'IVR Graph & Branching Integrity',
        status: 'PASS',
        message: `Flow verified: ${flowValidation.summary.totalQuestions} questions, starting at '${startingId}', all paths lead to terminal state.`
      });
    }

    if (flowValidation.warnings.length > 0) {
      checks.push({
        id: 'FLOW_GRAPH_WARNINGS',
        category: 'QUESTION_FLOW',
        name: 'Flow Reachability Warnings',
        status: 'WARN',
        message: `${flowValidation.warnings.length} warning(s) detected (e.g. unreachable questions).`,
        details: flowValidation.warnings
      });
    }
  }

  const isLaunchReady = checks.every((c) => c.status !== 'FAIL');

  return {
    isLaunchReady,
    campaignId: campaign.id,
    campaignName: campaign.name,
    checks,
    summary: {
      totalContacts,
      callableContacts: callableCount,
      dncSuppressedContacts: dncSuppressedCount,
      flowValid: flowValidation.isValid,
      flowErrorCount: flowValidation.errors.length,
      flowWarningCount: flowValidation.warnings.length
    }
  };
}
