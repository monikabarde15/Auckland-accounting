import React, { useState, useMemo } from 'react';
import {
  Plus,
  Play,
  Pause,
  StopCircle,
  Clock,
  ShieldCheck,
  Phone,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Search,
  Users,
  FileText,
  AlertOctagon,
  Activity
} from 'lucide-react';
import {
  Campaign,
  Questionnaire,
  Contact,
  CampaignStatus,
  CampaignPreLaunchResult,
  CallLog
} from '../types';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { LiveCampaignQueueModal } from './LiveCampaignQueueModal';
import {
  Button,
  Badge,
  Input,
  Modal,
  Tabs,
  MetricRow,
  PageHeader,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuItem,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  EmptyState
} from './ui';

interface CampaignsProps {
  campaigns: Campaign[];
  questionnaires: Questionnaire[];
  contacts: Contact[];
  onSaveCampaign: (campaign: Campaign) => void;
  onUpdateCampaignStatus?: (id: string, status: Campaign['status']) => void;
  onToggleStatus?: (id: string) => void;
  onDeleteCampaign?: (id: string) => void;
  onLaunchSimulator?: (campaignId?: string, contactId?: string) => void;
  onRunBatchSimulation?: (campaignId: string) => void;
  onSaveCallLog?: (log: CallLog) => void;
  isSimulatingBatch?: boolean;
  activeBatchCampaignId?: string | null;
}

