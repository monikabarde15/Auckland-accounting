import { prisma } from './prisma.js';
import { EntityType, ConsentStatus } from '@prisma/client';
import { normalizePhoneNumber } from '../utils/phone.js';
import { checkDncSuppression } from './dncService.js';
import { BadRequestError, NotFoundError } from '../errors/AppError.js';

export interface ListContactsParams {
  search?: string;
  groupId?: string;
  isDoNotCall?: boolean;
  consentStatus?: ConsentStatus;
  entityType?: EntityType;
  tag?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface CreateContactInput {
  name: string;
  companyName?: string;
  phoneNumber: string;
  email?: string;
  entityType?: EntityType;
  irdNumber?: string;
  assignedAccountant?: string;
  outstandingBalance?: number;
  dueDate?: string | Date;
  timezone?: string;
  tags?: string[];
  notes?: string;
  isDoNotCall?: boolean;
  consentStatus?: ConsentStatus;
  consentSource?: string;
  groupIds?: string[];
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface UpdateContactInput {
  name?: string;
  companyName?: string;
  phoneNumber?: string;
  email?: string;
  entityType?: EntityType;
  irdNumber?: string;
  assignedAccountant?: string;
  outstandingBalance?: number;
  dueDate?: string | Date;
  timezone?: string;
  tags?: string[];
  notes?: string;
  isDoNotCall?: boolean;
  consentStatus?: ConsentStatus;
  groupIds?: string[];
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Lists contacts with comprehensive server-side filtering, searching, sorting, and pagination.
 */
export async function listContacts(params: ListContactsParams = {}) {
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(params.limit) || 25));
  const skip = (page - 1) * limit;

  const where: any = {};

  // Search across name, company, phone, email, IRD
  if (params.search && params.search.trim()) {
    const q = params.search.trim();
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { companyName: { contains: q, mode: 'insensitive' } },
      { phoneNumber: { contains: q } },
      { email: { contains: q, mode: 'insensitive' } },
      { irdNumber: { contains: q } }
    ];
  }

  // Filter by Group membership
  if (params.groupId && params.groupId !== 'all') {
    where.groupMemberships = {
      some: { groupId: params.groupId }
    };
  }

  // Filter by Do-Not-Call suppression status
  if (typeof params.isDoNotCall === 'boolean') {
    where.isDoNotCall = params.isDoNotCall;
  }

  // Filter by Consent Status
  if (params.consentStatus && params.consentStatus in ConsentStatus) {
    where.consentStatus = params.consentStatus;
  }

  // Filter by Entity Type
  if (params.entityType && params.entityType in EntityType) {
    where.entityType = params.entityType;
  }

  // Filter by Tag
  if (params.tag && params.tag !== 'all') {
    where.tags = { has: params.tag };
  }

