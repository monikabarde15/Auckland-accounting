import React, { useState, useMemo } from 'react';
import {
  Plus,
  Trash2,
  Edit2,
  Check,
  Volume2,
  GitBranch,
  ArrowRight,
  Hash,
  Star,
  PhoneForwarded,
  MessageSquare,
  Play,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Save,
  Settings2,
  LayoutTemplate,
  HelpCircle,
  Clock,
  RotateCcw,
  Sliders,
  CheckSquare
} from 'lucide-react';
import { Questionnaire, Question, QuestionType, QuestionOption, FlowValidationResult } from '../types';
import { speechService } from '../utils/speech';
import { validateFlowGraph } from '../utils/flowValidator';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  Button,
  Badge,
  Input,
  Modal,
  Drawer,
  PageHeader,
  Card,
  ConfirmDialog,
  EmptyState
} from './ui';

// Available Dynamic Variables for IVR Prompts
export const DYNAMIC_VARIABLES = [
  { tag: '{client_name}', label: 'Client Name', desc: 'Full contact name (e.g. John Doe)' },
  { tag: '{company_name}', label: 'Company Name', desc: 'Client business entity' },
  { tag: '{balance}', label: 'Balance Due', desc: 'Outstanding fee amount' },
  { tag: '{due_date}', label: 'Due Date', desc: 'Filing or payment deadline' },
  { tag: '{assigned_accountant}', label: 'Accountant', desc: 'Assigned practice staff member' },
  { tag: '{ird_number}', label: 'IRD Number', desc: 'New Zealand Inland Revenue ID' }
];

// Practice Starter Templates
interface FlowTemplate {
  id: string;
  title: string;
  category: Questionnaire['category'];
  description: string;
  icon: string;
  questions: Question[];
}

