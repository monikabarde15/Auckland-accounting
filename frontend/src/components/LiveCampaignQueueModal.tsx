import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Phone,
  PhoneCall,
  PhoneForwarded,
  PhoneOff,
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  Clock,
  AlertOctagon,
  Users,
  ShieldCheck,
  Building2,
  Layers,
  ArrowRight,
  Headphones,
  Zap,
  Activity
} from 'lucide-react';
import { Campaign, Questionnaire, Contact, CallLog, CallStatus } from '../types';
import { Modal, Button, Badge } from './ui';

interface LiveCampaignQueueModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaign: Campaign;
  questionnaire?: Questionnaire;
  contacts: Contact[];
  onSaveCallLog?: (log: CallLog) => void;
  onUpdateCampaign?: (campaign: Campaign) => void;
  onLaunchSimulator?: (campaignId?: string, contactId?: string) => void;
}

interface QueueItem {
  contact: Contact;
  status: 'QUEUED' | 'DIALING' | 'IN_PROGRESS' | 'COMPLETED' | 'TRANSFERRED' | 'FAILED' | 'DNC_SUPPRESSED';
  attemptNumber: number;
  durationSeconds: number;
  currentStepPrompt?: string;
  responseSummary?: string;
  startedAt?: string;
  completedAt?: string;
}

