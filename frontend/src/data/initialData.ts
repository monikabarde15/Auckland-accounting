import { Questionnaire, Contact, Campaign, CallLog, AuditLogItem } from '../types';

export const INITIAL_QUESTIONNAIRES: Questionnaire[] = [
  // 1. Yes / No Binary Decision Flow
  {
    id: 'qnr_yes_no_gst',
    title: 'GST Return & Filing Approval (Yes / No)',
    category: 'Tax & Compliance',
    description: 'Binary DTMF decision flow for client draft review and direct IRD submission authorization.',
    startingQuestionId: 'q_gst_step_1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    questions: [
      {
        id: 'q_gst_step_1',
        name: 'Step 1: Draft Review Confirmation',
        type: 'yes_no',
        promptText: 'Kia Ora {client_name}, this is Auckland Accounting Services regarding your GST draft review. Have you reviewed your draft return? Press 1 for Yes, or 2 for No.',
        options: [
          { id: 'opt_gst_1', dtmfDigit: '1', label: 'Yes, draft reviewed', nextQuestionId: 'q_gst_step_2' },
          { id: 'opt_gst_2', dtmfDigit: '2', label: 'No, need assistance', nextQuestionId: 'q_gst_step_3' }
        ],
        timeoutSeconds: 6,
        maxRetries: 2,
        retryPromptText: 'Please press 1 if you have reviewed your draft, or 2 to speak with your accountant.'
      },
      {
        id: 'q_gst_step_2',
        name: 'Step 2: Filing Authorization',
        type: 'yes_no',
        promptText: 'Do you authorize Auckland Accounting Services to submit your return directly to the Inland Revenue Department? Press 1 to Authorize, or 2 to Request Changes.',
        options: [
          { id: 'opt_gst_auth_1', dtmfDigit: '1', label: 'Authorize Submission', nextQuestionId: 'q_gst_step_4' },
          { id: 'opt_gst_auth_2', dtmfDigit: '2', label: 'Request Changes', nextQuestionId: 'q_gst_step_3' }
        ],
        timeoutSeconds: 6,
        maxRetries: 2,
        retryPromptText: 'Press 1 to authorize submission, or 2 to request changes with your accountant.'
      },
      {
        id: 'q_gst_step_3',
        name: 'Step 3: Transfer to Assigned Accountant',
        type: 'transfer',
        promptText: 'Understood. Transferring your call to your assigned accountant {assigned_accountant} now.',
        transferPhoneNumber: '+1 737 250 8034',
        options: [],
        timeoutSeconds: 6,
        maxRetries: 1
      },
      {
        id: 'q_gst_step_4',
        name: 'Step 4: Filing Authorization Recorded',
        type: 'message_only',
        promptText: 'Thank you {client_name}. Your return authorization has been recorded and submitted to Inland Revenue. Goodbye.',
        options: [],
        timeoutSeconds: 4,
        maxRetries: 1
      }
    ]
  },

  // 2. Multiple Choice DTMF Menu with Replay ('REPEAT')
  {
    id: 'qnr_multiple_choice_fee',
    title: 'Client Fee & Invoice Options (Multiple Choice)',
    category: 'General',
    description: 'Multi-branch DTMF menu for balance notifications, receipt confirmation, email dispatches, and menu replay.',
    startingQuestionId: 'q_fee_step_1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    questions: [
      {
        id: 'q_fee_step_1',
        name: 'Step 1: Fee Follow-up Menu',
        type: 'multiple_choice',
        promptText: 'Kia Ora {client_name}, this is Auckland Accounting regarding an outstanding balance of {balance} due on {due_date}. Press 1 if payment has already been sent, 2 to receive bank deposit details, 3 to speak with billing, or 9 to repeat this menu.',
        options: [
          { id: 'opt_fee_1', dtmfDigit: '1', label: 'Payment already made', nextQuestionId: 'q_fee_step_2' },
          { id: 'opt_fee_2', dtmfDigit: '2', label: 'Send bank details by email', nextQuestionId: 'q_fee_step_3' },
          { id: 'opt_fee_3', dtmfDigit: '3', label: 'Speak to billing team', nextQuestionId: 'q_fee_step_4' },
          { id: 'opt_fee_9', dtmfDigit: '9', label: 'Repeat menu options', nextQuestionId: 'REPEAT' }
        ],
        timeoutSeconds: 7,
        maxRetries: 2,
        retryPromptText: 'Please press 1 for payment made, 2 for bank details, 3 for billing, or 9 to hear the menu again.'
      },
      {
        id: 'q_fee_step_2',
        name: 'Step 2: Payment Receipt Confirmation',
        type: 'message_only',
        promptText: 'Thank you for confirming your payment. Our accounts desk will reconcile your balance shortly. Have a great day.',
        options: [],
        timeoutSeconds: 4,
        maxRetries: 1
      },
      {
        id: 'q_fee_step_3',
        name: 'Step 3: Bank Details Dispatched',
        type: 'message_only',
        promptText: 'Our practice payment instructions and your invoice reference have been dispatched to your email on file. Thank you.',
        options: [],
        timeoutSeconds: 4,
        maxRetries: 1
      },
      {
        id: 'q_fee_step_4',
        name: 'Step 4: Billing Team Transfer',
        type: 'transfer',
        promptText: 'Connecting you with the practice accounts receivable desk now.',
        transferPhoneNumber: '+1 737 250 8034',
        options: [],
        timeoutSeconds: 6,
        maxRetries: 1
      }
    ]
  },

  // 3. Numeric Digits Keypad Entry with Hash (#) Terminating Key
  {
    id: 'qnr_numeric_ird_verify',
    title: 'Inland Revenue ID & PIN Verification (Numeric Digits)',
    category: 'Tax & Compliance',
    description: 'Collects variable-length numerical digits (8-9 digit IRD number) finished by hash key before conditional routing.',
    startingQuestionId: 'q_ird_step_1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    questions: [
      {
        id: 'q_ird_step_1',
        name: 'Step 1: IRD Number Keypad Entry',
        type: 'numeric',
        promptText: 'Kia Ora {client_name}, for security verification, please enter your 8 or 9 digit IRD number on your telephone keypad, followed by the hash key.',
        minDigits: 8,
        maxDigits: 9,
        finishOnKey: '#',
        defaultNextQuestionId: 'q_ird_step_2',
        options: [],
        timeoutSeconds: 10,
        maxRetries: 2,
        retryPromptText: 'Please enter your 8 or 9 digit IRD number on your keypad, followed by the hash key.'
      },
      {
        id: 'q_ird_step_2',
        name: 'Step 2: Statement Dispatch Confirmation',
        type: 'yes_no',
        promptText: 'Thank you. Your IRD number has been verified. Would you like a copy of your latest tax assessment summary emailed to you? Press 1 for Yes, or 2 for No.',
        options: [
          { id: 'opt_ird_yes', dtmfDigit: '1', label: 'Yes, email summary', nextQuestionId: 'q_ird_step_3' },
          { id: 'opt_ird_no', dtmfDigit: '2', label: 'No, summary not needed', nextQuestionId: 'q_ird_step_4' }
        ],
        timeoutSeconds: 6,
        maxRetries: 2,
        retryPromptText: 'Please press 1 to receive your tax summary by email, or 2 to conclude.'
      },
      {
        id: 'q_ird_step_3',
        name: 'Step 3: Tax Summary Emailed',
        type: 'message_only',
        promptText: 'Your tax assessment summary has been emailed to your address on file. Thank you for calling Auckland Accounting Services. Goodbye.',
        options: [],
        timeoutSeconds: 4,
        maxRetries: 1
      },
      {
        id: 'q_ird_step_4',
        name: 'Step 4: Verification Completed',
        type: 'message_only',
        promptText: 'Thank you for verifying your IRD details with Auckland Accounting Services. Have a great day. Goodbye.',
        options: [],
        timeoutSeconds: 4,
        maxRetries: 1
      }
    ]
  },

  // 4. Rating 1 to 5 Survey Scale with Recovery Routing
  {
    id: 'qnr_rating_csat_survey',
    title: 'Client Satisfaction CSAT Survey (Rating 1-5 Scale)',
    category: 'Customer Survey',
    description: 'Post-filing 1-5 star service rating scale with conditional service recovery transfer for low ratings.',
    startingQuestionId: 'q_csat_step_1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    questions: [
      {
        id: 'q_csat_step_1',
        name: 'Step 1: Service Satisfaction Score',
        type: 'rating_1_5',
        promptText: 'Kia Ora {client_name}, on a scale of 1 to 5, where 1 is poor and 5 is excellent, how satisfied are you with the accounting services provided by {assigned_accountant}?',
        options: [
          { id: 'opt_r_1', dtmfDigit: '1', label: '1 - Poor', nextQuestionId: 'q_csat_step_escalate' },
          { id: 'opt_r_2', dtmfDigit: '2', label: '2 - Fair', nextQuestionId: 'q_csat_step_escalate' },
          { id: 'opt_r_3', dtmfDigit: '3', label: '3 - Average', nextQuestionId: 'q_csat_step_neutral' },
          { id: 'opt_r_4', dtmfDigit: '4', label: '4 - Good', nextQuestionId: 'q_csat_step_thanks' },
          { id: 'opt_r_5', dtmfDigit: '5', label: '5 - Excellent', nextQuestionId: 'q_csat_step_thanks' }
        ],
        timeoutSeconds: 6,
        maxRetries: 2,
        retryPromptText: 'Please press a number from 1 to 5 on your telephone keypad.'
      },
      {
        id: 'q_csat_step_escalate',
        name: 'Step 2: Service Recovery Routing',
        type: 'transfer',
        promptText: 'We apologize that we did not meet your expectations. Routing your call to our practice client relations manager now.',
        transferPhoneNumber: '+1 737 250 8034',
        options: [],
        timeoutSeconds: 6,
        maxRetries: 1
      },
      {
        id: 'q_csat_step_neutral',
        name: 'Step 3: Feedback Acknowledgment',
        type: 'message_only',
        promptText: 'Thank you for your rating. Your feedback helps Auckland Accounting Services continuously improve our client services. Goodbye.',
        options: [],
        timeoutSeconds: 4,
        maxRetries: 1
      },
      {
        id: 'q_csat_step_thanks',
        name: 'Step 4: Positive Survey Conclusion',
        type: 'message_only',
        promptText: 'Thank you for your fantastic feedback and for partnering with Auckland Accounting Services! Have a wonderful day. Goodbye.',
        options: [],
        timeoutSeconds: 4,
        maxRetries: 1
      }
    ]
  },

  // 5. Comprehensive All-in-One Master Flow (Combines Numeric, Multiple Choice, Yes/No, Rating 1-5, Transfer, Announcement)
  {
    id: 'qnr_master_all_input_types',
    title: 'Complete Practice Master Flow (All Input Types)',
    category: 'General',
    description: 'Comprehensive end-to-end test flow exercising Numeric IRD entry, Multiple Choice menu, Yes/No decision, and Rating 1-5 scale.',
    startingQuestionId: 'q_master_step_1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    questions: [
      {
        id: 'q_master_step_1',
        name: 'Step 1: Identity & IRD Collection (Numeric)',
        type: 'numeric',
        promptText: 'Kia Ora {client_name}, welcome to Auckland Accounting. To begin, please enter your 8 or 9 digit IRD number, followed by hash.',
        minDigits: 8,
        maxDigits: 9,
        finishOnKey: '#',
        defaultNextQuestionId: 'q_master_step_2',
        options: [],
        timeoutSeconds: 10,
        maxRetries: 2,
        retryPromptText: 'Please key in your 8 or 9 digit IRD number, followed by hash.'
      },
      {
        id: 'q_master_step_2',
        name: 'Step 2: Service Topic Selection (Multiple Choice)',
        type: 'multiple_choice',
        promptText: 'Thank you. Please select what you need assistance with today: Press 1 for Tax Filing, 2 for Fee Balance of {balance}, or 3 for Live Advisor.',
        options: [
          { id: 'opt_m_1', dtmfDigit: '1', label: 'Tax Filing Confirmation', nextQuestionId: 'q_master_step_3' },
          { id: 'opt_m_2', dtmfDigit: '2', label: 'Fee Balance Inquiry', nextQuestionId: 'q_master_step_4' },
          { id: 'opt_m_3', dtmfDigit: '3', label: 'Live Advisor Transfer', nextQuestionId: 'q_master_step_5' }
        ],
        timeoutSeconds: 7,
        maxRetries: 2,
        retryPromptText: 'Please press 1 for tax filing, 2 for fee balance, or 3 for live advisor.'
      },
      {
        id: 'q_master_step_3',
        name: 'Step 3: Direct Authorization (Yes / No)',
        type: 'yes_no',
        promptText: 'Do you confirm your tax return is ready for direct lodgement with IRD? Press 1 for Yes, or 2 for No.',
        options: [
          { id: 'opt_m_yes', dtmfDigit: '1', label: 'Yes, lodge return', nextQuestionId: 'q_master_step_6' },
          { id: 'opt_m_no', dtmfDigit: '2', label: 'No, speak to accountant', nextQuestionId: 'q_master_step_5' }
        ],
        timeoutSeconds: 6,
        maxRetries: 2,
        retryPromptText: 'Press 1 for Yes, or 2 for No.'
      },
      {
        id: 'q_master_step_4',
        name: 'Step 4: Balance Details & SMS (Announcement)',
        type: 'message_only',
        promptText: 'Your current account balance of {balance} is due on {due_date}. Statement details have been sent to your email. Thank you.',
        defaultNextQuestionId: 'q_master_step_6',
        options: [],
        timeoutSeconds: 4,
        maxRetries: 1
      },
      {
        id: 'q_master_step_5',
        name: 'Step 5: Staff Transfer (Transfer)',
        type: 'transfer',
        promptText: 'Transferring your call to your assigned accountant {assigned_accountant} now.',
        transferPhoneNumber: '+1 737 250 8034',
        options: [],
        timeoutSeconds: 6,
        maxRetries: 1
      },
      {
        id: 'q_master_step_6',
        name: 'Step 6: Experience Rating (Rating 1-5)',
        type: 'rating_1_5',
        promptText: 'Before you go, please rate your telephone experience today from 1 to 5.',
        options: [
          { id: 'opt_m_r1', dtmfDigit: '1', label: '1 - Poor', nextQuestionId: 'q_master_step_7' },
          { id: 'opt_m_r2', dtmfDigit: '2', label: '2 - Fair', nextQuestionId: 'q_master_step_7' },
          { id: 'opt_m_r3', dtmfDigit: '3', label: '3 - Average', nextQuestionId: 'q_master_step_7' },
          { id: 'opt_m_r4', dtmfDigit: '4', label: '4 - Good', nextQuestionId: 'q_master_step_7' },
          { id: 'opt_m_r5', dtmfDigit: '5', label: '5 - Excellent', nextQuestionId: 'q_master_step_7' }
        ],
        timeoutSeconds: 6,
        maxRetries: 1,
        retryPromptText: 'Please press 1 through 5 on your telephone keypad.'
      },
      {
        id: 'q_master_step_7',
        name: 'Step 7: Final Conclusion (Announcement)',
        type: 'message_only',
        promptText: 'Thank you for choosing Auckland Accounting Services. Have a great day. Goodbye.',
        options: [],
        timeoutSeconds: 4,
        maxRetries: 1
      }
    ]
  }
];