const PRACTICE_TEMPLATES: FlowTemplate[] = [
  {
    id: 'blank',
    title: 'Custom Blank Flow',
    category: 'General',
    description: 'Start from scratch and design a completely custom outbound IVR questionnaire.',
    icon: '✨',
    questions: [
      {
        id: 'q_step_1',
        name: 'Step 1: Introduction & Identity Check',
        type: 'yes_no',
        promptText: 'Kia Ora {client_name}, this is Auckland Accounting Services. Please confirm you are ready to proceed. Press 1 for Yes, or 2 for No.',
        options: [
          { id: 'opt_1', dtmfDigit: '1', label: 'Yes, proceed', nextQuestionId: 'END' },
          { id: 'opt_2', dtmfDigit: '2', label: 'No, speak to accountant', nextQuestionId: 'END' }
        ],
        timeoutSeconds: 6,
        maxRetries: 2,
        retryPromptText: 'Sorry, that response was not recognized. Please press 1 for Yes or 2 for No.'
      }
    ]
  },
  {
    id: 'gst_tax_return',
    title: 'GST & Tax Return Confirmation',
    category: 'Tax & Compliance',
    description: 'Confirm client tax draft review, collect filing authorization, or route to assigned accountant.',
    icon: '📋',
    questions: [
      {
        id: 'q_gst_1',
        name: 'Step 1: Draft Review Confirmation',
        type: 'yes_no',
        promptText: 'Kia Ora {client_name}, this is Auckland Accounting Services. Have you reviewed your latest GST filing draft? Press 1 for Yes, or 2 for No.',
        options: [
          { id: 'opt_gst_1_1', dtmfDigit: '1', label: 'Yes, draft reviewed', nextQuestionId: 'q_gst_2' },
          { id: 'opt_gst_1_2', dtmfDigit: '2', label: 'No, need assistance', nextQuestionId: 'q_gst_3' }
        ],
        timeoutSeconds: 6,
        maxRetries: 2,
        retryPromptText: 'Please press 1 if you have reviewed your draft, or 2 if you have not.'
      },
      {
        id: 'q_gst_2',
        name: 'Step 2: Filing Authorization',
        type: 'yes_no',
        promptText: 'Do you authorize Auckland Accounting Services to submit your return directly to the Inland Revenue Department? Press 1 to Authorize, or 2 to Request Changes.',
        options: [
          { id: 'opt_gst_2_1', dtmfDigit: '1', label: 'Authorize Submission', nextQuestionId: 'END' },
          { id: 'opt_gst_2_2', dtmfDigit: '2', label: 'Request Changes', nextQuestionId: 'q_gst_3' }
        ],
        timeoutSeconds: 6,
        maxRetries: 2,
        retryPromptText: 'Press 1 to authorize submission, or 2 to request changes with your accountant.'
      },
      {
        id: 'q_gst_3',
        name: 'Step 3: Transfer to Accountant',
        type: 'transfer',
        promptText: 'Understood. Transferring your call to your assigned accountant {assigned_accountant} now.',
        transferPhoneNumber: '',
        options: [],
        timeoutSeconds: 6,
        maxRetries: 1
      }
    ]
  },
  {
    id: 'payment_reminder',
    title: 'Fee Payment & Billing Follow-up',
    category: 'General',
    description: 'Notify clients of balance due, confirm payments made, or provide automated SMS invoice copies.',
    icon: '💳',
    questions: [
      {
        id: 'q_pay_1',
        name: 'Step 1: Balance Notification',
        type: 'multiple_choice',
        promptText: 'Kia Ora {client_name}, this is Auckland Accounting Services regarding an outstanding balance of ${balance} due on {due_date}. Press 1 if payment has already been sent, 2 to receive our bank account details, or 3 to speak with billing.',
        options: [
          { id: 'opt_pay_1', dtmfDigit: '1', label: 'Payment already made', nextQuestionId: 'q_pay_2' },
          { id: 'opt_pay_2', dtmfDigit: '2', label: 'Send bank details', nextQuestionId: 'q_pay_3' },
          { id: 'opt_pay_3', dtmfDigit: '3', label: 'Speak to billing team', nextQuestionId: 'q_pay_4' }
        ],
        timeoutSeconds: 6,
        maxRetries: 2,
        retryPromptText: 'Please press 1 for payment made, 2 for bank details, or 3 for live billing support.'
      },
      {
        id: 'q_pay_2',
        name: 'Step 2: Payment Confirmation',
        type: 'message_only',
        promptText: 'Thank you for confirming your payment. We will reconcile your account shortly. Have a great day.',
        options: [],
        timeoutSeconds: 4,
        maxRetries: 1
      },
      {
        id: 'q_pay_3',
        name: 'Step 3: Details Dispatched',
        type: 'message_only',
        promptText: 'Our payment instructions and invoice reference have been dispatched to your registered email. Thank you.',
        options: [],
        timeoutSeconds: 4,
        maxRetries: 1
      },
      {
        id: 'q_pay_4',
        name: 'Step 4: Billing Team Transfer',
        type: 'transfer',
        promptText: 'Connecting you with the practice accounts team now.',
        transferPhoneNumber: '',
        options: [],
        timeoutSeconds: 6,
        maxRetries: 1
      }
    ]
  },
  {
    id: 'satisfaction_survey',
    title: 'Client Quality & Satisfaction Survey',
    category: 'Customer Survey',
    description: 'Post-filing 1-5 star service rating scale with feedback collection.',
    icon: '⭐',
    questions: [
      {
        id: 'q_surv_1',
        name: 'Step 1: Service Satisfaction Score',
        type: 'rating_1_5',
        promptText: 'Kia Ora {client_name}, on a scale of 1 to 5, where 1 is poor and 5 is excellent, how satisfied are you with our accounting services?',
        options: [
          { id: 'opt_s_1', dtmfDigit: '1', label: '1 - Very Dissatisfied', nextQuestionId: 'q_surv_escalate' },
          { id: 'opt_s_2', dtmfDigit: '2', label: '2 - Dissatisfied', nextQuestionId: 'q_surv_escalate' },
          { id: 'opt_s_3', dtmfDigit: '3', label: '3 - Neutral', nextQuestionId: 'q_surv_thanks' },
          { id: 'opt_s_4', dtmfDigit: '4', label: '4 - Satisfied', nextQuestionId: 'q_surv_thanks' },
          { id: 'opt_s_5', dtmfDigit: '5', label: '5 - Very Satisfied', nextQuestionId: 'q_surv_thanks' }
        ],
        timeoutSeconds: 6,
        maxRetries: 2,
        retryPromptText: 'Please press a number from 1 to 5 on your telephone keypad.'
      },
      {
        id: 'q_surv_escalate',
        name: 'Step 2: Service Recovery Routing',
        type: 'transfer',
        promptText: 'We apologize that we did not meet your expectations. Routing you to our client relations manager now.',
        transferPhoneNumber: '',
        options: [],
        timeoutSeconds: 6,
        maxRetries: 1
      },
      {
        id: 'q_surv_thanks',
        name: 'Step 3: Survey Conclusion',
        type: 'message_only',
        promptText: 'Thank you for your valuable feedback. It helps Auckland Accounting Services continuously improve. Goodbye.',
        options: [],
        timeoutSeconds: 4,
        maxRetries: 1
      }
    ]
  },
  {
    id: 'numeric_ird',
    title: 'Inland Revenue ID & Security (Numeric)',
    category: 'Tax & Compliance',
    description: 'Multi-digit numeric collection (8-9 digit IRD number) finished by hash (#) key with email dispatch confirmation.',
    icon: '🔢',
    questions: [
      {
        id: 'q_ird_tpl_1',
        name: 'Step 1: IRD Number Keypad Entry',
        type: 'numeric',
        promptText: 'Kia Ora {client_name}, for security verification, please enter your 8 or 9 digit IRD number on your telephone keypad, followed by the hash key.',
        minDigits: 8,
        maxDigits: 9,
        finishOnKey: '#',
        defaultNextQuestionId: 'q_ird_tpl_2',
        options: [],
        timeoutSeconds: 10,
        maxRetries: 2,
        retryPromptText: 'Please enter your 8 or 9 digit IRD number on your keypad, followed by the hash key.'
      },
      {
        id: 'q_ird_tpl_2',
        name: 'Step 2: Statement Dispatch Confirmation',
        type: 'yes_no',
        promptText: 'Thank you. Your IRD number has been verified. Would you like a copy of your tax assessment summary emailed to you? Press 1 for Yes, or 2 for No.',
        options: [
          { id: 'opt_ird_tpl_1', dtmfDigit: '1', label: 'Yes, email summary', nextQuestionId: 'q_ird_tpl_3' },
          { id: 'opt_ird_tpl_2', dtmfDigit: '2', label: 'No, summary not needed', nextQuestionId: 'q_ird_tpl_4' }
        ],
        timeoutSeconds: 6,
        maxRetries: 2,
        retryPromptText: 'Please press 1 to receive your tax summary by email, or 2 to conclude.'
      },
      {
        id: 'q_ird_tpl_3',
        name: 'Step 3: Summary Statement Dispatched',
        type: 'message_only',
        promptText: 'Your tax assessment summary has been emailed to your address on file. Thank you for calling Auckland Accounting Services. Goodbye.',
        options: [],
        timeoutSeconds: 4,
        maxRetries: 1
      },
      {
        id: 'q_ird_tpl_4',
        name: 'Step 4: Verification Completed',
        type: 'message_only',
        promptText: 'Thank you for verifying your IRD details with Auckland Accounting Services. Have a great day. Goodbye.',
        options: [],
        timeoutSeconds: 4,
        maxRetries: 1
      }
    ]
  },
  {
    id: 'master_practice_flow',
    title: 'Complete Practice Master Flow (All Input Types)',
    category: 'General',
    description: 'Comprehensive end-to-end flow combining Numeric input, Multiple Choice menu, Yes/No decision, and Rating 1-5 scale.',
    icon: '🚀',
    questions: [
      {
        id: 'q_m_tpl_1',
        name: 'Step 1: Identity Verification (Numeric)',
        type: 'numeric',
        promptText: 'Kia Ora {client_name}, welcome to Auckland Accounting. Please enter your 8 or 9 digit IRD number, followed by hash.',
        minDigits: 8,
        maxDigits: 9,
        finishOnKey: '#',
        defaultNextQuestionId: 'q_m_tpl_2',
        options: [],
        timeoutSeconds: 10,
        maxRetries: 2,
        retryPromptText: 'Please enter your IRD number followed by hash.'
      },
      {
        id: 'q_m_tpl_2',
        name: 'Step 2: Service Selection (Multiple Choice)',
        type: 'multiple_choice',
        promptText: 'Thank you. Please choose your topic: Press 1 for Tax Filing, 2 for Fee Balance of {balance}, or 3 for Live Advisor.',
        options: [
          { id: 'opt_m_tpl_1', dtmfDigit: '1', label: 'Tax Filing Confirmation', nextQuestionId: 'q_m_tpl_3' },
          { id: 'opt_m_tpl_2', dtmfDigit: '2', label: 'Fee Balance Inquiry', nextQuestionId: 'q_m_tpl_4' },
          { id: 'opt_m_tpl_3', dtmfDigit: '3', label: 'Live Advisor Transfer', nextQuestionId: 'q_m_tpl_5' }
        ],
        timeoutSeconds: 7,
        maxRetries: 2,
        retryPromptText: 'Please press 1 for tax filing, 2 for fee balance, or 3 for live advisor.'
      },
      {
        id: 'q_m_tpl_3',
        name: 'Step 3: Direct Authorization (Yes / No)',
        type: 'yes_no',
        promptText: 'Do you confirm your tax return is ready for direct lodgement with IRD? Press 1 for Yes, or 2 for No.',
        options: [
          { id: 'opt_m_tpl_yes', dtmfDigit: '1', label: 'Yes, lodge return', nextQuestionId: 'q_m_tpl_6' },
          { id: 'opt_m_tpl_no', dtmfDigit: '2', label: 'No, speak to accountant', nextQuestionId: 'q_m_tpl_5' }
        ],
        timeoutSeconds: 6,
        maxRetries: 2,
        retryPromptText: 'Press 1 for Yes, or 2 for No.'
      },
      {
        id: 'q_m_tpl_4',
        name: 'Step 4: Balance Details & SMS (Announcement)',
        type: 'message_only',
        promptText: 'Your current account balance of {balance} is due on {due_date}. Statement details have been sent to your email. Thank you.',
        defaultNextQuestionId: 'q_m_tpl_6',
        options: [],
        timeoutSeconds: 4,
        maxRetries: 1
      },
      {
        id: 'q_m_tpl_5',
        name: 'Step 5: Staff Transfer (Transfer)',
        type: 'transfer',
        promptText: 'Transferring your call to your assigned accountant {assigned_accountant} now.',
        transferPhoneNumber: '',
        options: [],
        timeoutSeconds: 6,
        maxRetries: 1
      },
      {
        id: 'q_m_tpl_6',
        name: 'Step 6: Experience Rating (Rating 1-5)',
        type: 'rating_1_5',
        promptText: 'Before you go, please rate your telephone experience today from 1 to 5.',
        options: [
          { id: 'opt_m_tpl_r1', dtmfDigit: '1', label: '1 - Poor', nextQuestionId: 'q_m_tpl_7' },
          { id: 'opt_m_tpl_r2', dtmfDigit: '2', label: '2 - Fair', nextQuestionId: 'q_m_tpl_7' },
          { id: 'opt_m_tpl_r3', dtmfDigit: '3', label: '3 - Average', nextQuestionId: 'q_m_tpl_7' },
          { id: 'opt_m_tpl_r4', dtmfDigit: '4', label: '4 - Good', nextQuestionId: 'q_m_tpl_7' },
          { id: 'opt_m_tpl_r5', dtmfDigit: '5', label: '5 - Excellent', nextQuestionId: 'q_m_tpl_7' }
        ],
        timeoutSeconds: 6,
        maxRetries: 1,
        retryPromptText: 'Please press 1 through 5 on your telephone keypad.'
      },
      {
        id: 'q_m_tpl_7',
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

interface QuestionnaireBuilderProps {
  questionnaires: Questionnaire[];
  onSaveQuestionnaire: (q: Questionnaire) => void;
  onDeleteQuestionnaire: (id: string) => void;
  onRestoreDefaultFlows?: () => void;
  onTestFlowInSimulator?: (questionnaireId: string) => void;
  onTestQuestionnaire?: (q: Questionnaire) => void;
}

export const QuestionnaireBuilder: React.FC<QuestionnaireBuilderProps> = ({
  questionnaires,
  onSaveQuestionnaire,
  onDeleteQuestionnaire,
  onRestoreDefaultFlows,
  onTestFlowInSimulator,
  onTestQuestionnaire
}) => {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('questionnaires.create');
  const canEdit = hasPermission('questionnaires.edit');
  const canDelete = hasPermission('questionnaires.delete');
  const canSimulate = hasPermission('calls.execute');

  const [selectedQId, setSelectedQId] = useState<string>(questionnaires[0]?.id || '');
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [isEditingNew, setIsEditingNew] = useState<boolean>(false);
  const [isNewFlowModalOpen, setIsNewFlowModalOpen] = useState<boolean>(false);
  const [isFlowSettingsOpen, setIsFlowSettingsOpen] = useState<boolean>(false);
  const [flowToDelete, setFlowToDelete] = useState<Questionnaire | null>(null);
  const [questionToDelete, setQuestionToDelete] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);

  // Auto-sync selected flow ID
  React.useEffect(() => {
    if (questionnaires.length > 0) {
      if (!selectedQId || !questionnaires.some((q) => q.id === selectedQId)) {
        setSelectedQId(questionnaires[0].id);
      }
    }
  }, [questionnaires, selectedQId]);

  // New Flow Form State (Dynamic & Template-Driven)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('blank');
  const [newFlowForm, setNewFlowForm] = useState({
    title: '',
    category: 'Tax & Compliance' as Questionnaire['category'],
    description: '',
    initialPrompt: 'Kia Ora {client_name}, this is Auckland Accounting Services. Please confirm your details. Press 1 for Yes, 2 for No.',
    initialType: 'yes_no' as QuestionType
  });

  const [flowSettingsForm, setFlowSettingsForm] = useState({
    title: '',
    category: 'Tax & Compliance' as Questionnaire['category'],
    description: ''
  });

  const activeQuestionnaire = useMemo(() => {
    return questionnaires.find((q) => q.id === selectedQId) || questionnaires[0];
  }, [questionnaires, selectedQId]);

  // Flow Graph Validation
  const validation: FlowValidationResult = useMemo(() => {
    if (!activeQuestionnaire || !activeQuestionnaire.questions || activeQuestionnaire.questions.length === 0) {
      return {
        isValid: false,
        errors: [],
        warnings: [],
        summary: { totalQuestions: 0, reachableQuestions: 0, unreachableQuestions: 0, terminalQuestions: 0, hasCycle: false }
      };
    }
    return validateFlowGraph(activeQuestionnaire.questions, activeQuestionnaire.startingQuestionId);
  }, [activeQuestionnaire]);

  const handleTestFlow = (q: Questionnaire) => {
    if (onTestFlowInSimulator) onTestFlowInSimulator(q.id);
    if (onTestQuestionnaire) onTestQuestionnaire(q);
  };

  // Switch Template in Creation Modal
  const handleSelectTemplate = (tplId: string) => {
    setSelectedTemplateId(tplId);
    const template = PRACTICE_TEMPLATES.find((t) => t.id === tplId);
    if (!template) return;

    if (tplId === 'blank') {
      setNewFlowForm({
        title: '',
        category: 'Tax & Compliance',
        description: '',
        initialPrompt: 'Kia Ora {client_name}, this is Auckland Accounting Services. Please confirm your details. Press 1 for Yes, 2 for No.',
        initialType: 'yes_no'
      });
    } else {
      setNewFlowForm({
        title: template.title,
        category: template.category,
        description: template.description,
        initialPrompt: template.questions[0]?.promptText || '',
        initialType: template.questions[0]?.type || 'yes_no'
      });
    }
  };

  // Create Flow from Form / Template
  const handleCreateNewFlow = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newFlowForm.title.trim() || 'New Outbound IVR Flow';
    const flowId = `qnr_${Date.now()}`;
    const template = PRACTICE_TEMPLATES.find((t) => t.id === selectedTemplateId);

    let questionsToUse: Question[] = [];
    let startingId = '';

    if (template && selectedTemplateId !== 'blank') {
      // Clone questions from template with unique IDs
      const idMap = new Map<string, string>();
      template.questions.forEach((q) => {
        idMap.set(q.id, `q_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`);
      });

      questionsToUse = template.questions.map((q, idx) => {
        const newQId = idMap.get(q.id) || `q_${Date.now()}_${idx}`;
        const newOptions = (q.options || []).map((opt) => ({
          ...opt,
          id: `opt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          nextQuestionId: opt.nextQuestionId === 'END' ? 'END' : idMap.get(opt.nextQuestionId || '') || 'END'
        }));

        return {
          ...q,
          id: newQId,
          options: newOptions
        };
      });

      startingId = questionsToUse[0]?.id || '';
    } else {
      // Custom first step
      const startQId = `q_${Date.now()}_1`;
      let initialOptions: QuestionOption[] = [];

      if (newFlowForm.initialType === 'yes_no') {
        initialOptions = [
          { id: `opt_${Date.now()}_1`, dtmfDigit: '1', label: 'Yes, proceed', nextQuestionId: 'END' },
          { id: `opt_${Date.now()}_2`, dtmfDigit: '2', label: 'No, speak to accountant', nextQuestionId: 'END' }
        ];
      } else if (newFlowForm.initialType === 'rating_1_5') {
        initialOptions = [
          { id: `opt_${Date.now()}_1`, dtmfDigit: '1', label: '1 - Poor', nextQuestionId: 'END' },
          { id: `opt_${Date.now()}_2`, dtmfDigit: '2', label: '2 - Fair', nextQuestionId: 'END' },
          { id: `opt_${Date.now()}_3`, dtmfDigit: '3', label: '3 - Average', nextQuestionId: 'END' },
          { id: `opt_${Date.now()}_4`, dtmfDigit: '4', label: '4 - Good', nextQuestionId: 'END' },
          { id: `opt_${Date.now()}_5`, dtmfDigit: '5', label: '5 - Excellent', nextQuestionId: 'END' }
        ];
      } else if (newFlowForm.initialType === 'multiple_choice') {
        initialOptions = [
          { id: `opt_${Date.now()}_1`, dtmfDigit: '1', label: 'Option 1', nextQuestionId: 'END' },
          { id: `opt_${Date.now()}_2`, dtmfDigit: '2', label: 'Option 2', nextQuestionId: 'END' }
        ];
      }

      const initialQuestion: Question = {
        id: startQId,
        name: 'Step 1: Initial Prompt',
        type: newFlowForm.initialType,
        promptText: newFlowForm.initialPrompt.trim() || 'Kia Ora {client_name}, this is Auckland Accounting Services. Please confirm your details.',
        options: initialOptions,
        transferPhoneNumber: newFlowForm.initialType === 'transfer' ? '' : undefined,
        timeoutSeconds: 6,
        maxRetries: 2,
        retryPromptText: 'Sorry, that was not recognized. Please try again.'
      };

      questionsToUse = [initialQuestion];
      startingId = startQId;
    }

    const newQuestionnaire: Questionnaire = {
      id: flowId,
      title,
      category: newFlowForm.category,
      description: newFlowForm.description.trim() || 'Custom practice outbound call flow.',
      startingQuestionId: startingId,
      questions: questionsToUse,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    onSaveQuestionnaire(newQuestionnaire);
    setSelectedQId(flowId);
    setIsNewFlowModalOpen(false);

    // Reset Form
    setSelectedTemplateId('blank');
    setNewFlowForm({
      title: '',
      category: 'Tax & Compliance',
      description: '',
      initialPrompt: 'Kia Ora {client_name}, this is Auckland Accounting Services. Please confirm your details. Press 1 for Yes, 2 for No.',
      initialType: 'yes_no'
    });

    try {
      await api.createQuestionnaire({
        title: newQuestionnaire.title,
        category: newQuestionnaire.category,
        description: newQuestionnaire.description
      });
    } catch {
      // Handled
    }
  };

  // Save Flow
  const handleSaveFlow = async () => {
    if (!activeQuestionnaire) return;
    setIsSaving(true);
    try {
      const updatedQ: Questionnaire = {
        ...activeQuestionnaire,
        updatedAt: new Date().toISOString()
      };
      onSaveQuestionnaire(updatedQ);

      try {
        await api.updateQuestionnaire(activeQuestionnaire.id, {
          title: activeQuestionnaire.title,
          description: activeQuestionnaire.description,
          category: activeQuestionnaire.category,
          startingQuestionId: activeQuestionnaire.startingQuestionId
        });
      } catch {
        // Handled
      }
      setSaveSuccessMessage('Questionnaire saved successfully.');
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveSuccessMessage(null), 3000);
    }
  };

  // Add Question Step
  const handleAddQuestion = () => {
    if (!activeQuestionnaire) return;
    const newId = `q_${Date.now()}`;
    const stepNumber = activeQuestionnaire.questions.length + 1;
    const newQ: Question = {
      id: newId,
      name: `Step ${stepNumber}: Follow-up Step`,
      type: 'yes_no',
      promptText: 'Kia Ora {client_name}, please confirm if you would like us to proceed. Press 1 for Yes, 2 for No.',
      options: [
        { id: `opt_${Date.now()}_1`, dtmfDigit: '1', label: 'Yes, proceed', nextQuestionId: 'END' },
        { id: `opt_${Date.now()}_2`, dtmfDigit: '2', label: 'No, speak with accountant', nextQuestionId: 'END' }
      ],
      timeoutSeconds: 6,
      maxRetries: 2,
      retryPromptText: 'Sorry, that was not recognized. Please press 1 for Yes or 2 for No.'
    };
    setEditingQuestion(newQ);
    setIsEditingNew(true);
  };

  // Save Question from Drawer
  const handleSaveQuestionForm = (savedQ: Question) => {
    if (!activeQuestionnaire) return;
    let updatedQuestions: Question[];
    if (isEditingNew) {
      // If previous question's first option pointed to 'END', auto-connect it to the new question
      const prevIdx = activeQuestionnaire.questions.length - 1;
      let questionsCopy = [...activeQuestionnaire.questions];
      if (prevIdx >= 0) {
        const prevQ = questionsCopy[prevIdx];
        const updatedOpts = (prevQ.options || []).map((opt, i) => {
          if (i === 0 && (opt.nextQuestionId === 'END' || !opt.nextQuestionId)) {
            return { ...opt, nextQuestionId: savedQ.id };
          }
          return opt;
        });
        questionsCopy[prevIdx] = { ...prevQ, options: updatedOpts };
      }
      updatedQuestions = [...questionsCopy, savedQ];
    } else {
      updatedQuestions = activeQuestionnaire.questions.map((q) => (q.id === savedQ.id ? savedQ : q));
    }

    const updatedQ: Questionnaire = {
      ...activeQuestionnaire,
      questions: updatedQuestions,
      startingQuestionId: activeQuestionnaire.startingQuestionId || savedQ.id,
      updatedAt: new Date().toISOString()
    };

    onSaveQuestionnaire(updatedQ);
    setEditingQuestion(null);
  };

  // Delete Question
  const handleDeleteQuestion = () => {
    if (!activeQuestionnaire || !questionToDelete) return;
    if (activeQuestionnaire.questions.length <= 1) {
      alert('A flow must have at least one step.');
      setQuestionToDelete(null);
      return;
    }
    const updatedQuestions = activeQuestionnaire.questions.filter((q) => q.id !== questionToDelete);
    let newStart = activeQuestionnaire.startingQuestionId;
    if (newStart === questionToDelete) {
      newStart = updatedQuestions[0]?.id || '';
    }

    onSaveQuestionnaire({
      ...activeQuestionnaire,
      questions: updatedQuestions,
      startingQuestionId: newStart,
      updatedAt: new Date().toISOString()
    });
    setQuestionToDelete(null);
  };

  // Delete Flow
  const handleDeleteFlow = () => {
    if (!flowToDelete) return;
    const deletedId = flowToDelete.id;
    onDeleteQuestionnaire(deletedId);
    const remaining = questionnaires.filter((q) => q.id !== deletedId);
    if (remaining.length > 0) {
      setSelectedQId(remaining[0].id);
    } else {
      setSelectedQId('');
    }
    setFlowToDelete(null);
  };

  const getTypeBadge = (type: QuestionType) => {
    switch (type) {
      case 'yes_no':
        return <Badge variant="success" size="sm">Yes / No</Badge>;
      case 'rating_1_5':
        return <Badge variant="warning" size="sm">Rating 1-5</Badge>;
      case 'numeric':
        return <Badge variant="info" size="sm">Numeric Digits</Badge>;
      case 'multiple_choice':
        return <Badge variant="brand" size="sm">Multiple Choice</Badge>;
      case 'message_only':
        return <Badge variant="neutral" size="sm">Announcement</Badge>;
      case 'transfer':
        return <Badge variant="info" size="sm">Live Transfer</Badge>;
      default:
        return <Badge variant="neutral" size="sm">{type}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="IVR Questionnaires"
        description="Configure interactive voice response steps, DTMF answer options, and conditional branching logic."
        actions={
          <div className="flex items-center gap-2">
            {activeQuestionnaire && (
              <>
                {canSimulate && onTestFlowInSimulator && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTestFlow(activeQuestionnaire)}
                    leftIcon={<Play className="w-3.5 h-3.5 text-emerald-600" />}
                  >
                    Test Simulator
                  </Button>
                )}
                {canEdit && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSaveFlow}
                    isLoading={isSaving}
                    leftIcon={<Save className="w-3.5 h-3.5" />}
                  >
                    Save Flow
                  </Button>
                )}
              </>
            )}
            {canCreate && (
              <Button
                variant={activeQuestionnaire ? 'outline' : 'primary'}
                size="sm"
                onClick={() => setIsNewFlowModalOpen(true)}
                leftIcon={<Plus className="w-3.5 h-3.5" />}
              >
                New Flow
              </Button>
            )}
          </div>
        }
      />

      {saveSuccessMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs px-3.5 py-2 rounded-lg flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{saveSuccessMessage}</span>
        </div>
      )}

      {!activeQuestionnaire ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8">
          <EmptyState
            title="No Questionnaire Flows"
            description="Create your first questionnaire flow using practice templates or load the standard testing flows covering all input types."
            action={
              <div className="flex items-center gap-2">
                {canCreate && onRestoreDefaultFlows && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={onRestoreDefaultFlows}
                    leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                  >
                    Load All Practice Flows
                  </Button>
                )}
                {canCreate && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsNewFlowModalOpen(true)}
                    leftIcon={<Plus className="w-3.5 h-3.5" />}
                  >
                    Create Custom Flow
                  </Button>
                )}
              </div>
            }
          />
        </div>
      ) : (
        /* Two Column Layout: Left Flow List (260px) + Right Canvas */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Questionnaire Selection Panel */}
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Flows ({questionnaires.length})</span>
              <div className="flex items-center gap-1">
                {canCreate && onRestoreDefaultFlows && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={onRestoreDefaultFlows}
                    title="Restore full suite of practice test flows"
                    leftIcon={<RotateCcw className="w-3 h-3 text-slate-500" />}
                  >
                    Reset Flows
                  </Button>
                )}
                {canCreate && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setIsNewFlowModalOpen(true)}
                    leftIcon={<Plus className="w-3 h-3" />}
                  >
                    New Flow
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-1.5 max-h-[550px] overflow-y-auto">
              {questionnaires.map((q) => {
                const isSelected = q.id === selectedQId;
                return (
                  <div
                    key={q.id}
                    onClick={() => setSelectedQId(q.id)}
                    className={`p-2.5 rounded-lg border text-left cursor-pointer transition-colors ${
                      isSelected
                        ? 'border-[#0f2e4a] bg-blue-50/40 ring-1 ring-[#0f2e4a]'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-xs text-slate-900 leading-tight">{q.title}</div>
                      <Badge variant="neutral" size="sm">{q.questions.length} steps</Badge>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1 line-clamp-1">{q.category} · {q.description}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Flow Canvas & Steps */}
          <div className="lg:col-span-8 space-y-4">
            {/* Active Flow Header & Graph Validation Status */}
            <Card padding="sm" className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-slate-900">{activeQuestionnaire.title}</h2>
                    <Badge variant="brand" size="sm">{activeQuestionnaire.category}</Badge>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{activeQuestionnaire.description}</p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {canEdit && (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => {
                        setFlowSettingsForm({
                          title: activeQuestionnaire.title,
                          category: activeQuestionnaire.category,
                          description: activeQuestionnaire.description || ''
                        });
                        setIsFlowSettingsOpen(true);
                      }}
                      leftIcon={<Settings2 className="w-3 h-3 text-slate-500" />}
                    >
                      Settings
                    </Button>
                  )}
                  {canDelete && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setFlowToDelete(activeQuestionnaire)}
                      className="text-red-600 hover:bg-red-50 hover:text-red-700"
                      leftIcon={<Trash2 className="w-3 h-3" />}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>

              {/* Validation & Entry Node Bar */}
              <div className="pt-2.5 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 font-medium">Start Step:</span>
                  <select
                    disabled={!canEdit}
                    value={activeQuestionnaire.startingQuestionId || activeQuestionnaire.questions[0]?.id || ''}
                    onChange={(e) => {
                      if (!canEdit) return;
                      onSaveQuestionnaire({
                        ...activeQuestionnaire,
                        startingQuestionId: e.target.value,
                        updatedAt: new Date().toISOString()
                      });
                    }}
                    className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0f2e4a] disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    {activeQuestionnaire.questions.map((q, idx) => (
                      <option key={q.id} value={q.id}>
                        Step {idx + 1}: {q.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  {validation.isValid ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Flow graph valid ({validation.summary.reachableQuestions} reachable steps)</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-red-700 text-xs font-medium">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>{validation.errors[0]?.message || 'Flow has validation errors'}</span>
                    </span>
                  )}
                </div>
              </div>
            </Card>

            {/* Question Step Cards */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Question Flow Steps ({activeQuestionnaire.questions.length})
                </span>
                {canEdit && (
                  <Button
                    variant="primary"
                    size="xs"
                    onClick={handleAddQuestion}
                    leftIcon={<Plus className="w-3 h-3" />}
                  >
                    Add Step
                  </Button>
                )}
              </div>

              {activeQuestionnaire.questions.map((q, idx) => {
                const isStartNode = (activeQuestionnaire.startingQuestionId || activeQuestionnaire.questions[0]?.id) === q.id;

                return (
                  <div
                    key={q.id}
                    className={`bg-white border rounded-lg p-4 transition-colors ${
                      isStartNode ? 'border-slate-300 ring-1 ring-slate-200' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="w-6 h-6 rounded bg-slate-100 text-slate-700 font-mono font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                          {idx + 1}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-slate-900 text-sm">{q.name}</span>
                            {isStartNode && <Badge variant="brand" size="sm">Start Step</Badge>}
                            {getTypeBadge(q.type)}
                          </div>
                          <p className="text-xs text-slate-700 mt-1 italic leading-relaxed">
                            "{q.promptText}"
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => speechService.speak(q.promptText || '')}
                          title="Preview Speech Audio"
                          className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                        </button>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingQuestion(q);
                              setIsEditingNew(false);
                            }}
                            title="Edit Question & Branches"
                            className="p-1 rounded text-slate-400 hover:text-[#0f2e4a] hover:bg-slate-100 transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => setQuestionToDelete(q.id)}
                            title="Delete Question Step"
                            className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Branching Destinations */}
                    <div className="mt-3 pt-2.5 border-t border-slate-100 text-xs">
                      {q.type === 'message_only' ? (
                        <div className="text-slate-500 flex items-center gap-1">
                          <ArrowRight className="w-3 h-3 text-slate-400" />
                          <span>Speaks announcement and terminates call.</span>
                        </div>
                      ) : q.type === 'transfer' ? (
                        <div className="text-blue-700 font-medium flex items-center gap-1">
                          <PhoneForwarded className="w-3.5 h-3.5" />
                          <span>Transfers live call to: {q.transferPhoneNumber || 'Assigned Accountant'}</span>
                        </div>
                      ) : q.type === 'numeric' ? (
                        <div className="p-2 bg-slate-50 rounded border border-slate-200 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5 text-slate-700">
                            <Hash className="w-3.5 h-3.5 text-[#0f2e4a]" />
                            <span>Collects {q.minDigits ?? 1}–{q.maxDigits ?? 9} digits (finish on {q.finishOnKey || '#'})</span>
                          </div>
                          <div className="flex items-center gap-1 text-[11px]">
                            <span className="text-slate-500">Then:</span>
                            <ArrowRight className="w-3 h-3 text-slate-400" />
                            {q.defaultNextQuestionId === 'REPEAT' ? (
                              <span className="text-amber-700 font-medium">Repeat Step</span>
                            ) : q.defaultNextQuestionId === 'END' || !q.defaultNextQuestionId ? (
                              <span className="text-red-700 font-medium">End Call</span>
                            ) : (
                              <span className="text-blue-700 font-medium">
                                {activeQuestionnaire.questions.find((x) => x.id === q.defaultNextQuestionId)?.name || q.defaultNextQuestionId}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {(q.options || []).map((opt) => {
                            const targetQ = activeQuestionnaire.questions.find((x) => x.id === opt.nextQuestionId);
                            const isRepeat = opt.nextQuestionId === 'REPEAT';
                            const isEnd = opt.nextQuestionId === 'END' || !opt.nextQuestionId;

                            return (
                              <div
                                key={opt.id}
                                className="p-2 bg-slate-50 rounded border border-slate-200 flex items-center justify-between gap-2"
                              >
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="w-4 h-4 rounded bg-slate-200 text-slate-700 font-mono font-bold text-[10px] flex items-center justify-center shrink-0">
                                    {opt.dtmfDigit}
                                  </span>
                                  <span className="font-medium text-slate-800 truncate">{opt.label}</span>
                                </div>
                                <div className="flex items-center gap-1 text-[11px] shrink-0">
                                  <ArrowRight className="w-3 h-3 text-slate-400" />
                                  {isRepeat ? (
                                    <span className="text-amber-700 font-medium">Repeat Step</span>
                                  ) : isEnd ? (
                                    <span className="text-red-700 font-medium">End Call</span>
                                  ) : (
                                    <span className="text-blue-700 font-medium">{targetQ?.name || opt.nextQuestionId}</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Slide-Over Question & Branches Editor Drawer */}
      {editingQuestion && activeQuestionnaire && (
        <QuestionEditDrawer
          question={editingQuestion}
          allQuestions={activeQuestionnaire.questions}
          onSave={handleSaveQuestionForm}
          onClose={() => setEditingQuestion(null)}
        />
      )}

      {/* Modal: Create New Flow with Dynamic Templates & Custom Mode */}
      {isNewFlowModalOpen && (
        <Modal
          isOpen={isNewFlowModalOpen}
          onClose={() => setIsNewFlowModalOpen(false)}
          size="lg"
          title="Create New Questionnaire Flow"
          description="Select a standard practice template or start with a custom outbound IVR questionnaire."
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button variant="outline" size="sm" onClick={() => setIsNewFlowModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={handleCreateNewFlow}>
                Create Flow
              </Button>
            </div>
          }
        >
          <form onSubmit={handleCreateNewFlow} className="space-y-4 text-xs">
            {/* Template Selector Grid */}
            <div>
              <label className="block text-xs font-semibold text-slate-800 mb-1.5">
                Starter Template
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PRACTICE_TEMPLATES.map((tpl) => {
                  const isSelected = selectedTemplateId === tpl.id;
                  return (
                    <div
                      key={tpl.id}
                      onClick={() => handleSelectTemplate(tpl.id)}
                      className={`p-2.5 rounded-lg border cursor-pointer transition-all ${
                        isSelected
                          ? 'border-[#0f2e4a] bg-blue-50/50 ring-1 ring-[#0f2e4a]'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-base">{tpl.icon}</span>
                        <div className="font-semibold text-slate-900 text-xs">{tpl.title}</div>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                        {tpl.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Flow Metadata */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
              <Input
                label="Flow Title *"
                required
                value={newFlowForm.title}
                onChange={(e) => setNewFlowForm({ ...newFlowForm, title: e.target.value })}
                placeholder="e.g. GST Filing Confirmation 2026"
              />
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
                <select
                  value={newFlowForm.category}
                  onChange={(e) => setNewFlowForm({ ...newFlowForm, category: e.target.value as any })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-[#0f2e4a]"
                >
                  <option value="Tax & Compliance">Tax & Compliance</option>
                  <option value="Audit">Audit</option>
                  <option value="Customer Survey">Customer Survey</option>
                  <option value="Payroll & PAYE">Payroll & PAYE</option>
                  <option value="General">General</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
              <textarea
                rows={2}
                value={newFlowForm.description}
                onChange={(e) => setNewFlowForm({ ...newFlowForm, description: e.target.value })}
                placeholder="Briefly describe the purpose of this call flow..."
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#0f2e4a]"
              />
            </div>

            {/* First Step Customization (when Blank template selected) */}
            {selectedTemplateId === 'blank' && (
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800 text-xs flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#0f2e4a]" />
                    Initial Step Configuration
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-500 text-[11px]">Type:</span>
                    <select
                      value={newFlowForm.initialType}
                      onChange={(e) => setNewFlowForm({ ...newFlowForm, initialType: e.target.value as QuestionType })}
                      className="px-2 py-0.5 bg-white border border-slate-300 rounded text-xs font-medium text-slate-800"
                    >
                      <option value="yes_no">Yes / No (Press 1 or 2)</option>
                      <option value="multiple_choice">Multiple Choice</option>
                      <option value="rating_1_5">Rating 1-5 Scale</option>
                      <option value="message_only">Announcement Only</option>
                      <option value="transfer">Live Staff Transfer</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-medium text-slate-700">Spoken Prompt Text</label>
                    <div className="flex items-center gap-1 text-[10px] text-slate-600">
                      <span>Insert:</span>
                      {DYNAMIC_VARIABLES.slice(0, 3).map((v) => (
                        <button
                          key={v.tag}
                          type="button"
                          onClick={() => setNewFlowForm((prev) => ({ ...prev, initialPrompt: prev.initialPrompt + ' ' + v.tag }))}
                          className="px-1.5 py-0.5 bg-white border border-slate-200 hover:bg-slate-100 rounded text-slate-700"
                        >
                          {v.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    rows={2}
                    value={newFlowForm.initialPrompt}
                    onChange={(e) => setNewFlowForm({ ...newFlowForm, initialPrompt: e.target.value })}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#0f2e4a]"
                  />
                  <div className="flex items-center justify-end mt-1">
                    <button
                      type="button"
                      onClick={() => speechService.speak(newFlowForm.initialPrompt)}
                      className="text-[11px] text-[#0f2e4a] hover:underline flex items-center gap-1"
                    >
                      <Volume2 className="w-3 h-3" /> Test Voice Audio
                    </button>
                  </div>
                </div>
              </div>
            )}
          </form>
        </Modal>
      )}

      {/* Modal: Flow Settings */}
      {isFlowSettingsOpen && activeQuestionnaire && (
        <Modal
          isOpen={isFlowSettingsOpen}
          onClose={() => setIsFlowSettingsOpen(false)}
          size="md"
          title="Questionnaire Flow Settings"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button variant="outline" size="sm" onClick={() => setIsFlowSettingsOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  onSaveQuestionnaire({
                    ...activeQuestionnaire,
                    title: flowSettingsForm.title.trim(),
                    category: flowSettingsForm.category,
                    description: flowSettingsForm.description.trim(),
                    updatedAt: new Date().toISOString()
                  });
                  setIsFlowSettingsOpen(false);
                }}
              >
                Save Settings
              </Button>
            </div>
          }
        >
          <div className="space-y-3 text-xs">
            <Input
              label="Flow Title"
              value={flowSettingsForm.title}
              onChange={(e) => setFlowSettingsForm({ ...flowSettingsForm, title: e.target.value })}
            />
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
              <select
                value={flowSettingsForm.category}
                onChange={(e) => setFlowSettingsForm({ ...flowSettingsForm, category: e.target.value as any })}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-[#0f2e4a]"
              >
                <option value="Tax & Compliance">Tax & Compliance</option>
                <option value="Audit">Audit</option>
                <option value="Customer Survey">Customer Survey</option>
                <option value="Payroll & PAYE">Payroll & PAYE</option>
                <option value="General">General</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
              <textarea
                rows={2}
                value={flowSettingsForm.description}
                onChange={(e) => setFlowSettingsForm({ ...flowSettingsForm, description: e.target.value })}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#0f2e4a]"
              />
            </div>
          </div>
        </Modal>
      )}



      {/* Confirm Flow Deletion */}
      {flowToDelete && (
        <ConfirmDialog
          isOpen={!!flowToDelete}
          onClose={() => setFlowToDelete(null)}
          onConfirm={handleDeleteFlow}
          title="Delete Questionnaire Flow"
          message={`Are you sure you want to delete "${flowToDelete.title}"? This cannot be undone.`}
        />
      )}

      {/* Confirm Question Deletion */}
      {questionToDelete && (
        <ConfirmDialog
          isOpen={!!questionToDelete}
          onClose={() => setQuestionToDelete(null)}
          onConfirm={handleDeleteQuestion}
          title="Delete Step"
          message="Are you sure you want to delete this step from the flow?"
        />
      )}
    </div>
  );
};

// ==========================================
// Question Edit Drawer Subcomponent (Dynamic & User-Friendly)
// ==========================================
interface QuestionEditDrawerProps {
  question: Question;
  allQuestions: Question[];
  onSave: (q: Question) => void;
  onClose: () => void;
}

const QuestionEditDrawer: React.FC<QuestionEditDrawerProps> = ({ question, allQuestions, onSave, onClose }) => {
  const [formData, setFormData] = useState<Question>({ ...question });
  const [showAdvancedSettings, setShowAdvancedSettings] = useState<boolean>(false);

  // Dynamic Type Switching with Auto-Configured Defaults
  const handleTypeChange = (newType: QuestionType) => {
    let newOptions = formData.options || [];

    if (newType === 'yes_no') {
      newOptions = [
        { id: `opt_${Date.now()}_1`, dtmfDigit: '1', label: 'Yes, proceed', nextQuestionId: 'END' },
        { id: `opt_${Date.now()}_2`, dtmfDigit: '2', label: 'No, speak to accountant', nextQuestionId: 'END' }
      ];
    } else if (newType === 'rating_1_5') {
      newOptions = [
        { id: `opt_${Date.now()}_1`, dtmfDigit: '1', label: '1 - Poor', nextQuestionId: 'END' },
        { id: `opt_${Date.now()}_2`, dtmfDigit: '2', label: '2 - Fair', nextQuestionId: 'END' },
        { id: `opt_${Date.now()}_3`, dtmfDigit: '3', label: '3 - Average', nextQuestionId: 'END' },
        { id: `opt_${Date.now()}_4`, dtmfDigit: '4', label: '4 - Good', nextQuestionId: 'END' },
        { id: `opt_${Date.now()}_5`, dtmfDigit: '5', label: '5 - Excellent', nextQuestionId: 'END' }
      ];
    } else if (newType === 'message_only' || newType === 'transfer') {
      newOptions = [];
    } else if (newType === 'multiple_choice' && newOptions.length === 0) {
      newOptions = [
        { id: `opt_${Date.now()}_1`, dtmfDigit: '1', label: 'Option 1', nextQuestionId: 'END' },
        { id: `opt_${Date.now()}_2`, dtmfDigit: '2', label: 'Option 2', nextQuestionId: 'END' }
      ];
    }

    setFormData((prev) => ({
      ...prev,
      type: newType,
      options: newOptions,
      transferPhoneNumber: newType === 'transfer' ? (prev.transferPhoneNumber || '') : prev.transferPhoneNumber
    }));
  };

  const handleAddOption = () => {
    const nextDigit = String((formData.options?.length || 0) + 1);
    const newOpt: QuestionOption = {
      id: `opt_${Date.now()}`,
      dtmfDigit: nextDigit,
      label: `Option ${nextDigit}`,
      nextQuestionId: 'END'
    };
    setFormData((prev) => ({
      ...prev,
      options: [...(prev.options || []), newOpt]
    }));
  };

  const handleRemoveOption = (optId: string) => {
    setFormData((prev) => ({
      ...prev,
      options: (prev.options || []).filter((o) => o.id !== optId)
    }));
  };

  const handleUpdateOption = (optId: string, updates: Partial<QuestionOption>) => {
    setFormData((prev) => ({
      ...prev,
      options: (prev.options || []).map((o) => (o.id === optId ? { ...o, ...updates } : o))
    }));
  };

  const handleInsertVariable = (varTag: string) => {
    setFormData((prev) => ({
      ...prev,
      promptText: (prev.promptText ? prev.promptText + ' ' : '') + varTag
    }));
  };

  return (
    <Drawer
      isOpen={true}
      onClose={onClose}
      size="md"
      title="Configure Step & Branching"
      subtitle="Define spoken prompt, response options, and target destinations."
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={() => onSave(formData)}>
            Save Step
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-xs">
        <Input
          label="Step Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="e.g. Identity Verification"
        />

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Question Type</label>
          <select
            value={formData.type}
            onChange={(e) => handleTypeChange(e.target.value as QuestionType)}
            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-[#0f2e4a]"
          >
            <option value="yes_no">Yes / No (Press 1 or 2)</option>
            <option value="multiple_choice">Multiple Choice (DTMF Menu)</option>
            <option value="rating_1_5">Rating Scale (1 to 5)</option>
            <option value="numeric">Numeric Digits Input (PIN/IRD)</option>
            <option value="message_only">Announcement Only (Terminates)</option>
            <option value="transfer">Transfer Call to Staff</option>
          </select>
        </div>

        {/* Spoken Prompt Section with Dynamic Variables */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium text-slate-700">Spoken Prompt Text</label>
            <button
              type="button"
              onClick={() => speechService.speak(formData.promptText || '')}
              className="text-[11px] text-[#0f2e4a] hover:underline font-medium flex items-center gap-1"
            >
              <Volume2 className="w-3.5 h-3.5" /> Listen Audio
            </button>
          </div>

          {/* Dynamic Variable Chips */}
          <div className="mb-2 p-2 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
            <div className="flex items-center gap-1 text-[11px] text-slate-600 font-medium">
              <Sparkles className="w-3 h-3 text-[#0f2e4a]" />
              <span>Click to Insert Dynamic Client Field:</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {DYNAMIC_VARIABLES.map((v) => (
                <button
                  key={v.tag}
                  type="button"
                  onClick={() => handleInsertVariable(v.tag)}
                  title={v.desc}
                  className="px-2 py-0.5 bg-white border border-slate-300 hover:border-slate-400 hover:bg-slate-100 rounded text-[11px] font-mono text-slate-700 transition-colors"
                >
                  {v.tag}
                </button>
              ))}
            </div>
          </div>

          <textarea
            rows={3}
            value={formData.promptText}
            onChange={(e) => setFormData({ ...formData, promptText: e.target.value })}
            placeholder="Type what the synthetic voice will speak to the caller..."
            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#0f2e4a]"
          />
        </div>

        {formData.type === 'transfer' && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-900">
              <PhoneForwarded className="w-3.5 h-3.5" />
              <span>Live Call Transfer Configuration</span>
            </div>
            <Input
              label="Transfer Destination Number"
              value={formData.transferPhoneNumber || ''}
              onChange={(e) => setFormData({ ...formData, transferPhoneNumber: e.target.value })}
              placeholder="+64 9 837 0000"
            />
            <p className="text-[11px] text-blue-700">
              When the caller reaches this step, the platform will bridge the call to the specified practice telephone number.
            </p>
          </div>
        )}

        {formData.type === 'message_only' && (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 text-xs flex items-start gap-2">
            <MessageSquare className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
            <span>This is an announcement step. Once the prompt is spoken, the call will conclude and disconnect cleanly.</span>
          </div>
        )}

        {formData.type === 'numeric' && (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
              <Hash className="w-3.5 h-3.5 text-[#0f2e4a]" />
              <span>Numeric Keypad Collection Configuration</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Collects numerical keypad entry (e.g. IRD number, reference PIN, or dollar amount) from caller.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="number"
                label="Min Required Digits"
                value={formData.minDigits ?? 1}
                onChange={(e) => setFormData({ ...formData, minDigits: Number(e.target.value) || 1 })}
              />
              <Input
                type="number"
                label="Max Allowed Digits"
                value={formData.maxDigits ?? 9}
                onChange={(e) => setFormData({ ...formData, maxDigits: Number(e.target.value) || 9 })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Terminating Key (Finish On)</label>
              <select
                value={formData.finishOnKey || '#'}
                onChange={(e) => setFormData({ ...formData, finishOnKey: e.target.value })}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs font-mono font-bold text-slate-800"
              >
                <option value="#"># (Hash / Pound Key)</option>
                <option value="*">* (Star Key)</option>
                <option value="">None (auto-submit on max digits)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">After Digits Entered, Jump to:</label>
              <select
                value={formData.defaultNextQuestionId || 'END'}
                onChange={(e) => setFormData({ ...formData, defaultNextQuestionId: e.target.value })}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs font-medium text-slate-800"
              >
                <option value="END">End Call (Terminal)</option>
                <option value="REPEAT">Repeat This Step / Menu</option>
                {allQuestions
                  .filter((q) => q.id !== formData.id)
                  .map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        )}

        {formData.type !== 'message_only' && formData.type !== 'transfer' && formData.type !== 'numeric' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-slate-700">DTMF Options & Branching Targets</label>
              {formData.type === 'multiple_choice' && (
                <button
                  type="button"
                  onClick={handleAddOption}
                  className="text-xs text-[#0f2e4a] hover:underline font-medium flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Add Option
                </button>
              )}
            </div>

            <div className="space-y-2">
              {(formData.options || []).map((opt) => (
                <div key={opt.id} className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={opt.dtmfDigit}
                      onChange={(e) => handleUpdateOption(opt.id, { dtmfDigit: e.target.value })}
                      className="w-8 px-1.5 py-1 bg-white border border-slate-300 rounded text-center text-xs font-mono font-bold"
                      placeholder="1"
                    />
                    <input
                      type="text"
                      value={opt.label}
                      onChange={(e) => handleUpdateOption(opt.id, { label: e.target.value })}
                      className="flex-1 px-2.5 py-1 bg-white border border-slate-300 rounded text-xs"
                      placeholder="Option label"
                    />
                    {formData.type === 'multiple_choice' && (
                      <button
                        type="button"
                        onClick={() => handleRemoveOption(opt.id)}
                        className="p-1 text-slate-400 hover:text-red-600 rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 shrink-0">Then jump to:</span>
                    <select
                      value={opt.nextQuestionId || 'END'}
                      onChange={(e) => handleUpdateOption(opt.id, { nextQuestionId: e.target.value })}
                      className="flex-1 px-2 py-1 bg-white border border-slate-300 rounded text-xs font-medium text-slate-800"
                    >
                      <option value="END">End Call (Terminal)</option>
                      <option value="REPEAT">Repeat This Step / Menu</option>
                      {allQuestions
                        .filter((q) => q.id !== formData.id)
                        .map((q) => (
                          <option key={q.id} value={q.id}>
                            {q.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Collapsible Advanced Telephony Settings */}
        <div className="pt-2 border-t border-slate-200">
          <button
            type="button"
            onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
            className="text-xs text-slate-600 hover:text-slate-900 font-medium flex items-center gap-1.5"
          >
            <Sliders className="w-3.5 h-3.5 text-slate-400" />
            <span>{showAdvancedSettings ? 'Hide Advanced Telephony Settings' : 'Show Advanced Telephony Settings (Timeouts, Retries)'}</span>
          </button>

          {showAdvancedSettings && (
            <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  type="number"
                  label="Response Timeout (sec)"
                  value={formData.timeoutSeconds || 6}
                  onChange={(e) => setFormData({ ...formData, timeoutSeconds: Number(e.target.value) || 6 })}
                />
                <Input
                  type="number"
                  label="Max Retries"
                  value={formData.maxRetries || 2}
                  onChange={(e) => setFormData({ ...formData, maxRetries: Number(e.target.value) || 2 })}
                />
              </div>
              <Input
                label="Retry Prompt Text"
                value={formData.retryPromptText || ''}
                onChange={(e) => setFormData({ ...formData, retryPromptText: e.target.value })}
                placeholder="Sorry, that response was not recognized. Please try again."
              />
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
};
