import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Plus,
  Trash2,
  Search,
  Phone,
  AlertTriangle
} from 'lucide-react';
import { DncRecord } from '../../types';
import { api } from '../../services/api';
import {
  Button,
  Badge,
  Input,
  Modal,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  ConfirmDialog,
  EmptyState
} from '../ui';

interface DncRegistryViewProps {
  onRefreshContacts?: () => void;
}

export const DncRegistryView: React.FC<DncRegistryViewProps> = ({ onRefreshContacts }) => {
  const [dncRecords, setDncRecords] = useState<DncRecord[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newReason, setNewReason] = useState('Client requested exclusion');
  const [newSource, setNewSource] = useState('CLIENT_REQUEST');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [recordToDelete, setRecordToDelete] = useState<DncRecord | null>(null);

  const loadDncRecords = async () => {
    setIsLoading(true);
    try {
      const res = await api.getDncRecords({ search: searchQuery, limit: 50 });
      if (res.success && res.data) {
        setDncRecords(res.data.records || []);
        setTotalCount(res.data.pagination?.total || 0);
      }
    } catch (err) {
      console.error('Failed to load DNC records:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDncRecords();
  }, [searchQuery]);

  const handleAddDnc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPhone.trim()) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await api.addToDnc({
        phoneNumber: newPhone.trim(),
        reason: newReason.trim(),
        source: newSource
      });

      if (res.success) {
        setIsAddModalOpen(false);
        setNewPhone('');
        setNewReason('Client requested exclusion');
        loadDncRecords();
        onRefreshContacts?.();
      } else {
        setErrorMsg(res.error?.message || 'Failed to add phone to DNC registry');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to add phone to DNC registry');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveDnc = async () => {
    if (!recordToDelete) return;
    try {
      await api.removeFromDnc(recordToDelete.id);
      setRecordToDelete(null);
      loadDncRecords();
      onRefreshContacts?.();
    } catch (err: any) {
      alert(err?.message || 'Failed to remove from DNC');
    }
  };

  return (
    <div className="space-y-4">
      {/* Search & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="w-full sm:w-80">
          <Input
            placeholder="Search suppressed phone numbers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            leftIcon={<Search className="w-3.5 h-3.5" />}
          />
        </div>

        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            setNewPhone('');
            setErrorMsg(null);
            setIsAddModalOpen(true);
          }}
          leftIcon={<Plus className="w-3.5 h-3.5" />}
        >
          Add Number to DNC
        </Button>
      </div>

      {/* DNC Table */}
      {isLoading ? (
        <div className="py-12 text-center text-xs text-slate-400">Loading suppression registry...</div>
      ) : dncRecords.length === 0 ? (
        <EmptyState
          icon={<ShieldAlert className="w-8 h-8 text-slate-300" />}
          title="No suppressed phone numbers"
          description="Numbers added to the Do-Not-Call registry will be automatically excluded from all automated dialing."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Suppressed Phone Number</TableHeaderCell>
              <TableHeaderCell>Reason / Compliance Justification</TableHeaderCell>
              <TableHeaderCell>Source</TableHeaderCell>
              <TableHeaderCell>Registered Date</TableHeaderCell>
              <TableHeaderCell>Enrolled By</TableHeaderCell>
              <TableHeaderCell className="text-right">Actions</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dncRecords.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <span className="font-mono font-semibold text-slate-900">{r.phoneNumber}</span>
                </TableCell>
                <TableCell>
                  <span className="text-slate-700">{r.reason || 'Client requested exclusion'}</span>
                </TableCell>
                <TableCell>
                  <Badge variant="neutral" size="sm">{r.source}</Badge>
                </TableCell>
                <TableCell className="text-xs text-slate-500 font-mono">
                  {new Date(r.createdAt).toLocaleDateString('en-NZ', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })}
                </TableCell>
                <TableCell className="text-xs text-slate-600">
                  {r.createdBy?.name || 'System / Practice Policy'}
                </TableCell>
                <TableCell className="text-right">
                  <button
                    type="button"
                    onClick={() => setRecordToDelete(r)}
                    className="p-1 text-slate-400 hover:text-red-600 rounded"
                    title="Remove suppression"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Modal: Add to DNC */}
      {isAddModalOpen && (
        <Modal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          size="sm"
          title="Add Number to Do-Not-Call List"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button variant="outline" size="sm" onClick={() => setIsAddModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleAddDnc}
                isLoading={isSubmitting}
              >
                Suppress Number
              </Button>
            </div>
          }
        >
          <form onSubmit={handleAddDnc} className="space-y-3 text-xs">
            {errorMsg && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded text-red-700">
                {errorMsg}
              </div>
            )}
            <Input
              label="Phone Number (E.164) *"
              required
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="e.g. +64 21 555 9999"
            />
            <Input
              label="Reason / Notes"
              value={newReason}
              onChange={(e) => setNewReason(e.target.value)}
              placeholder="e.g. Client requested exclusion"
            />
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Source</label>
              <select
                value={newSource}
                onChange={(e) => setNewSource(e.target.value)}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-[#0f2e4a]"
              >
                <option value="CLIENT_REQUEST">Client Direct Request</option>
                <option value="IVR_OPT_OUT">Automated IVR Keypress Opt-Out</option>
                <option value="COMPLIANCE">Regulatory / Practice Compliance</option>
                <option value="MANUAL">Manual Practice Entry</option>
              </select>
            </div>
          </form>
        </Modal>
      )}

      {/* Confirm DNC Removal */}
      {recordToDelete && (
        <ConfirmDialog
          isOpen={!!recordToDelete}
          onClose={() => setRecordToDelete(null)}
          onConfirm={handleRemoveDnc}
          title="Remove DNC Suppression"
          message={`Remove ${recordToDelete.phoneNumber} from Do-Not-Call suppression? Automated outbound calling to this number will become eligible again.`}
        />
      )}
    </div>
  );
};
