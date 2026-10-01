import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Download,
  Search,
  CheckCircle2,
  AlertTriangle,
  PhoneForwarded,
  XCircle,
  Clock,
  Volume2,
  Play,
  Pause,
  Building,
  Radio,
  FileText,
  RefreshCw,
  Phone,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Info,
  DollarSign,
  Hash
} from 'lucide-react';
import { CallLog, CallAttemptDetail } from '../types';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  Button,
  Badge,
  Input,
  Drawer,
  PageHeader,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  EmptyState
} from './ui';

interface CallLogsProps {
  callLogs: CallLog[];
}

export const CallLogs: React.FC<CallLogsProps> = ({ callLogs: fallbackCallLogs }) => {
  const { hasPermission } = useAuth();
  const canExport = hasPermission('reports.export');

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('ALL');
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [selectedCallDetail, setSelectedCallDetail] = useState<CallAttemptDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Live Backend State
  const [liveCalls, setLiveCalls] = useState<any[]>([]);
  const [pagination, setPagination] = useState<{ page: number; limit: number; total: number; totalPages: number }>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [useLiveApi, setUseLiveApi] = useState<boolean>(true);

  // Audio recording simulation
  const [isPlayingRecording, setIsPlayingRecording] = useState<boolean>(false);
  const [playbackProgress, setPlaybackProgress] = useState<number>(0);

  const fetchLiveCalls = useCallback(async (page = 1) => {
    setIsLoading(true);
    try {
      const params: Record<string, any> = { page, limit: 20 };
      if (statusFilter !== 'all') {
        params.status = statusFilter.toUpperCase();
      }
      if (searchQuery.trim()) {
        params.search = searchQuery.trim();
      }
      if (dateFilter === 'TODAY') {
        const now = new Date();
        params.startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      } else if (dateFilter === '7DAYS') {
        params.startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      } else if (dateFilter === '30DAYS') {
        params.startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      }
      const res = await api.getCalls(params);
      if (res.success && res.data) {
        setLiveCalls((res.data as any).data || (res.data as any).calls || []);
        setPagination((res.data as any).pagination || { page: 1, limit: 20, total: 0, totalPages: 1 });
        setUseLiveApi(true);
      } else {
        setUseLiveApi(false);
      }
    } catch {
      setUseLiveApi(false);
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, searchQuery, dateFilter]);

  useEffect(() => {
    fetchLiveCalls(1);
  }, [fetchLiveCalls]);

  // Fetch full details when drawer opens
  useEffect(() => {
    if (!selectedCallId) {
      setSelectedCallDetail(null);
      return;
    }

    const foundInLive = liveCalls.find((c) => c.id === selectedCallId);
    if (foundInLive && foundInLive.responses && foundInLive.retryLogs) {
      setSelectedCallDetail(foundInLive);
      return;
    }

    setIsLoadingDetail(true);
    api.getCallById(selectedCallId)
      .then((res) => {
        if (res.success && res.data?.call) {
          setSelectedCallDetail(res.data.call);
        } else if (foundInLive) {
          setSelectedCallDetail(foundInLive);
        } else {
          const localMatch = fallbackCallLogs.find((l) => l.id === selectedCallId);
          if (localMatch) {
            setSelectedCallDetail({
              id: localMatch.id,
              contactId: localMatch.contactId,
              campaignId: localMatch.campaignId,
              attemptNumber: localMatch.attemptNumber || 1,
              status: localMatch.status.toUpperCase(),
              durationSeconds: localMatch.durationSeconds,
              startedAt: localMatch.startedAt,
              createdAt: localMatch.startedAt,
              updatedAt: localMatch.endedAt || localMatch.startedAt,
              contact: {
                name: localMatch.contactName,
                companyName: localMatch.companyName,
                phoneNumber: localMatch.phoneNumber
              },
              campaign: {
                id: localMatch.campaignId,
                name: localMatch.campaignName,
                callerId: ''
              },
              responses: localMatch.responses?.map((r, idx) => ({
                id: `resp_${idx}`,
                questionId: r.questionId,
                inputReceived: r.inputReceived,
                isValid: r.isValid,
                recordedAt: r.recordedAt,
                question: {
                  id: r.questionId,
                  questionText: r.promptText || r.questionName,
                  questionType: r.questionType || 'YES_NO'
                }
              })) || []
            });
          }
        }
      })
      .catch(() => {
        if (foundInLive) setSelectedCallDetail(foundInLive);
      })
      .finally(() => setIsLoadingDetail(false));
  }, [selectedCallId, liveCalls, fallbackCallLogs]);

  const getStatusBadge = (status: string) => {
    const s = String(status).toUpperCase();
    switch (s) {
      case 'COMPLETED':
        return <Badge variant="success" size="sm">Completed</Badge>;
      case 'TRANSFERRED':
        return <Badge variant="info" size="sm">Transferred</Badge>;
      case 'IN_PROGRESS':
      case 'RINGING':
      case 'INITIATED':
        return <Badge variant="warning" dot size="sm">{s.replace('_', ' ')}</Badge>;
      case 'BUSY':
        return <Badge variant="warning" size="sm">Busy</Badge>;
      case 'NO_ANSWER':
        return <Badge variant="neutral" size="sm">No Answer</Badge>;
      case 'FAILED':
        return <Badge variant="danger" size="sm">Failed</Badge>;
      case 'CANCELLED':
        return <Badge variant="neutral" size="sm">Cancelled</Badge>;
      default:
        return <Badge variant="neutral" size="sm">{status}</Badge>;
    }
  };

  const displayLogs = useMemo(() => {
    if (useLiveApi && liveCalls.length > 0) {
      return liveCalls.map((c) => ({
        id: c.id,
        contactName: c.contact?.name || 'Unknown Contact',
        companyName: c.contact?.companyName || '—',
        phoneNumber: c.contact?.phoneNumber || '—',
        campaignName: c.campaign?.name || 'Outbound Campaign',
        status: c.status,
        providerSid: c.providerSid,
        durationSeconds: c.durationSeconds || 0,
        cost: c.cost || 0,
        responsesCount: c.responses?.length || 0,
        startedAt: c.startedAt || c.createdAt,
        errorCode: c.errorCode,
        raw: c
      }));
    }

    return fallbackCallLogs
      .filter((log) => {
        const q = searchQuery.toLowerCase();
        const matchesSearch =
          log.contactName.toLowerCase().includes(q) ||
          log.companyName.toLowerCase().includes(q) ||
          log.phoneNumber.includes(searchQuery) ||
          log.campaignName.toLowerCase().includes(q);

        const matchesStatus = statusFilter === 'all' || log.status.toLowerCase() === statusFilter.toLowerCase();
        return matchesSearch && matchesStatus;
      })
      .map((log) => ({
        id: log.id,
        contactName: log.contactName,
        companyName: log.companyName,
        phoneNumber: log.phoneNumber,
        campaignName: log.campaignName,
        status: log.status,
        providerSid: null,
        durationSeconds: log.durationSeconds || 0,
        cost: 0,
        responsesCount: log.responses?.length || 0,
        startedAt: log.startedAt,
        errorCode: null,
        raw: log
      }));
  }, [useLiveApi, liveCalls, fallbackCallLogs, searchQuery, statusFilter]);

  const exportLogsCSV = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.append('status', statusFilter.toUpperCase());
      if (dateFilter === 'TODAY') {
        const now = new Date();
        params.append('startDate', new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString());
      } else if (dateFilter === '7DAYS') {
        params.append('startDate', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
      } else if (dateFilter === '30DAYS') {
        params.append('startDate', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
      }

      const token = api.getAccessToken();
      const res = await fetch(`${api.getBaseUrl()}/reports/export/calls?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Auckland_Accounting_Call_Records_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        return;
      }
    } catch {
      // Fallback to client CSV if offline
    } finally {
      setIsExporting(false);
    }

    // Client-side fallback
    const headers = [
      'Call Attempt ID',
      'Provider SID',
      'Contact Name',
      'Company',
      'Phone Number',
      'Campaign',
      'Status',
      'Duration (sec)',
      'Cost (NZD)',
      'Timestamp',
      'Responses Count'
    ];
    const rows = displayLogs.map((l) => [
      `"${l.id}"`,
      `"${l.providerSid || 'MOCK_OR_SIMULATED'}"`,
      `"${l.contactName}"`,
      `"${l.companyName}"`,
      `"${l.phoneNumber}"`,
      `"${l.campaignName}"`,
      `"${l.status}"`,
      `"${l.durationSeconds}"`,
      `"${l.cost ? `$${l.cost.toFixed(2)}` : '$0.00'}"`,
      `"${l.startedAt}"`,
      `"${l.responsesCount}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Auckland_Accounting_Call_Records_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleAudioSimulation = () => {
    if (isPlayingRecording) {
      setIsPlayingRecording(false);
    } else {
      setIsPlayingRecording(true);
      setPlaybackProgress(0);
      const interval = setInterval(() => {
        setPlaybackProgress((prev) => {
          if (prev >= 100) {
            clearInterval(interval);
            setIsPlayingRecording(false);
            return 100;
          }
          return prev + 5;
        });
      }, 400);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Call Records"
        description="Comprehensive records of outbound dialing attempts, provider status events, transcripts, and DTMF responses."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchLiveCalls(pagination.page)}
              isLoading={isLoading}
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            >
              Refresh
            </Button>
            {canExport && (
              <Button
                variant="outline"
                size="sm"
                onClick={exportLogsCSV}
                isLoading={isExporting}
                leftIcon={<Download className="w-3.5 h-3.5" />}
              >
                Export CSV
              </Button>
            )}
          </div>
        }
      />

      {/* Search, Status & Date Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200">
        <div className="w-full lg:w-72">
          <Input
            placeholder="Search by client, company, phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            leftIcon={<Search className="w-3.5 h-3.5" />}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Date Filter Tabs */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
            <button
              type="button"
              onClick={() => setDateFilter('ALL')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                dateFilter === 'ALL' ? 'bg-white text-[#0f2e4a] shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Time
            </button>
            <button
              type="button"
              onClick={() => setDateFilter('TODAY')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                dateFilter === 'TODAY' ? 'bg-white text-[#0f2e4a] shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setDateFilter('7DAYS')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                dateFilter === '7DAYS' ? 'bg-white text-[#0f2e4a] shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              7 Days
            </button>
            <button
              type="button"
              onClick={() => setDateFilter('30DAYS')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                dateFilter === '30DAYS' ? 'bg-white text-[#0f2e4a] shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              30 Days
            </button>
          </div>

          <div className="w-full sm:w-48">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0f2e4a]"
            >
              <option value="all">All Statuses</option>
              <option value="completed">Completed Calls</option>
              <option value="in_progress">In Progress / Ringing</option>
              <option value="transferred">Transferred to Staff</option>
              <option value="busy">Network Busy</option>
              <option value="no_answer">No Answer</option>
              <option value="failed">Failed Connection</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
      </div>

      {/* Call Records Table */}
      {displayLogs.length === 0 ? (
        <EmptyState
          icon={<FileText className="w-8 h-8" />}
          title="No call records match filters"
          description={
            searchQuery || statusFilter !== 'all'
              ? 'Try adjusting your search criteria or status filter.'
              : 'Outbound call attempts and records will appear here as campaigns execute.'
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Client & Company</TableHeaderCell>
              <TableHeaderCell>Phone & Campaign</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Responses</TableHeaderCell>
              <TableHeaderCell>Duration & Cost</TableHeaderCell>
              <TableHeaderCell>Timestamp</TableHeaderCell>
              <TableHeaderCell className="text-right">Action</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayLogs.map((log) => (
              <TableRow
                key={log.id}
                isClickable
                onClick={() => setSelectedCallId(log.id)}
                isSelected={selectedCallId === log.id}
              >
                <TableCell>
                  <div className="font-semibold text-slate-900">{log.contactName}</div>
                  <div className="text-xs text-slate-500">{log.companyName}</div>
                </TableCell>

                <TableCell>
                  <div className="font-mono text-xs text-slate-800">{log.phoneNumber}</div>
                  <div className="text-[11px] text-slate-500 line-clamp-1">{log.campaignName}</div>
                </TableCell>

                <TableCell>{getStatusBadge(log.status)}</TableCell>

                <TableCell>
                  {log.responsesCount > 0 ? (
                    <span className="text-xs font-medium text-slate-800 font-mono">
                      {log.responsesCount} answer{log.responsesCount > 1 ? 's' : ''}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </TableCell>

                <TableCell>
                  <div className="font-mono text-xs text-slate-700">{log.durationSeconds}s</div>
                  {log.cost > 0 && (
                    <div className="text-[11px] text-emerald-600 font-mono font-medium">${log.cost.toFixed(2)} NZD</div>
                  )}
                </TableCell>

                <TableCell className="text-xs text-slate-500 font-mono">
                  {new Date(log.startedAt).toLocaleString('en-NZ', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </TableCell>

                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedCallId(log.id);
                    }}
                  >
                    Inspect
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Pagination Controls */}
      {useLiveApi && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between px-2 pt-2 border-t border-slate-200 text-xs text-slate-600">
          <div>
            Showing Page <strong>{pagination.page}</strong> of <strong>{pagination.totalPages}</strong> (
            <strong>{pagination.total}</strong> total attempts)
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="xs"
              disabled={pagination.page <= 1 || isLoading}
              onClick={() => fetchLiveCalls(pagination.page - 1)}
              leftIcon={<ChevronLeft className="w-3.5 h-3.5" />}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="xs"
              disabled={pagination.page >= pagination.totalPages || isLoading}
              onClick={() => fetchLiveCalls(pagination.page + 1)}
              rightIcon={<ChevronRight className="w-3.5 h-3.5" />}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Call Details Slide-Over Drawer */}
      {selectedCallId && (
        <Drawer
          isOpen={!!selectedCallId}
          onClose={() => setSelectedCallId(null)}
          size="lg"
          title={selectedCallDetail?.contact?.name || 'Call Attempt Details'}
          subtitle={`${selectedCallDetail?.contact?.companyName || 'Client'} · ${
            selectedCallDetail?.contact?.phoneNumber || ''
          }`}
          footer={
            <div className="flex items-center justify-between w-full text-xs text-slate-500">
              <span className="font-mono">
                Provider SID: {selectedCallDetail?.providerSid || 'MOCK_SIMULATION_SID'}
              </span>
              <Button variant="outline" size="sm" onClick={() => setSelectedCallId(null)}>
                Close
              </Button>
            </div>
          }
        >
          {isLoadingDetail ? (
            <div className="py-12 text-center text-slate-500 text-xs flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-[#0f2e4a]" />
              Loading complete call diagnostics...
            </div>
          ) : selectedCallDetail ? (
            <div className="space-y-5 text-xs">
              {/* Meta Grid */}
              <div className="grid grid-cols-4 gap-2 bg-slate-50 p-3 rounded-lg border border-slate-200 text-center">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">Status</span>
                  <div className="mt-1 flex justify-center">{getStatusBadge(selectedCallDetail.status)}</div>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">Attempt #</span>
                  <span className="font-semibold text-slate-800 font-mono mt-1 block">
                    {selectedCallDetail.attemptNumber || 1}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">Duration</span>
                  <span className="font-semibold text-slate-800 font-mono mt-1 block">
                    {selectedCallDetail.durationSeconds || 0}s
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">Cost (NZD)</span>
                  <span className="font-semibold text-emerald-700 font-mono mt-1 block">
                    ${(selectedCallDetail.cost || 0).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Error Alert if Failed */}
              {selectedCallDetail.errorCode && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">Telephony Error: {selectedCallDetail.errorCode}</div>
                    <div className="text-[11px] text-red-700 mt-0.5">
                      {selectedCallDetail.errorMessage || 'Call terminated with carrier network error.'}
                    </div>
                  </div>
                </div>
              )}

              {/* Campaign Context */}
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1.5">
                <div className="text-[10px] text-slate-400 uppercase font-semibold">Campaign & Line</div>
                <div className="flex items-center justify-between text-slate-800 font-medium">
                  <span>{selectedCallDetail.campaign?.name || 'Default Outbound Flow'}</span>
                  <span className="font-mono text-xs text-slate-600">
                    {selectedCallDetail.campaign?.callerId ? `CLI: ${selectedCallDetail.campaign.callerId}` : ''}
                  </span>
                </div>
              </div>

              {/* Audio Recording Player */}
              <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-slate-600" />
                    <span>Call Audio Recording / Simulation</span>
                  </span>
                  <span className="font-mono text-slate-500 text-[11px]">
                    {selectedCallDetail.durationSeconds || 0}s
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={toggleAudioSimulation}
                    className="w-7 h-7 rounded-full bg-[#0f2e4a] text-white flex items-center justify-center shrink-0 hover:bg-[#163e63] transition-colors"
                  >
                    {isPlayingRecording ? (
                      <Pause className="w-3.5 h-3.5" />
                    ) : (
                      <Play className="w-3.5 h-3.5 ml-0.5 fill-current" />
                    )}
                  </button>
                  <div className="flex-1 bg-slate-200 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-[#0f2e4a] h-full transition-all duration-300 rounded-full"
                      style={{ width: `${playbackProgress}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Questionnaire & DTMF Answers */}
              <div className="space-y-2">
                <span className="font-semibold text-slate-700 uppercase tracking-wider text-[10px] block">
                  Questionnaire Responses & Captured Input:
                </span>
                {!selectedCallDetail.responses || selectedCallDetail.responses.length === 0 ? (
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-slate-400 italic text-center">
                    No questionnaire responses captured for this call.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {selectedCallDetail.responses.map((resp, i) => (
                      <div
                        key={resp.id || i}
                        className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between gap-3"
                      >
                        <div className="space-y-0.5">
                          <span className="font-semibold text-slate-800 block">
                            {resp.question?.questionText || `Question ${i + 1}`}
                          </span>
                          <div className="text-slate-600 text-[11px] flex items-center gap-2">
                            <span>
                              Input: <strong className="font-mono text-slate-900">{resp.inputReceived}</strong>
                            </span>
                            {resp.matchedOption && (
                              <span className="text-slate-500">({resp.matchedOption})</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {resp.isValid ? (
                            <Badge variant="success" size="sm">Valid</Badge>
                          ) : (
                            <Badge variant="danger" size="sm">Invalid</Badge>
                          )}
                          <Badge variant="neutral" size="sm">
                            {resp.question?.questionType || 'DTMF'}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Retry History Timeline */}
              {selectedCallDetail.retryLogs && selectedCallDetail.retryLogs.length > 0 && (
                <div className="space-y-2">
                  <span className="font-semibold text-slate-700 uppercase tracking-wider text-[10px] block">
                    Retry Engine Execution History:
                  </span>
                  <div className="space-y-1.5">
                    {selectedCallDetail.retryLogs.map((log) => (
                      <div
                        key={log.id}
                        className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between text-[11px]"
                      >
                        <div>
                          <span className="font-semibold text-slate-800">
                            Attempt #{log.attemptNumber} · Reason: {log.reason}
                          </span>
                          <div className="text-slate-500 font-mono text-[10px] mt-0.5">
                            Scheduled Next: {new Date(log.nextRetryAt).toLocaleTimeString('en-NZ')}
                          </div>
                        </div>
                        <Badge variant="warning" size="sm">{log.status}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 text-center text-slate-400 text-xs">Call details not found.</div>
          )}
        </Drawer>
      )}
    </div>
  );
};
