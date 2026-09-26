import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { api } from './services/api';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './components/auth/LoginPage';
import { ForgotPasswordPage } from './components/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './components/auth/ResetPasswordPage';
import { Dashboard } from './components/Dashboard';
import { Campaigns } from './components/Campaigns';
import { QuestionnaireBuilder } from './components/QuestionnaireBuilder';
import { ContactManager } from './components/ContactManager';
import { CallLogs } from './components/CallLogs';
import { AnalyticsView } from './components/AnalyticsView';
import { AuditLogView } from './components/AuditLogView';
import { PracticeUsersView } from './components/admin/PracticeUsersView';
import { RolesView } from './components/admin/RolesView';
import { SettingsView } from './components/admin/SettingsView';
import { CallSimulatorModal } from './components/CallSimulatorModal';
import {
  INITIAL_QUESTIONNAIRES,
  INITIAL_CONTACTS,
  INITIAL_CAMPAIGNS,
  INITIAL_CALL_LOGS,
  INITIAL_AUDIT_LOGS
} from './data/initialData';
import {
  Questionnaire,
  Contact,
  Campaign,
  CallLog,
  AuditLogItem,
  CallStatus
} from './types';

function AculaWorkspace() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Clean legacy dummy storage and load initial state
  const loadCleanStorage = <T extends { id?: string }>(key: string, fallback: T[]): T[] => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      if (
        raw.includes('cmp_itr_deadline') ||
        raw.includes('ABC Tax Services') ||
        raw.includes('cnt_sharma') ||
        raw.includes('+91 80 4719') ||
        raw.includes('q_itr_reminder') ||
        raw.includes('cmp_aug_gst')
      ) {
        localStorage.removeItem(key);
        return fallback;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return fallback;
      }
      // Ensure all standard initial flows and items are present
      const existingIds = new Set(parsed.map((item: any) => item.id).filter(Boolean));
      const missingFromFallback = fallback.filter((f) => f.id && !existingIds.has(f.id));
      if (missingFromFallback.length > 0) {
        const merged = [...parsed, ...missingFromFallback];
        localStorage.setItem(key, JSON.stringify(merged));
        return merged;
      }
      return parsed;
    } catch {
      return fallback;
    }
  };

  const [questionnaires, setQuestionnaires] = useState<Questionnaire[]>(() => {
    return loadCleanStorage('ak_accounting_questionnaires', INITIAL_QUESTIONNAIRES);
  });

  const [contacts, setContacts] = useState<Contact[]>(() => {
    return loadCleanStorage('ak_accounting_contacts', INITIAL_CONTACTS);
  });

  const [campaigns, setCampaigns] = useState<Campaign[]>(() => {
    return loadCleanStorage('ak_accounting_campaigns', INITIAL_CAMPAIGNS);
  });

  const [callLogs, setCallLogs] = useState<CallLog[]>(() => {
    return loadCleanStorage('ak_accounting_calllogs', INITIAL_CALL_LOGS);
  });

  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>(() => {
    return loadCleanStorage('ak_accounting_auditlogs', INITIAL_AUDIT_LOGS);
  });

  // Simulator Modal State
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);
  const [simulatorQuestionnaire, setSimulatorQuestionnaire] = useState<Questionnaire | undefined>(() => questionnaires[0]);
  const [simulatorContact, setSimulatorContact] = useState<Contact | undefined>(() => contacts[0]);
  const [simulatorCallerId, setSimulatorCallerId] = useState('+1 737 250 8034');
  const [simulatorCampaignId, setSimulatorCampaignId] = useState<string>('');
  const [isSimulatingBatch, setIsSimulatingBatch] = useState(false);
  const [activeBatchCampaignId, setActiveBatchCampaignId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('ak_accounting_questionnaires', JSON.stringify(questionnaires));
  }, [questionnaires]);

  useEffect(() => {
    localStorage.setItem('ak_accounting_contacts', JSON.stringify(contacts));
  }, [contacts]);

  // Sync contacts from backend database on load / user login
  useEffect(() => {
    let isMounted = true;
    const syncBackendContacts = async () => {
      try {
        const res = await api.getContacts({ limit: 100 });
        if (isMounted && res.success && res.data?.contacts && res.data.contacts.length > 0) {
          const backendContacts = res.data.contacts;
          setContacts((prev) => {
            const backendIds = new Set(backendContacts.map((c) => c.id));
            const localOnly = prev.filter((c) => !backendIds.has(c.id));
            const merged = [...backendContacts, ...localOnly];
            localStorage.setItem('ak_accounting_contacts', JSON.stringify(merged));
            return merged;
          });
        }
      } catch (err) {
        console.warn('Could not sync contacts from backend API:', err);
      }
    };

    syncBackendContacts();
    return () => {
      isMounted = false;
    };
  }, [user]);

  useEffect(() => {
    localStorage.setItem('ak_accounting_campaigns', JSON.stringify(campaigns));
  }, [campaigns]);

  useEffect(() => {
    localStorage.setItem('ak_accounting_calllogs', JSON.stringify(callLogs));
  }, [callLogs]);

  useEffect(() => {
    localStorage.setItem('ak_accounting_auditlogs', JSON.stringify(auditLogs));
  }, [auditLogs]);

  // Dynamic Audit Logger
  const logAuditEvent = (action: string, category: AuditLogItem['category'], details: string) => {
    const performer = user ? `${user.name} (${user.role})` : 'System Operator';
    const item: AuditLogItem = {
      id: `aud_${Date.now()}`,
      action,
      performedBy: performer,
      category,
      details,
      timestamp: new Date().toISOString()
    };
    setAuditLogs((prev) => [item, ...prev]);
  };

  // Questionnaire Handlers
  const handleSaveQuestionnaire = (q: Questionnaire) => {
    const exists = questionnaires.some((item) => item.id === q.id);
    if (exists) {
      setQuestionnaires((prev) => prev.map((item) => (item.id === q.id ? q : item)));
      logAuditEvent('Questionnaire Updated', 'Questionnaire', `Modified flow "${q.title}" with ${q.questions.length} nodes.`);
    } else {
      setQuestionnaires((prev) => [...prev, q]);
      logAuditEvent('Questionnaire Created', 'Questionnaire', `Created new IVR flow "${q.title}".`);
    }
  };

  const handleDeleteQuestionnaire = (id: string) => {
    const q = questionnaires.find((x) => x.id === id);
    setQuestionnaires((prev) => prev.filter((item) => item.id !== id));
    logAuditEvent('Questionnaire Deleted', 'Questionnaire', `Removed flow "${q?.title || id}".`);
  };

  const handleResetPracticeData = () => {
    setQuestionnaires(INITIAL_QUESTIONNAIRES);
    setContacts(INITIAL_CONTACTS);
    setCampaigns(INITIAL_CAMPAIGNS);
    localStorage.setItem('ak_accounting_questionnaires', JSON.stringify(INITIAL_QUESTIONNAIRES));
    localStorage.setItem('ak_accounting_contacts', JSON.stringify(INITIAL_CONTACTS));
    localStorage.setItem('ak_accounting_campaigns', JSON.stringify(INITIAL_CAMPAIGNS));
    logAuditEvent('Practice Data Reset', 'System', 'Restored full suite of standard practice flows and test datasets.');
  };

  // Contact Handlers
  const handleSaveContact = (c: Contact) => {
    const exists = contacts.some((item) => item.id === c.id);
    if (exists) {
      setContacts((prev) => prev.map((item) => (item.id === c.id ? c : item)));
      logAuditEvent('Contact Updated', 'Contact', `Updated client details for ${c.name} (${c.companyName}).`);
    } else {
      setContacts((prev) => [c, ...prev]);
      logAuditEvent('Contact Created', 'Contact', `Enrolled new contact ${c.name} (${c.phoneNumber}).`);
    }
  };

  const handleDeleteContact = (id: string) => {
    const c = contacts.find((x) => x.id === id);
    setContacts((prev) => prev.filter((item) => item.id !== id));
    logAuditEvent('Contact Deleted', 'Contact', `Deleted contact record ${c?.name || id}.`);
  };

  const handleImportContacts = (imported: Contact[]) => {
    setContacts((prev) => [...imported, ...prev]);
    logAuditEvent('Batch Contacts Imported', 'Contact', `Imported ${imported.length} new client contacts into practice directory.`);
  };

  // Campaign Handlers
  const handleSaveCampaign = (c: Campaign) => {
    const exists = campaigns.some((item) => item.id === c.id);
    if (exists) {
      setCampaigns((prev) => prev.map((item) => (item.id === c.id ? c : item)));
      logAuditEvent('Campaign Updated', 'Campaign', `Updated configuration for campaign "${c.name}".`);
    } else {
      setCampaigns((prev) => [...prev, c]);
      logAuditEvent('Campaign Created', 'Campaign', `Created new outbound campaign "${c.name}".`);
    }
  };

  const handleDeleteCampaign = (id: string) => {
    const c = campaigns.find((x) => x.id === id);
    setCampaigns((prev) => prev.filter((item) => item.id !== id));
    logAuditEvent('Campaign Deleted', 'Campaign', `Removed campaign "${c?.name || id}".`);
  };

  const handleToggleCampaignStatus = (id: string) => {
    setCampaigns((prev) =>
      prev.map((c) => {
        if (c.id === id) {
          const newStatus = c.status === 'running' ? 'paused' : 'running';
          logAuditEvent('Campaign Status Changed', 'Campaign', `Campaign "${c.name}" status transitioned to ${newStatus.toUpperCase()}.`);
          return { ...c, status: newStatus };
        }
        return c;
      })
    );
  };

  // Call Logs & Simulation Handlers
  const handleSaveCallLog = (log: CallLog) => {
    setCallLogs((prev) => [log, ...prev]);
    setCampaigns((prev) =>
      prev.map((c) => {
        if (c.id === log.campaignId) {
          const stats = c.stats || { totalContacts: 0, completedCalls: 0, answeredCalls: 0, transferredCalls: 0, failedCalls: 0, avgDurationSeconds: 0 };
          return {
            ...c,
            stats: {
              ...stats,
              completedCalls: stats.completedCalls + 1,
              answeredCalls: log.status === 'completed' ? stats.answeredCalls + 1 : stats.answeredCalls,
              transferredCalls: log.status === 'transferred' ? stats.transferredCalls + 1 : stats.transferredCalls
            }
          };
        }
        return c;
      })
    );
  };

  const handleLaunchSimulator = (cId?: string, contactId?: string) => {
    const campaign = campaigns.find((c) => c.id === cId) || campaigns[0];
    const questionnaire = questionnaires.find((q) => q.id === campaign?.questionnaireId) || questionnaires[0];
    const contact = contacts.find((ct) => ct.id === contactId) || contacts[0];

    if (campaign) {
      setSimulatorCampaignId(campaign.id);
      setSimulatorCallerId(campaign.callerId || '+1 737 250 8034');
    }
    if (questionnaire) setSimulatorQuestionnaire(questionnaire);
    if (contact) setSimulatorContact(contact);

    setIsSimulatorOpen(true);
  };

  const handleRunBatchSimulation = (campaignId: string) => {
    const campaign = campaigns.find((c) => c.id === campaignId);
    if (!campaign) return;

    setIsSimulatingBatch(true);
    setActiveBatchCampaignId(campaignId);
    logAuditEvent('Batch Dialing Started', 'Campaign', `Initiated batch dialing simulation for "${campaign.name}".`);

    const callableContacts = contacts.filter((c) => !c.isDoNotCall);
    let index = 0;

    const interval = setInterval(() => {
      if (index >= Math.min(callableContacts.length, 5)) {
        clearInterval(interval);
        setIsSimulatingBatch(false);
        setActiveBatchCampaignId(null);
        logAuditEvent('Batch Dialing Finished', 'Campaign', `Completed simulated run for "${campaign.name}".`);
        return;
      }

      const currentContact = callableContacts[index];
      const isTransferred = Math.random() > 0.7;
      const isCompleted = !isTransferred && Math.random() > 0.2;
      const finalStatus: CallStatus = isTransferred ? 'transferred' : isCompleted ? 'completed' : 'failed';

      const nowStr = new Date().toISOString();
      const startStr = new Date(Date.now() - 45000).toISOString();

      const simulatedLog: CallLog = {
        id: `call_batch_${Date.now()}_${index}`,
        campaignId: campaign.id,
        campaignName: campaign.name,
        contactId: currentContact.id,
        contactName: currentContact.name,
        companyName: currentContact.companyName,
        phoneNumber: currentContact.phoneNumber,
        status: finalStatus,
        attemptNumber: 1,
        startedAt: startStr,
        endedAt: nowStr,
        durationSeconds: Math.floor(Math.random() * 40) + 15,
        responses: [
          {
            questionId: 'q1',
            questionName: 'Filing Confirmation',
            questionType: 'yes_no',
            promptText: 'Ready to confirm GST return details?',
            inputReceived: '1',
            inputMethod: 'dtmf',
            recordedAt: startStr,
            isValid: true
          },
          {
            questionId: 'q2',
            questionName: 'Reconciliation Check',
            questionType: 'multiple_choice',
            promptText: 'Have all accounts been reconciled?',
            inputReceived: isTransferred ? '3' : '1',
            inputMethod: 'dtmf',
            recordedAt: nowStr,
            isValid: true
          }
        ],
        transcript: [
          { speaker: 'system', text: 'Kia Ora, this is Auckland Accounting Services.', timestamp: startStr },
          { speaker: 'user', text: 'Answered and confirmed identity.', timestamp: startStr },
          {
            speaker: 'system',
            text: isTransferred
              ? 'Transfer Request: Routing call to assigned accountant (+1 737 250 8034).'
              : 'Filing confirmed. Disconnecting.',
            timestamp: nowStr
          }
        ]
      };

      handleSaveCallLog(simulatedLog);
      index++;
    }, 1500);
  };

  const runningCount = campaigns.filter((c) => c.status === 'running').length;

  return (
    <AppShell
      currentPath={location.pathname}
      onNavigate={(path) => navigate(path)}
      runningCampaignCount={runningCount}
    >
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route
          path="/dashboard"
          element={
            <Dashboard
              campaigns={campaigns}
              questionnaires={questionnaires}
              contacts={contacts}
              callLogs={callLogs}
              onOpenSimulator={() => handleLaunchSimulator()}
              onNavigateTab={(tab) => navigate(`/${tab}`)}
              onRunBatchSimulation={handleRunBatchSimulation}
              isSimulatingBatch={isSimulatingBatch}
            />
          }
        />
        <Route
          path="/contacts/*"
          element={
            <ProtectedRoute requiredPermission="contacts.view">
              <ContactManager
                contacts={contacts}
                onSaveContact={handleSaveContact}
                onDeleteContact={handleDeleteContact}
                onImportContacts={handleImportContacts}
                onCallContactInSimulator={(contactId) => handleLaunchSimulator(undefined, contactId)}
              />
            </ProtectedRoute>
          }
        />
        <Route
          path="/campaigns"
          element={
            <ProtectedRoute requiredPermission="campaigns.view">
              <Campaigns
                campaigns={campaigns}
                questionnaires={questionnaires}
                contacts={contacts}
                onSaveCampaign={handleSaveCampaign}
                onDeleteCampaign={handleDeleteCampaign}
                onToggleStatus={handleToggleCampaignStatus}
                onLaunchSimulator={handleLaunchSimulator}
                onRunBatchSimulation={handleRunBatchSimulation}
                onSaveCallLog={handleSaveCallLog}
                isSimulatingBatch={isSimulatingBatch}
                activeBatchCampaignId={activeBatchCampaignId}
              />
            </ProtectedRoute>
          }
        />
        <Route
          path="/questions"
          element={
            <ProtectedRoute requiredPermission="questionnaires.view">
              <QuestionnaireBuilder
                questionnaires={questionnaires}
                onSaveQuestionnaire={handleSaveQuestionnaire}
                onDeleteQuestionnaire={handleDeleteQuestionnaire}
                onRestoreDefaultFlows={handleResetPracticeData}
                onTestFlowInSimulator={(qId) => {
                  const q = questionnaires.find((x) => x.id === qId);
                  if (q) setSimulatorQuestionnaire(q);
                  setIsSimulatorOpen(true);
                }}
                onTestQuestionnaire={(q) => {
                  setSimulatorQuestionnaire(q);
                  setIsSimulatorOpen(true);
                }}
              />
            </ProtectedRoute>
          }
        />
        <Route
          path="/calls"
          element={
            <ProtectedRoute requiredPermission="calls.view">
              <CallLogs callLogs={callLogs} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute requiredPermission="reports.view">
              <AnalyticsView
                callLogs={callLogs}
                campaigns={campaigns}
                contacts={contacts}
                questionnaires={questionnaires}
              />
            </ProtectedRoute>
          }
        />
        <Route
          path="/audit-logs"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN']} requiredPermission="audit.view">
              <AuditLogView auditLogs={auditLogs} logs={auditLogs} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/users"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN']} requiredPermission="users.view">
              <PracticeUsersView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/roles"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN']} requiredPermission="roles.view">
              <RolesView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN']} requiredPermission="system.settings">
              <SettingsView />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>

      {/* Interactive Telephony Simulator Modal */}
      <CallSimulatorModal
        isOpen={isSimulatorOpen}
        onClose={() => setIsSimulatorOpen(false)}
        questionnaires={questionnaires}
        contacts={contacts}
        campaigns={campaigns}
        defaultCampaignId={simulatorCampaignId}
        defaultQuestionnaireId={simulatorQuestionnaire?.id}
        defaultContactId={simulatorContact?.id}
        onSaveCallLog={handleSaveCallLog}
      />
    </AppShell>
  );
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <AculaWorkspace />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