export const INITIAL_CONTACTS: Contact[] = [
  {
    id: 'cmufic50r0000v4jg3r86y1v5',
    name: 'Mr. Om',
    companyName: 'Om Prakash & Associates',
    phoneNumber: '+918210543772',
    email: 'omprakash@aucklandaccounting.co.nz',
    entityType: 'Company',
    irdNumber: '128-492-381',
    assignedAccountant: 'David Chen (CA)',
    outstandingBalance: 1250.0,
    dueDate: new Date().toISOString().split('T')[0],
    tags: ['VIP', 'Live Testing'],
    isDoNotCall: false,
    callPermission: true,
    consentStatus: 'GRANTED',
    groups: ['GST Tax Filings'],
    createdAt: new Date().toISOString()
  },
  {
    id: 'cmuhxurl80004v4bsu1qpp712',
    name: 'Kiwi Enterprise Ltd',
    companyName: 'Kiwi Enterprise Ltd',
    phoneNumber: '+64219867947',
    email: 'accounts@kiwienterprise.co.nz',
    entityType: 'Company',
    irdNumber: '49-102-394',
    assignedAccountant: 'Priya Sharma (CPA)',
    outstandingBalance: 480.0,
    dueDate: new Date().toISOString().split('T')[0],
    tags: ['GST', 'Monthly'],
    isDoNotCall: false,
    callPermission: true,
    consentStatus: 'GRANTED',
    groups: ['GST Tax Filings'],
    createdAt: new Date().toISOString()
  },
  {
    id: 'cmuhxurp10005v4bs6r3t3dlz',
    name: 'Auckland Construction Group',
    companyName: 'Auckland Construction Group',
    phoneNumber: '+64229868083',
    email: 'info@aucklandconstruction.co.nz',
    entityType: 'Company',
    irdNumber: '88-341-902',
    assignedAccountant: 'David Chen (CA)',
    outstandingBalance: 2400.0,
    dueDate: new Date().toISOString().split('T')[0],
    tags: ['Fee Reminders'],
    isDoNotCall: false,
    callPermission: true,
    consentStatus: 'GRANTED',
    groups: ['Fee Reminders'],
    createdAt: new Date().toISOString()
  }
];

