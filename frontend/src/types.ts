export type QuestionType =
  | 'yes_no'
  | 'rating_1_5'
  | 'numeric'
  | 'multiple_choice'
  | 'message_only'
  | 'transfer';

export interface QuestionOption {
  id: string;
  dtmfDigit: string; // e.g. '1', '2', '9', '*'
  label: string;
  nextQuestionId?: string | 'END'; // target question id or END
  voiceTriggers?: string[]; // e.g. ['yes', 'yeah', 'correct']
}

export interface Question {
  id: string;
  name: string;
  type: QuestionType;
  promptText: string; // e.g. "Kia Ora {client_name}, this is Auckland Accounting Services. Have you received your GST filing draft? Press 1 for Yes, 2 for No."
  speechAudioUrl?: string; // Optional custom audio file URL
  options: QuestionOption[]; // for multiple_choice, yes_no, rating_1_5
  defaultNextQuestionId?: string | 'END';
  // Numeric configuration
  minDigits?: number;
  maxDigits?: number;
  finishOnKey?: string; // default '#'
  minValue?: number;
  maxValue?: number;
  // Transfer configuration
  transferPhoneNumber?: string; // e.g. "+1 737 250 8034"
  // Validation and timeout
  timeoutSeconds: number; // default 6s
  maxRetries: number; // default 2
  retryPromptText?: string; // "Sorry, that was not recognized. Please try again."
}

export interface Questionnaire {
  id: string;
  title: string;
  description: string;
  category: 'Tax & Compliance' | 'Audit' | 'Customer Survey' | 'Payroll & PAYE' | 'General';
  startingQuestionId: string;
  questions: Question[];
  createdAt: string;
  updatedAt: string;
}

export type ConsentStatus =
  | 'GRANTED'
  | 'REVOKED'
  | 'PENDING'
  | 'EXPIRED'
  | 'CONSENT_GRANTED'
  | 'CONSENT_REVOKED'
  | 'CONSENT_PENDING'
  | 'CONSENT_EXPIRED';