  // Dynamic sorting
  const allowedSortFields = ['name', 'companyName', 'createdAt', 'outstandingBalance', 'dueDate', 'phoneNumber'];
  const sortBy = allowedSortFields.includes(params.sortBy || '') ? params.sortBy! : 'createdAt';
  const sortOrder = params.sortOrder === 'asc' ? 'asc' : 'desc';

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
      include: {
        groupMemberships: {
          include: {
            group: {
              select: { id: true, name: true }
            }
          }
        }
      }
    }),
    prisma.contact.count({ where })
  ]);

  return {
    contacts: contacts.map((c) => ({
      ...c,
      outstandingBalance: c.outstandingBalance ? Number(c.outstandingBalance) : 0,
      groups: c.groupMemberships.map((m) => m.group)
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

/**
 * Retrieves a single contact with full detail including groups and consent records.
 */
export async function getContactById(id: string) {
  const contact = await prisma.contact.findUnique({
    where: { id },
    include: {
      groupMemberships: {
        include: {
          group: { select: { id: true, name: true, description: true } }
        }
      },
      consentRecords: {
        take: 5,
        orderBy: { recordedAt: 'desc' },
        include: {
          recordedBy: { select: { id: true, name: true } }
        }
      }
    }
  });

  if (!contact) {
    throw new NotFoundError(`Contact with ID '${id}' not found`);
  }

  return {
    ...contact,
    outstandingBalance: contact.outstandingBalance ? Number(contact.outstandingBalance) : 0,
    groups: contact.groupMemberships.map((m) => m.group)
  };
}

/**
 * Creates a new contact with normalized E.164 phone number, automatic DNC checking, and initial consent record.
 */
export async function createContact(input: CreateContactInput) {
  const {
    name,
    companyName,
    phoneNumber,
    email,
    entityType = EntityType.COMPANY,
    irdNumber,
    assignedAccountant = 'David Chen (CA)',
    outstandingBalance = 0,
    dueDate,
    timezone = 'Pacific/Auckland',
    tags = [],
    notes,
    isDoNotCall = false,
    consentStatus = ConsentStatus.GRANTED,
    consentSource = 'MANUAL',
    groupIds = [],
    userId,
    ipAddress,
    userAgent
  } = input;

  if (!name || !name.trim()) {
    throw new BadRequestError('Contact name is required');
  }

  const norm = normalizePhoneNumber(phoneNumber);
  if (!norm.isValid) {
    throw new BadRequestError(`Invalid phone number: ${norm.error || 'must be a valid phone number'}`);
  }

  // Server-side DNC check: if on suppression list, always enforce isDoNotCall = true
  const dncCheck = await checkDncSuppression(norm.e164);
  const finalDnc = dncCheck.isSuppressed ? true : isDoNotCall;

  const contact = await prisma.$transaction(async (tx) => {
    const created = await tx.contact.create({
      data: {
        name: name.trim(),
        companyName: companyName?.trim() || 'Sole Trader',
        phoneNumber: norm.e164,
        email: email?.trim().toLowerCase() || null,
        entityType,
        irdNumber: irdNumber?.trim() || null,
        assignedAccountant: assignedAccountant.trim(),
        outstandingBalance,
        dueDate: dueDate ? new Date(dueDate) : null,
        timezone,
        tags,
        notes: notes?.trim() || null,
        isDoNotCall: finalDnc,
        callPermission: consentStatus === ConsentStatus.GRANTED && !finalDnc,
        consentStatus,
        consentSource,
        consentTimestamp: new Date()
      }
    });

    // Add group memberships if specified
    if (groupIds.length > 0) {
      const validGroups = await tx.contactGroup.findMany({
        where: { id: { in: groupIds } },
        select: { id: true }
      });

      if (validGroups.length > 0) {
        await tx.contactGroupMember.createMany({
          data: validGroups.map((g) => ({
            contactId: created.id,
            groupId: g.id
          })),
          skipDuplicates: true
        });
      }
    }

    // Record initial consent audit entry
    await tx.consentRecord.create({
      data: {
        contactId: created.id,
        status: consentStatus,
        source: consentSource,
        notes: `Initial contact enrollment (${consentSource})`,
        recordedById: userId
      }
    });

    // Log contact creation in central audit trail
    await tx.auditLog.create({
      data: {
        userId,
        action: 'CONTACT_CREATED',
        category: 'Contact',
        entityType: 'Contact',
        entityId: created.id,
        newValue: {
          name: created.name,
          phoneNumber: created.phoneNumber,
          companyName: created.companyName,
          isDoNotCall: created.isDoNotCall,
          consentStatus: created.consentStatus
        },
        ipAddress,
        userAgent,
        details: `Created contact ${created.name} (${created.phoneNumber}). DNC Suppressed: ${created.isDoNotCall}.`
      }
    });

    return created;
  });

  return getContactById(contact.id);
}

/**
 * Updates an existing contact record with audit logging.
 */
export async function updateContact(id: string, input: UpdateContactInput) {
  const existing = await prisma.contact.findUnique({
    where: { id }
  });

  if (!existing) {
    throw new NotFoundError(`Contact with ID '${id}' not found`);
  }

  let finalPhone = existing.phoneNumber;
  let finalDnc = input.isDoNotCall !== undefined ? input.isDoNotCall : existing.isDoNotCall;

  if (input.phoneNumber && input.phoneNumber !== existing.phoneNumber) {
    const norm = normalizePhoneNumber(input.phoneNumber);
    if (!norm.isValid) {
      throw new BadRequestError(`Invalid phone number: ${norm.error || 'must be valid E.164'}`);
    }
    finalPhone = norm.e164;

    // Check if new number is on DNC suppression list
    const dncCheck = await checkDncSuppression(finalPhone);
    if (dncCheck.isSuppressed) {
      finalDnc = true;
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.contact.update({
      where: { id },
      data: {
        name: input.name !== undefined ? input.name.trim() : undefined,
        companyName: input.companyName !== undefined ? input.companyName.trim() : undefined,
        phoneNumber: finalPhone,
        email: input.email !== undefined ? (input.email ? input.email.trim().toLowerCase() : null) : undefined,
        entityType: input.entityType,
        irdNumber: input.irdNumber !== undefined ? (input.irdNumber ? input.irdNumber.trim() : null) : undefined,
        assignedAccountant: input.assignedAccountant,
        outstandingBalance: input.outstandingBalance !== undefined ? input.outstandingBalance : undefined,
        dueDate: input.dueDate !== undefined ? (input.dueDate ? new Date(input.dueDate) : null) : undefined,
        timezone: input.timezone,
        tags: input.tags,
        notes: input.notes !== undefined ? (input.notes ? input.notes.trim() : null) : undefined,
        isDoNotCall: finalDnc,
        callPermission: input.consentStatus ? input.consentStatus === ConsentStatus.GRANTED && !finalDnc : undefined,
        consentStatus: input.consentStatus
      }
    });

    // Update group memberships if groupIds provided
    if (input.groupIds !== undefined) {
      await tx.contactGroupMember.deleteMany({ where: { contactId: id } });
      if (input.groupIds.length > 0) {
        await tx.contactGroupMember.createMany({
          data: input.groupIds.map((gId) => ({
            contactId: id,
            groupId: gId
          })),
          skipDuplicates: true
        });
      }
    }

    // Audit log
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: 'CONTACT_UPDATED',
        category: 'Contact',
        entityType: 'Contact',
        entityId: id,
        oldValue: {
          name: existing.name,
          phoneNumber: existing.phoneNumber,
          isDoNotCall: existing.isDoNotCall
        },
        newValue: {
          name: res.name,
          phoneNumber: res.phoneNumber,
          isDoNotCall: res.isDoNotCall
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        details: `Updated contact record for ${res.name} (${res.phoneNumber}).`
      }
    });

    return res;
  });

  return getContactById(updated.id);
}

/**
 * Deletes a contact record and cascades memberships with audit logging.
 */
export async function deleteContact(id: string, userId?: string, ipAddress?: string, userAgent?: string) {
  const existing = await prisma.contact.findUnique({
    where: { id }
  });

  if (!existing) {
    throw new NotFoundError(`Contact with ID '${id}' not found`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.contactGroupMember.deleteMany({ where: { contactId: id } });
    await tx.consentRecord.deleteMany({ where: { contactId: id } });
    await tx.contact.delete({ where: { id } });

    await tx.auditLog.create({
      data: {
        userId,
        action: 'CONTACT_DELETED',
        category: 'Contact',
        entityType: 'Contact',
        entityId: id,
        oldValue: {
          name: existing.name,
          phoneNumber: existing.phoneNumber,
          companyName: existing.companyName
        },
        ipAddress,
        userAgent,
        details: `Deleted contact record ${existing.name} (${existing.phoneNumber}).`
      }
    });
  });

  return { success: true, deletedId: id };
}
