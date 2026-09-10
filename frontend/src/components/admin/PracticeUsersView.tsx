import React, { useState } from 'react';
import { UserCheck, Shield, Mail, Plus } from 'lucide-react';
import {
  Button,
  Badge,
  PageHeader,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  Modal,
  Input
} from '../ui';

export const PracticeUsersView: React.FC = () => {
  const [users, setUsers] = useState([
    {
      id: 'usr_01',
      name: 'David Chen',
      title: 'Principal Partner (Chartered Accountant)',
      email: 'superadmin@aucklandaccounting.co.nz',
      role: 'SUPER_ADMIN',
      isActive: true,
      lastLogin: 'Active now'
    },
    {
      id: 'usr_02',
      name: 'Priya Sharma',
      title: 'Practice Manager (CPA)',
      email: 'admin@aucklandaccounting.co.nz',
      role: 'ADMIN',
      isActive: true,
      lastLogin: 'Today, 09:15 NZST'
    },
    {
      id: 'usr_03',
      name: 'James Wilson',
      title: 'Senior Operations Associate',
      email: 'operator@aucklandaccounting.co.nz',
      role: 'OPERATOR',
      isActive: true,
      lastLogin: 'Yesterday, 16:45 NZST'
    }
  ]);

  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('OPERATOR');

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteName || !inviteEmail) return;

    setUsers([
      ...users,
      {
        id: `usr_${Date.now()}`,
        name: inviteName,
        title: 'Practice Member',
        email: inviteEmail,
        role: inviteRole,
        isActive: true,
        lastLogin: 'Invitation pending'
      }
    ]);
    setIsInviteModalOpen(false);
    setInviteName('');
    setInviteEmail('');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Practice Users & Access"
        description="Manage Auckland Accounting staff accounts, role assignments, and session permissions."
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsInviteModalOpen(true)}
            leftIcon={<Plus className="w-3.5 h-3.5" />}
          >
            Invite Staff Member
          </Button>
        }
      />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHeaderCell>Practice Member</TableHeaderCell>
            <TableHeaderCell>Email Address</TableHeaderCell>
            <TableHeaderCell>Assigned Role</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
            <TableHeaderCell className="text-right">Last Authenticated</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id}>
              <TableCell>
                <div className="font-semibold text-slate-900">{u.name}</div>
                <div className="text-[11px] text-slate-500">{u.title}</div>
              </TableCell>

              <TableCell>
                <div className="flex items-center gap-1.5 font-mono text-xs text-slate-700">
                  <Mail className="w-3.5 h-3.5 text-slate-400" />
                  <span>{u.email}</span>
                </div>
              </TableCell>

              <TableCell>
                <Badge
                  variant={u.role === 'SUPER_ADMIN' ? 'brand' : u.role === 'ADMIN' ? 'info' : 'neutral'}
                  size="sm"
                >
                  <Shield className="w-3 h-3 mr-1" />
                  {u.role}
                </Badge>
              </TableCell>

              <TableCell>
                <Badge variant={u.isActive ? 'success' : 'danger'} size="sm" dot>
                  {u.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </TableCell>

              <TableCell className="text-right text-xs text-slate-500 font-mono">
                {u.lastLogin}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Invite Modal */}
      {isInviteModalOpen && (
        <Modal
          isOpen={isInviteModalOpen}
          onClose={() => setIsInviteModalOpen(false)}
          size="sm"
          title="Invite Practice Staff Member"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button variant="outline" size="sm" onClick={() => setIsInviteModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={handleInvite}>
                Send Invitation
              </Button>
            </div>
          }
        >
          <form onSubmit={handleInvite} className="space-y-3 text-xs">
            <Input
              label="Full Name *"
              required
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              placeholder="e.g. Liam Taylor"
            />
            <Input
              label="Email Address *"
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="e.g. liam@aucklandaccounting.co.nz"
            />
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Security Role</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-[#0f2e4a]"
              >
                <option value="OPERATOR">Operator (Standard Staff)</option>
                <option value="ADMIN">Admin (Practice Manager)</option>
                <option value="SUPER_ADMIN">Super Admin (Principal Partner)</option>
              </select>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