export interface Contact {
  id: string;
  name: string;
  companyName: string;
  phoneNumber: string; // E.g. "+64 21 892 4101"
  email: string;
  entityType?: 'Individual' | 'Company' | 'Trust' | 'Partnership' | 'Sole Proprietor' | 'INDIVIDUAL' | 'COMPANY' | 'TRUST' | 'PARTNERSHIP';
  irdNumber?: string;
  assignedAccountant?: string;
  outstandingBalance?: number;
  dueDate?: string;
  tags?: string[];
  isDoNotCall: boolean;
  callPermission?: boolean;
  consentStatus?: ConsentStatus;
  consentSource?: string;
  consentGrantedAt?: string;
  consentTimestamp?: string;
  groups?: Array<{ id: string; name: string }> | string[];
  notes?: string;
  lastCallDate?: string;
  lastCallStatus?: CallStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface ContactGroup {
  id: string;
  name: string;
  description?: string | null;
  memberCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface DncRecord {
  id: string;
  phoneNumber: string;
  reason?: string | null;
  source: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: { id: string; name: string; email: string };
}

export interface ConsentRecord {
  id: string;
  contactId: string;
  status: ConsentStatus;
  source: string;
  evidence?: string | null;
  notes?: string | null;
  recordedAt: string;
  recordedBy?: { id: string; name: string };
}

export interface ParsedCsvRow {
  rowIndex: number;
  raw: Record<string, string>;
  normalized: {
    name: string;
    companyName?: string;
    phoneNumber: string;
    email?: string;
    entityType?: string;
    assignedAccountant?: string;
    outstandingBalance?: number;
    dueDate?: string;
    tags?: string[];
  };
  validationErrors: string[];
  validationWarnings: string[];
  isDuplicate: boolean;
  isDncMatched: boolean;
  existingContactId?: string;
  status: 'valid' | 'warning' | 'invalid';
}

export interface CsvPreviewResult {
  totalRows?: number;
  validRows?: number;
  warningRows?: number;
  invalidRows?: number;
  duplicateRows?: number;
  dncSuppressedRows?: number;
  columnsDetected?: string[];
  sampleRows?: ParsedCsvRow[];
  validCount?: number;
  invalidCount?: number;
  duplicateInFileCount?: number;
  duplicateInDbCount?: number;
  dncBlockedCount?: number;
  previewRows?: ParsedCsvRow[];
  parsedRows?: ParsedCsvRow[];
}

export interface ImportSummaryResult {
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  createdGroupId?: string;
}

export type CallStatus =
  | 'pending'
  | 'queued'
  | 'initiating'
  | 'ringing'
  | 'in_progress'
  | 'completed'
  | 'busy'
  | 'no_answer'
  | 'failed'
  | 'transferred';

export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'ready'
  | 'DRAFT'
  | 'SCHEDULED'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'
  | 'READY';

export interface RetryPolicy {
  maxAttempts: number; // e.g. 3
  intervalMinutes: number; // e.g. 60
  retryOnBusy: boolean;
  retryOnNoAnswer: boolean;
  retryOnFailed: boolean;
}

export interface CallingSchedule {
  startHour?: string; // "09:00"
  endHour?: string; // "17:00"
  startDate?: string;
  startTime?: string;
  endTime?: string;
  callWindowDays?: string[];
  daysOfWeek?: number[] | string[]; // 1 = Mon, 5 = Fri
  timezone?: string; // "Pacific/Auckland"
}

export interface FlowValidationError {
  questionId?: string;
  field?: string;
  code: string;
  message: string;
}

export interface FlowValidationWarning {
  questionId?: string;
  code: string;
  message: string;
}

export interface FlowValidationResult {
  isValid: boolean;
  errors: FlowValidationError[];
  warnings: FlowValidationWarning[];
  summary: {
    totalQuestions: number;
    reachableQuestions: number;
    unreachableQuestions: number;
    terminalQuestions: number;
    hasCycle: boolean;
  };
}

export interface PreLaunchValidationCheck {
  id: string;
  category: 'CAMPAIGN' | 'CONTACTS' | 'QUESTION_FLOW' | 'COMPLIANCE' | 'CONFIG';
  name: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  message: string;
  details?: any;
}

export interface CampaignPreLaunchResult {
  isLaunchReady: boolean;
  campaignId: string;
  campaignName?: string;
  timestamp?: string;
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

export interface VoiceProfile {
  id: string;
  name: string; // e.g. "Aria (New Zealand Female)"
  region: string;
  accent: string;
  description: string;
  gender: 'female' | 'male';
  isDefault?: boolean;
}

export interface Campaign {
  id: string;
  name: string;
  description?: string | null;
  questionnaireId?: string | null;
  questionnaire?: {
    id: string;
    title: string;
    category?: string;
    questions?: Question[];
    startingQuestionId?: string | null;
  } | null;
  status: CampaignStatus;
  callerId: string; // e.g. "+17372508034"
  callerName?: string; // "Auckland Accounting Services"
  callingStartTime?: string;
  callingEndTime?: string;
  daysOfWeek?: number[];
  timezone?: string;
  maxConcurrentCalls?: number;
  dailyCallLimit?: number | null;
  maxCalls?: number | null;
  maxCost?: number | null;
  retryEnabled?: boolean;
  maxRetries?: number;
  retryIntervalMinutes?: number;
  retryDelayMinutes?: number;
  retryOnBusy?: boolean;
  retryOnNoAnswer?: boolean;
  retryOnFailed?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  targetContactIds?: string[];
  targetGroups?: string[];
  schedule?: CallingSchedule;
  retryPolicy?: RetryPolicy;
  concurrencyLimit?: number; // 1-10 simultaneous calls
  voiceSpeed?: number; // 0.8 to 1.2
  voicePitch?: number; // 0.8 to 1.2
  voiceProfile?: string; // e.g. "Aria (New Zealand Female)"
  voiceEngine?: string; // e.g. "NZ Voice Engine (Neural)"
  enableSpeechRecognition?: boolean;
  contactCount?: number;
  totalContacts?: number;
  callJobCount?: number;
  validation?: CampaignPreLaunchResult | null;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  stats?: {
    totalContacts?: number;
    completedCalls?: number;
    answeredCalls?: number;
    busyCalls?: number;
    noAnswerCalls?: number;
    failedCalls?: number;
    transferredCalls?: number;
    avgDurationSeconds?: number;
  };
}

export interface CallResponseRecord {
  questionId: string;
  questionName: string;
  questionType: QuestionType;
  promptText: string;
  inputReceived: string; // DTMF digit or speech text
  inputMethod: 'dtmf' | 'voice';
  recordedAt: string;
  isValid: boolean;
}

export interface CallAttemptResponse {
  id: string;
  questionId: string;
  rawDigits?: string | null;
  inputReceived: string;
  matchedOption?: string | null;
  isValid: boolean;
  durationSeconds?: number | null;
  recordedAt: string;
  question?: {
    id: string;
    questionText: string;
    questionType: string;
    promptAudioUrl?: string | null;
  };
}

export interface CallAttemptRetryLog {
  id: string;
  attemptNumber: number;
  reason: string;
  nextRetryAt: string;
  status: string;
  createdAt: string;
}

export interface CallAttemptDetail {
  id: string;
  callJobId?: string;
  contactId: string;
  campaignId: string;
  attemptNumber: number;
  status: string;
  providerSid?: string | null;
  providerStatus?: string | null;
  durationSeconds?: number | null;
  cost?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  recordingUrl?: string | null;
  startedAt?: string | null;
  answeredAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  contact?: Partial<Contact>;
  campaign?: { id: string; name: string; callerId: string };
  responses?: CallAttemptResponse[];
  retryLogs?: CallAttemptRetryLog[];
}

export interface CallLog {
  id: string;
  campaignId: string;
  campaignName: string;
  contactId: string;
  contactName: string;
  companyName: string;
  phoneNumber: string;
  status: CallStatus;
  attemptNumber: number;
  startedAt: string;
  endedAt?: string;
  durationSeconds: number;
  costNzd?: number;
  recordingUrl?: string | null;
  responses: CallResponseRecord[];
  transcript: Array<{
    speaker: 'system' | 'user';
    text: string;
    timestamp: string;
  }>;
  hangupCause?: 'completed' | 'user_hangup' | 'system_timeout' | 'transferred' | 'busy' | 'no_answer';
}

export interface AuditLogItem {
  id: string;
  action: string;
  performedBy: string;
  category: 'Campaign' | 'Questionnaire' | 'Contact' | 'System' | 'Call Execution';
  details: string;
  timestamp: string;
}

export interface ReportDateFilter {
  startDate?: string;
  endDate?: string;
  campaignId?: string;
}

export interface SummaryReportData {
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

export interface CampaignReportData {
  campaign: {
    id: string;
    name: string;
    status: string;
    callerId: string;
    callingStartTime: string;
    callingEndTime: string;
    timezone: string;
    maxCost: number | null;
    maxRetries: number;
    startDate: string | null;
    endDate: string | null;
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

export interface FormattedPermission {
  id: string;
  key: string;
  legacyKey: string;
  action: string;
  subject: string;
  category?: string;
  module?: string;
  label: string;
  description: string | null;
}

export interface RoleDefinition {
  id: string;
  name: 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR';
  description: string | null;
  isSystemProtected: boolean;
  userCount: number;
  permissions: FormattedPermission[];
  permissionKeys: string[];
}

export interface GroupedPermissions {
  [category: string]: FormattedPermission[];
}
