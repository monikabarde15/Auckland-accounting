import React, { useState, useEffect } from 'react';
import { Contact, ContactGroup } from '../../types';
import { Button, Input, Modal } from '../ui';

export interface ContactEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (contactData: Partial<Contact>, groupIds: string[]) => Promise<void>;
  editingContact?: Contact | null;
  groups: ContactGroup[];
}

export const ContactEditorModal: React.FC<ContactEditorModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingContact,
  groups
}) => {
  const [formData, setFormData] = useState<Partial<Contact>>({
    name: '',
    companyName: '',
    phoneNumber: '',
    email: '',
    entityType: 'COMPANY',
    irdNumber: '',
    assignedAccountant: 'David Chen (CA)',
    outstandingBalance: 0,
    dueDate: new Date().toISOString().split('T')[0],
    isDoNotCall: false
  });
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (editingContact) {
      setFormData({
        name: editingContact.name || '',
        companyName: editingContact.companyName || '',
        phoneNumber: editingContact.phoneNumber || '',
        email: editingContact.email || '',
        entityType: editingContact.entityType || 'COMPANY',
        irdNumber: editingContact.irdNumber || '',
        assignedAccountant: editingContact.assignedAccountant || 'David Chen (CA)',
        outstandingBalance: editingContact.outstandingBalance || 0,
        dueDate: editingContact.dueDate || new Date().toISOString().split('T')[0],
        isDoNotCall: !!editingContact.isDoNotCall
      });
      setSelectedGroupIds(editingContact.groupMemberships?.map((m: any) => m.groupId) || []);
    } else {
      setFormData({
        name: '',
        companyName: '',
        phoneNumber: '',
        email: '',
        entityType: 'COMPANY',
        irdNumber: '',
        assignedAccountant: 'David Chen (CA)',
        outstandingBalance: 0,
        dueDate: new Date().toISOString().split('T')[0],
        isDoNotCall: false
      });
      setSelectedGroupIds([]);
    }
    setErrorMsg(null);
  }, [editingContact, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name?.trim() || !formData.phoneNumber?.trim()) {
      setErrorMsg('Name and Phone Number are required.');
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);
    try {
      await onSave(formData, selectedGroupIds);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save contact');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title={editingContact ? 'Edit Practice Client' : 'Add Practice Client'}
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} isLoading={isSaving}>
            {editingContact ? 'Save Changes' : 'Create Contact'}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {errorMsg && (
          <div className="p-2.5 bg-red-50 border border-red-200 rounded text-red-700 text-xs">
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Client Full Name *"
            required
            value={formData.name || ''}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g. Sarah Mitchell"
          />
          <Input
            label="Company Name"
            value={formData.companyName || ''}
            onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
            placeholder="e.g. Auckland Construction Ltd"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Phone Number (E.164) *"
            required
            value={formData.phoneNumber || ''}
            onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
            placeholder="e.g. +64 21 892 4101"
          />
          <Input
            label="Email Address"
            type="email"
            value={formData.email || ''}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            placeholder="e.g. sarah@aklconstruction.co.nz"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Entity Type</label>
            <select
              value={formData.entityType}
              onChange={(e) => setFormData({ ...formData, entityType: e.target.value as any })}
              className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-[#0f2e4a]"
            >
              <option value="COMPANY">Company</option>
              <option value="INDIVIDUAL">Individual</option>
              <option value="TRUST">Trust</option>
              <option value="PARTNERSHIP">Partnership</option>
            </select>
          </div>
          <Input
            label="IRD Number"
            value={formData.irdNumber || ''}
            onChange={(e) => setFormData({ ...formData, irdNumber: e.target.value })}
            placeholder="e.g. 109-842-993"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Outstanding Balance ($ NZD)"
            type="number"
            step="0.01"
            value={formData.outstandingBalance ?? 0}
            onChange={(e) => setFormData({ ...formData, outstandingBalance: parseFloat(e.target.value) || 0 })}
          />
          <Input
            label="GST / Review Due Date"
            type="date"
            value={formData.dueDate || ''}
            onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
          />
        </div>

        {/* DNC Suppression Checkbox */}
        <div className="pt-2 border-t border-slate-100">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!formData.isDoNotCall}
              onChange={(e) => setFormData({ ...formData, isDoNotCall: e.target.checked })}
              className="rounded text-red-600 focus:ring-red-500"
            />
            <span className="text-xs font-medium text-slate-800">
              Register on Do-Not-Call (DNC) list (suppress all automated outbound calls)
            </span>
          </label>
        </div>
      </form>
    </Modal>
  );
};
