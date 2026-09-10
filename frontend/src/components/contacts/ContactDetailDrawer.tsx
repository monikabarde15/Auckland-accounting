import React, { useState, useEffect } from 'react';
import {
  Building,
  Phone,
  Mail,
  User,
  ShieldCheck,
  ShieldBan,
  Calendar,
  DollarSign,
  Edit2,
  Trash2,
  PhoneCall,
  FileText
} from 'lucide-react';
import { Contact, ContactGroup, ConsentRecord, ConsentStatus } from '../../types';
import { api } from '../../services/api';
import { Button, Badge, Drawer, Input } from '../ui';

export interface ContactDetailDrawerProps {
  contactId: string | null;
  contact?: Contact | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (contact: Contact) => void;
  onDelete: (contactId: string) => void;
  onToggleDnc: (contact: Contact) => void;
  onCallInSimulator?: (contactId: string) => void;
  allGroups: ContactGroup[];
  onRefresh: () => void;
}

export const ContactDetailDrawer: React.FC<ContactDetailDrawerProps> = ({
  contactId,
  contact: initialContact,
  isOpen,
  onClose,
  onEdit,
  onDelete,
  onToggleDnc,
  onCallInSimulator,
  onRefresh
}) => {
  const [contact, setContact] = useState<Contact | null>(initialContact || null);
  const [consentHistory, setConsentHistory] = useState<ConsentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecordingConsent, setIsRecordingConsent] = useState(false);
  const [newConsentStatus, setNewConsentStatus] = useState<ConsentStatus>('GRANTED');
  const [consentNotes, setConsentNotes] = useState('');

  useEffect(() => {
    if (initialContact) {
      setContact(initialContact);
    }
  }, [initialContact]);

  useEffect(() => {
    if (!contactId || !isOpen) return;

    const fetchContactData = async () => {
      if (!initialContact) {
        setIsLoading(true);
      }
      try {
        const res = await api.getContactById(contactId);
        if (res.success && res.data) {
          setContact(res.data);
        }
        const consentRes = await api.getContactConsent(contactId);
        if (consentRes.success && consentRes.data?.history) {
          setConsentHistory(consentRes.data.history);
        }
      } catch {
        // Handled
      } finally {
        setIsLoading(false);
      }
    };

    fetchContactData();
  }, [contactId, isOpen, initialContact]);

  const handleSaveConsent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactId) return;

    try {
      await api.recordContactConsent(contactId, {
        status: newConsentStatus,
        notes: consentNotes,
        source: 'MANUAL_PRACTICE_UPDATE'
      });
      setIsRecordingConsent(false);
      setConsentNotes('');
      // Reload consent
      const consentRes = await api.getContactConsent(contactId);
      if (consentRes.success && consentRes.data?.history) {
        setConsentHistory(consentRes.data.history);
      }
      onRefresh();
    } catch {
      // Handled
    }
  };

  if (!isOpen) return null;

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title={contact?.name || 'Contact Details'}
      subtitle={contact?.companyName || 'Practice Client Record'}
      footer={
        contact && (
          <div className="flex items-center justify-between w-full gap-2">
            <Button
              variant="outline"
              size="xs"
              className="text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => {
                onClose();
                onDelete(contact.id);
              }}
              leftIcon={<Trash2 className="w-3.5 h-3.5" />}
            >
              Delete
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onClose();
                  onEdit(contact);
                }}
                leftIcon={<Edit2 className="w-3.5 h-3.5" />}
              >
                Edit
              </Button>
              {onCallInSimulator && !contact.isDoNotCall && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    onClose();
                    onCallInSimulator(contact.id);
                  }}
                  leftIcon={<Phone className="w-3.5 h-3.5" />}
                >
                  Call in Simulator
                </Button>
              )}
            </div>
          </div>
        )
      }
    >
      {isLoading || !contact ? (
        <div className="py-12 text-center text-xs text-slate-400">Loading client profile...</div>
      ) : (
        <div className="space-y-5 text-xs">
          {/* Identity Card */}
          <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-2">
            <span className="font-semibold text-slate-700 uppercase tracking-wider text-[10px] block">
              Client & Entity Identity
            </span>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-slate-400 block text-[11px]">Entity Type</span>
                <span className="font-medium text-slate-800">{contact.entityType || 'COMPANY'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">IRD Number</span>
                <span className="font-mono font-medium text-slate-800">{contact.irdNumber || '—'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Phone (E.164)</span>
                <span className="font-mono font-medium text-slate-800">{contact.phoneNumber}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Email</span>
                <span className="font-medium text-slate-800 truncate block">{contact.email || '—'}</span>
              </div>
            </div>
          </div>

          {/* Accounting Profile */}
          <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-2">
            <span className="font-semibold text-slate-700 uppercase tracking-wider text-[10px] block">
              Accounting Practice Profile
            </span>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-slate-400 block text-[11px]">Assigned Accountant</span>
                <span className="font-medium text-slate-800">{contact.assignedAccountant || 'David Chen (CA)'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Outstanding Balance</span>
                <span className="font-mono font-bold text-slate-900">
                  ${contact.outstandingBalance ? Number(contact.outstandingBalance).toFixed(2) : '0.00'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Filing / Due Date</span>
                <span className="font-medium text-slate-800">{contact.dueDate || '—'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Timezone</span>
                <span className="font-medium text-slate-800">{contact.timezone || 'Pacific/Auckland'}</span>
              </div>
            </div>
          </div>

          {/* DNC & Compliance Status */}
          <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-700 uppercase tracking-wider text-[10px] block">
                Do-Not-Call (DNC) Compliance
              </span>
              <Button
                variant="outline"
                size="xs"
                onClick={() => {
                  onToggleDnc(contact);
                  setContact({ ...contact, isDoNotCall: !contact.isDoNotCall });
                }}
              >
                {contact.isDoNotCall ? 'Remove DNC' : 'Suppress (DNC)'}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              {contact.isDoNotCall ? (
                <Badge variant="danger" size="md">DNC Suppressed</Badge>
              ) : (
                <Badge variant="success" size="md">Eligible for Outbound Calling</Badge>
              )}
            </div>
          </div>

          {/* Consent History Timeline */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-700 uppercase tracking-wider text-[10px] block">
                Consent Audit History
              </span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setIsRecordingConsent(!isRecordingConsent)}
              >
                {isRecordingConsent ? 'Cancel' : 'Update Consent'}
              </Button>
            </div>

            {isRecordingConsent && (
              <form onSubmit={handleSaveConsent} className="p-3 bg-slate-100 rounded-lg space-y-2 border border-slate-200">
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">New Consent Status</label>
                  <select
                    value={newConsentStatus}
                    onChange={(e) => setNewConsentStatus(e.target.value as ConsentStatus)}
                    className="w-full px-2.5 py-1 bg-white border border-slate-300 rounded text-xs"
                  >
                    <option value="GRANTED">Consent Granted</option>
                    <option value="REVOKED">Consent Revoked</option>
                    <option value="PENDING">Pending Verification</option>
                  </select>
                </div>
                <Input
                  placeholder="Reason or notes..."
                  value={consentNotes}
                  onChange={(e) => setConsentNotes(e.target.value)}
                />
                <Button variant="primary" size="xs" type="submit">
                  Save Consent Record
                </Button>
              </form>
            )}

            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {consentHistory.length === 0 ? (
                <p className="text-slate-400 text-xs italic py-2 text-center">
                  Default engagement consent recorded.
                </p>
              ) : (
                consentHistory.map((item, i) => (
                  <div key={i} className="p-2.5 bg-slate-50 rounded border border-slate-200 flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-slate-800">{item.status}</span>
                      <span className="text-slate-500 text-[11px] block">{item.notes || item.source}</span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {new Date(item.recordedAt).toLocaleDateString('en-NZ')}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
};
