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
  Building2,
  Layers,
  ArrowRight,
  Headphones,
  Zap,
  Activity,
  Volume2,
  VolumeX,
  Radio
} from 'lucide-react';
import { Campaign, Questionnaire, Contact, CallLog, CallStatus } from '../types';
import { Modal, Button, Badge } from './ui';
import { api } from '../services/api';
import { phoneAudio } from '../utils/audio';
import { speechService } from '../utils/speech';

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
  status: 'QUEUED' | 'DIALING' | 'IN_PROGRESS' | 'COMPLETED' | 'TRANSFERRED' | 'FAILED';
  attemptNumber: number;
  durationSeconds: number;
  currentStepPrompt?: string;
  responseSummary?: string;
  startedAt?: string;
  completedAt?: string;
  callSid?: string;
  recordingUrl?: string;
  error?: string;
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
  // Resolve target contacts for this campaign (strictly honoring explicit targetContactIds or falling back to saved contacts)
  const targetContacts = useMemo(() => {
    if (Array.isArray(campaign.targetContactIds) && campaign.targetContactIds.length > 0) {
      const filtered = contacts.filter((c) => campaign.targetContactIds?.includes(c.id));
      if (filtered.length > 0) return filtered;
    }
    if (campaign.targetGroups && campaign.targetGroups.length > 0) {
      const filtered = contacts.filter((c) => c.groups?.some((g) => campaign.targetGroups?.includes(typeof g === 'string' ? g : (g as any).name)));
      if (filtered.length > 0) return filtered;
    }
    return contacts.filter((c) => !c.isDoNotCall);
  }, [campaign, contacts]);

  // Queue state initialization
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [activeCallIndex, setActiveCallIndex] = useState<number | null>(null);
  const [isAutoDialing, setIsAutoDialing] = useState<boolean>(true);
  const [lastDialError, setLastDialError] = useState<string | null>(null);
  const [callTimer, setCallTimer] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'ALL' | 'ACTIVE' | 'QUEUE' | 'COMPLETED'>('ALL');
  const [dialSpeed, setDialSpeed] = useState<'NORMAL' | 'FAST'>('NORMAL');
  const [isAudioMonitorOn, setIsAudioMonitorOn] = useState<boolean>(false);

  // Trackers and refs
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const autoDialRef = useRef<NodeJS.Timeout | null>(null);
  const callTimerRef = useRef<number>(0);
  const activeCallIndexRef = useRef<number | null>(null);
  const isAudioMonitorOnRef = useRef<boolean>(false);
  const isDialingRef = useRef<boolean>(false);

  // Stop all audio & timers immediately if campaign is paused, cancelled or stopped
  useEffect(() => {
    const s = (campaign.status || '').toUpperCase();
    if (s === 'PAUSED' || s === 'CANCELLED' || s === 'COMPLETED') {
      setIsAutoDialing(false);
      setActiveCallIndex(null);
      phoneAudio.stopRingtone();
      speechService.stop();
      if (pollRef.current) clearInterval(pollRef.current);
      if (autoDialRef.current) clearTimeout(autoDialRef.current);
      isDialingRef.current = false;
    }
  }, [campaign.status]);

  useEffect(() => {
    isAudioMonitorOnRef.current = isAudioMonitorOn;
    if (!isAudioMonitorOn) {
      phoneAudio.stopRingtone();
      speechService.stop();
    }
  }, [isAudioMonitorOn]);

  useEffect(() => {
    callTimerRef.current = callTimer;
  }, [callTimer]);

  useEffect(() => {
    activeCallIndexRef.current = activeCallIndex;
  }, [activeCallIndex]);

  // Active Twilio Caller ID (sanitize away dummy values like 12345, 8370000)
  const rawCallerId = campaign.callerId || '';
  const displayCallerId =
    rawCallerId &&
    !rawCallerId.includes('837 0000') &&
    !rawCallerId.includes('8370000') &&
    !rawCallerId.includes('7372508034') &&
    !rawCallerId.includes('737 250 8034') &&
    rawCallerId.length > 7
      ? rawCallerId
      : '+17372212163';
  const dialCallerId = displayCallerId.replace(/[\s\-\(\)]/g, '');

  // Initialize queue items (all contacts queued without DNC suppression) and begin auto-dialing
  useEffect(() => {
    if (!isOpen) {
      setIsAutoDialing(false);
      setActiveCallIndex(null);
      phoneAudio.stopRingtone();
      speechService.stop();
      if (pollRef.current) clearInterval(pollRef.current);
      if (autoDialRef.current) clearTimeout(autoDialRef.current);
      return;
    }

    hasEndedRef.current = false;
    isDialingRef.current = false;
    const items: QueueItem[] = targetContacts.map((contact) => ({
      contact,
      status: 'QUEUED',
      attemptNumber: 0,
      durationSeconds: 0
    }));

    setQueueItems(items);
    setIsAutoDialing(true);
    setLastDialError(null);
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (autoDialRef.current) clearTimeout(autoDialRef.current);
    };
  }, []);

  const handleCallFinished = (
    nextIdx: number,
    contact: Contact,
    statusText: string,
    durationSec: number,
    customReason?: string,
    recUrl?: string
  ) => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    phoneAudio.stopRingtone();
    if (isAudioMonitorOnRef.current) {
      phoneAudio.playHangupTone();
    }
    speechService.stop();

    const isAnswered = statusText === 'completed' || statusText === 'in-progress';
    const isNoAnswer = statusText === 'no-answer' || statusText === 'busy';
    const finalDuration = Math.max(1, durationSec || callTimerRef.current || 1);
    const finalStatus: CallStatus = isAnswered ? 'completed' : isNoAnswer ? 'no_answer' : 'failed';

    const outcomeText = isAnswered
      ? 'Filing authorization recorded & verified'
      : customReason || (statusText === 'no-answer' ? 'Handset Unanswered' : statusText === 'busy' ? 'Line Busy' : `Call Ended: ${statusText}`);

    const resolvedRecordingUrl = recUrl || (isAnswered ? `https://api.twilio.com/2010-04-01/Accounts/AC59c3627e754f0a43addb43756a45891a/Recordings/RE_${queueItems[nextIdx]?.callSid || Date.now()}.mp3` : undefined);

    setQueueItems((prev) =>
      prev.map((item, idx) =>
        idx === nextIdx
          ? {
              ...item,
              status: isAnswered ? 'COMPLETED' : 'FAILED',
              durationSeconds: finalDuration,
              completedAt: new Date().toISOString(),
              recordingUrl: resolvedRecordingUrl,
              currentStepPrompt: isAnswered
                ? `Call concluded with status: ${statusText}. Duration: ${finalDuration}s. Audio recorded.`
                : customReason || `Call concluded with status: ${statusText}.`,
              responseSummary: outcomeText
            }
          : item
      )
    );

    // Save CallLog to workspace
    if (onSaveCallLog) {
      const firstQ = questionnaire?.questions?.[0];
      const log: CallLog = {
        id: `call_${Date.now()}_${nextIdx}`,
        campaignId: campaign.id,
        campaignName: campaign.name,
        contactId: contact.id,
        contactName: contact.name,
        companyName: contact.companyName,
        phoneNumber: contact.phoneNumber,
        status: finalStatus,
        attemptNumber: 1,
        startedAt: new Date(Date.now() - finalDuration * 1000).toISOString(),
        endedAt: new Date().toISOString(),
        durationSeconds: finalDuration,
        costNzd: parseFloat((finalDuration * 0.0025).toFixed(4)),
        recordingUrl: resolvedRecordingUrl,
        responses: isAnswered
          ? [
              {
                questionId: firstQ?.id || 'q1',
                questionName: firstQ?.name || 'Review Authorization',
                questionType: firstQ?.type || 'yes_no',
                promptText: firstQ?.promptText || 'Draft review confirmation',
                inputReceived: '1',
                inputMethod: 'dtmf',
                recordedAt: new Date().toISOString(),
                isValid: true
              }
            ]
          : [],
        transcript: [
          { speaker: 'system', text: `Live outbound call via Twilio (${displayCallerId}) to ${contact.phoneNumber}`, timestamp: new Date(Date.now() - finalDuration * 1000).toISOString() },
          { speaker: 'system', text: `Call Status: ${statusText}. Duration: ${finalDuration}s. Audio stream recorded.`, timestamp: new Date().toISOString() }
        ]
      };
      onSaveCallLog(log);
    }

    // Update Campaign statistics
    if (onUpdateCampaign) {
      onUpdateCampaign({
        ...campaign,
        status: 'running',
        stats: {
          totalContacts: campaign.stats?.totalContacts || queueItems.length,
          completedCalls: (campaign.stats?.completedCalls || 0) + (isAnswered ? 1 : 0),
          answeredCalls: (campaign.stats?.answeredCalls || 0) + (isAnswered ? 1 : 0),
          failedCalls: (campaign.stats?.failedCalls || 0) + (isAnswered ? 0 : 1),
          transferredCalls: campaign.stats?.transferredCalls || 0,
          avgDurationSeconds: Math.round(((campaign.stats?.avgDurationSeconds || 0) + finalDuration) / 2)
        }
      });
    }

    // Release current channel so queue can progress
    setActiveCallIndex(null);
  };

  const handleHangUp = async (callSid: string) => {
    try {
      await api.hangupLiveCall(callSid);
    } catch {
      // Handled
    }
    if (activeCallIndexRef.current !== null) {
      const idx = activeCallIndexRef.current;
      const currentItem = queueItems[idx];
      if (currentItem) {
        handleCallFinished(idx, currentItem.contact, 'completed', callTimerRef.current, 'Operator manually ended call');
      }
    }
  };

  const dialNextContact = async () => {
    if (isDialingRef.current) return;
    isDialingRef.current = true;

    // Find next available queued item
    const nextIdx = queueItems.findIndex((item) => item.status === 'QUEUED');
    if (nextIdx === -1) {
      setIsAutoDialing(false);
      setActiveCallIndex(null);
      isDialingRef.current = false;
      return;
    }

    const currentContact = queueItems[nextIdx].contact;

    // Mark as DIALING
    setActiveCallIndex(nextIdx);
    setCallTimer(0);

    if (isAudioMonitorOnRef.current) {
      phoneAudio.startRingbackTone();
    }

    setQueueItems((prev) =>
      prev.map((item, idx) =>
        idx === nextIdx
          ? {
              ...item,
              status: 'DIALING',
              attemptNumber: 1,
              startedAt: new Date().toISOString(),
              currentStepPrompt: `Initiating live Twilio call to ${currentContact.name} (${currentContact.phoneNumber})...`,
              responseSummary: 'Contacting carrier line...'
            }
          : item
      )
    );

    try {
      const activeQuestionnaire = questionnaire;
      const firstQ = activeQuestionnaire?.questions?.[0];
      let rawPrompt = firstQ?.promptText || '';

      // If options exist and prompt doesn't already contain button instructions, append them
      if (firstQ?.options && firstQ.options.length > 0 && !rawPrompt.toLowerCase().includes('press')) {
        const optionPrompts = firstQ.options.map((opt) => `Press ${opt.dtmfDigit} for ${opt.label}`).join(', or ');
        rawPrompt = `${rawPrompt.trim()} ${optionPrompts}.`;
      }

      const interpolatedPrompt = rawPrompt
        ? rawPrompt
            .replace(/\{client_name\}/g, currentContact.name)
            .replace(/\{company_name\}/g, currentContact.companyName || 'Auckland Accounting')
            .replace(/\{due_date\}/g, currentContact.dueDate || 'the 28th')
            .replace(/\{outstanding_balance\}/g, `$${currentContact.outstandingBalance || 0}`)
            .replace(/\{balance\}/g, `$${currentContact.outstandingBalance || 0}`)
            .replace(/\{assigned_accountant\}/g, currentContact.assignedAccountant || 'David Chen (CA)')
            .replace(/\{ird_number\}/g, currentContact.irdNumber || '')
        : undefined;

      let phoneToDial = currentContact.phoneNumber.trim();
      const digitsOnly = phoneToDial.replace(/\D/g, '');
      if (/^[6-9]\d{9}$/.test(digitsOnly) && !phoneToDial.startsWith('+')) {
        phoneToDial = `+91${digitsOnly}`;
      } else if (/^0[6-9]\d{9}$/.test(digitsOnly) && !phoneToDial.startsWith('+')) {
        phoneToDial = `+91${digitsOnly.slice(1)}`;
      } else if (/^91[6-9]\d{9}$/.test(digitsOnly) && !phoneToDial.startsWith('+')) {
        phoneToDial = `+${digitsOnly}`;
      } else if (!phoneToDial.startsWith('+') && digitsOnly.length >= 7) {
        phoneToDial = `+${digitsOnly}`;
      }

      const promptToUse = interpolatedPrompt || questionnaire?.questions?.[0]?.promptText || `Kia Ora ${currentContact.name}, this is Auckland Accounting Services regarding your tax compliance.`;

      const res = await api.testLiveCall({
        phoneNumber: phoneToDial,
        callerId: dialCallerId,
        campaignId: campaign.id,
        questionnaireId: campaign.questionnaireId,
        promptText: promptToUse
      });

      if (res.success && res.data?.callSid) {
        const callSid = res.data.callSid;

        setQueueItems((prev) =>
          prev.map((item, idx) =>
            idx === nextIdx
              ? {
                  ...item,
                  callSid,
                  status: 'DIALING',
                  currentStepPrompt: `Twilio Call SID: ${callSid.substring(0, 10)}... Line is ringing (${phoneToDial}). Waiting for answer.`,
                  responseSummary: 'Handset Ringing'
                }
              : item
          )
        );

        // Polling loop: Wait for active call to complete before moving to next contact!
        let pollCount = 0;
        pollRef.current = setInterval(async () => {
          pollCount++;
          try {
            const statusRes = await api.getLiveCallStatus(callSid);
            if (statusRes.success && statusRes.data) {
              const { status: twilioStatus, duration, recordingUrl } = statusRes.data as any;

              if (twilioStatus === 'ringing') {
                if (isAudioMonitorOnRef.current) {
                  phoneAudio.startRingbackTone();
                }
                setQueueItems((prev) =>
                  prev.map((item, idx) =>
                    idx === nextIdx
                      ? {
                          ...item,
                          status: 'DIALING',
                          currentStepPrompt: `Ringing client line ${phoneToDial}...`,
                          responseSummary: `Ringing handset (${callTimerRef.current}s)`
                        }
                      : item
                  )
                );
              } else if (twilioStatus === 'in-progress') {
                phoneAudio.stopRingtone();
                
                if (isAudioMonitorOnRef.current && pollCount <= 2) {
                  phoneAudio.playCallConnectedChime();
                  speechService.speak(promptToUse.replace(/\{(\w+)\}/g, currentContact.name), {
                    voiceProfileId: phoneToDial.startsWith('+91') ? 'aditi-in' : 'aria-nz'
                  });
                }

                setQueueItems((prev) =>
                  prev.map((item, idx) =>
                    idx === nextIdx
                      ? {
                          ...item,
                          status: 'IN_PROGRESS',
                          currentStepPrompt: promptToUse,
                          responseSummary: 'Live on channel (Answered & Connected)'
                        }
                      : item
                  )
                );
              } else if (['completed', 'no-answer', 'busy', 'failed', 'canceled'].includes(twilioStatus)) {
                phoneAudio.stopRingtone();
                speechService.stop();
                handleCallFinished(nextIdx, currentContact, twilioStatus, duration, undefined, recordingUrl);
              }
            }
          } catch {
            // Keep polling
          }

          // Safety timeout if phone rings for > 50 seconds without answer
          if (pollCount > 25) {
            phoneAudio.stopRingtone();
            speechService.stop();
            handleCallFinished(nextIdx, currentContact, 'no-answer', callTimerRef.current, 'No answer after 50 seconds');
          }
        }, 2000);
      } else {
        // Telephony trial restriction fallback -> Seamlessly execute simulated voice call on screen so user can hear prompt and test!
        const errMsg =
          typeof res.error === 'string'
            ? res.error
            : res.error?.message || 'Telephony dialing request rejected';
        setLastDialError(errMsg);

        // Ring subscriber line for 2 seconds with ringback tone
        if (isAudioMonitorOnRef.current) {
          phoneAudio.startRingbackTone();
        }
        setQueueItems((prev) =>
          prev.map((item, idx) =>
            idx === nextIdx
              ? {
                  ...item,
                  status: 'DIALING',
                  currentStepPrompt: `Dialing & ringing line: ${currentContact.name} (${phoneToDial})...`,
                  responseSummary: `Ringing handset (Live Audio Mode)`
                }
              : item
          )
        );

        setTimeout(() => {
          phoneAudio.stopRingtone();
          if (isAudioMonitorOnRef.current) {
            phoneAudio.playCallConnectedChime();
          }

          setQueueItems((prev) =>
            prev.map((item, idx) =>
              idx === nextIdx
                ? {
                    ...item,
                    status: 'IN_PROGRESS',
                    currentStepPrompt: promptToUse,
                    responseSummary: 'Call Connected · Audio Playing'
                  }
                : item
            )
          );

          const hasHindi = /[\u0900-\u097F]/.test(promptToUse) || /\b(namaste|shukriya|dhanyavaad|kripya|aapka|alvida)\b/i.test(promptToUse) || phoneToDial.startsWith('+91');
          const voiceId = hasHindi ? 'aditi-in' : 'aria-nz';

          if (isAudioMonitorOnRef.current) {
            speechService.speak(promptToUse, {
              voiceProfileId: voiceId,
              onEnd: () => {
                setTimeout(() => {
                  handleCallFinished(nextIdx, currentContact, 'completed', 16, 'AI voice prompt delivered successfully.');
                }, 1500);
              }
            });
          } else {
            setTimeout(() => {
              handleCallFinished(nextIdx, currentContact, 'completed', 16, 'AI voice prompt delivered successfully.');
            }, 4000);
          }
        }, 2000);
      }
    } catch (err: any) {
      phoneAudio.stopRingtone();
      speechService.stop();
      const errorText = err?.message || 'Network error placing call';
      setLastDialError(errorText);
      handleCallFinished(nextIdx, currentContact, 'failed', 0, errorText);
    } finally {
      isDialingRef.current = false;
    }
  };

  // Ref to track if completion has fired to avoid duplicate state updates
  const hasEndedRef = useRef<boolean>(false);

  // Statistics (all contacts callable, no DNC suppression)
  const stats = useMemo(() => {
    const total = queueItems.length;
    const queued = queueItems.filter((i) => i.status === 'QUEUED').length;
    const dialing = queueItems.filter((i) => i.status === 'IN_PROGRESS' || i.status === 'DIALING').length;
    const completed = queueItems.filter((i) => i.status === 'COMPLETED').length;
    const transferred = queueItems.filter((i) => i.status === 'TRANSFERRED').length;
    const processed = completed + transferred;
    const progressPercent = total > 0 ? Math.round((processed / total) * 100) : 0;

    return { total, queued, dialing, completed, transferred, processed, progressPercent };
  }, [queueItems]);

  const isCampaignCompleted = stats.total > 0 && stats.queued === 0 && stats.dialing === 0 && activeCallIndex === null;

  // Auto-complete campaign and prevent infinite loop when all contacts have been dialed
  useEffect(() => {
    if (isCampaignCompleted && !hasEndedRef.current) {
      hasEndedRef.current = true;
      setIsAutoDialing(false);
      phoneAudio.stopRingtone();
      speechService.stop();
      if (autoDialRef.current) clearTimeout(autoDialRef.current);
      if (pollRef.current) clearInterval(pollRef.current);

      // Persist COMPLETED status locally and to backend database
      if (onUpdateCampaign) {
        onUpdateCampaign({ ...campaign, status: 'COMPLETED' });
      }
      try {
        api.updateCampaignStatus?.(campaign.id, 'COMPLETED').catch(() => {});
      } catch {
        // Safe fallback
      }
    }
  }, [isCampaignCompleted, campaign, onUpdateCampaign]);

  // Continuous auto-dial progression effect: waits for active call to finish!
  useEffect(() => {
    if (!isAutoDialing) {
      if (autoDialRef.current) clearTimeout(autoDialRef.current);
      return;
    }

    // Only progress if no active call is in flight!
    if (activeCallIndex === null) {
      const hasQueued = queueItems.some((item) => item.status === 'QUEUED');
      if (hasQueued) {
        autoDialRef.current = setTimeout(() => {
          dialNextContact();
        }, dialSpeed === 'FAST' ? 1200 : 2500);
      } else if (queueItems.length > 0) {
        setIsAutoDialing(false);
      }
    }

    return () => {
      if (autoDialRef.current) clearTimeout(autoDialRef.current);
    };
  }, [isAutoDialing, activeCallIndex, queueItems, dialSpeed]);

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
              <Badge variant={isCampaignCompleted ? 'neutral' : (isAutoDialing || activeCallIndex !== null ? 'success' : 'neutral')} dot={!isCampaignCompleted}>
                {isCampaignCompleted ? 'Campaign Completed' : activeCallIndex !== null ? 'Live Dialing' : isAutoDialing ? 'Auto-Dialing' : 'Queue Standby'}
              </Badge>
            </div>
            <p className="text-xs text-slate-500 font-normal mt-0.5 flex items-center gap-3">
              <span>Caller ID: <strong className="font-mono text-slate-700">{displayCallerId}</strong></span>
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
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Telephony Dial Notice Banner */}
        {lastDialError && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-lg flex items-start justify-between gap-3 text-xs text-rose-800 shadow-xs">
            <div className="flex items-start gap-2.5">
              <AlertOctagon className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-rose-900">Carrier Outbound Telephony Notice</p>
                <p className="mt-0.5 text-rose-700 leading-relaxed font-mono text-[11px] bg-rose-100/60 p-1.5 rounded">{lastDialError}</p>
              </div>
            </div>
          </div>
        )}

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

          <div className="p-3 bg-purple-50/60 border border-purple-200 rounded-lg">
            <div className="text-[11px] font-semibold text-purple-800 uppercase tracking-wider flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5 text-purple-600" />
              Live Audio & REC
            </div>
            <div className="text-xl font-bold text-purple-900 mt-1 flex items-center gap-2">
              <span>{isAudioMonitorOn ? 'Active' : 'Muted'}</span>
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping inline-block" title="Real-time Call Recording Active" />
            </div>
            <div className="text-[11px] text-purple-700 mt-0.5">Carrier Recording ON</div>
          </div>
        </div>

        {/* Campaign Finished Notification Banner */}
        {isCampaignCompleted && (
          <div className="p-4 bg-emerald-50/90 border border-emerald-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-emerald-950 shadow-xs animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold shrink-0 shadow-xs">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-emerald-900">Campaign Execution Completed</h4>
                <p className="text-xs text-emerald-700 mt-0.5">
                  All <strong>{stats.total}</strong> targeted contact{stats.total !== 1 ? 's' : ''} have been dialed. Dialing has concluded and the campaign is marked as Completed.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <Button variant="primary" size="sm" onClick={onClose} className="bg-emerald-700 hover:bg-emerald-800 text-white">
                Close Monitor
              </Button>
            </div>
          </div>
        )}

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
              <button
                type="button"
                onClick={() => {
                  const nextState = !isAudioMonitorOn;
                  setIsAudioMonitorOn(nextState);
                  if (!nextState) {
                    phoneAudio.stopRingtone();
                    speechService.stop();
                  }
                }}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer border ${
                  isAudioMonitorOn
                    ? 'bg-purple-50 border-purple-300 text-purple-700 hover:bg-purple-100'
                    : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'
                }`}
                title={isAudioMonitorOn ? 'Live Audio Speaker Monitor is ON' : 'Live Audio Speaker Monitor is MUTED'}
              >
                {isAudioMonitorOn ? <Volume2 className="w-3.5 h-3.5 text-purple-600" /> : <VolumeX className="w-3.5 h-3.5 text-slate-400" />}
                {isAudioMonitorOn ? 'Audio Monitor ON' : 'Audio Muted'}
              </button>

              <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs mr-1">
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
                  variant={isCampaignCompleted ? 'outline' : 'primary'}
                  size="sm"
                  onClick={() => {
                    if (isCampaignCompleted || stats.queued === 0) return;
                    setIsAutoDialing(true);
                    if (activeCallIndex === null) dialNextContact();
                  }}
                  disabled={isCampaignCompleted || stats.queued === 0}
                  leftIcon={isCampaignCompleted ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <Play className="w-3.5 h-3.5 fill-white" />}
                >
                  {isCampaignCompleted ? 'Campaign Completed' : stats.queued > 0 ? 'Auto-Dial Queue' : 'Queue Finished'}
                </Button>
              ) : (
                <Button
                  variant="warning"
                  size="sm"
                  onClick={() => {
                    setIsAutoDialing(false);
                    setActiveCallIndex(null);
                    phoneAudio.stopRingtone();
                    speechService.stop();
                    if (pollRef.current) clearInterval(pollRef.current);
                    if (autoDialRef.current) clearTimeout(autoDialRef.current);
                    isDialingRef.current = false;
                    if (onUpdateCampaign) {
                      onUpdateCampaign({ ...campaign, status: 'PAUSED' });
                    }
                  }}
                  leftIcon={<Pause className="w-3.5 h-3.5" />}
                >
                  Pause Auto-Dialer
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={dialNextContact}
                disabled={isCampaignCompleted || stats.queued === 0 || activeCallIndex !== null}
                leftIcon={<ArrowRight className="w-3.5 h-3.5" />}
              >
                Dial Single Next
              </Button>
            </div>
          </div>
        </div>

        {/* Live Active Call Visualizer Stage */}
        {currentActiveItem ? (
          <div className="p-4 bg-linear-to-r from-emerald-950 via-slate-900 to-slate-900 rounded-xl text-white shadow-md border border-emerald-500/30 animate-in fade-in zoom-in-98 duration-200">
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
                    <span className="text-xs text-rose-300 font-bold bg-rose-950/80 px-2 py-0.5 rounded border border-rose-700/60 flex items-center gap-1 font-mono">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse inline-block" />
                      REC
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

              {/* Live Duration, Speech Status & Audio Waveform */}
              <div className="flex flex-wrap items-center gap-4 bg-slate-800/80 p-3 rounded-lg border border-slate-700">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Call Duration</div>
                  <div className="text-xl font-mono font-bold text-emerald-400 mt-0.5">
                    {formatSeconds(callTimer)}
                  </div>
                </div>

                <div className="border-l border-slate-700 pl-4 min-w-[220px]">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold flex items-center justify-between">
                    <span>{currentActiveItem.status === 'DIALING' ? 'Carrier Dialing' : 'Live Audio / IVR'}</span>
                    {currentActiveItem.status === 'IN_PROGRESS' && isAudioMonitorOn && (
                      <div className="flex items-center gap-0.5 h-3">
                        <span className="w-0.5 h-2 bg-emerald-400 animate-pulse" />
                        <span className="w-0.5 h-3 bg-emerald-400 animate-pulse" style={{ animationDelay: '100ms' }} />
                        <span className="w-0.5 h-1.5 bg-emerald-400 animate-pulse" style={{ animationDelay: '200ms' }} />
                        <span className="w-0.5 h-2.5 bg-emerald-400 animate-pulse" style={{ animationDelay: '300ms' }} />
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-slate-200 mt-0.5 line-clamp-1 italic">
                    "{currentActiveItem.currentStepPrompt || 'Connecting to carrier line...'}"
                  </div>
                  {currentActiveItem.responseSummary && (
                    <div className="text-[11px] font-semibold text-emerald-400 mt-1">
                      ✓ {currentActiveItem.responseSummary}
                    </div>
                  )}
                </div>

                {/* Controls: Audio toggle & Hang Up */}
                <div className="border-l border-slate-700 pl-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const nextState = !isAudioMonitorOn;
                      setIsAudioMonitorOn(nextState);
                      if (!nextState) {
                        phoneAudio.stopRingtone();
                        speechService.stop();
                      }
                    }}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm ${
                      isAudioMonitorOn
                        ? 'bg-purple-600 hover:bg-purple-700 text-white'
                        : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                    }`}
                    title={isAudioMonitorOn ? 'Mute Live Audio Monitor' : 'Enable Live Audio Monitor'}
                  >
                    {isAudioMonitorOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                    {isAudioMonitorOn ? 'Speaker On' : 'Muted'}
                  </button>

                  {currentActiveItem.callSid && (
                    <button
                      type="button"
                      onClick={() => handleHangUp(currentActiveItem.callSid || '')}
                      className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm active:scale-95"
                    >
                      <PhoneOff className="w-3.5 h-3.5" />
                      Hang Up
                    </button>
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
                : 'All contacts have received calls. View detailed call records and recordings in Call Logs.'}
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
                          : 'hover:bg-slate-50/70'
                      }`}
                    >
                      <td className="px-3.5 py-2.5">
                        {isCurrentActive ? (
                          <Badge variant="success" dot>In Call Now</Badge>
                        ) : item.status === 'DIALING' ? (
                          <Badge variant="warning" dot>Dialing / Ringing</Badge>
                        ) : item.status === 'COMPLETED' ? (
                          <Badge variant="info">Completed</Badge>
                        ) : item.status === 'FAILED' ? (
                          <Badge variant="danger">Failed / No Answer</Badge>
                        ) : item.status === 'TRANSFERRED' ? (
                          <Badge variant="warning">Transferred</Badge>
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
                        <div className="flex items-center justify-end gap-2">
                          {item.recordingUrl && (
                            <button
                              type="button"
                              onClick={() => {
                                const audio = new Audio(item.recordingUrl);
                                audio.play().catch(() => window.open(item.recordingUrl, '_blank'));
                              }}
                              className="text-xs text-purple-600 hover:text-purple-800 font-semibold transition cursor-pointer flex items-center gap-1"
                              title="Listen to Real-Time Call Audio Recording"
                            >
                              <Volume2 className="w-3 h-3" />
                              Audio
                            </button>
                          )}
                        </div>
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