export const LiveCampaignQueueModal: React.FC<LiveCampaignQueueModalProps> = ({
  isOpen,
  onClose,
  campaign,
  questionnaire,
  contacts,
  onSaveCallLog,
  onUpdateCampaign,
  onLaunchSimulator
}) => {
  // Resolve target contacts for this campaign
  const targetContacts = useMemo(() => {
    if (campaign.targetContactIds && campaign.targetContactIds.length > 0) {
      return contacts.filter((c) => campaign.targetContactIds?.includes(c.id));
    }
    if (campaign.targetGroups && campaign.targetGroups.length > 0) {
      return contacts.filter((c) => c.groups?.some((g) => campaign.targetGroups?.includes(typeof g === 'string' ? g : g.name)));
    }
    return contacts;
  }, [campaign, contacts]);

  // Queue state initialization
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [activeCallIndex, setActiveCallIndex] = useState<number | null>(null);
  const [isAutoDialing, setIsAutoDialing] = useState<boolean>(false);
  const [callTimer, setCallTimer] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'ALL' | 'ACTIVE' | 'QUEUE' | 'COMPLETED'>('ALL');
  const [dialSpeed, setDialSpeed] = useState<'NORMAL' | 'FAST'>('NORMAL');

  // Initialize or reset queue items when campaign opens
  useEffect(() => {
    if (!isOpen) {
      setIsAutoDialing(false);
      setActiveCallIndex(null);
      return;
    }

    const items: QueueItem[] = targetContacts.map((contact) => ({
      contact,
      status: contact.isDoNotCall ? 'DNC_SUPPRESSED' : 'QUEUED',
      attemptNumber: 0,
      durationSeconds: 0
    }));

    setQueueItems(items);
  }, [isOpen, targetContacts]);

  // Live call seconds counter
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (activeCallIndex !== null) {
      interval = setInterval(() => {
        setCallTimer((prev) => prev + 1);
      }, 1000);
    } else {
      setCallTimer(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeCallIndex]);

  // Active call reference
  const currentActiveItem = activeCallIndex !== null ? queueItems[activeCallIndex] : null;

  // Auto-Dialing Queue Progression Engine
  const autoDialRef = useRef<NodeJS.Timeout | null>(null);

  const dialNextContact = () => {
    // Find next available queued item
    const nextIdx = queueItems.findIndex((item) => item.status === 'QUEUED');
    if (nextIdx === -1) {
      setIsAutoDialing(false);
      setActiveCallIndex(null);
      return;
    }

    // Mark as DIALING & IN_PROGRESS
    setActiveCallIndex(nextIdx);
    setCallTimer(0);

    const firstQuestion = questionnaire?.questions?.[0];
    const initialPrompt = firstQuestion?.promptText || 'Connecting to client line...';

    setQueueItems((prev) =>
      prev.map((item, idx) =>
        idx === nextIdx
          ? {
              ...item,
              status: 'IN_PROGRESS',
              attemptNumber: 1,
              startedAt: new Date().toISOString(),
              currentStepPrompt: initialPrompt
            }
          : item
      )
    );

    // Simulate call flow steps
    const stepDelay = dialSpeed === 'FAST' ? 1400 : 2600;

    setTimeout(() => {
      // Step 2: Answered and customer provides DTMF response
      const secondQuestion = questionnaire?.questions?.[1];
      const opt = secondQuestion?.options?.[0];

      setQueueItems((prev) =>
        prev.map((item, idx) =>
          idx === nextIdx
            ? {
                ...item,
                currentStepPrompt: secondQuestion?.promptText || 'Gathering response...',
                responseSummary: opt ? `Selected: [${opt.dtmfDigit}] ${opt.label}` : 'Verified via DTMF [1]'
              }
            : item
        )
      );

      // Step 3: Complete Call & Log Result
      setTimeout(() => {
        const isTransfer = Math.random() > 0.75;
        const finalStatus: CallStatus = isTransfer ? 'transferred' : 'completed';
        const finalDuration = Math.floor(Math.random() * 25) + 15;

        setQueueItems((prev) =>
          prev.map((item, idx) =>
            idx === nextIdx
              ? {
                  ...item,
                  status: isTransfer ? 'TRANSFERRED' : 'COMPLETED',
                  durationSeconds: finalDuration,
                  completedAt: new Date().toISOString(),
                  responseSummary: isTransfer
                    ? 'Call transferred to Assigned Accountant'
                    : 'Filing authorization recorded & submitted'
                }
              : item
          )
        );

        // Save CallLog to workspace
        if (onSaveCallLog) {
          const currentContact = queueItems[nextIdx].contact;
          const log: CallLog = {
            id: `call_live_${Date.now()}_${nextIdx}`,
            campaignId: campaign.id,
            campaignName: campaign.name,
            contactId: currentContact.id,
            contactName: currentContact.name,
            companyName: currentContact.companyName,
            phoneNumber: currentContact.phoneNumber,
            status: finalStatus,
            attemptNumber: 1,
            startedAt: new Date(Date.now() - finalDuration * 1000).toISOString(),
            endedAt: new Date().toISOString(),
            durationSeconds: finalDuration,
            responses: [
              {
                questionId: firstQuestion?.id || 'q1',
                questionName: firstQuestion?.name || 'Identity Verification',
                questionType: firstQuestion?.type || 'yes_no',
                promptText: firstQuestion?.promptText || 'Draft review confirmation',
                inputReceived: '1',
                inputMethod: 'dtmf',
                recordedAt: new Date().toISOString(),
                isValid: true
              }
            ],
            transcript: [
              { speaker: 'system', text: firstQuestion?.promptText || 'Welcome to Auckland Accounting', timestamp: new Date(Date.now() - finalDuration * 1000).toISOString() },
              { speaker: 'user', text: 'Pressed DTMF Key [1] (Confirmation)', timestamp: new Date(Date.now() - 5000).toISOString() },
              { speaker: 'system', text: isTransfer ? 'Transferring call to accountant...' : 'Authorization recorded. Thank you.', timestamp: new Date().toISOString() }
            ]
          };
          onSaveCallLog(log);
        }

        setActiveCallIndex(null);
      }, stepDelay);
    }, stepDelay);
  };

  // Continuous auto-dial loop effect
  useEffect(() => {
    if (!isAutoDialing) {
      if (autoDialRef.current) clearTimeout(autoDialRef.current);
      return;
    }

    if (activeCallIndex === null) {
      const hasQueued = queueItems.some((item) => item.status === 'QUEUED');
      if (hasQueued) {
        autoDialRef.current = setTimeout(() => {
          dialNextContact();
        }, dialSpeed === 'FAST' ? 600 : 1200);
      } else {
        setIsAutoDialing(false);
      }
    }

    return () => {
      if (autoDialRef.current) clearTimeout(autoDialRef.current);
    };
  }, [isAutoDialing, activeCallIndex, queueItems, dialSpeed]);

  // Statistics
  const stats = useMemo(() => {
    const total = queueItems.length;
    const queued = queueItems.filter((i) => i.status === 'QUEUED').length;
    const dialing = queueItems.filter((i) => i.status === 'IN_PROGRESS' || i.status === 'DIALING').length;
    const completed = queueItems.filter((i) => i.status === 'COMPLETED').length;
    const transferred = queueItems.filter((i) => i.status === 'TRANSFERRED').length;
    const dnc = queueItems.filter((i) => i.status === 'DNC_SUPPRESSED').length;
    const processed = completed + transferred;
    const progressPercent = total > 0 ? Math.round((processed / total) * 100) : 0;

    return { total, queued, dialing, completed, transferred, dnc, processed, progressPercent };
  }, [queueItems]);

  // Filtered queue items for table
  const filteredItems = useMemo(() => {
    if (activeTab === 'ACTIVE') {
      return queueItems.filter((i) => i.status === 'IN_PROGRESS' || i.status === 'DIALING');
    }
    if (activeTab === 'QUEUE') {
      return queueItems.filter((i) => i.status === 'QUEUED');
    }
    if (activeTab === 'COMPLETED') {
      return queueItems.filter((i) => i.status === 'COMPLETED' || i.status === 'TRANSFERRED');
    }
    return queueItems;
  }, [queueItems, activeTab]);

  const formatSeconds = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="full"
      title={
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700 shadow-xs">
            <Activity className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-900">{campaign.name}</h3>
              <Badge variant={isAutoDialing || activeCallIndex !== null ? 'success' : 'neutral'} dot>
                {activeCallIndex !== null ? 'Live Dialing' : isAutoDialing ? 'Auto-Dialing' : 'Queue Standby'}
              </Badge>
            </div>
            <p className="text-xs text-slate-500 font-normal mt-0.5 flex items-center gap-3">
              <span>Caller ID: <strong className="font-mono text-slate-700">{campaign.callerId || '+1 737 250 8034'}</strong></span>
              <span>•</span>
              <span>Flow: <strong className="text-slate-700">{questionnaire?.title || 'Default Practice Flow'}</strong></span>
              <span>•</span>
              <span>Concurrency: <strong className="text-slate-700">{campaign.maxConcurrentCalls || 5} channels</strong></span>
            </p>
          </div>
        </div>
      }
      footer={
        <div className="flex items-center justify-between w-full text-xs">
          <div className="flex items-center gap-2 text-slate-500">
            <Clock className="w-3.5 h-3.5" />
            <span>Calling Window: {campaign.callingStartTime || '09:00'} – {campaign.callingEndTime || '18:00'} NZST</span>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Close Monitor
            </Button>
            {onLaunchSimulator && currentActiveItem && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onLaunchSimulator(campaign.id, currentActiveItem.contact.id)}
                leftIcon={<Headphones className="w-3.5 h-3.5 text-blue-600" />}
              >
                Listen in Simulator
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Top Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-slate-400" />
              Target Queue
            </div>
            <div className="text-xl font-bold text-slate-900 mt-1">{stats.total}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">{stats.queued} remaining in queue</div>
          </div>

          <div className={`p-3 border rounded-lg transition-colors ${stats.dialing > 0 ? 'bg-emerald-50/70 border-emerald-300' : 'bg-slate-50 border-slate-200'}`}>
            <div className="text-[11px] font-semibold text-emerald-800 uppercase tracking-wider flex items-center gap-1.5">
              <PhoneCall className={`w-3.5 h-3.5 ${stats.dialing > 0 ? 'text-emerald-600 animate-bounce' : 'text-slate-400'}`} />
              In Call (Active)
            </div>
            <div className="text-xl font-bold text-emerald-900 mt-1">{stats.dialing}</div>
            <div className="text-[11px] text-emerald-700 mt-0.5">Live on channel</div>
          </div>

          <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-lg">
            <div className="text-[11px] font-semibold text-blue-800 uppercase tracking-wider flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
              Completed
            </div>
            <div className="text-xl font-bold text-blue-900 mt-1">{stats.completed}</div>
            <div className="text-[11px] text-blue-700 mt-0.5">Verified & Recorded</div>
          </div>

          <div className="p-3 bg-amber-50/60 border border-amber-200 rounded-lg">
            <div className="text-[11px] font-semibold text-amber-800 uppercase tracking-wider flex items-center gap-1.5">
              <PhoneForwarded className="w-3.5 h-3.5 text-amber-600" />
              Transferred
            </div>
            <div className="text-xl font-bold text-amber-900 mt-1">{stats.transferred}</div>
            <div className="text-[11px] text-amber-700 mt-0.5">Escalated to Staff</div>
          </div>

          <div className="p-3 bg-rose-50/60 border border-rose-200 rounded-lg">
            <div className="text-[11px] font-semibold text-rose-800 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-rose-600" />
              DNC Blocked
            </div>
            <div className="text-xl font-bold text-rose-900 mt-1">{stats.dnc}</div>
            <div className="text-[11px] text-rose-700 mt-0.5">Suppressed for Safety</div>
          </div>
        </div>

        {/* Progress Bar & Queue Controls Bar */}
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-800">Campaign Execution Progress</span>
                <span className="text-xs font-mono font-semibold text-slate-600">
                  {stats.processed} / {stats.total} Contacts ({stats.progressPercent}%)
                </span>
              </div>
              <div className="w-full sm:w-80 bg-slate-100 rounded-full h-2 mt-1.5 overflow-hidden border border-slate-200">
                <div
                  className="bg-emerald-600 h-full rounded-full transition-all duration-300"
                  style={{ width: `${stats.progressPercent}%` }}
                />
              </div>
            </div>

            {/* Interactive Control Buttons */}
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs mr-2">
                <button
                  type="button"
                  onClick={() => setDialSpeed('NORMAL')}
                  className={`px-2 py-1 rounded-md text-[11px] font-medium transition cursor-pointer ${
                    dialSpeed === 'NORMAL' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Normal Speed
                </button>
                <button
                  type="button"
                  onClick={() => setDialSpeed('FAST')}
                  className={`px-2 py-1 rounded-md text-[11px] font-medium transition cursor-pointer flex items-center gap-1 ${
                    dialSpeed === 'FAST' ? 'bg-white text-indigo-700 shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Zap className="w-3 h-3 text-indigo-500" />
                  Fast (Demo)
                </button>
              </div>

              {!isAutoDialing ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setIsAutoDialing(true);
                    if (activeCallIndex === null) dialNextContact();
                  }}
                  leftIcon={<Play className="w-3.5 h-3.5 fill-white" />}
                >
                  {stats.queued > 0 ? 'Auto-Dial Queue' : 'Queue Finished'}
                </Button>
              ) : (
                <Button
                  variant="warning"
                  size="sm"
                  onClick={() => setIsAutoDialing(false)}
                  leftIcon={<Pause className="w-3.5 h-3.5" />}
                >
                  Pause Auto-Dialer
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={dialNextContact}
                disabled={stats.queued === 0 || activeCallIndex !== null}
                leftIcon={<ArrowRight className="w-3.5 h-3.5" />}
              >
                Dial Single Next
              </Button>
            </div>
          </div>
        </div>

        {/* Live Active Call Visualizer Stage */}
        {currentActiveItem ? (
          <div className="p-4 bg-linear-to-r from-emerald-900 via-slate-900 to-slate-900 rounded-xl text-white shadow-md border border-emerald-500/30 animate-in fade-in zoom-in-98 duration-200">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400 shrink-0">
                  <PhoneCall className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block" />
                      LIVE CALL IN PROGRESS
                    </span>
                    <span className="text-xs text-slate-400 font-mono">Channel #1</span>
                  </div>
                  <h4 className="text-lg font-bold text-white mt-0.5">
                    {currentActiveItem.contact.name}
                  </h4>
                  <div className="flex items-center gap-3 text-xs text-slate-300 mt-1">
                    <span className="font-mono bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700 text-emerald-300">
                      {currentActiveItem.contact.phoneNumber}
                    </span>
                    <span className="flex items-center gap-1">
                      <Building2 className="w-3.5 h-3.5 text-slate-400" />
                      {currentActiveItem.contact.companyName}
                    </span>
                    {currentActiveItem.contact.assignedAccountant && (
                      <span className="text-slate-400">
                        CA: {currentActiveItem.contact.assignedAccountant}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Live Duration & Speech Status */}
              <div className="flex items-center gap-6 bg-slate-800/80 p-3 rounded-lg border border-slate-700">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Call Duration</div>
                  <div className="text-xl font-mono font-bold text-emerald-400 mt-0.5">
                    {formatSeconds(callTimer)}
                  </div>
                </div>

                <div className="border-l border-slate-700 pl-4 min-w-[200px]">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Current IVR Step</div>
                  <div className="text-xs text-slate-200 mt-0.5 line-clamp-1 italic">
                    "{currentActiveItem.currentStepPrompt || 'Speaking prompt...'}"
                  </div>
                  {currentActiveItem.responseSummary && (
                    <div className="text-[11px] font-semibold text-emerald-400 mt-1">
                      ✓ {currentActiveItem.responseSummary}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-center py-6">
            <PhoneOff className="w-6 h-6 text-slate-400 mx-auto mb-2" />
            <div className="text-xs font-semibold text-slate-700">
              {stats.queued > 0 ? 'No active call in flight. Ready to dial.' : 'All numbers in queue have been dialed.'}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {stats.queued > 0
                ? 'Click "Auto-Dial Queue" above to start calling queued numbers sequentially.'
                : 'All contacts have received calls. View detailed call records in Call Logs.'}
            </p>
          </div>
        )}

        {/* Queue Table with Tab Filters */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('ALL')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                  activeTab === 'ALL' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                All Numbers ({queueItems.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('QUEUE')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                  activeTab === 'QUEUE' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Upcoming in Queue ({stats.queued})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('ACTIVE')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                  activeTab === 'ACTIVE' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                In Call ({stats.dialing})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('COMPLETED')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                  activeTab === 'COMPLETED' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Completed & Logged ({stats.processed})
              </button>
            </div>
          </div>

          <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-3.5 py-2.5">Position / Status</th>
                  <th className="px-3.5 py-2.5">Contact Name</th>
                  <th className="px-3.5 py-2.5">Phone Number</th>
                  <th className="px-3.5 py-2.5">Company / Entity</th>
                  <th className="px-3.5 py-2.5">Outcome / Notes</th>
                  <th className="px-3.5 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-normal">
                {filteredItems.map((item, idx) => {
                  const isCurrentActive = activeCallIndex !== null && queueItems[activeCallIndex]?.contact.id === item.contact.id;

                  return (
                    <tr
                      key={item.contact.id}
                      className={`transition-colors ${
                        isCurrentActive
                          ? 'bg-emerald-50/60 font-medium'
                          : item.status === 'DNC_SUPPRESSED'
                          ? 'bg-slate-50/50 opacity-60'
                          : 'hover:bg-slate-50/70'
                      }`}
                    >
                      <td className="px-3.5 py-2.5">
                        {isCurrentActive ? (
                          <Badge variant="success" dot>In Call Now</Badge>
                        ) : item.status === 'COMPLETED' ? (
                          <Badge variant="info">Completed</Badge>
                        ) : item.status === 'TRANSFERRED' ? (
                          <Badge variant="warning">Transferred</Badge>
                        ) : item.status === 'DNC_SUPPRESSED' ? (
                          <Badge variant="danger">DNC Blocked</Badge>
                        ) : (
                          <span className="text-slate-500 font-mono font-semibold">#{idx + 1} Queued</span>
                        )}
                      </td>

                      <td className="px-3.5 py-2.5">
                        <div className="font-semibold text-slate-900">{item.contact.name}</div>
                        <div className="text-[10px] text-slate-400">{item.contact.email}</div>
                      </td>

                      <td className="px-3.5 py-2.5">
                        <span className="font-mono text-slate-800 font-medium">{item.contact.phoneNumber}</span>
                      </td>

                      <td className="px-3.5 py-2.5">
                        <div className="text-slate-800">{item.contact.companyName}</div>
                        <div className="text-[10px] text-slate-400">Accountant: {item.contact.assignedAccountant || 'Unassigned'}</div>
                      </td>

                      <td className="px-3.5 py-2.5">
                        {item.responseSummary ? (
                          <span className="text-emerald-700 font-medium">{item.responseSummary}</span>
                        ) : item.status === 'DNC_SUPPRESSED' ? (
                          <span className="text-red-600">Suppressed by DNC Registry</span>
                        ) : item.status === 'QUEUED' ? (
                          <span className="text-slate-400 italic">Waiting in dialer queue</span>
                        ) : (
                          <span className="text-slate-500">In progress</span>
                        )}
                        {item.durationSeconds > 0 && (
                          <span className="text-[10px] text-slate-400 ml-2 font-mono">({item.durationSeconds}s)</span>
                        )}
                      </td>

                      <td className="px-3.5 py-2.5 text-right">
                        {onLaunchSimulator && item.status !== 'DNC_SUPPRESSED' && (
                          <button
                            type="button"
                            onClick={() => onLaunchSimulator(campaign.id, item.contact.id)}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium transition cursor-pointer"
                          >
                            Simulator
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
};
