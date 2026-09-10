import { prisma } from './prisma.js';
import { normalizePhoneNumber } from '../utils/phone.js';
import { BadRequestError, NotFoundError } from '../errors/AppError.js';

export interface AddToDncInput {
  phoneNumber: string;
  reason?: string;
  source?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface RemoveFromDncInput {
  idOrPhone: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface DncListParams {
  search?: string;
  page?: number;
  limit?: number;
}

/**
 * Checks if a phone number is registered on the active Do-Not-Call suppression list.
 */
export async function checkDncSuppression(rawPhone: string) {
  const norm = normalizePhoneNumber(rawPhone);
  const targetPhone = norm.isValid ? norm.e164 : rawPhone.trim();

  const record = await prisma.dncRecord.findFirst({
    where: {
      phoneNumber: targetPhone,
      isActive: true
    }
  });

  return {
    isSuppressed: !!record,
    normalizedPhone: norm.e164,
    record: record || null
  };
}

/**
 * Adds a phone number to the Do-Not-Call (DNC) registry.
 * Automatically synchronizes all matching contact records by setting isDoNotCall = true.
 * Records an auditable compliance event.
 */
export async function addToDnc(input: AddToDncInput) {
  const norm = normalizePhoneNumber(input.phoneNumber);
  if (!norm.isValid) {
    throw new BadRequestError(`Invalid phone number: ${norm.error || 'cannot normalize to E.164'}`);
  }

  const canonicalPhone = norm.e164;

  const record = await prisma.$transaction(async (tx) => {
    // 1. Upsert DNC record
    const existing = await tx.dncRecord.findUnique({
      where: { phoneNumber: canonicalPhone }
    });

    let dnc;
    if (existing) {
      dnc = await tx.dncRecord.update({
        where: { id: existing.id },
        data: {
          isActive: true,
          reason: input.reason || existing.reason,
          source: input.source || existing.source,
          createdById: input.userId || existing.createdById
        }
      });
    } else {
      dnc = await tx.dncRecord.create({
        data: {
          phoneNumber: canonicalPhone,
          reason: input.reason || 'Client request / Compliance opt-out',
          source: input.source || 'MANUAL',
          isActive: true,
          createdById: input.userId
        }
      });
    }

    // 2. Cascade suppression to any matching contacts in the database
    await tx.contact.updateMany({
      where: { phoneNumber: canonicalPhone },
      data: { isDoNotCall: true }
    });

    // 3. Log compliance audit record
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: 'DNC_ADDED',
        category: 'Contact',
        entityType: 'DncRecord',
        entityId: dnc.id,
        newValue: {
          phoneNumber: canonicalPhone,
          reason: dnc.reason,
          source: dnc.source
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        details: `Phone number ${canonicalPhone} placed on Do-Not-Call suppression registry. Reason: ${dnc.reason || 'N/A'}`
      }
    });

    return dnc;
  });

  return record;
}

/**
 * Removes a phone number from the DNC registry by ID or phone number.
 */
export async function removeFromDnc(input: RemoveFromDncInput) {
  const { idOrPhone, userId, ipAddress, userAgent } = input;

  const record = await prisma.dncRecord.findFirst({
    where: {
      OR: [
        { id: idOrPhone },
        { phoneNumber: idOrPhone },
        { phoneNumber: normalizePhoneNumber(idOrPhone).e164 }
      ]
    }
  });

  if (!record) {
    throw new NotFoundError(`DNC record for '${idOrPhone}' not found`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.dncRecord.update({
      where: { id: record.id },
      data: { isActive: false }
    });

    // Note: We deliberately do NOT blindly unsuppress contacts; their isDoNotCall flag can be updated explicitly per contact.
    await tx.auditLog.create({
      data: {
        userId,
        action: 'DNC_REMOVED',
        category: 'Contact',
        entityType: 'DncRecord',
        entityId: record.id,
        oldValue: {
          phoneNumber: record.phoneNumber,
          reason: record.reason
        },
        ipAddress,
        userAgent,
        details: `Phone number ${record.phoneNumber} removed from active Do-Not-Call suppression list.`
      }
    });
  });

  return { success: true, removedPhone: record.phoneNumber };
}

/**
 * Lists active DNC suppression records with pagination and search.
 */
export async function listDncRecords(params: DncListParams = {}) {
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(params.limit) || 25));
  const skip = (page - 1) * limit;

  const where: any = { isActive: true };

  if (params.search && params.search.trim()) {
    const q = params.search.trim();
    where.OR = [
      { phoneNumber: { contains: q } },
      { reason: { contains: q, mode: 'insensitive' } },
      { source: { contains: q, mode: 'insensitive' } }
    ];
  }

  const [records, total] = await Promise.all([
    prisma.dncRecord.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true }
        }
      }
    }),
    prisma.dncRecord.count({ where })
  ]);

  return {
    records,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}