export const INITIAL_CAMPAIGNS: Campaign[] = [
  {
    id: 'cmp_nz_gst_q1',
    name: 'Q1 GST Filing Authorizations 2026',
    status: 'draft',
    questionnaireId: 'qnr_yes_no_gst',
    targetGroups: ['GST Tax Filings'],
    targetContactIds: [],
    callerId: '+1 737 250 8034',
    schedule: {
      startDate: new Date().toISOString().split('T')[0],
      startTime: '09:00',
      endTime: '17:00',
      timezone: 'Pacific/Auckland',
      callWindowDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
    },
    concurrencyLimit: 5,
    maxRetries: 2,
    retryDelayMinutes: 30,
    stats: {
      totalContacts: 2,
      completedCalls: 0,
      answeredCalls: 0,
      transferredCalls: 0,
      failedCalls: 0,
      avgDurationSeconds: 0
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'cmp_nz_fee_reminders',
    name: 'Outstanding Fee & Balance Notifications',
    status: 'draft',
    questionnaireId: 'qnr_multiple_choice_fee',
    targetGroups: ['Fee Reminders'],
    targetContactIds: [],
    callerId: '+1 737 250 8034',
    schedule: {
      startDate: new Date().toISOString().split('T')[0],
      startTime: '09:30',
      endTime: '16:30',
      timezone: 'Pacific/Auckland',
      callWindowDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
    },
    concurrencyLimit: 3,
    maxRetries: 2,
    retryDelayMinutes: 60,
    stats: {
      totalContacts: 0,
      completedCalls: 0,
      answeredCalls: 0,
      transferredCalls: 0,
      failedCalls: 0,
      avgDurationSeconds: 0
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'cmp_nz_ird_verification',
    name: 'Inland Revenue ID & Security Verification',
    status: 'draft',
    questionnaireId: 'qnr_numeric_ird_verify',
    targetGroups: ['Corporate Clients'],
    targetContactIds: [],
    callerId: '+1 737 250 8034',
    schedule: {
      startDate: new Date().toISOString().split('T')[0],
      startTime: '09:00',
      endTime: '17:00',
      timezone: 'Pacific/Auckland',
      callWindowDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
    },
    concurrencyLimit: 5,
    maxRetries: 2,
    retryDelayMinutes: 30,
    stats: {
      totalContacts: 0,
      completedCalls: 0,
      answeredCalls: 0,
      transferredCalls: 0,
      failedCalls: 0,
      avgDurationSeconds: 0
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'cmp_nz_csat_survey',
    name: 'Annual Practice CSAT & Quality Survey',
    status: 'draft',
    questionnaireId: 'qnr_rating_csat_survey',
    targetGroups: ['Customer Survey'],
    targetContactIds: [],
    callerId: '+1 737 250 8034',
    schedule: {
      startDate: new Date().toISOString().split('T')[0],
      startTime: '10:00',
      endTime: '16:00',
      timezone: 'Pacific/Auckland',
      callWindowDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
    },
    concurrencyLimit: 4,
    maxRetries: 1,
    retryDelayMinutes: 120,
    stats: {
      totalContacts: 0,
      completedCalls: 0,
      answeredCalls: 0,
      transferredCalls: 0,
      failedCalls: 0,
      avgDurationSeconds: 0
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'cmp_nz_master_flow',
    name: 'End-to-End Master Flow (All Input Types)',
    status: 'draft',
    questionnaireId: 'qnr_master_all_input_types',
    targetGroups: ['Corporate Clients'],
    targetContactIds: [],
    callerId: '+1 737 250 8034',
    schedule: {
      startDate: new Date().toISOString().split('T')[0],
      startTime: '09:00',
      endTime: '17:00',
      timezone: 'Pacific/Auckland',
      callWindowDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
    },
    concurrencyLimit: 5,
    maxRetries: 2,
    retryDelayMinutes: 30,
    stats: {
      totalContacts: 6,
      completedCalls: 0,
      answeredCalls: 0,
      transferredCalls: 0,
      failedCalls: 0,
      avgDurationSeconds: 0
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];



export const INITIAL_CALL_LOGS: CallLog[] = [];

export const INITIAL_AUDIT_LOGS: AuditLogItem[] = [
  {
    id: 'aud_init_1',
    action: 'System Initialized',
    performedBy: 'System Administrator (ADMIN)',
    category: 'System',
    details: 'Auckland Accounting automated outbound telephony platform loaded with practice flow templates.',
    timestamp: new Date().toISOString()
  }
];