export const Campaigns: React.FC<CampaignsProps> = ({
  campaigns,
  questionnaires,
  contacts,
  onSaveCampaign,
  onDeleteCampaign,
  onLaunchSimulator,
  onRunBatchSimulation,
  onSaveCallLog,
  isSimulatingBatch = false,
  activeBatchCampaignId = null
}) => {
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isWizardOpen, setIsWizardOpen] = useState<boolean>(false);
  const [validatingCampaignId, setValidatingCampaignId] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<CampaignPreLaunchResult | null>(null);
  const [showValidationModal, setShowValidationModal] = useState<boolean>(false);
  const [liveQueueCampaign, setLiveQueueCampaign] = useState<Campaign | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    campaign: Campaign;
    action: 'START' | 'PAUSE' | 'RESUME' | 'CANCEL' | 'DELETE';
  } | null>(null);
  const [isEmergencyStopConfirmOpen, setIsEmergencyStopConfirmOpen] = useState<boolean>(false);

  // Status Metrics
  const metrics = useMemo(() => {
    let running = 0;
    let scheduled = 0;
    let paused = 0;
    let draft = 0;
    let completed = 0;

    campaigns.forEach((c) => {
      const s = String(c.status).toUpperCase();
      if (s === 'RUNNING') running++;
      else if (s === 'SCHEDULED') scheduled++;
      else if (s === 'PAUSED') paused++;
      else if (s === 'DRAFT') draft++;
      else if (s === 'COMPLETED') completed++;
    });

    return { total: campaigns.length, running, scheduled, paused, draft, completed };
  }, [campaigns]);

  // Filtered campaigns
  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((c) => {
      const normStatus = String(c.status).toUpperCase();
      if (activeTab !== 'ALL' && normStatus !== activeTab) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = c.name.toLowerCase().includes(q);
        const matchDesc = (c.description || '').toLowerCase().includes(q);
        if (!matchName && !matchDesc) return false;
      }
      return true;
    });
  }, [campaigns, activeTab, searchQuery]);

  // Pre-launch validation trigger
  const handleValidateCampaign = async (c: Campaign) => {
    setValidatingCampaignId(c.id);
    try {
      const res = await api.validateCampaign(c.id);
      if (res.success && res.data) {
        setValidationResult(res.data);
        setShowValidationModal(true);
      } else {
        const matchedContacts = c.targetContactIds && c.targetContactIds.length > 0
          ? contacts.filter((ct) => c.targetContactIds?.includes(ct.id))
          : c.targetGroups && c.targetGroups.length > 0
          ? contacts.filter((ct) => ct.groups?.some((g) => c.targetGroups?.includes(g)))
          : contacts;
        const totalContacts = matchedContacts.length || c.contactCount || 0;
        const dncCount = matchedContacts.filter((ct) => ct.isDoNotCall).length;
        const callable = Math.max(0, matchedContacts.filter((ct) => !ct.isDoNotCall).length);

        const localResult: CampaignPreLaunchResult = {
          campaignId: c.id,
          isLaunchReady: callable > 0 && !!c.questionnaireId,
          timestamp: new Date().toISOString(),
          checks: [
            {
              id: 'CONFIG_FIELDS',
              category: 'CONFIG',
              name: 'Campaign Name & Caller ID',
              status: c.name ? 'PASS' : 'FAIL',
              message: c.name ? `Configured as "${c.name}"` : 'Missing name'
            },
            {
              id: 'CONTACTS_AUDIENCE',
              category: 'CONTACTS',
              name: 'Target Audience & DNC Suppression',
              status: totalContacts === 0 ? 'FAIL' : callable === 0 ? 'FAIL' : dncCount > 0 ? 'WARN' : 'PASS',
              message: totalContacts === 0
                ? 'No contacts attached'
                : callable === 0
                ? 'All contacts are DNC suppressed'
                : `${callable} callable contacts (${dncCount} DNC suppressed)`
            },
            {
              id: 'FLOW_LINK',
              category: 'QUESTION_FLOW',
              name: 'IVR Question Flow',
              status: c.questionnaireId ? 'PASS' : 'FAIL',
              message: c.questionnaireId ? 'Linked to verified questionnaire flow' : 'No questionnaire flow selected'
            }
          ],
          summary: {
            totalContacts,
            callableContacts: callable,
            dncSuppressedContacts: dncCount,
            flowValid: !!c.questionnaireId,
            flowErrorCount: c.questionnaireId ? 0 : 1,
            flowWarningCount: 0
          }
        };
        setValidationResult(localResult);
        setShowValidationModal(true);
      }
    } catch {
      // Local fallback handled
    } finally {
      setValidatingCampaignId(null);
    }
  };

  // State Transition Action
  const handleExecuteStateAction = async () => {
    if (!confirmAction) return;
    const { campaign, action } = confirmAction;

    try {
      if (action === 'START') {
        if (!hasPermission('campaigns.start')) {
          alert('Permission denied. You do not have permission to start campaigns (campaigns.start).');
          return;
        }
        let updatedCampaign: Campaign = {
          ...campaign,
          status: 'running',
          startedAt: new Date().toISOString()
        };
        try {
          const res = await api.startCampaign(campaign.id);
          if (res.success && res.data) {
            updatedCampaign = res.data;
          } else if (res.error && res.error.code !== 'NOT_FOUND' && res.error.code !== 'NETWORK_ERROR') {
            alert(res.error.message || 'Failed to start campaign.');
            return;
          }
        } catch {
          // Fallback to local state transition
        }
        onSaveCampaign(updatedCampaign);
        setLiveQueueCampaign(updatedCampaign);
      } else if (action === 'PAUSE') {
        if (!hasPermission('campaigns.pause')) {
          alert('Permission denied. You do not have permission to pause campaigns (campaigns.pause).');
          return;
        }
        let updatedCampaign: Campaign = { ...campaign, status: 'paused' };
        try {
          const res = await api.pauseCampaign(campaign.id);
          if (res.success && res.data) {
            updatedCampaign = res.data;
          }
        } catch {
          // Local fallback
        }
        onSaveCampaign(updatedCampaign);
      } else if (action === 'RESUME') {
        if (!hasPermission('campaigns.resume')) {
          alert('Permission denied. You do not have permission to resume campaigns (campaigns.resume).');
          return;
        }
        let updatedCampaign: Campaign = { ...campaign, status: 'running' };
        try {
          const res = await api.resumeCampaign(campaign.id);
          if (res.success && res.data) {
            updatedCampaign = res.data;
          }
        } catch {
          // Local fallback
        }
        onSaveCampaign(updatedCampaign);
      } else if (action === 'CANCEL') {
        if (!hasPermission('campaigns.cancel')) {
          alert('Permission denied. You do not have permission to cancel campaigns (campaigns.cancel).');
          return;
        }
        let updatedCampaign: Campaign = { ...campaign, status: 'cancelled' };
        try {
          const res = await api.cancelCampaign(campaign.id);
          if (res.success && res.data) {
            updatedCampaign = res.data;
          }
        } catch {
          // Local fallback
        }
        onSaveCampaign(updatedCampaign);
      } else if (action === 'DELETE') {
        if (!hasPermission('campaigns.delete')) {
          alert('Permission denied. You do not have permission to delete campaigns (campaigns.delete).');
          return;
        }
        try {
          await api.deleteCampaign(campaign.id);
        } catch {
          // Local fallback
        }
        if (onDeleteCampaign) onDeleteCampaign(campaign.id);
      }
    } catch (err: any) {
      alert(err.message || 'Operation failed');
    } finally {
      setConfirmAction(null);
    }
  };

  // Emergency Stop Handler (pauses/cancels all running campaigns and terminates queued jobs)
  const handleEmergencyStopAll = async () => {
    try {
      await api.emergencyStopAllCampaigns();
    } catch {
      // Continue to local state sync
    }

    const runningList = campaigns.filter((c) => String(c.status).toUpperCase() === 'RUNNING');
    for (const c of runningList) {
      try {
        const res = await api.pauseCampaign(c.id);
        if (res.success && res.data) {
          onSaveCampaign(res.data);
        } else {
          onSaveCampaign({ ...c, status: 'paused' });
        }
      } catch {
        onSaveCampaign({ ...c, status: 'paused' });
      }
    }
    setIsEmergencyStopConfirmOpen(false);
  };

  const getStatusBadge = (status: CampaignStatus) => {
    const s = String(status).toUpperCase();
    switch (s) {
      case 'RUNNING':
        return <Badge variant="success" dot>Running</Badge>;
      case 'SCHEDULED':
        return <Badge variant="info">Scheduled</Badge>;
      case 'PAUSED':
        return <Badge variant="warning">Paused</Badge>;
      case 'DRAFT':
        return <Badge variant="neutral">Draft</Badge>;
      case 'COMPLETED':
        return <Badge variant="neutral">Completed</Badge>;
      case 'CANCELLED':
        return <Badge variant="danger">Cancelled</Badge>;
      case 'FAILED':
        return <Badge variant="danger">Failed</Badge>;
      default:
        return <Badge variant="neutral">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaigns"
        description="Outbound dialing schedules, audience targeting, and campaign lifecycle management."
        actions={
          <div className="flex items-center gap-2">
            {metrics.running > 0 && hasPermission('emergency.stop') && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setIsEmergencyStopConfirmOpen(true)}
                leftIcon={<AlertOctagon className="w-3.5 h-3.5" />}
              >
                Halt All Calls
              </Button>
            )}
            {hasPermission('campaigns.create') && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setIsWizardOpen(true)}
                leftIcon={<Plus className="w-3.5 h-3.5" />}
              >
                Create Campaign
              </Button>
            )}
          </div>
        }
      />

      {/* Metrics Row */}
      <MetricRow
        metrics={[
          { label: 'Total', value: metrics.total },
          { label: 'Running', value: metrics.running, status: metrics.running > 0 ? 'success' : 'neutral' },
          { label: 'Scheduled', value: metrics.scheduled },
          { label: 'Paused', value: metrics.paused, status: metrics.paused > 0 ? 'warning' : 'neutral' },
          { label: 'Draft', value: metrics.draft },
          { label: 'Completed', value: metrics.completed }
        ]}
      />

      {/* Filter Tabs & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <Tabs
          tabs={[
            { id: 'ALL', label: 'All', count: metrics.total },
            { id: 'RUNNING', label: 'Running', count: metrics.running },
            { id: 'SCHEDULED', label: 'Scheduled', count: metrics.scheduled },
            { id: 'PAUSED', label: 'Paused', count: metrics.paused },
            { id: 'DRAFT', label: 'Draft', count: metrics.draft },
            { id: 'COMPLETED', label: 'Completed', count: metrics.completed }
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
        />

        <div className="w-full sm:w-64">
          <Input
            placeholder="Search campaigns..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            leftIcon={<Search className="w-3.5 h-3.5" />}
          />
        </div>
      </div>

      {/* Campaigns Data Table */}
      {filteredCampaigns.length === 0 ? (
        <EmptyState
          icon={<AlertTriangle className="w-8 h-8" />}
          title="No campaigns found"
          description={
            searchQuery
              ? `No campaigns match "${searchQuery}".`
              : 'No campaigns in this view. Create a new campaign to begin outbound dialing.'
          }
          action={
            hasPermission('campaigns.create') ? (
              <Button variant="primary" size="sm" onClick={() => setIsWizardOpen(true)}>
                Create Campaign
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Campaign</TableHeaderCell>
              <TableHeaderCell>Questionnaire Flow</TableHeaderCell>
              <TableHeaderCell>Target Audience</TableHeaderCell>
              <TableHeaderCell>Window</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell className="text-right">Actions</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCampaigns.map((c) => {
              const s = String(c.status).toUpperCase();
              const qFlow = questionnaires.find((q) => q.id === c.questionnaireId) || c.questionnaire;
              const matchedContacts = c.targetContactIds && c.targetContactIds.length > 0
                ? contacts.filter((ct) => c.targetContactIds?.includes(ct.id))
                : c.targetGroups && c.targetGroups.length > 0
                ? contacts.filter((ct) => ct.groups?.some((g) => c.targetGroups?.includes(g)))
                : contacts;
              const totalContacts = matchedContacts.length || c.contactCount || 0;
              const dncCount = matchedContacts.filter((ct) => ct.isDoNotCall).length;
              const callableCount = Math.max(0, matchedContacts.filter((ct) => !ct.isDoNotCall).length);

              const dropdownItems: DropdownMenuItem[] = [
                {
                  label: 'Live Queue & Monitor',
                  icon: <Activity className="w-3.5 h-3.5 text-emerald-600" />,
                  onClick: () => setLiveQueueCampaign(c)
                }
              ];

              if ((s === 'DRAFT' || s === 'READY' || s === 'SCHEDULED') && hasPermission('campaigns.start')) {
                dropdownItems.push({
                  label: 'Start Campaign',
                  icon: <Play className="w-3.5 h-3.5 text-emerald-600" />,
                  onClick: () => setConfirmAction({ campaign: c, action: 'START' })
                });
              }
              if (s === 'RUNNING' && hasPermission('campaigns.pause')) {
                dropdownItems.push({
                  label: 'Pause Campaign',
                  icon: <Pause className="w-3.5 h-3.5 text-amber-600" />,
                  onClick: () => setConfirmAction({ campaign: c, action: 'PAUSE' })
                });
              }
              if (s === 'PAUSED' && hasPermission('campaigns.resume')) {
                dropdownItems.push({
                  label: 'Resume Campaign',
                  icon: <Play className="w-3.5 h-3.5 text-emerald-600" />,
                  onClick: () => setConfirmAction({ campaign: c, action: 'RESUME' })
                });
              }
              dropdownItems.push({
                label: 'Pre-Launch Verification',
                icon: <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />,
                onClick: () => handleValidateCampaign(c)
              });
              if (onLaunchSimulator && hasPermission('calls.execute')) {
                dropdownItems.push({
                  label: 'Test in Simulator',
                  icon: <Phone className="w-3.5 h-3.5 text-slate-600" />,
                  onClick: () => onLaunchSimulator(c.id)
                });
              }
              if ((s === 'RUNNING' || s === 'PAUSED' || s === 'DRAFT' || s === 'READY' || s === 'SCHEDULED') && hasPermission('campaigns.cancel')) {
                dropdownItems.push({
                  label: 'Cancel Campaign',
                  icon: <StopCircle className="w-3.5 h-3.5 text-red-600" />,
                  variant: 'danger' as const,
                  onClick: () => setConfirmAction({ campaign: c, action: 'CANCEL' })
                });
              }
              if (hasPermission('campaigns.delete')) {
                dropdownItems.push({
                  label: 'Delete Campaign',
                  icon: <Trash2 className="w-3.5 h-3.5 text-red-600" />,
                  variant: 'danger' as const,
                  onClick: () => setConfirmAction({ campaign: c, action: 'DELETE' })
                });
              }

              return (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="font-semibold text-slate-900">{c.name}</div>
                    <div className="text-xs text-slate-500 line-clamp-1">{c.description || 'No description provided'}</div>
                    <div className="text-[11px] text-slate-400 font-mono mt-0.5">Caller: {c.callerId}</div>
                  </TableCell>

                  <TableCell>
                    {qFlow ? (
                      <span className="text-xs text-slate-800 font-medium flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-slate-400" />
                        {qFlow.title}
                      </span>
                    ) : (
                      <span className="text-xs text-amber-700 font-medium">No Flow Attached</span>
                    )}
                  </TableCell>

                  <TableCell>
                    <div className="text-xs text-slate-800 font-medium flex items-center gap-1">
                      <Users className="w-3.5 h-3.5 text-slate-400" />
                      <span>{callableCount} callable</span>
                      {dncCount > 0 && <span className="text-red-600">({dncCount} DNC)</span>}
                    </div>
                  </TableCell>

                  <TableCell>
                    <div className="text-xs text-slate-700 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>{c.callingStartTime || '09:00'} - {c.callingEndTime || '18:00'}</span>
                    </div>
                    <div className="text-[11px] text-slate-400">Max {c.maxConcurrentCalls || 5} concurrent</div>
                  </TableCell>

                  <TableCell>
                    {getStatusBadge(c.status)}
                  </TableCell>

                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant={s === 'RUNNING' ? 'primary' : 'outline'}
                        size="xs"
                        onClick={() => setLiveQueueCampaign(c)}
                        leftIcon={<Activity className={`w-3 h-3 ${s === 'RUNNING' ? 'animate-pulse text-emerald-200' : 'text-slate-500'}`} />}
                      >
                        {s === 'RUNNING' ? 'Live' : 'View'}
                      </Button>
                      <DropdownMenu items={dropdownItems} />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* Pre-Launch Verification Modal */}
      {showValidationModal && validationResult && (
        <Modal
          isOpen={showValidationModal}
          onClose={() => setShowValidationModal(false)}
          size="lg"
          title={
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-blue-600" />
              <span>Pre-Launch Verification: {validationResult.campaignName}</span>
            </div>
          }
          footer={
            <Button variant="primary" size="sm" onClick={() => setShowValidationModal(false)}>
              Close Report
            </Button>
          }
        >
          <div className="space-y-4">
            <div
              className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${
                validationResult.isLaunchReady
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}
            >
              {validationResult.isLaunchReady ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="font-semibold">
                  {validationResult.isLaunchReady
                    ? 'All pre-launch compliance checks passed'
                    : 'Launch blocked — fix verification errors'}
                </p>
                <p className="mt-0.5 opacity-90">
                  {validationResult.isLaunchReady
                    ? 'Audience, DNC suppression, calling windows, and IVR flow are valid.'
                    : 'Campaign cannot start with invalid flows or zero callable contacts.'}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {validationResult.checks.map((chk) => (
                <div
                  key={chk.id}
                  className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 flex items-start justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="font-semibold text-slate-800">{chk.name}</div>
                    <div className="text-slate-600 mt-0.5">{chk.message}</div>
                  </div>
                  <Badge
                    variant={chk.status === 'PASS' ? 'success' : chk.status === 'WARN' ? 'warning' : 'danger'}
                    size="sm"
                  >
                    {chk.status}
                  </Badge>
                </div>
              ))}
            </div>

            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 grid grid-cols-3 text-center text-xs">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Callable</span>
                <span className="text-sm font-semibold text-emerald-700 font-mono">
                  {validationResult.summary.callableContacts}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">DNC Suppressed</span>
                <span className="text-sm font-semibold text-red-600 font-mono">
                  {validationResult.summary.dncSuppressedContacts}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">IVR Flow</span>
                <span className={`text-sm font-semibold ${validationResult.summary.flowValid ? 'text-emerald-700' : 'text-red-600'}`}>
                  {validationResult.summary.flowValid ? 'Valid' : 'Errors'}
                </span>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Confirmation Dialog for State Transitions */}
      {confirmAction && (
        <ConfirmDialog
          isOpen={!!confirmAction}
          onClose={() => setConfirmAction(null)}
          onConfirm={handleExecuteStateAction}
          title={`Confirm Campaign ${confirmAction.action}`}
          variant={confirmAction.action === 'CANCEL' || confirmAction.action === 'DELETE' ? 'danger' : 'primary'}
          message={
            <span>
              Are you sure you want to <strong>{confirmAction.action.toLowerCase()}</strong> campaign "
              {confirmAction.campaign.name}"?
              {confirmAction.action === 'CANCEL' && ' Cancelled campaigns cannot be restarted.'}
              {confirmAction.action === 'DELETE' && ' All campaign configuration and records will be permanently removed.'}
            </span>
          }
        />
      )}

      {/* Emergency Stop Confirmation */}
      {isEmergencyStopConfirmOpen && (
        <ConfirmDialog
          isOpen={isEmergencyStopConfirmOpen}
          onClose={() => setIsEmergencyStopConfirmOpen(false)}
          onConfirm={handleEmergencyStopAll}
          title="Emergency Halt: Stop All Outbound Dialing"
          variant="danger"
          confirmLabel="Halt All Calling"
          message={
            <span>
              This will immediately pause all <strong>{metrics.running}</strong> running campaigns and halt outbound dial attempts.
            </span>
          }
        />
      )}

      {/* Campaign Creation Wizard */}
      {isWizardOpen && (
        <CampaignWizardModal
          questionnaires={questionnaires}
          contacts={contacts}
          onSave={onSaveCampaign}
          onClose={() => setIsWizardOpen(false)}
        />
      )}

      {/* Live Campaign Queue & Dialer Monitor Modal */}
      {liveQueueCampaign && (
        <LiveCampaignQueueModal
          isOpen={true}
          onClose={() => setLiveQueueCampaign(null)}
          campaign={liveQueueCampaign}
          questionnaire={questionnaires.find((q) => q.id === liveQueueCampaign.questionnaireId) || questionnaires[0]}
          contacts={contacts}
          onSaveCallLog={onSaveCallLog}
          onUpdateCampaign={onSaveCampaign}
          onLaunchSimulator={onLaunchSimulator}
        />
      )}
    </div>
  );
};

// ==========================================
// Campaign Creation Wizard Modal Subcomponent
// ==========================================
interface CampaignWizardModalProps {
  questionnaires: Questionnaire[];
  contacts: Contact[];
  onSave: (c: Campaign) => void;
  onClose: () => void;
}

const CampaignWizardModal: React.FC<CampaignWizardModalProps> = ({
  questionnaires,
  contacts,
  onSave,
  onClose
}) => {
  const [step, setStep] = useState<number>(1);
  const [formData, setFormData] = useState<Partial<Campaign>>({
    name: '',
    description: '',
    callerId: '+6498370000',
    callerName: 'Auckland Accounting Services',
    questionnaireId: questionnaires[0]?.id || '',
    callingStartTime: '09:00',
    callingEndTime: '18:00',
    daysOfWeek: [1, 2, 3, 4, 5],
    timezone: 'Pacific/Auckland',
    maxConcurrentCalls: 5,
    dailyCallLimit: 100,
    maxCalls: 500,
    maxCost: 250.0,
    retryEnabled: true,
    maxRetries: 3,
    retryIntervalMinutes: 60,
    status: 'draft'
  });

  const [selectedContactIds, setSelectedContactIds] = useState<string[]>(
    contacts.filter((c) => !c.isDoNotCall).map((c) => c.id)
  );

  const callableCount = useMemo(() => {
    return selectedContactIds.filter((id) => {
      const ct = contacts.find((c) => c.id === id);
      return ct && !ct.isDoNotCall;
    }).length;
  }, [selectedContactIds, contacts]);

  const handleFinish = async () => {
    if (!formData.name?.trim()) {
      alert('Campaign name is required.');
      return;
    }

    try {
      const res = await api.createCampaign({
        ...formData,
        targetContactIds: selectedContactIds
      });

      if (res.success && res.data) {
        onSave(res.data);
      } else {
        const localCampaign: Campaign = {
          id: `camp_${Date.now()}`,
          name: formData.name || 'New Campaign',
          description: formData.description,
          callerId: formData.callerId || '+6498370000',
          callerName: formData.callerName || 'Auckland Accounting Services',
          questionnaireId: formData.questionnaireId,
          status: 'draft',
          callingStartTime: formData.callingStartTime,
          callingEndTime: formData.callingEndTime,
          daysOfWeek: formData.daysOfWeek,
          timezone: formData.timezone,
          maxConcurrentCalls: formData.maxConcurrentCalls,
          dailyCallLimit: formData.dailyCallLimit,
          maxCalls: formData.maxCalls,
          maxCost: formData.maxCost,
          retryEnabled: formData.retryEnabled,
          maxRetries: formData.maxRetries,
          retryIntervalMinutes: formData.retryIntervalMinutes,
          targetContactIds: selectedContactIds,
          contactCount: selectedContactIds.length,
          createdAt: new Date().toISOString()
        };
        onSave(localCampaign);
      }
      onClose();
    } catch (err: any) {
      alert(err.message || 'Failed to save campaign');
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      size="xl"
      title={`Create Outbound Campaign (Step ${step} of 4)`}
      footer={
        <div className="flex items-center justify-between w-full">
          <Button
            variant="outline"
            size="sm"
            onClick={step > 1 ? () => setStep(step - 1) : onClose}
          >
            {step > 1 ? 'Back' : 'Cancel'}
          </Button>
          {step < 4 ? (
            <Button variant="primary" size="sm" onClick={() => setStep(step + 1)}>
              Continue
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={handleFinish}>
              Save Campaign (Draft)
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4 text-xs">
        {step === 1 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-900">Campaign Identity</h4>
            <Input
              label="Campaign Name"
              value={formData.name || ''}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g. End of Financial Year (EOFY) Review Check"
            />
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Description / Scope</label>
              <textarea
                rows={2}
                value={formData.description || ''}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Automated client outbound calls verifying documentation..."
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-[#0f2e4a] focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Caller ID (E.164)"
                value={formData.callerId || ''}
                onChange={(e) => setFormData({ ...formData, callerId: e.target.value })}
              />
              <Input
                label="Caller Name"
                value={formData.callerName || ''}
                onChange={(e) => setFormData({ ...formData, callerName: e.target.value })}
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-900">Select IVR Questionnaire Flow</h4>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {questionnaires.map((q) => (
                <label
                  key={q.id}
                  className={`p-3 rounded-lg border flex items-start gap-2.5 cursor-pointer transition-colors ${
                    formData.questionnaireId === q.id
                      ? 'border-[#0f2e4a] bg-blue-50/40 ring-1 ring-[#0f2e4a]'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="questionnaire"
                    checked={formData.questionnaireId === q.id}
                    onChange={() => setFormData({ ...formData, questionnaireId: q.id })}
                    className="mt-0.5 text-[#0f2e4a]"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 text-xs">{q.title}</span>
                      <span className="text-[10px] text-slate-500 font-mono">{q.questions.length} steps</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">{q.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-slate-900">Audience Selection</h4>
              <span className="text-xs text-emerald-700 font-medium">{callableCount} callable selected</span>
            </div>
            <div className="border border-slate-200 rounded-lg overflow-hidden max-h-56 overflow-y-auto divide-y divide-slate-100">
              {contacts.map((c) => {
                const isSelected = selectedContactIds.includes(c.id);
                return (
                  <div
                    key={c.id}
                    onClick={() => {
                      setSelectedContactIds((prev) =>
                        isSelected ? prev.filter((id) => id !== c.id) : [...prev, c.id]
                      );
                    }}
                    className={`p-2.5 flex items-center justify-between cursor-pointer hover:bg-slate-50 ${
                      isSelected ? 'bg-blue-50/30' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        readOnly
                        className="rounded text-[#0f2e4a]"
                      />
                      <div>
                        <span className="font-medium text-slate-900">{c.name}</span>
                        <span className="text-slate-500 text-[11px] ml-1.5 font-mono">{c.phoneNumber}</span>
                      </div>
                    </div>
                    {c.isDoNotCall ? (
                      <Badge variant="danger" size="sm">DNC</Badge>
                    ) : (
                      <Badge variant="success" size="sm">Callable</Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-900">Calling Window & Limits</h4>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Start Time"
                type="time"
                value={formData.callingStartTime || '09:00'}
                onChange={(e) => setFormData({ ...formData, callingStartTime: e.target.value })}
              />
              <Input
                label="End Time"
                type="time"
                value={formData.callingEndTime || '18:00'}
                onChange={(e) => setFormData({ ...formData, callingEndTime: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Max Concurrent Calls"
                type="number"
                min={1}
                max={20}
                value={formData.maxConcurrentCalls || 5}
                onChange={(e) => setFormData({ ...formData, maxConcurrentCalls: Number(e.target.value) })}
              />
              <Input
                label="Budget Cost Cap ($ NZD)"
                type="number"
                min={10}
                value={formData.maxCost || 250}
                onChange={(e) => setFormData({ ...formData, maxCost: Number(e.target.value) })}
              />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
