import React, { useState, useEffect } from 'react';
import {
  Megaphone,
  ArrowRight,
  Play,
  Clock,
  AlertTriangle,
  PhoneCall,
  Users,
  CheckCircle2,
  RefreshCw
} from 'lucide-react';
import { Campaign, Questionnaire, Contact, CallLog, SummaryReportData } from '../types';
import { api } from '../services/api';
import {
  Button,
  Badge,
  Card,
  MetricRow,
  PageHeader,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell
} from './ui';

interface DashboardProps {
  campaigns: Campaign[];
  questionnaires: Questionnaire[];
  contacts: Contact[];
  callLogs: CallLog[];
  onOpenSimulator: () => void;
  onNavigateTab: (tab: string) => void;
  onRunBatchSimulation: (campaignId: string) => void;
  isSimulatingBatch: boolean;
}

export const Dashboard: React.FC<DashboardProps> = ({
  campaigns,
  questionnaires,
  contacts,
  callLogs,
  onOpenSimulator,
  onNavigateTab,
  onRunBatchSimulation,
  isSimulatingBatch
}) => {
  const [summaryReport, setSummaryReport] = useState<SummaryReportData | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;
    api.getSummaryReport()
      .then((res) => {
        if (isMounted && res.success && res.data) {
          setSummaryReport(res.data);
        }
      })
      .catch(() => {
        // Fallback to prop-driven metrics if offline
      })
      .finally(() => {
        if (isMounted) setIsLoadingSummary(false);
      });
    return () => {
      isMounted = false;
    };
  }, [campaigns.length, callLogs.length]);

  const runningCampaigns = campaigns.filter((c) => c.status === 'running' || c.status === 'RUNNING');
  const pausedCampaigns = campaigns.filter((c) => c.status === 'paused' || c.status === 'PAUSED');

  const totalCalls = summaryReport?.overview.totalCallsPlaced ?? callLogs.length;
  const completedCalls =
    summaryReport?.overview.completedCalls ?? callLogs.filter((l) => l.status === 'completed').length;
  const transferredCalls =
    summaryReport?.overview.transferredCalls ?? callLogs.filter((l) => l.status === 'transferred').length;
  const answerRate =
    summaryReport?.overview.answerRatePct ??
    (totalCalls > 0 ? Math.round(((completedCalls + transferredCalls) / totalCalls) * 100) : 0);
  const avgDuration =
    summaryReport?.overview.averageDurationSeconds ??
    (totalCalls > 0
      ? Math.round(callLogs.reduce((acc, curr) => acc + (curr.durationSeconds || 0), 0) / totalCalls)
      : 0);
  const callableContactsCount =
    summaryReport?.overview.callableContacts ??
    contacts.filter((c) => !c.isDoNotCall && c.consentStatus === 'GRANTED').length;
  const dncContactsCount =
    summaryReport?.suppression.dncSuppressed ?? contacts.filter((c) => c.isDoNotCall).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations Dashboard"
        description="Real-time monitoring of outbound campaigns, telephony activity, and operational alerts."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onNavigateTab('campaigns')}>
              Manage Campaigns
            </Button>
            <Button variant="primary" size="sm" onClick={() => onNavigateTab('questions')}>
              Questionnaires
            </Button>
          </div>
        }
      />

      {/* 1. What Needs Attention? */}
      {pausedCampaigns.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 text-amber-900">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>
                {pausedCampaigns.length} campaign{pausedCampaigns.length > 1 ? 's are' : ' is'} paused.
              </strong>{' '}
              Resume to continue scheduled dial batches.
            </span>
          </div>
          <Button
            variant="outline"
            size="xs"
            onClick={() => onNavigateTab('campaigns')}
            className="border-amber-300 text-amber-900 hover:bg-amber-100 shrink-0"
          >
            Review Campaigns
          </Button>
        </div>
      )}

      {/* 2. Today's Activity Metrics */}
      <div>
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
          Telephony & Campaign Metrics
        </div>
        <MetricRow
          metrics={[
            {
              label: 'Active Campaigns',
              value: `${runningCampaigns.length} / ${campaigns.length}`,
              status: runningCampaigns.length > 0 ? 'success' : 'neutral'
            },
            { label: 'Total Calls Placed', value: totalCalls },
            { label: 'Completed / Handled', value: completedCalls + transferredCalls, status: 'success' },
            { label: 'Answer Rate', value: `${answerRate}%`, status: answerRate >= 70 ? 'success' : 'warning' },
            { label: 'Average Duration', value: `${avgDuration}s` },
            {
              label: 'Callable Contacts',
              value: callableContactsCount,
              subtext: `${dncContactsCount} DNC suppressed`
            }
          ]}
        />
      </div>

      {/* 3. Running Campaigns & Active Sessions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Active Calling Campaigns</h2>
          <button
            type="button"
            onClick={() => onNavigateTab('campaigns')}
            className="text-xs text-[#0f2e4a] hover:underline font-medium flex items-center gap-1"
          >
            <span>All Campaigns</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {runningCampaigns.length === 0 ? (
          <Card padding="sm" className="text-center py-6 text-xs text-slate-500">
            <Megaphone className="w-6 h-6 text-slate-400 mx-auto mb-2" />
            <span>No active outbound campaigns running currently.</span>
          </Card>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Campaign Name</TableHeaderCell>
                <TableHeaderCell>Questionnaire Flow</TableHeaderCell>
                <TableHeaderCell>Calling Window</TableHeaderCell>
                <TableHeaderCell>Progress</TableHeaderCell>
                <TableHeaderCell className="text-right">Action</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runningCampaigns.map((c) => {
                const q = questionnaires.find((item) => item.id === c.questionnaireId);
                const progressPct = c.stats?.totalContacts
                  ? Math.round((c.stats.completedCalls / c.stats.totalContacts) * 100)
                  : 0;

                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="font-semibold text-slate-900">{c.name}</div>
                      <div className="text-xs text-slate-500 font-mono mt-0.5">Caller: {c.callerId}</div>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-slate-700 font-medium">{q?.title || 'Direct Flow'}</span>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs text-slate-600 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>
                          {c.callingStartTime || '09:00'} - {c.callingEndTime || '18:00'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="w-36 space-y-1">
                        <div className="flex justify-between text-[11px] text-slate-600">
                          <span>
                            {c.stats?.completedCalls || 0} / {c.stats?.totalContacts || 0}
                          </span>
                          <span className="font-mono font-medium">{progressPct}%</span>
                        </div>
                        <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                          <div className="bg-[#0f2e4a] h-full rounded-full" style={{ width: `${progressPct}%` }} />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => onRunBatchSimulation(c.id)}
                        disabled={isSimulatingBatch}
                        leftIcon={<Play className="w-3 h-3 text-emerald-600 fill-emerald-600" />}
                      >
                        {isSimulatingBatch ? 'Dialing...' : 'Dispatch Batch'}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* 4. Recent Call Activity */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Recent Dispatched Calls</h2>
          <button
            type="button"
            onClick={() => onNavigateTab('calls')}
            className="text-xs text-[#0f2e4a] hover:underline font-medium flex items-center gap-1"
          >
            <span>View All Records</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {callLogs.length === 0 ? (
          <Card padding="sm" className="text-center py-6 text-xs text-slate-500">
            <PhoneCall className="w-6 h-6 text-slate-400 mx-auto mb-2" />
            <span>No call records available yet.</span>
          </Card>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Client & Company</TableHeaderCell>
                <TableHeaderCell>Phone Number</TableHeaderCell>
                <TableHeaderCell>Campaign</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Duration</TableHeaderCell>
                <TableHeaderCell className="text-right">Timestamp</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {callLogs.slice(0, 6).map((log) => {
                const contact = contacts.find((c) => c.id === log.contactId);
                const statusVariant =
                  log.status === 'completed'
                    ? 'success'
                    : log.status === 'transferred'
                    ? 'info'
                    : log.status === 'failed' || log.status === 'busy'
                    ? 'danger'
                    : 'neutral';

                return (
                  <TableRow key={log.id}>
                    <TableCell>
                      <div className="font-semibold text-slate-900">{log.contactName}</div>
                      <div className="text-xs text-slate-500">{contact?.companyName || log.companyName}</div>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-slate-700">{log.phoneNumber}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-slate-700">{log.campaignName}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant} size="sm">
                        {log.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-slate-600">{log.durationSeconds}s</span>
                    </TableCell>
                    <TableCell className="text-right text-xs text-slate-500 font-mono">
                      {new Date(log.startedAt).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
};
