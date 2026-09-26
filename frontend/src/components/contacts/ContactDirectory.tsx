import React from 'react';
import {
  Search,
  Plus,
  Phone,
  Edit2,
  Trash2,
  ShieldBan,
  Eye,
  Building,
  User,
  ShieldCheck,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { Contact, ContactGroup } from '../../types';
import { useAuth } from '../../context/AuthContext';
import {
  Button,
  Badge,
  Input,
  DropdownMenu,
  DropdownMenuItem,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  EmptyState
} from '../ui';

export interface ContactDirectoryProps {
  contacts: Contact[];
  groups: ContactGroup[];
  totalCount: number;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedGroupId: string;
  onGroupFilterChange: (groupId: string) => void;
  dncFilter: 'all' | 'callable' | 'dnc_only';
  onDncFilterChange: (filter: 'all' | 'callable' | 'dnc_only') => void;
  consentFilter: string;
  onConsentFilterChange: (filter: string) => void;
  entityTypeFilter: string;
  onEntityTypeFilterChange: (filter: string) => void;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  onSortChange: (field: string) => void;
  onViewDetails: (contact: Contact) => void;
  onEditContact: (contact: Contact) => void;
  onDeleteContact: (contactId: string) => void;
  onToggleDnc: (contact: Contact) => void;
  onCallInSimulator?: (contactId: string) => void;
  onNewContact: () => void;
  onLaunchImport: () => void;
  onExportCsv: () => void;
  onBulkAddToGroup?: (contactIds: string[], groupId: string) => void;
  isLoading?: boolean;
}

export const ContactDirectory: React.FC<ContactDirectoryProps> = ({
  contacts,
  groups,
  totalCount,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange,
  searchQuery,
  onSearchChange,
  selectedGroupId,
  onGroupFilterChange,
  dncFilter,
  onDncFilterChange,
  consentFilter,
  onConsentFilterChange,
  entityTypeFilter,
  onEntityTypeFilterChange,
  sortBy,
  sortOrder,
  onSortChange,
  onViewDetails,
  onEditContact,
  onDeleteContact,
  onToggleDnc,
  onCallInSimulator,
  onNewContact,
  onLaunchImport,
  onExportCsv
}) => {
  const { hasPermission } = useAuth();
  
  const filteredContacts = contacts.filter((c) => {
    const q = searchQuery.toLowerCase().trim();
    const cleanQuery = q.replace(/[\s\-\(\)\+]/g, '');
    const cleanPhone = (c.phoneNumber || '').replace(/[\s\-\(\)\+]/g, '');

    const matchesSearch =
      !q ||
      c.name.toLowerCase().includes(q) ||
      (c.companyName || '').toLowerCase().includes(q) ||
      (c.phoneNumber && c.phoneNumber.includes(q)) ||
      (cleanQuery && cleanPhone.includes(cleanQuery)) ||
      (c.email || '').toLowerCase().includes(q);

    const matchesDnc =
      dncFilter === 'all'
        ? true
        : dncFilter === 'callable'
        ? !c.isDoNotCall
        : !!c.isDoNotCall;

    const matchesConsent =
      consentFilter === 'all' ? true : c.consentStatus === consentFilter;

    const matchesGroup =
      selectedGroupId === 'all'
        ? true
        : Array.isArray(c.groups) &&
          c.groups.some((g: any) =>
            typeof g === 'string' ? g === selectedGroupId : g.id === selectedGroupId || g.name === selectedGroupId
          );

    const matchesEntityType =
      entityTypeFilter === 'all'
        ? true
        : String(c.entityType || '').toLowerCase() === entityTypeFilter.toLowerCase();

    return matchesSearch && matchesDnc && matchesConsent && matchesGroup && matchesEntityType;
  });

  const totalPages = Math.max(1, Math.ceil(filteredContacts.length / pageSize));
  const paginatedContacts = filteredContacts.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  return (
    <div className="space-y-4">
      {/* Search & Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
        <div className="sm:col-span-5">
          <Input
            placeholder="Search by client name, company, phone, email..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            leftIcon={<Search className="w-3.5 h-3.5" />}
          />
        </div>

        <div className="sm:col-span-3">
          <select
            value={selectedGroupId}
            onChange={(e) => onGroupFilterChange(e.target.value)}
            className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0f2e4a]"
          >
            <option value="all">All Contact Groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.memberCount ?? 0})
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <select
            value={dncFilter}
            onChange={(e) => onDncFilterChange(e.target.value as any)}
            className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0f2e4a]"
          >
            <option value="all">All Telephony Status</option>
            <option value="callable">Callable Only</option>
            <option value="dnc_only">DNC Suppressed Only</option>
          </select>
        </div>

        <div className="sm:col-span-2">
          <select
            value={consentFilter}
            onChange={(e) => onConsentFilterChange(e.target.value)}
            className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0f2e4a]"
          >
            <option value="all">All Consent</option>
            <option value="GRANTED">Consent Granted</option>
            <option value="PENDING">Pending Review</option>
            <option value="REVOKED">Revoked</option>
          </select>
        </div>
      </div>

      {/* Directory Table */}
      {paginatedContacts.length === 0 ? (
        <EmptyState
          icon={<User className="w-8 h-8" />}
          title="No contacts found"
          description={
            searchQuery || dncFilter !== 'all' || consentFilter !== 'all'
              ? 'Try modifying your search or filter options.'
              : 'Add your first practice client or import a CSV file.'
          }
          action={
            <Button variant="primary" size="sm" onClick={onNewContact}>
              Add Contact
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Client & Company</TableHeaderCell>
              <TableHeaderCell>Phone & Email</TableHeaderCell>
              <TableHeaderCell>Balance Due</TableHeaderCell>
              <TableHeaderCell>DNC Status</TableHeaderCell>
              <TableHeaderCell>Consent</TableHeaderCell>
              <TableHeaderCell className="text-right">Actions</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedContacts.map((c) => {
              const dropdownItems: DropdownMenuItem[] = [
                {
                  label: 'View Details',
                  icon: <Eye className="w-3.5 h-3.5 text-slate-600" />,
                  onClick: () => onViewDetails(c)
                }
              ];

              if (hasPermission('contacts.edit')) {
                dropdownItems.push({
                  label: 'Edit Contact',
                  icon: <Edit2 className="w-3.5 h-3.5 text-slate-600" />,
                  onClick: () => onEditContact(c)
                });
              }

              if (onCallInSimulator && !c.isDoNotCall && hasPermission('calls.execute')) {
                dropdownItems.push({
                  label: 'Call in Simulator',
                  icon: <Phone className="w-3.5 h-3.5 text-emerald-600" />,
                  onClick: () => onCallInSimulator(c.id)
                });
              }

              if (hasPermission('dnc.manage')) {
                dropdownItems.push({
                  label: c.isDoNotCall ? 'Remove DNC Suppression' : 'Add to DNC Registry',
                  icon: <ShieldBan className="w-3.5 h-3.5 text-amber-600" />,
                  onClick: () => onToggleDnc(c)
                });
              }

              if (hasPermission('contacts.delete')) {
                dropdownItems.push({
                  label: 'Delete Contact',
                  icon: <Trash2 className="w-3.5 h-3.5 text-red-600" />,
                  variant: 'danger' as const,
                  onClick: () => onDeleteContact(c.id)
                });
              }

              return (
                <TableRow key={c.id} isClickable onClick={() => onViewDetails(c)}>
                  <TableCell>
                    <div className="font-semibold text-slate-900">{c.name}</div>
                    <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                      <Building className="w-3 h-3 text-slate-400" />
                      <span>{c.companyName || 'Individual'}</span>
                    </div>
                  </TableCell>

                  <TableCell>
                    <div className="font-mono text-xs text-slate-800 font-medium">{c.phoneNumber}</div>
                    <div className="text-[11px] text-slate-500 truncate max-w-[200px]">{c.email || '—'}</div>
                  </TableCell>

                  <TableCell>
                    <div className="font-mono text-xs font-semibold text-slate-900">
                      ${c.outstandingBalance ? Number(c.outstandingBalance).toFixed(2) : '0.00'}
                    </div>
                    {c.dueDate && (
                      <div className="text-[10px] text-slate-400">Due: {c.dueDate}</div>
                    )}
                  </TableCell>

                  <TableCell>
                    {c.isDoNotCall ? (
                      <Badge variant="danger" size="sm">DNC Suppressed</Badge>
                    ) : (
                      <Badge variant="success" size="sm">Callable</Badge>
                    )}
                  </TableCell>

                  <TableCell>
                    <Badge
                      variant={c.consentStatus === 'GRANTED' ? 'success' : c.consentStatus === 'REVOKED' ? 'danger' : 'neutral'}
                      size="sm"
                    >
                      {c.consentStatus || 'GRANTED'}
                    </Badge>
                  </TableCell>

                  <TableCell className="text-right">
                    <DropdownMenu items={dropdownItems} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* Pagination Controls */}
      {filteredContacts.length > pageSize && (
        <div className="flex items-center justify-between pt-2 text-xs text-slate-500">
          <span>
            Showing {(currentPage - 1) * pageSize + 1} to{' '}
            {Math.min(currentPage * pageSize, filteredContacts.length)} of {filteredContacts.length} clients
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="xs"
              disabled={currentPage <= 1}
              onClick={() => onPageChange(currentPage - 1)}
              leftIcon={<ChevronLeft className="w-3.5 h-3.5" />}
            >
              Previous
            </Button>
            <span className="px-2 font-mono">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="xs"
              disabled={currentPage >= totalPages}
              onClick={() => onPageChange(currentPage + 1)}
              rightIcon={<ChevronRight className="w-3.5 h-3.5" />}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
