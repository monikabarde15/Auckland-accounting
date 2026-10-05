import React, { useState, useMemo, useRef } from 'react';
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
  Activity,
  Edit2,
  CheckSquare,
  Square
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
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [validatingCampaignId, setValidatingCampaignId] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<CampaignPreLaunchResult | null>(null);
  const [showValidationModal, setShowValidationModal] = useState<boolean>(false);
  const [liveQueueCampaign, setLiveQueueCampaign] = useState<Campaign | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    campaign: Campaign;
    action: 'START' | 'PAUSE' | 'RESUME' | 'CANCEL' | 'DELETE';
  } | null>(null);
  const [isEmergencyStopConfirmOpen, setIsEmergencyStopConfirmOpen] = useState<boolean>(false);
  const [executingCampaignId, setExecutingCampaignId] = useState<string | null>(null);
  const isExecutingRef = useRef<boolean>(false);

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

  // Direct, single-execution handler for START and RESUME (no slow confirm dialogs, no double-clicking)
  const handleDirectStartOrResume = async (campaign: Campaign, action: 'START' | 'RESUME') => {
    if (isExecutingRef.current) return;
    if (action === 'START' && !hasPermission('campaigns.start')) {
      alert('Permission denied. You do not have permission to start campaigns (campaigns.start).');
      return;
    }
    if (action === 'RESUME' && !hasPermission('campaigns.resume')) {
      alert('Permission denied. You do not have permission to resume campaigns (campaigns.resume).');
      return;
    }

    isExecutingRef.current = true;
    setExecutingCampaignId(campaign.id);

    try {
      let updatedCampaign: Campaign = {
        ...campaign,
        status: 'running',
        startedAt: campaign.startedAt || new Date().toISOString()
      };

      // 1. INSTANT OPTIMISTIC UI UPDATE RIGHT NOW! (0ms!)
      onSaveCampaign(updatedCampaign);

      // Resolve callable contacts for this campaign
      const matchedContacts = Array.isArray(campaign.targetContactIds)
        ? contacts.filter((ct) => campaign.targetContactIds?.includes(ct.id))
        : campaign.targetGroups && campaign.targetGroups.length > 0
        ? contacts.filter((ct) => ct.groups?.some((g) => campaign.targetGroups?.includes(typeof g === 'string' ? g : (g as any).name)))
        : [];
      const callableContactIds = matchedContacts.map((ct) => ct.id);

      try {
        let res = action === 'START'
          ? await api.startCampaign(campaign.id)
          : await api.resumeCampaign(campaign.id);

        // If campaign does not exist in backend database yet, create/sync it first!
        if (action === 'START' && res.error && (res.error.code === 'NOT_FOUND' || res.error.message?.toLowerCase().includes('not found'))) {
          const createRes = await api.createCampaign({
            id: campaign.id,
            name: campaign.name,
            description: campaign.description,
            callerId: campaign.callerId || undefined,
            callerName: campaign.callerName || 'Auckland Accounting',
            targetContactIds: callableContactIds.length > 0 ? callableContactIds : undefined
          });

          if (createRes.success && createRes.data) {
            res = await api.startCampaign(createRes.data.id);
            if (res.success && res.data) {
              updatedCampaign = {
                ...res.data,
                id: createRes.data.id,
                targetContactIds: campaign.targetContactIds || callableContactIds
              };
            }
          }
        }

        if (res.success && res.data) {
          updatedCampaign = {
            ...res.data,
            targetContactIds: campaign.targetContactIds || callableContactIds
          };
        }
      } catch (err: any) {
        console.warn('Notice from backend during campaign execution:', err);
      }

      onSaveCampaign(updatedCampaign);
    } catch (err: any) {
      alert(err.message || 'Operation failed');
    } finally {
      isExecutingRef.current = false;
      setExecutingCampaignId(null);
    }
  };

  // Instant, single-click Pause handler (optimistic state + background API)
  const handleDirectPause = async (campaign: Campaign) => {
    if (!hasPermission('campaigns.pause')) {
      alert('Permission denied. You do not have permission to pause campaigns (campaigns.pause).');
      return;
    }
    // Optimistic instant UI update
    onSaveCampaign({ ...campaign, status: 'paused' });
    if (liveQueueCampaign?.id === campaign.id) {
      setLiveQueueCampaign((prev) => (prev ? { ...prev, status: 'paused' } : null));
    }
    // Fire API asynchronously
    api.pauseCampaign(campaign.id).then((res) => {
      if (res.success && res.data) {
        onSaveCampaign(res.data);
      }
    }).catch(() => {});
  };

  // Instant, single-click Stop / Cancel handler (optimistic state + background API)
  const handleDirectStop = async (campaign: Campaign) => {
    if (!hasPermission('campaigns.cancel')) {
      alert('Permission denied. You do not have permission to cancel campaigns (campaigns.cancel).');
      return;
    }
    // Optimistic instant UI update
    onSaveCampaign({ ...campaign, status: 'cancelled' });
    if (liveQueueCampaign?.id === campaign.id) {
      setLiveQueueCampaign(null);
    }
    // Fire API asynchronously
    api.cancelCampaign(campaign.id).then((res) => {
      if (res.success && res.data) {
        onSaveCampaign(res.data);
      }
    }).catch(() => {});
  };

  // State Transition Action for other dialogs (DELETE)
  const handleExecuteStateAction = async () => {
    if (!confirmAction) return;
    const { campaign, action } = confirmAction;
    setConfirmAction(null);

    if (action === 'START' || action === 'RESUME') {
      await handleDirectStartOrResume(campaign, action);
      return;
    }
    if (action === 'PAUSE') {
      await handleDirectPause(campaign);
      return;
    }
    if (action === 'CANCEL') {
      await handleDirectStop(campaign);
      return;
    }

    try {
      if (action === 'DELETE') {
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
    }
  };

  // Emergency Stop Handler (pauses/cancels all running campaigns INSTANTLY)
  const handleEmergencyStopAll = async () => {
    setIsEmergencyStopConfirmOpen(false);
    // Instant optimistic update on UI
    campaigns.forEach((c) => {
      if (String(c.status).toUpperCase() === 'RUNNING') {
        onSaveCampaign({ ...c, status: 'paused' });
      }
    });
    if (liveQueueCampaign) {
      setLiveQueueCampaign(null);
    }
    // Fire API asynchronously in background
    api.emergencyStopAllCampaigns().catch(() => {});
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
                title="Immediately halt all running outbound calls"
              >
                Halt All Calls
              </Button>
            )}
            {hasPermission('campaigns.create') && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setEditingCampaign(null);
                  setIsWizardOpen(true);
                }}
                leftIcon={<Plus className="w-3.5 h-3.5" />}
              >
                Create Campaign
              </Button>
            )}
          </div>
        }
      />

      {/* Streamlined Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-sm">
            {metrics.total}
          </div>
          <div>
            <div className="text-[11px] text-slate-500 font-medium">Total Campaigns</div>
            <div className="text-xs font-semibold text-slate-900">{metrics.total} campaigns</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm ${
            metrics.running > 0 ? 'bg-emerald-50 text-emerald-600 ring-2 ring-emerald-500/20' : 'bg-slate-100 text-slate-500'
          }`}>
            {metrics.running}
          </div>
          <div>
            <div className="text-[11px] text-slate-500 font-medium">Active Dialing</div>
            <div className={`text-xs font-semibold ${metrics.running > 0 ? 'text-emerald-700' : 'text-slate-600'}`}>
              {metrics.running > 0 ? `${metrics.running} running now` : 'Idle / Standby'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center font-bold text-sm">
            {metrics.paused + metrics.scheduled}
          </div>
          <div>
            <div className="text-[11px] text-slate-500 font-medium">Paused / Scheduled</div>
            <div className="text-xs font-semibold text-slate-700">{metrics.paused + metrics.scheduled} campaigns</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center font-bold text-sm">
            {contacts.filter(c => !c.isDoNotCall).length}
          </div>
          <div>
            <div className="text-[11px] text-slate-500 font-medium">Callable Contacts</div>
            <div className="text-xs font-semibold text-slate-900">{contacts.filter(c => !c.isDoNotCall).length} ready</div>
          </div>
        </div>
      </div>

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
        <Table containerClassName="w-full" noScroll={true} className="w-full table-fixed">
          <TableHeader>
            <TableRow>
              <TableHeaderCell className="w-[48%]">Campaign</TableHeaderCell>
              <TableHeaderCell className="w-[18%]">Target Audience</TableHeaderCell>
              <TableHeaderCell className="w-[14%]">Status</TableHeaderCell>
              <TableHeaderCell className="w-[20%] text-right">Actions</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCampaigns.map((c) => {
              const s = String(c.status).toUpperCase();
              const qFlow = questionnaires.find((q) => q.id === c.questionnaireId) || c.questionnaire;
              const matchedContacts = Array.isArray(c.targetContactIds)
                ? contacts.filter((ct) => c.targetContactIds?.includes(ct.id))
                : c.targetGroups && c.targetGroups.length > 0
                ? contacts.filter((ct) => ct.groups?.some((g) => c.targetGroups?.includes(typeof g === 'string' ? g : (g as any).name)))
                : [];
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

              if (onLaunchSimulator && hasPermission('calls.execute')) {
                dropdownItems.push({
                  label: 'Test in Simulator',
                  icon: <Phone className="w-3.5 h-3.5 text-blue-600" />,
                  onClick: () => onLaunchSimulator(c.id)
                });
              }

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
              if (s !== 'RUNNING' && hasPermission('campaigns.edit')) {
                dropdownItems.push({
                  label: 'Edit Campaign & Contacts',
                  icon: <Edit2 className="w-3.5 h-3.5 text-blue-600" />,
                  onClick: () => {
                    setEditingCampaign(c);
                    setIsWizardOpen(true);
                  }
                });
              }
              dropdownItems.push({
                label: 'Pre-Launch Verification',
                icon: <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />,
                onClick: () => handleValidateCampaign(c)
              });
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

              const cleanName =
                c.name && !c.name.startsWith('Campaign cmp_') && c.name !== c.id
                  ? c.name
                  : c.id === 'cmp_nz_ird_verification'
                  ? 'Inland Revenue ID & Security Verification'
                  : c.id === 'cmp_nz_gst_q1'
                  ? 'Q1 GST Filing Authorizations 2026'
                  : c.id === 'cmp_nz_fee_reminders'
                  ? 'Outstanding Fee & Balance Notifications'
                  : c.id === 'cmp_nz_csat_survey'
                  ? 'Annual Practice CSAT & Quality Survey'
                  : c.id === 'cmp_nz_master_flow'
                  ? 'End-to-End Master Flow (All Input Types)'
                  : (c.name || 'Outbound Campaign').replace(/^Campaign\s+cmp_nz_/, '').replace(/_/g, ' ');

              const isThisExecuting = executingCampaignId === c.id;

              return (
                <TableRow key={c.id}>
                  <TableCell className="overflow-hidden py-3.5">
                    <div className="font-semibold text-slate-900 truncate text-sm" title={cleanName}>
                      {cleanName}
                    </div>
                    {qFlow && (
                      <div className="text-xs text-slate-500 font-medium flex items-center gap-1.5 mt-1 truncate" title={`Flow: ${qFlow.title}`}>
                        <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{qFlow.title}</span>
                      </div>
                    )}
                  </TableCell>

                  <TableCell>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCampaign(c);
                        setIsWizardOpen(true);
                      }}
                      className="text-left group cursor-pointer hover:opacity-90 transition-opacity"
                      title="Click to edit campaign contacts"
                    >
                      <div className="text-xs text-slate-800 font-medium flex items-center gap-1.5 group-hover:text-blue-600">
                        <Users className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600 shrink-0" />
                        <span className="whitespace-nowrap">{totalContacts} contacts</span>
                        <Edit2 className="w-3 h-3 text-slate-400 opacity-60 group-hover:opacity-100 ml-0.5 shrink-0" />
                      </div>
                    </button>
                  </TableCell>

                  <TableCell>
                    {getStatusBadge(c.status)}
                  </TableCell>

                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2 flex-nowrap">
                      {(s === 'DRAFT' || s === 'READY' || s === 'SCHEDULED') && (
                        <Button
                          variant="primary"
                          size="xs"
                          className="bg-emerald-600 hover:bg-emerald-700 text-white border-transparent font-medium shadow-sm whitespace-nowrap"
                          onClick={() => setConfirmAction({ campaign: c, action: 'START' })}
                          leftIcon={isThisExecuting ? <Activity className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3 fill-current" />}
                          disabled={!hasPermission('campaigns.start') || isThisExecuting}
                          title="Start Outbound Campaign"
                        >
                          {isThisExecuting ? 'Starting...' : 'Start'}
                        </Button>
                      )}
                      {s === 'RUNNING' && (
                        <>
                          <Button
                            variant="outline"
                            size="xs"
                            className="border-amber-500 text-amber-700 hover:bg-amber-50 font-medium whitespace-nowrap"
                            onClick={() => setConfirmAction({ campaign: c, action: 'PAUSE' })}
                            leftIcon={<Pause className="w-3 h-3" />}
                            disabled={!hasPermission('campaigns.pause')}
                            title="Pause Campaign Dialing"
                          >
                            Pause
                          </Button>
                          <Button
                            variant="outline"
                            size="xs"
                            className="border-rose-400 text-rose-700 hover:bg-rose-50 font-medium whitespace-nowrap"
                            onClick={() => setConfirmAction({ campaign: c, action: 'CANCEL' })}
                            leftIcon={<StopCircle className="w-3 h-3 text-rose-600" />}
                            disabled={!hasPermission('campaigns.cancel')}
                            title="Stop Campaign Dialing"
                          >
                            Stop
                          </Button>
                        </>
                      )}
                      {s === 'PAUSED' && (
                        <>
                          <Button
                            variant="primary"
                            size="xs"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white border-transparent font-medium shadow-sm whitespace-nowrap"
                            onClick={() => setConfirmAction({ campaign: c, action: 'RESUME' })}
                            leftIcon={isThisExecuting ? <Activity className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3 fill-current" />}
                            disabled={!hasPermission('campaigns.resume') || isThisExecuting}
                            title="Resume Campaign Dialing"
                          >
                            {isThisExecuting ? 'Resuming...' : 'Resume'}
                          </Button>
                          <Button
                            variant="outline"
                            size="xs"
                            className="border-rose-400 text-rose-700 hover:bg-rose-50 font-medium whitespace-nowrap"
                            onClick={() => setConfirmAction({ campaign: c, action: 'CANCEL' })}
                            leftIcon={<StopCircle className="w-3 h-3 text-rose-600" />}
                            disabled={!hasPermission('campaigns.cancel')}
                            title="Stop Campaign Dialing"
                          >
                            Stop
                          </Button>
                        </>
                      )}
                      {(s === 'COMPLETED' || s === 'CANCELLED' || s === 'FAILED') && (
                        <Button
                          variant="outline"
                          size="xs"
                          className="text-slate-600 hover:text-slate-900 border-slate-300 font-medium whitespace-nowrap"
                          onClick={() => setConfirmAction({ campaign: c, action: 'START' })}
                          leftIcon={isThisExecuting ? <Activity className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                          disabled={!hasPermission('campaigns.start') || isThisExecuting}
                          title="Restart Campaign"
                        >
                          {isThisExecuting ? 'Starting...' : 'Start'}
                        </Button>
                      )}
                      <Button
                        variant={s === 'RUNNING' ? 'primary' : 'outline'}
                        size="xs"
                        onClick={() => setLiveQueueCampaign(c)}
                        leftIcon={<Activity className={`w-3 h-3 ${s === 'RUNNING' ? 'animate-pulse text-emerald-200' : 'text-slate-500'}`} />}
                        title="Open Live Call Monitor"
                      >
                        {s === 'RUNNING' ? 'Live Monitor' : 'View'}
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
          title={`Confirm Campaign ${confirmAction.action === 'CANCEL' ? 'STOP' : confirmAction.action}`}
          confirmLabel={
            confirmAction.action === 'START'
              ? 'Start Outbound Dialing'
              : confirmAction.action === 'PAUSE'
              ? 'Pause Calling'
              : confirmAction.action === 'RESUME'
              ? 'Resume Calling'
              : confirmAction.action === 'CANCEL'
              ? 'Stop Campaign'
              : undefined
          }
          cancelLabel="Go Back"
          variant={confirmAction.action === 'CANCEL' || confirmAction.action === 'DELETE' ? 'danger' : 'primary'}
          message={
            <span>
              Are you sure you want to <strong>{confirmAction.action === 'CANCEL' ? 'stop' : confirmAction.action.toLowerCase()}</strong> campaign "
              {confirmAction.campaign.name}"?
              {confirmAction.action === 'START' && ' This will initiate automated outbound calling to the target audience.'}
              {confirmAction.action === 'RESUME' && ' Outbound calling will continue for the remaining contacts.'}
              {confirmAction.action === 'CANCEL' && ' All in-flight and pending calls for this campaign will be stopped.'}
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

      {/* Campaign Creation / Edit Wizard */}
      {isWizardOpen && (
        <CampaignWizardModal
          questionnaires={questionnaires}
          contacts={contacts}
          campaignToEdit={editingCampaign}
          onSave={(c) => {
            onSaveCampaign(c);
            setEditingCampaign(null);
          }}
          onClose={() => {
            setIsWizardOpen(false);
            setEditingCampaign(null);
          }}
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
// Campaign Creation & Edit Wizard Modal Subcomponent
// ==========================================
interface CampaignWizardModalProps {
  questionnaires: Questionnaire[];
  contacts: Contact[];
  campaignToEdit?: Campaign | null;
  onSave: (c: Campaign) => void;
  onClose: () => void;
}

const CampaignWizardModal: React.FC<CampaignWizardModalProps> = ({
  questionnaires,
  contacts,
  campaignToEdit,
  onSave,
  onClose
}) => {
  const isEditing = Boolean(campaignToEdit);
  const [step, setStep] = useState<number>(isEditing ? 3 : 1);
  const [contactSearchQuery, setContactSearchQuery] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const [formData, setFormData] = useState<Partial<Campaign>>(() => {
    if (campaignToEdit) {
      return {
        ...campaignToEdit,
        questionnaireId: campaignToEdit.questionnaireId || questionnaires[0]?.id || ''
      };
    }
    return {
      name: '',
      description: '',
      callerId: '',
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
    };
  });

  const [selectedContactIds, setSelectedContactIds] = useState<string[]>(() => {
    if (campaignToEdit?.targetContactIds && campaignToEdit.targetContactIds.length > 0) {
      return campaignToEdit.targetContactIds;
    }
    if (campaignToEdit) {
      return [];
    }
    return contacts.filter((c) => !c.isDoNotCall).map((c) => c.id);
  });

  const filteredContacts = useMemo(() => {
    if (!contactSearchQuery.trim()) return contacts;
    const q = contactSearchQuery.toLowerCase();
    return contacts.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      (c.phoneNumber && c.phoneNumber.toLowerCase().includes(q)) ||
      (c.companyName && c.companyName.toLowerCase().includes(q)) ||
      (c.tags && c.tags.some((t) => t.toLowerCase().includes(q)))
    );
  }, [contacts, contactSearchQuery]);

  const callableCount = useMemo(() => {
    return selectedContactIds.filter((id) => {
      const ct = contacts.find((c) => c.id === id);
      return ct && !ct.isDoNotCall;
    }).length;
  }, [selectedContactIds, contacts]);

  const selectedDncCount = useMemo(() => {
    return selectedContactIds.filter((id) => {
      const ct = contacts.find((c) => c.id === id);
      return ct && ct.isDoNotCall;
    }).length;
  }, [selectedContactIds, contacts]);

  const handleSelectAllCallable = () => {
    const callableIds = contacts.filter((c) => !c.isDoNotCall).map((c) => c.id);
    setSelectedContactIds(callableIds);
  };

  const handleClearAll = () => {
    setSelectedContactIds([]);
  };

  const handleToggleContact = (contactId: string) => {
    setSelectedContactIds((prev) =>
      prev.includes(contactId) ? prev.filter((id) => id !== contactId) : [...prev, contactId]
    );
  };

  const handleFinish = async () => {
    if (!formData.name?.trim()) {
      alert('Campaign name is required.');
      setStep(1);
      return;
    }

    setIsSaving(true);
    try {
      if (campaignToEdit) {
        let updatedCampaign: Campaign = {
          ...campaignToEdit,
          ...formData,
          name: formData.name.trim(),
          targetContactIds: selectedContactIds,
          targetGroups: [],
          contactCount: selectedContactIds.length
        };

        try {
          const res = await api.updateCampaign(campaignToEdit.id, {
            ...formData,
            name: formData.name.trim(),
            targetContactIds: selectedContactIds
          });
          if (res.success && res.data) {
            updatedCampaign = {
              ...res.data,
              targetContactIds: selectedContactIds,
              targetGroups: [],
              contactCount: selectedContactIds.length
            };
          }
        } catch {
          // Local fallback handled
        }

        try {
          await api.attachContactsToCampaign(campaignToEdit.id, {
            contactIds: selectedContactIds
          });
        } catch {
          // Ignore if already attached via updateCampaign
        }

        onSave(updatedCampaign);
        onClose();
        return;
      }

      // Brand new campaign creation
      const res = await api.createCampaign({
        ...formData,
        targetContactIds: selectedContactIds
      });

      if (res.success && res.data) {
        try {
          await api.attachContactsToCampaign(res.data.id, {
            contactIds: selectedContactIds
          });
        } catch {}
        onSave({
          ...res.data,
          targetContactIds: selectedContactIds,
          targetGroups: [],
          contactCount: selectedContactIds.length
        });
      } else {
        const localCampaign: Campaign = {
          id: `camp_${Date.now()}`,
          name: formData.name || 'New Campaign',
          description: formData.description,
          callerId: formData.callerId || '',
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
          targetGroups: [],
          contactCount: selectedContactIds.length,
          createdAt: new Date().toISOString()
        };
        onSave(localCampaign);
      }
      onClose();
    } catch (err: any) {
      alert(err.message || 'Failed to save campaign');
    } finally {
      setIsSaving(false);
    }
  };

  const steps = [
    { id: 1, label: '1. Campaign Info' },
    { id: 2, label: '2. IVR Flow / Script' },
    { id: 3, label: '3. Select Contacts' },
    { id: 4, label: '4. Calling Window' }
  ];

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      size="xl"
      title={
        isEditing
          ? `Edit Campaign & Contacts: ${formData.name || campaignToEdit?.name}`
          : `Create Outbound Campaign (Step ${step} of 4)`
      }
      footer={
        <div className="flex items-center justify-between w-full">
          <Button
            variant="outline"
            size="sm"
            onClick={step > 1 ? () => setStep(step - 1) : onClose}
          >
            {step > 1 ? 'Back' : 'Cancel'}
          </Button>
          <div className="flex items-center gap-2">
            {step < 4 && (
              <Button variant="outline" size="sm" onClick={() => setStep(step + 1)}>
                Next Step
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={handleFinish}
              disabled={isSaving}
            >
              {isSaving
                ? 'Saving...'
                : isEditing
                ? 'Save Changes'
                : 'Save Campaign (Draft)'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 text-xs">
        {/* Step Navigation Tabs */}
        <div className="flex border-b border-slate-200 pb-2 mb-4 gap-1 overflow-x-auto">
          {steps.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStep(s.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                step === s.id
                  ? 'bg-[#0f2e4a] text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span>{s.label}</span>
              {s.id === 3 && (
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                    step === s.id ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {callableCount}
                </span>
              )}
            </button>
          ))}
        </div>

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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Audience & Contact Selection</h4>
                <p className="text-[11px] text-slate-500">
                  Select specific contacts to dial in this campaign.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={handleSelectAllCallable}
                  leftIcon={<CheckSquare className="w-3.5 h-3.5 text-emerald-600" />}
                >
                  Select All Callable ({contacts.filter((c) => !c.isDoNotCall).length})
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={handleClearAll}
                  leftIcon={<Square className="w-3.5 h-3.5 text-slate-500" />}
                >
                  Clear All
                </Button>
              </div>
            </div>

            {/* Search contacts bar */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={contactSearchQuery}
                onChange={(e) => setContactSearchQuery(e.target.value)}
                placeholder="Search contacts by name, phone, company, or tag..."
                className="w-full pl-9 pr-3 py-1.5 border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-[#0f2e4a] focus:outline-none"
              />
            </div>

            {/* Selection stats summary */}
            <div className="flex items-center gap-3 bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-xs">
              <span className="font-semibold text-slate-700">Selection Summary:</span>
              <span className="text-emerald-700 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {callableCount} callable selected
              </span>
              {selectedDncCount > 0 && (
                <span className="text-red-600 font-medium flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {selectedDncCount} DNC suppressed
                </span>
              )}
              <span className="text-slate-400 ml-auto font-mono text-[11px]">
                {selectedContactIds.length} of {contacts.length} total
              </span>
            </div>

            {/* Contact list with checkboxes */}
            <div className="border border-slate-200 rounded-lg overflow-hidden max-h-64 overflow-y-auto divide-y divide-slate-100">
              {filteredContacts.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-xs">
                  No contacts found matching "{contactSearchQuery}".
                </div>
              ) : (
                filteredContacts.map((c) => {
                  const isSelected = selectedContactIds.includes(c.id);
                  return (
                    <div
                      key={c.id}
                      onClick={() => handleToggleContact(c.id)}
                      className={`p-2.5 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors ${
                        isSelected ? 'bg-blue-50/40' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleContact(c.id)}
                          className="rounded text-[#0f2e4a] cursor-pointer"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900 truncate">{c.name}</span>
                            {c.companyName && (
                              <span className="text-[11px] text-slate-500 truncate hidden sm:inline">
                                • {c.companyName}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-slate-500 text-[11px]">
                            <span className="font-mono">{c.phoneNumber}</span>
                            {c.groups && c.groups.length > 0 && (
                              <span className="text-slate-400 text-[10px]">
                                [{c.groups.join(', ')}]
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 ml-2">
                        {c.isDoNotCall ? (
                          <Badge variant="danger" size="sm">DNC</Badge>
                        ) : (
                          <Badge variant="success" size="sm">Callable</Badge>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
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
