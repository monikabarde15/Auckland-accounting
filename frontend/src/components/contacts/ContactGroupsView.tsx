import React, { useState, useEffect } from 'react';
import {
  FolderTree,
  Plus,
  Trash2,
  Users,
  Edit2,
  X,
  UserPlus
} from 'lucide-react';
import { Contact, ContactGroup } from '../../types';
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

export interface ContactGroupsViewProps {
  groups: ContactGroup[];
  onRefreshGroups: () => void;
  allContacts: Contact[];
}

export const ContactGroupsView: React.FC<ContactGroupsViewProps> = ({
  groups,
  onRefreshGroups,
  allContacts
}) => {
  const [selectedGroup, setSelectedGroup] = useState<ContactGroup | null>(groups[0] || null);
  const [members, setMembers] = useState<Contact[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);

  // Group Create / Edit modal
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ContactGroup | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');

  // Add Member modal
  const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);

  // Deletion confirm
  const [groupToDelete, setGroupToDelete] = useState<ContactGroup | null>(null);

  const loadGroupMembers = async (groupId: string) => {
    setIsLoadingMembers(true);
    try {
      const res = await api.getContactGroupById(groupId);
      if (res.success && res.data) {
        setMembers(res.data.members || []);
      }
    } catch {
      // Fallback
      setMembers([]);
    } finally {
      setIsLoadingMembers(false);
    }
  };

  useEffect(() => {
    if (selectedGroup) {
      loadGroupMembers(selectedGroup.id);
    }
  }, [selectedGroup?.id]);

  const handleOpenCreateGroup = () => {
    setEditingGroup(null);
    setGroupName('');
    setGroupDescription('');
    setIsGroupModalOpen(true);
  };

  const handleOpenEditGroup = (g: ContactGroup) => {
    setEditingGroup(g);
    setGroupName(g.name);
    setGroupDescription(g.description || '');
    setIsGroupModalOpen(true);
  };

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) return;

    try {
      if (editingGroup) {
        await api.updateContactGroup(editingGroup.id, {
          name: groupName.trim(),
          description: groupDescription.trim()
        });
      } else {
        const res = await api.createContactGroup({
          name: groupName.trim(),
          description: groupDescription.trim()
        });
        if (res.success && res.data) {
          setSelectedGroup(res.data);
        }
      }
      setIsGroupModalOpen(false);
      onRefreshGroups();
    } catch (err: any) {
      alert(err.message || 'Failed to save group');
    }
  };

  const handleDeleteGroup = async () => {
    if (!groupToDelete) return;
    try {
      await api.deleteContactGroup(groupToDelete.id);
      setGroupToDelete(null);
      onRefreshGroups();
      const remaining = groups.filter((g) => g.id !== groupToDelete.id);
      setSelectedGroup(remaining[0] || null);
    } catch (err: any) {
      alert(err.message || 'Failed to delete group');
    }
  };

  const handleAddMembers = async () => {
    if (!selectedGroup || selectedContactIds.length === 0) return;
    try {
      await api.addGroupMembers(selectedGroup.id, selectedContactIds);
      setIsAddMemberModalOpen(false);
      setSelectedContactIds([]);
      loadGroupMembers(selectedGroup.id);
      onRefreshGroups();
    } catch (err: any) {
      alert(err.message || 'Failed to add members');
    }
  };

  const handleRemoveMember = async (contactId: string) => {
    if (!selectedGroup) return;
    try {
      await api.removeGroupMember(selectedGroup.id, contactId);
      loadGroupMembers(selectedGroup.id);
      onRefreshGroups();
    } catch (err: any) {
      alert(err.message || 'Failed to remove member');
    }
  };

  const nonMembers = allContacts.filter(
    (c) => !members.some((m) => m.id === c.id)
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left: Groups List (4 cols) */}
      <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-3 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
            Contact Groups ({groups.length})
          </span>
          <Button
            variant="ghost"
            size="xs"
            onClick={handleOpenCreateGroup}
            leftIcon={<Plus className="w-3 h-3" />}
          >
            New Group
          </Button>
        </div>

        {groups.length === 0 ? (
          <EmptyState
            title="No contact groups"
            description="Create groups to categorize clients for targeted campaigns."
            action={
              <Button variant="primary" size="xs" onClick={handleOpenCreateGroup}>
                Create Group
              </Button>
            }
          />
        ) : (
          <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
            {groups.map((g) => {
              const isSelected = selectedGroup?.id === g.id;
              return (
                <div
                  key={g.id}
                  onClick={() => setSelectedGroup(g)}
                  className={`p-2.5 rounded-lg border text-left cursor-pointer transition-colors ${
                    isSelected
                      ? 'border-[#0f2e4a] bg-blue-50/40 ring-1 ring-[#0f2e4a]'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-xs text-slate-900 truncate">{g.name}</span>
                    <Badge variant="neutral" size="sm">{g.memberCount ?? 0} members</Badge>
                  </div>
                  {g.description && (
                    <p className="text-[11px] text-slate-500 mt-1 line-clamp-1">{g.description}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right: Selected Group Members & Management (8 cols) */}
      <div className="lg:col-span-8 space-y-4">
        {selectedGroup ? (
          <div className="space-y-4">
            {/* Header info */}
            <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">{selectedGroup.name}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{selectedGroup.description || 'No description provided.'}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => handleOpenEditGroup(selectedGroup)}
                  leftIcon={<Edit2 className="w-3 h-3" />}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={() => setGroupToDelete(selectedGroup)}
                  leftIcon={<Trash2 className="w-3 h-3" />}
                >
                  Delete
                </Button>
              </div>
            </div>

            {/* Members Table */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Group Members ({members.length})
                </span>
                <Button
                  variant="primary"
                  size="xs"
                  onClick={() => {
                    setSelectedContactIds([]);
                    setIsAddMemberModalOpen(true);
                  }}
                  leftIcon={<UserPlus className="w-3 h-3" />}
                >
                  Add Clients to Group
                </Button>
              </div>

              {isLoadingMembers ? (
                <div className="py-8 text-center text-xs text-slate-400">Loading members...</div>
              ) : members.length === 0 ? (
                <EmptyState
                  title="No members in this group"
                  description="Add clients from your directory to this group."
                  action={
                    <Button
                      variant="primary"
                      size="xs"
                      onClick={() => setIsAddMemberModalOpen(true)}
                    >
                      Add Members
                    </Button>
                  }
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHeaderCell>Client Name</TableHeaderCell>
                      <TableHeaderCell>Company</TableHeaderCell>
                      <TableHeaderCell>Phone</TableHeaderCell>
                      <TableHeaderCell className="text-right">Action</TableHeaderCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-semibold text-slate-900">{m.name}</TableCell>
                        <TableCell className="text-slate-600">{m.companyName || '—'}</TableCell>
                        <TableCell className="font-mono text-slate-700">{m.phoneNumber}</TableCell>
                        <TableCell className="text-right">
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(m.id)}
                            className="p-1 text-slate-400 hover:text-red-600 rounded"
                            title="Remove from group"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        ) : (
          <EmptyState
            title="No group selected"
            description="Select a group from the list on the left to view and manage its members."
          />
        )}
      </div>

      {/* Modal: Create/Edit Group */}
      {isGroupModalOpen && (
        <Modal
          isOpen={isGroupModalOpen}
          onClose={() => setIsGroupModalOpen(false)}
          size="sm"
          title={editingGroup ? 'Edit Contact Group' : 'Create Contact Group'}
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button variant="outline" size="sm" onClick={() => setIsGroupModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={handleSaveGroup}>
                {editingGroup ? 'Save Changes' : 'Create Group'}
              </Button>
            </div>
          }
        >
          <form onSubmit={handleSaveGroup} className="space-y-3 text-xs">
            <Input
              label="Group Name *"
              required
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g. GST August Filers"
            />
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
              <textarea
                rows={2}
                value={groupDescription}
                onChange={(e) => setGroupDescription(e.target.value)}
                placeholder="Description of client category..."
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#0f2e4a]"
              />
            </div>
          </form>
        </Modal>
      )}

      {/* Modal: Add Members to Group */}
      {isAddMemberModalOpen && (
        <Modal
          isOpen={isAddMemberModalOpen}
          onClose={() => setIsAddMemberModalOpen(false)}
          size="md"
          title={`Add Clients to "${selectedGroup?.name}"`}
          footer={
            <div className="flex items-center justify-between w-full">
              <span className="text-xs text-slate-500 font-medium">
                {selectedContactIds.length} client{selectedContactIds.length !== 1 ? 's' : ''} selected
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setIsAddMemberModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={selectedContactIds.length === 0}
                  onClick={handleAddMembers}
                >
                  Add Selected Clients
                </Button>
              </div>
            </div>
          }
        >
          <div className="space-y-2 text-xs">
            <p className="text-slate-500">Select clients from your directory to add to this group:</p>
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-60 overflow-y-auto">
              {nonMembers.length === 0 ? (
                <p className="p-4 text-center text-slate-400">All practice clients are already in this group.</p>
              ) : (
                nonMembers.map((c) => {
                  const isChecked = selectedContactIds.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className={`p-2.5 flex items-center justify-between cursor-pointer hover:bg-slate-50 ${
                        isChecked ? 'bg-blue-50/30' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedContactIds([...selectedContactIds, c.id]);
                            } else {
                              setSelectedContactIds(selectedContactIds.filter((id) => id !== c.id));
                            }
                          }}
                          className="rounded text-[#0f2e4a]"
                        />
                        <div>
                          <span className="font-semibold text-slate-900 block">{c.name}</span>
                          <span className="text-slate-500 text-[11px]">{c.companyName || c.phoneNumber}</span>
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Confirm Deletion */}
      {groupToDelete && (
        <ConfirmDialog
          isOpen={!!groupToDelete}
          onClose={() => setGroupToDelete(null)}
          onConfirm={handleDeleteGroup}
          title="Delete Contact Group"
          message={`Are you sure you want to delete group "${groupToDelete.name}"? Contacts within the group will not be deleted.`}
        />
      )}
    </div>
  );
};
