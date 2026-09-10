import React, { useState } from 'react';
import { Search, User, FileText } from 'lucide-react';
import { AuditLogItem } from '../types';
import {
  Badge,
  Input,
  PageHeader,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  EmptyState
} from './ui';

interface AuditLogViewProps {
  auditLogs?: AuditLogItem[];
  logs?: AuditLogItem[];
}

export const AuditLogView: React.FC<AuditLogViewProps> = ({ auditLogs, logs }) => {
  const [search, setSearch] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const effectiveLogs = auditLogs || logs || [];

  const filteredLogs = effectiveLogs.filter((log) => {
    const q = search.toLowerCase();
    const matchesSearch =
      log.action.toLowerCase().includes(q) ||
      log.details.toLowerCase().includes(q) ||
      log.performedBy.toLowerCase().includes(q);

    const matchesCategory = categoryFilter === 'all' || log.category === categoryFilter;

    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Trail"
        description="Immutable record of system operations, campaign executions, and administrative events."
      />

      {/* Filter Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="w-full sm:w-80">
          <Input
            placeholder="Search by actor, action, or keyword..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="w-3.5 h-3.5" />}
          />
        </div>

        <div className="w-full sm:w-48">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0f2e4a]"
          >
            <option value="all">All Categories</option>
            <option value="Campaign">Campaigns</option>
            <option value="Questionnaire">Questionnaires</option>
            <option value="Contact">Contacts & DNC</option>
            <option value="Call Execution">Call Executions</option>
            <option value="System">System & Security</option>
          </select>
        </div>
      </div>

      {/* Audit Table */}
      {filteredLogs.length === 0 ? (
        <EmptyState
          icon={<FileText className="w-8 h-8" />}
          title="No audit events found"
          description={
            search || categoryFilter !== 'all'
              ? 'No records match the active search or category filter.'
              : 'Audit trail events will be recorded here.'
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Action & Category</TableHeaderCell>
              <TableHeaderCell>Performed By</TableHeaderCell>
              <TableHeaderCell>Event Details</TableHeaderCell>
              <TableHeaderCell className="text-right">Timestamp</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredLogs.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <div className="font-semibold text-slate-900">{item.action}</div>
                  <div className="mt-0.5">
                    <Badge variant="neutral" size="sm">{item.category}</Badge>
                  </div>
                </TableCell>

                <TableCell>
                  <div className="flex items-center gap-1.5 text-xs text-slate-800 font-medium">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    <span>{item.performedBy}</span>
                  </div>
                </TableCell>

                <TableCell>
                  <span className="text-xs text-slate-600 leading-relaxed max-w-lg block">
                    {item.details}
                  </span>
                </TableCell>

                <TableCell className="text-right text-xs text-slate-500 font-mono whitespace-nowrap">
                  {new Date(item.timestamp).toLocaleString('en-NZ', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
};
