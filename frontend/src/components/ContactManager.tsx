import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Users, FolderTree, ShieldBan, Upload, Plus, Download } from 'lucide-react';
import { Contact, ContactGroup } from '../types';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Button, PageHeader, Tabs } from './ui';
import { ContactDirectory } from './contacts/ContactDirectory';
import { ContactGroupsView } from './contacts/ContactGroupsView';
import { DncRegistryView } from './contacts/DncRegistryView';
import { CsvImportWizard } from './contacts/CsvImportWizard';
import { ContactDetailDrawer } from './contacts/ContactDetailDrawer';
import { ContactEditorModal } from './contacts/ContactEditorModal';

interface ContactManagerProps {
  contacts: Contact[];
  onSaveContact: (contact: Contact) => void;
  onDeleteContact: (contactId: string) => void;
  onImportContacts: (contacts: Contact[]) => void;
  onCallContactInSimulator?: (contactId: string) => void;
}

export const ContactManager: React.FC<ContactManagerProps> = ({
  contacts,
  onSaveContact,
  onDeleteContact,
  onCallContactInSimulator
}) => {
  const { hasPermission } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Active Tab
  const [activeTab, setActiveTab] = useState<string>('directory');
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('all');
  const [dncFilter, setDncFilter] = useState<'all' | 'callable' | 'dnc_only'>('all');
  const [consentFilter, setConsentFilter] = useState('all');
  const [entityTypeFilter, setEntityTypeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Modals & Drawers
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [isDetailDrawerOpen, setIsDetailDrawerOpen] = useState(false);
  const [isEditorModalOpen, setIsEditorModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [isImportWizardOpen, setIsImportWizardOpen] = useState(false);

  // Sync tab with pathname if navigated directly
  useEffect(() => {
    if (location.pathname === '/contacts/groups') {
      setActiveTab('groups');
    } else if (location.pathname === '/contacts/dnc') {
      setActiveTab('dnc');
    } else if (location.pathname === '/contacts/import') {
      setActiveTab('import');
    } else {
      setActiveTab('directory');
    }
  }, [location.pathname]);

  const loadGroups = async () => {
    try {
      const res = await api.getContactGroups();
      if (res.success && res.data) {
        setGroups(res.data);
      }
    } catch {
      // Handled
    }
  };

  useEffect(() => {
    loadGroups();
  }, []);

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    if (tabId === 'groups') navigate('/contacts/groups');
    else if (tabId === 'dnc') navigate('/contacts/dnc');
    else if (tabId === 'import') navigate('/contacts/import');
    else navigate('/contacts');
  };

  const handleOpenNewContact = () => {
    setEditingContact(null);
    setIsEditorModalOpen(true);
  };

  const handleEditContact = (contact: Contact) => {
    setEditingContact(contact);
    setIsEditorModalOpen(true);
  };

  const handleViewDetails = (contact: Contact) => {
    setSelectedContact(contact);
    setIsDetailDrawerOpen(true);
  };

  const handleToggleDnc = async (contact: Contact) => {
    const updated: Contact = {
      ...contact,
      isDoNotCall: !contact.isDoNotCall,
      callPermission: contact.isDoNotCall
    };
    onSaveContact(updated);
  };

  const handleSaveContactData = async (contactData: Partial<Contact>, groupIds: string[]) => {
    if (editingContact) {
      const updated = { ...editingContact, ...contactData };
      onSaveContact(updated as Contact);
    } else {
      const newContact: Contact = {
        id: `cnt_${Date.now()}`,
        name: contactData.name || 'New Client',
        companyName: contactData.companyName || '',
        phoneNumber: contactData.phoneNumber || '',
        email: contactData.email || '',
        entityType: contactData.entityType || 'COMPANY',
        irdNumber: contactData.irdNumber || '',
        assignedAccountant: contactData.assignedAccountant || 'David Chen (CA)',
        outstandingBalance: contactData.outstandingBalance || 0,
        dueDate: contactData.dueDate || new Date().toISOString().split('T')[0],
        tags: contactData.tags || [],
        callPermission: !contactData.isDoNotCall,
        isDoNotCall: !!contactData.isDoNotCall,
        consentStatus: contactData.consentStatus || 'GRANTED',
        createdAt: new Date().toISOString()
      };
      onSaveContact(newContact);
    }
    setIsEditorModalOpen(false);
  };

  const exportContactsCsv = () => {
    const headers = ['Name', 'Company', 'Phone', 'Email', 'Entity Type', 'IRD Number', 'Balance', 'DNC Status'];
    const rows = contacts.map((c) => [
      `"${c.name}"`,
      `"${c.companyName}"`,
      `"${c.phoneNumber}"`,
      `"${c.email}"`,
      `"${c.entityType}"`,
      `"${c.irdNumber || ''}"`,
      `"${c.outstandingBalance || 0}"`,
      `"${c.isDoNotCall ? 'DNC' : 'Callable'}"`
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `Auckland_Accounting_Contacts_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const availableTabs = [
    { id: 'directory', label: 'Directory', count: contacts.length, icon: <Users className="w-3.5 h-3.5" />, permission: 'contacts.view' },
    { id: 'groups', label: 'Groups', count: groups.length, icon: <FolderTree className="w-3.5 h-3.5" />, permission: 'groups.view' },
    { id: 'dnc', label: 'DNC Registry', count: contacts.filter((c) => c.isDoNotCall).length, icon: <ShieldBan className="w-3.5 h-3.5" />, permission: 'dnc.view' }
  ].filter((t) => hasPermission(t.permission));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contact Directory & Compliance Hub"
        description="Manage client directory, grouping, Do-Not-Call suppression, and batch CSV imports."
        actions={
          <div className="flex items-center gap-2">
            {hasPermission('contacts.export') && (
              <Button
                variant="outline"
                size="sm"
                onClick={exportContactsCsv}
                leftIcon={<Download className="w-3.5 h-3.5" />}
              >
                Export CSV
              </Button>
            )}
            {hasPermission('contacts.import') && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsImportWizardOpen(true)}
                leftIcon={<Upload className="w-3.5 h-3.5" />}
              >
                Import CSV
              </Button>
            )}
            {hasPermission('contacts.create') && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleOpenNewContact}
                leftIcon={<Plus className="w-3.5 h-3.5" />}
              >
                Add Contact
              </Button>
            )}
          </div>
        }
      />

      {availableTabs.length > 0 && (
        <Tabs
          tabs={availableTabs}
          activeTab={activeTab === 'import' ? 'directory' : activeTab}
          onChange={handleTabChange}
        />
      )}

      {activeTab === 'directory' && (
        <ContactDirectory
          contacts={contacts}
          groups={groups}
          totalCount={contacts.length}
          currentPage={currentPage}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          selectedGroupId={selectedGroupId}
          onGroupFilterChange={setSelectedGroupId}
          dncFilter={dncFilter}
          onDncFilterChange={setDncFilter}
          consentFilter={consentFilter}
          onConsentFilterChange={setConsentFilter}
          entityTypeFilter={entityTypeFilter}
          onEntityTypeFilterChange={setEntityTypeFilter}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSortChange={setSortBy}
          onViewDetails={handleViewDetails}
          onEditContact={handleEditContact}
          onDeleteContact={onDeleteContact}
          onToggleDnc={handleToggleDnc}
          onCallInSimulator={onCallContactInSimulator}
          onNewContact={handleOpenNewContact}
          onLaunchImport={() => setIsImportWizardOpen(true)}
          onExportCsv={exportContactsCsv}
        />
      )}

      {activeTab === 'groups' && (
        <ContactGroupsView
          groups={groups}
          allContacts={contacts}
          onRefreshGroups={loadGroups}
        />
      )}

      {activeTab === 'dnc' && (
        <DncRegistryView onRefreshContacts={() => {}} />
      )}

      {activeTab === 'import' && (
        <div className="bg-white border border-slate-200 rounded-lg p-6 text-center space-y-3">
          <Upload className="w-10 h-10 text-slate-400 mx-auto" />
          <h3 className="text-sm font-semibold text-slate-900">CSV Import Pipeline</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Upload CSV files containing practice client records with automatic E.164 normalization and DNC validation.
          </p>
          <Button variant="primary" size="sm" onClick={() => setIsImportWizardOpen(true)}>
            Open Import Wizard
          </Button>
        </div>
      )}

      {/* Contact Details Drawer */}
      {isDetailDrawerOpen && (
        <ContactDetailDrawer
          contactId={selectedContact?.id || null}
          contact={selectedContact}
          isOpen={isDetailDrawerOpen}
          onClose={() => setIsDetailDrawerOpen(false)}
          onEdit={handleEditContact}
          onDelete={onDeleteContact}
          onToggleDnc={handleToggleDnc}
          onCallInSimulator={onCallContactInSimulator}
          allGroups={groups}
          onRefresh={() => {}}
        />
      )}

      {/* Contact Editor Modal */}
      {isEditorModalOpen && (
        <ContactEditorModal
          isOpen={isEditorModalOpen}
          onClose={() => setIsEditorModalOpen(false)}
          onSave={handleSaveContactData}
          editingContact={editingContact}
          groups={groups}
        />
      )}

      {/* CSV Import Wizard Modal */}
      {isImportWizardOpen && (
        <CsvImportWizard
          isOpen={isImportWizardOpen}
          onClose={() => setIsImportWizardOpen(false)}
          groups={groups}
          onImportComplete={loadGroups}
        />
      )}
    </div>
  );
};
