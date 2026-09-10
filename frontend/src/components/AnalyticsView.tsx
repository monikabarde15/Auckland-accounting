import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts';
import {
  Download,
  RefreshCw,
  Calendar,
  Filter,
  CheckCircle2,
  AlertTriangle,
  PhoneCall,
  PhoneForwarded,
  XCircle,
  HelpCircle,
  ShieldCheck,
  DollarSign
} from 'lucide-react';
import { Campaign, Questionnaire, SummaryReportData, CampaignReportData } from '../types';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Button, Badge, Card, MetricRow, PageHeader, EmptyState } from './ui';

interface AnalyticsViewProps {
  campaigns?: Campaign[];
  questionnaires?: Questionnaire[];
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  campaigns = [],
  questionnaires = []
}) => {
  const { hasPermission } = useAuth();
  const canExport = hasPermission('reports.export');

  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('all');
  const [dateRangeFilter, setDateRangeFilter] = useState<string>('ALL');
  const [summaryData, setSummaryData] = useState<SummaryReportData | null>(null);
  const [campaignData, setCampaignData] = useState<CampaignReportData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  const calculateDateRange = useCallback(() => {
    const now = new Date();
    if (dateRangeFilter === 'TODAY') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      return { startDate: start };
    } else if (dateRangeFilter === '7DAYS') {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      return { startDate: start };
    } else if (dateRangeFilter === '30DAYS') {
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      return { startDate: start };
    }
    return {};
  }, [dateRangeFilter]);

  const loadAnalytics = useCallback(async () => {
    setIsLoading(true);
    try {
      const dateParams = calculateDateRange();
      if (selectedCampaignId === 'all') {
        const res = await api.getSummaryReport(dateParams);
        if (res.success && res.data) {
          setSummaryData(res.data);
          setCampaignData(null);
        }
      } else {
        const [sumRes, campRes] = await Promise.all([
          api.getSummaryReport({ ...dateParams, campaignId: selectedCampaignId }),
          api.getCampaignReport(selectedCampaignId, dateParams)
        ]);
        if (sumRes.success && sumRes.data) setSummaryData(sumRes.data);
        if (campRes.success && campRes.data) setCampaignData(campRes.data);
      }
    } catch {
      // Handle error gracefully
    } finally {
      setIsLoading(false);
    }
  }, [selectedCampaignId, calculateDateRange]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      let downloadUrl = '/api/reports/export/calls';
      const dateParams = calculateDateRange();
      const params = new URLSearchParams();
      if (dateParams.startDate) params.append('startDate', dateParams.startDate);
      if (selectedCampaignId !== 'all') {
        downloadUrl = `/api/reports/export/campaign/${selectedCampaignId}`;
      } else if (params.toString()) {
        downloadUrl += `?${params.toString()}`;
      }

      const token = api.getAccessToken();
      const res = await fetch(downloadUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download =
          selectedCampaignId !== 'all'
            ? `Auckland_Accounting_Campaign_${selectedCampaignId}_Report.csv`
            : `Auckland_Accounting_Calls_Report_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }
    } finally {
      setIsExporting(false);
    }
  };

  const overview = summaryData?.overview;
  const outcomeData = summaryData?.outcomes || [];
  const hourlyData = summaryData?.hourlyVolume || [];
  const totalCalls = overview?.totalCallsPlaced || 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports & Analytics"
        description="Comprehensive operational reporting, telephony resolution rates, and questionnaire response summaries."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadAnalytics}
              isLoading={isLoading}
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            >
              Refresh
            </Button>
            {canExport && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportCsv}
                isLoading={isExporting}
                leftIcon={<Download className="w-3.5 h-3.5" />}
              >
                Export Report (CSV)
              </Button>
            )}
          </div>
        }
      />

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-500" />
          <span className="text-xs font-semibold text-slate-700">Filter Scope:</span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Campaign Filter */}
          <select
            value={selectedCampaignId}
            onChange={(e) => setSelectedCampaignId(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0f2e4a]"
          >
            <option value="all">All Campaigns (Global Aggregation)</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.status})
              </option>
            ))}
          </select>

          {/* Date Range Filter */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
            <button
              type="button"
              onClick={() => setDateRangeFilter('ALL')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                dateRangeFilter === 'ALL'
                  ? 'bg-white text-[#0f2e4a] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Time
            </button>
            <button
              type="button"
              onClick={() => setDateRangeFilter('TODAY')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                dateRangeFilter === 'TODAY'
                  ? 'bg-white text-[#0f2e4a] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setDateRangeFilter('7DAYS')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                dateRangeFilter === '7DAYS'
                  ? 'bg-white text-[#0f2e4a] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              7 Days
            </button>
            <button
              type="button"
              onClick={() => setDateRangeFilter('30DAYS')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                dateRangeFilter === '30DAYS'
                  ? 'bg-white text-[#0f2e4a] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              30 Days
            </button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-slate-500 text-xs flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-[#0f2e4a]" />
          <span>Calculating live metrics from PostgreSQL database...</span>
        </div>
      ) : (
        <>
          {/* Key Metrics Row */}
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Telephony Performance & Resolution Metrics
            </div>
            <MetricRow
              metrics={[
                { label: 'Total Calls Placed', value: totalCalls },
                {
                  label: 'Answer Rate',
                  value: `${overview?.answerRatePct || 0}%`,
                  status: (overview?.answerRatePct || 0) >= 70 ? 'success' : 'warning',
                  subtext: `${(overview?.completedCalls || 0) + (overview?.transferredCalls || 0)} answered`
                },
                {
                  label: 'Resolution Rate',
                  value: `${overview?.completionRatePct || 0}%`,
                  status: (overview?.completionRatePct || 0) >= 60 ? 'success' : 'neutral'
                },
                {
                  label: 'Average Duration',
                  value: `${overview?.averageDurationSeconds || 0}s`,
                  subtext: `${overview?.totalDurationSeconds || 0}s total talk time`
                },
                {
                  label: 'Estimated Spend',
                  value: `$${(overview?.totalEstimatedCostNzd || 0).toFixed(2)} NZD`,
                  subtext: campaignData?.metrics.costBudgetCapNzd
                    ? `Cap: $${campaignData.metrics.costBudgetCapNzd.toFixed(2)} (${campaignData.metrics.budgetUtilizedPct}% used)`
                    : '$0.04/min standard'
                },
                {
                  label: 'Safety Suppressions',
                  value: summaryData?.suppression.totalSuppressed || 0,
                  subtext: `${summaryData?.suppression.dncSuppressed || 0} DNC · ${summaryData?.suppression.consentBlocked || 0} Consent`
                }
              ]}
            />
          </div>

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Hourly Volume */}
            <Card className="lg:col-span-8 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Hourly Call Volume (Auckland Time)</h3>
                  <p className="text-xs text-slate-500">
                    Call attempts vs answered connections across business hours (NZST/NZDT)
                  </p>
                </div>
                <Badge variant="neutral" size="sm">
                  Pacific/Auckland
                </Badge>
              </div>

              {totalCalls === 0 ? (
                <div className="h-60 flex items-center justify-center text-xs text-slate-400">
                  No call attempts recorded in this time period.
                </div>
              ) : (
                <div className="h-60 w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hourlyData} margin={{ top: 5, right: 10, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="2 2" stroke="#edf0f4" vertical={false} />
                      <XAxis dataKey="hour" stroke="#8c94a0" fontSize={11} tickLine={false} axisLine={{ stroke: '#e2e5ea' }} />
                      <YAxis stroke="#8c94a0" fontSize={11} tickLine={false} axisLine={{ stroke: '#e2e5ea' }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#ffffff',
                          borderColor: '#e2e5ea',
                          fontSize: '11px',
                          borderRadius: '6px',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
                      <Bar dataKey="dialed" name="Dialed" fill="#0f2e4a" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="answered" name="Answered" fill="#16a34a" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            {/* Telephony Outcomes */}
            <Card className="lg:col-span-4 flex flex-col justify-between space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Call Outcomes</h3>
                <p className="text-xs text-slate-500">Distribution of final call attempt dispositions</p>
              </div>

              {totalCalls === 0 ? (
                <div className="h-44 flex items-center justify-center text-xs text-slate-400">
                  No call dispositions to display.
                </div>
              ) : (
                <div className="h-44 w-full my-auto">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={outcomeData.filter((o) => o.count > 0)}
                        cx="50%"
                        cy="50%"
                        innerRadius={36}
                        outerRadius={62}
                        paddingAngle={2}
                        dataKey="count"
                      >
                        {outcomeData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e5ea', fontSize: '11px', borderRadius: '6px' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="space-y-1.5 pt-2 border-t border-slate-100 text-xs">
                {outcomeData.map((item) => (
                  <div key={item.status} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="text-slate-600 text-[11px]">{item.label}</span>
                    </div>
                    <span className="font-semibold text-slate-900 font-mono">
                      {item.count} ({item.percentage}%)
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Campaign Questionnaire Response Breakdown (When Specific Campaign Selected) */}
          {campaignData && campaignData.questionnaireResponses && campaignData.questionnaireResponses.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Questionnaire Response Breakdown: {campaignData.campaign.name}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Recorded client DTMF keypresses, answers, and satisfaction survey distributions
                  </p>
                </div>
                <Badge variant="info" size="sm">
                  {campaignData.metrics.completedCalls} Completed Flows
                </Badge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {campaignData.questionnaireResponses.map((q) => (
                  <Card key={q.questionId} className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[10px] font-mono uppercase font-semibold text-slate-400">
                          Step #{q.stepNumber} · {q.questionType}
                        </div>
                        <h4 className="text-xs font-semibold text-slate-900 mt-0.5">{q.questionText}</h4>
                      </div>
                      <Badge variant="neutral" size="sm">
                        {q.totalResponses} answer{q.totalResponses !== 1 ? 's' : ''}
                      </Badge>
                    </div>

                    {q.averageRating !== null && q.averageRating !== undefined && (
                      <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-md text-xs flex items-center justify-between text-emerald-900">
                        <span className="font-medium">Average Score:</span>
                        <span className="font-mono font-bold text-sm text-emerald-700">{q.averageRating} / 5.0</span>
                      </div>
                    )}

                    <div className="space-y-2">
                      {q.optionsBreakdown.map((opt) => (
                        <div key={opt.optionKey} className="space-y-1 text-xs">
                          <div className="flex justify-between font-medium text-slate-700">
                            <span>
                              Key [{opt.optionKey}]: {opt.optionLabel}
                            </span>
                            <span className="font-mono text-slate-900">
                              {opt.count} ({opt.percentage}%)
                            </span>
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-[#0f2e4a] h-full rounded-full transition-all duration-300"
                              style={{ width: `${opt.percentage}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Compliance & Suppression Breakdown */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="space-y-1.5">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Do-Not-Call (DNC) Registry
              </div>
              <div className="text-lg font-bold text-slate-900 font-mono">
                {summaryData?.suppression.dncSuppressed || 0} Contacts
              </div>
              <p className="text-[11px] text-slate-500">Strictly excluded from dial queues per NZ compliance</p>
            </Card>

            <Card className="space-y-1.5">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Missing / Revoked Consent
              </div>
              <div className="text-lg font-bold text-slate-900 font-mono">
                {summaryData?.suppression.consentBlocked || 0} Contacts
              </div>
              <p className="text-[11px] text-slate-500">Blocked pending explicit GRANTED engagement consent</p>
            </Card>

            <Card className="space-y-1.5">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Retry Engine Operations
              </div>
              <div className="text-lg font-bold text-slate-900 font-mono">
                {summaryData?.retries.totalRetriesScheduled || 0} Scheduled
              </div>
              <p className="text-[11px] text-slate-500">
                {summaryData?.retries.successfulRetries || 0} resolved successfully on retry attempt
              </p>
            </Card>
          </div>
        </>
      )}
    </div>
  );
};
