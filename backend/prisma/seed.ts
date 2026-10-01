import 'dotenv/config';
import { PrismaClient, CampaignStatus, QuestionType, NextAction, EntityType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Auckland Accounting IVR database...');

  // 1. Roles & Permissions
  const superAdminRole = await prisma.role.upsert({
    where: { name: 'SUPER_ADMIN' },
    update: {},
    create: {
      name: 'SUPER_ADMIN',
      description: 'Full system administration and critical telephony configuration access'
    }
  });

  const adminRole = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    update: {},
    create: {
      name: 'ADMIN',
      description: 'Practice manager: manage campaigns, questionnaires, contacts, view reports'
    }
  });

  const operatorRole = await prisma.role.upsert({
    where: { name: 'OPERATOR' },
    update: {},
    create: {
      name: 'OPERATOR',
      description: 'Staff operator: view assigned campaigns, contacts, call results'
    }
  });

  // Permissions
  const permissionsList = [
    // Contacts
    { action: 'view', subject: 'contacts', description: 'View contact directory, profiles, and compliance details' },
    { action: 'create', subject: 'contacts', description: 'Add new client contacts' },
    { action: 'edit', subject: 'contacts', description: 'Edit existing client contact details and balances' },
    { action: 'delete', subject: 'contacts', description: 'Delete client contacts from directory' },
    { action: 'import', subject: 'contacts', description: 'Bulk import contacts via CSV upload wizard' },
    { action: 'export', subject: 'contacts', description: 'Export contacts list to RFC 4180 CSV' },

    // Contact Groups
    { action: 'view', subject: 'groups', description: 'View contact groups and member lists' },
    { action: 'create', subject: 'groups', description: 'Create new contact groups' },
    { action: 'edit', subject: 'groups', description: 'Edit group names and assign/remove members' },
    { action: 'delete', subject: 'groups', description: 'Delete contact groups' },

    // Do-Not-Call (DNC) & Consent
    { action: 'view', subject: 'dnc', description: 'View Do-Not-Call suppression registry and consent logs' },
    { action: 'manage', subject: 'dnc', description: 'Add or remove numbers from DNC suppression registry' },

    // Campaigns
    { action: 'view', subject: 'campaigns', description: 'View campaigns, scheduling, and pre-launch validation' },
    { action: 'create', subject: 'campaigns', description: 'Create new calling campaigns' },
    { action: 'edit', subject: 'campaigns', description: 'Edit campaign configurations and schedules' },
    { action: 'delete', subject: 'campaigns', description: 'Delete draft or finished campaigns' },
    { action: 'start', subject: 'campaigns', description: 'Launch and start outbound calling campaigns' },
    { action: 'pause', subject: 'campaigns', description: 'Pause running campaigns' },
    { action: 'resume', subject: 'campaigns', description: 'Resume paused campaigns' },
    { action: 'cancel', subject: 'campaigns', description: 'Cancel active campaigns' },

    // Questionnaires & IVR Flow Graph
    { action: 'view', subject: 'questionnaires', description: 'View IVR questionnaires, questions, and flow diagrams' },
    { action: 'create', subject: 'questionnaires', description: 'Create new IVR questionnaires and questions' },
    { action: 'edit', subject: 'questionnaires', description: 'Edit question scripts, DTMF keys, and branching rules' },
    { action: 'delete', subject: 'questionnaires', description: 'Delete questionnaires and individual questions' },

    // Calls & Telephony
    { action: 'view', subject: 'calls', description: 'View call history, recordings, transcripts, and diagnostics' },
    { action: 'execute', subject: 'calls', description: 'Trigger manual test calls and telephony simulator' },

    // Reports & Analytics
    { action: 'view', subject: 'reports', description: 'View KPI summaries, call pacing charts, and response funnels' },
    { action: 'export', subject: 'reports', description: 'Export call records and campaign analytics to CSV' },

    // User Management
    { action: 'view', subject: 'users', description: 'View staff and administrator accounts' },
    { action: 'create', subject: 'users', description: 'Create new staff user accounts' },
    { action: 'edit', subject: 'users', description: 'Edit user accounts and reset credentials' },
    { action: 'deactivate', subject: 'users', description: 'Deactivate or reactivate user accounts' },

    // Roles & Permissions
    { action: 'view', subject: 'roles', description: 'View system roles and permission assignments' },
    { action: 'manage', subject: 'roles', description: 'Configure and modify role permissions' },

    // Audit & System
    { action: 'view', subject: 'audit', description: 'View immutable compliance audit trail' },
    { action: 'settings', subject: 'system', description: 'View and manage system and telephony settings' },
    { action: 'stop', subject: 'emergency', description: 'Trigger emergency stop to halt all outbound calls' },
    { action: 'manage', subject: 'all', description: 'Full unrestricted system administration' }
  ];

  // Default baseline permissions per role
  const adminPermissions = [
    'contacts.view', 'contacts.create', 'contacts.edit', 'contacts.delete', 'contacts.import', 'contacts.export',
    'groups.view', 'groups.create', 'groups.edit', 'groups.delete',
    'dnc.view', 'dnc.manage',
    'campaigns.view', 'campaigns.create', 'campaigns.edit', 'campaigns.delete', 'campaigns.start', 'campaigns.pause', 'campaigns.resume', 'campaigns.cancel',
    'questionnaires.view', 'questionnaires.create', 'questionnaires.edit', 'questionnaires.delete',
    'calls.view', 'calls.execute',
    'reports.view', 'reports.export',
    'users.view',
    'audit.view',
    'emergency.stop'
  ];

  const operatorPermissions = [
    'contacts.view',
    'groups.view',
    'dnc.view',
    'campaigns.view',
    'questionnaires.view',
    'calls.view',
    'reports.view'
  ];

  for (const p of permissionsList) {
    const perm = await prisma.permission.upsert({
      where: {
        action_subject: {
          action: p.action,
          subject: p.subject
        }
      },
      update: { description: p.description },
      create: p
    });

    const permKey = `${p.subject}.${p.action}`;

    // SUPER_ADMIN gets all permissions
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: superAdminRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: superAdminRole.id, permissionId: perm.id }
    });

    // ADMIN default permissions
    if (adminPermissions.includes(permKey) || (p.action === 'manage' && p.subject === 'all')) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: adminRole.id, permissionId: perm.id } },
        update: {},
        create: { roleId: adminRole.id, permissionId: perm.id }
      });
    }

    // OPERATOR default permissions
    if (operatorPermissions.includes(permKey)) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: operatorRole.id, permissionId: perm.id } },
        update: {},
        create: { roleId: operatorRole.id, permissionId: perm.id }
      });
    }
  }

  console.log('Roles & permissions configured.');

  // 2. Default Users (Bcrypt hashed with 12 rounds)
  const defaultUsers = [
    {
      email: 'superadmin@aucklandaccounting.co.nz',
      name: 'David Chen (Principal Partner)',
      passwordPlain: 'AculaSuperAdmin2026!',
      role: superAdminRole
    },
    {
      email: 'admin@aucklandaccounting.co.nz',
      name: 'Priya Sharma (Practice Manager)',
      passwordPlain: 'AculaAdmin2026!',
      role: adminRole
    },
    {
      email: 'operator@aucklandaccounting.co.nz',
      name: 'James Wilson (Operations Associate)',
      passwordPlain: 'AculaOperator2026!',
      role: operatorRole
    }
  ];

  for (const u of defaultUsers) {
    const passwordHash = await bcrypt.hash(u.passwordPlain, 12);
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        passwordHash,
        name: u.name,
        isActive: true
      },
      create: {
        email: u.email,
        name: u.name,
        passwordHash,
        isActive: true
      }
    });

    // Ensure role assignment
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: u.role.id } },
      update: {},
      create: { userId: user.id, roleId: u.role.id }
    });
  }

  console.log('Default practice user accounts seeded (superadmin, admin, operator).');

  // 3. Default System Settings
  const settings = [
    {
      key: 'CALLING_HOURS_START',
      value: '09:00',
      description: 'Default outbound dialing start time (NZST)'
    },
    {
      key: 'CALLING_HOURS_END',
      value: '18:00',
      description: 'Default outbound dialing cutoff time (NZST)'
    },
    {
      key: 'DEFAULT_TIMEZONE',
      value: 'Pacific/Auckland',
      description: 'Auckland practice primary timezone'
    },
    {
      key: 'DEFAULT_CALLER_ID',
      value: process.env.TWILIO_PHONE_NUMBER || '',
      description: 'Active Twilio Outbound Calling Phone Number'
    },
    {
      key: 'MAX_CONCURRENT_CALLS_DEFAULT',
      value: '5',
      description: 'Default maximum simultaneous calls'
    },
    {
      key: 'RETRY_MAX_ATTEMPTS',
      value: '3',
      description: 'Default retry attempts for uncompleted calls'
    },
    {
      key: 'RETRY_INTERVAL_MINUTES',
      value: '60',
      description: 'Default retry backoff period in minutes'
    }
  ];

  for (const s of settings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: s
    });
  }

  // 4. Contact Groups
  const gstGroup = await prisma.contactGroup.upsert({
    where: { name: 'GST Clients - Aug/Sep 2026' },
    update: {},
    create: {
      name: 'GST Clients - Aug/Sep 2026',
      description: 'Bi-monthly GST return filers due on 28th'
    }
  });

  await prisma.contactGroup.upsert({
    where: { name: 'Tax Return Follow-up' },
    update: {},
    create: {
      name: 'Tax Return Follow-up',
      description: 'Clients with pending Income Tax Return disclosures'
    }
  });

  // 5. Contact Groups initialized (empty)

  // 6. Seed Practice Questionnaire Flows
  const superAdmin = await prisma.user.findUnique({
    where: { email: 'superadmin@aucklandaccounting.co.nz' }
  });

  let gstQuestionnaire = await prisma.questionnaire.findFirst({
    where: { title: 'GST Filing Verification & Submission Reminder' }
  });

  if (!gstQuestionnaire) {
    gstQuestionnaire = await prisma.questionnaire.create({
      data: {
        title: 'GST Filing Verification & Submission Reminder',
        description: 'Standard practice flow verifying bank reconciliations and client declaration for IRD GST return filing.',
        category: 'Tax & Compliance',
        createdById: superAdmin?.id,
        questions: {
          create: [
            {
              name: 'Greeting & Verification',
              questionText: 'Kia Ora, this is Auckland Accounting Services calling regarding your upcoming GST return. Are you ready to confirm your return details? Press 1 for Yes, or 2 to call back later.',
              type: QuestionType.YES_NO,
              orderNo: 1,
              timeoutSeconds: 7,
              retryCount: 2,
              options: {
                create: [
                  {
                    optionKey: '1',
                    optionLabel: 'Yes, proceed',
                    nextAction: NextAction.CONTINUE
                  },
                  {
                    optionKey: '2',
                    optionLabel: 'No, call back later',
                    nextAction: NextAction.END_CALL
                  }
                ]
              }
            },
            {
              name: 'Bank Reconciliation Check',
              questionText: 'Have all business bank accounts been fully reconciled in Xero or MYOB? Press 1 if fully reconciled, Press 2 if uncoded transactions remain, or Press 3 to transfer to your accountant.',
              type: QuestionType.MULTIPLE_CHOICE,
              orderNo: 2,
              timeoutSeconds: 8,
              retryCount: 2,
              options: {
                create: [
                  {
                    optionKey: '1',
                    optionLabel: 'Fully reconciled',
                    nextAction: NextAction.CONTINUE
                  },
                  {
                    optionKey: '2',
                    optionLabel: 'Uncoded transactions',
                    nextAction: NextAction.CONTINUE
                  },
                  {
                    optionKey: '3',
                    optionLabel: 'Transfer to accountant',
                    nextAction: NextAction.TRANSFER
                  }
                ]
              }
            },
            {
              name: 'Filing Authorization Closing',
              questionText: 'Thank you. Auckland Accounting Services has logged your verification and our tax agents will finalize your Inland Revenue filing draft. Kia pai to ra, have a great day.',
              type: QuestionType.MESSAGE_ONLY,
              orderNo: 3,
              timeoutSeconds: 5,
              retryCount: 0
            }
          ]
        }
      },
      include: { questions: true }
    });

    // Set starting question
    if (gstQuestionnaire.questions.length > 0) {
      await prisma.questionnaire.update({
        where: { id: gstQuestionnaire.id },
        data: { startingQuestionId: gstQuestionnaire.questions[0].id }
      });
    }
  }

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
