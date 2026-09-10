import { prisma } from './prisma.js';
import { BadRequestError, NotFoundError } from '../errors/AppError.js';

export interface CreateGroupInput {
  name: string;
  description?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface UpdateGroupInput {
  name?: string;
  description?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Lists all contact groups with member counts.
 */
export async function listGroups() {
  const groups = await prisma.contactGroup.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: {
        select: { members: true }
      }
    }
  });

  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    memberCount: g._count.members,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt
  }));
}

/**
 * Retrieves a single group by ID with paginated member list.
 */
export async function getGroupById(id: string, params: { page?: number; limit?: number } = {}) {
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(params.limit) || 25));
  const skip = (page - 1) * limit;

  const group = await prisma.contactGroup.findUnique({
    where: { id },
    include: {
      _count: { select: { members: true } }
    }
  });

  if (!group) {
    throw new NotFoundError(`Contact group with ID '${id}' not found`);
  }

  const [memberships, total] = await Promise.all([
    prisma.contactGroupMember.findMany({
      where: { groupId: id },
      skip,
      take: limit,
      orderBy: { joinedAt: 'desc' },
      include: {
        contact: {
          select: {
            id: true,
            name: true,
            companyName: true,
            phoneNumber: true,
            email: true,
            entityType: true,
            isDoNotCall: true,
            consentStatus: true
          }
        }
      }
    }),
    prisma.contactGroupMember.count({ where: { groupId: id } })
  ]);

  return {
    group: {
      id: group.id,
      name: group.name,
      description: group.description,
      memberCount: group._count.members,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt
    },
    members: memberships.map((m) => ({
      ...m.contact,
      joinedAt: m.joinedAt
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
 * Creates a new contact group.
 */
export async function createGroup(input: CreateGroupInput) {
  const { name, description, userId, ipAddress, userAgent } = input;
  const trimmedName = name?.trim();

  if (!trimmedName) {
    throw new BadRequestError('Group name is required');
  }

  const existing = await prisma.contactGroup.findUnique({
    where: { name: trimmedName }
  });

  if (existing) {
    throw new BadRequestError(`A contact group named '${trimmedName}' already exists`);
  }

  const group = await prisma.$transaction(async (tx) => {
    const created = await tx.contactGroup.create({
      data: {
        name: trimmedName,
        description: description?.trim() || null
      }
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: 'GROUP_CREATED',
        category: 'Contact',
        entityType: 'ContactGroup',
        entityId: created.id,
        newValue: { name: created.name, description: created.description },
        ipAddress,
        userAgent,
        details: `Created contact group "${created.name}".`
      }
    });

    return created;
  });

  return group;
}

/**
 * Updates an existing contact group.
 */
export async function updateGroup(id: string, input: UpdateGroupInput) {
  const { name, description, userId, ipAddress, userAgent } = input;

  const existing = await prisma.contactGroup.findUnique({
    where: { id }
  });

  if (!existing) {
    throw new NotFoundError(`Contact group with ID '${id}' not found`);
  }

  const trimmedName = name?.trim();
  if (trimmedName && trimmedName !== existing.name) {
    const duplicate = await prisma.contactGroup.findUnique({
      where: { name: trimmedName }
    });
    if (duplicate) {
      throw new BadRequestError(`A contact group named '${trimmedName}' already exists`);
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.contactGroup.update({
      where: { id },
      data: {
        ...(trimmedName ? { name: trimmedName } : {}),
        ...(description !== undefined ? { description: description.trim() || null } : {})
      }
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: 'GROUP_UPDATED',
        category: 'Contact',
        entityType: 'ContactGroup',
        entityId: id,
        oldValue: { name: existing.name, description: existing.description },
        newValue: { name: res.name, description: res.description },
        ipAddress,
        userAgent,
        details: `Updated contact group "${res.name}".`
      }
    });

    return res;
  });

  return updated;
}

/**
 * Deletes a contact group and cascades membership deletions.
 */
export async function deleteGroup(id: string, userId?: string, ipAddress?: string, userAgent?: string) {
  const existing = await prisma.contactGroup.findUnique({
    where: { id },
    include: { _count: { select: { members: true } } }
  });

  if (!existing) {
    throw new NotFoundError(`Contact group with ID '${id}' not found`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.contactGroupMember.deleteMany({
      where: { groupId: id }
    });

    await tx.contactGroup.delete({
      where: { id }
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: 'GROUP_DELETED',
        category: 'Contact',
        entityType: 'ContactGroup',
        entityId: id,
        oldValue: { name: existing.name, memberCount: existing._count.members },
        ipAddress,
        userAgent,
        details: `Deleted contact group "${existing.name}" (had ${existing._count.members} members).`
      }
    });
  });

  return { success: true, deletedId: id };
}

/**
 * Adds contacts to a group, preventing duplicate memberships.
 */
export async function addGroupMembers(
  groupId: string,
  contactIds: string[],
  userId?: string,
  ipAddress?: string,
  userAgent?: string
) {
  const group = await prisma.contactGroup.findUnique({
    where: { id: groupId }
  });

  if (!group) {
    throw new NotFoundError(`Contact group with ID '${groupId}' not found`);
  }

  if (!contactIds || contactIds.length === 0) {
    throw new BadRequestError('No contact IDs provided');
  }

  // Verify all contact IDs exist
  const existingContacts = await prisma.contact.findMany({
    where: { id: { in: contactIds } },
    select: { id: true }
  });

  const validContactIds = existingContacts.map((c) => c.id);

  if (validContactIds.length === 0) {
    throw new BadRequestError('None of the provided contact IDs are valid');
  }

  // Create memberships skipping duplicates
  const recordsToInsert = validContactIds.map((cId) => ({
    groupId,
    contactId: cId
  }));

  const createResult = await prisma.contactGroupMember.createMany({
    data: recordsToInsert,
    skipDuplicates: true
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: 'GROUP_MEMBER_ADDED',
      category: 'Contact',
      entityType: 'ContactGroup',
      entityId: groupId,
      newValue: { count: createResult.count, contactIds: validContactIds },
      ipAddress,
      userAgent,
      details: `Added ${createResult.count} contact(s) to group "${group.name}".`
    }
  });

  return {
    success: true,
    addedCount: createResult.count,
    totalRequested: contactIds.length
  };
}

/**
 * Removes a contact from a group.
 */
export async function removeGroupMember(
  groupId: string,
  contactId: string,
  userId?: string,
  ipAddress?: string,
  userAgent?: string
) {
  const membership = await prisma.contactGroupMember.findUnique({
    where: {
      contactId_groupId: {
        contactId,
        groupId
      }
    },
    include: {
      group: { select: { name: true } },
      contact: { select: { name: true, phoneNumber: true } }
    }
  });

  if (!membership) {
    throw new NotFoundError(`Contact membership not found in this group`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.contactGroupMember.delete({
      where: {
        contactId_groupId: {
          contactId,
          groupId
        }
      }
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: 'GROUP_MEMBER_REMOVED',
        category: 'Contact',
        entityType: 'ContactGroup',
        entityId: groupId,
        details: `Removed contact ${membership.contact.name} (${membership.contact.phoneNumber}) from group "${membership.group.name}".`,
        ipAddress,
        userAgent
      }
    });
  });

  return { success: true };
}
