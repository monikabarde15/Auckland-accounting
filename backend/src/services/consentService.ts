import { prisma } from './prisma.js';
import { ConsentStatus } from '@prisma/client';
import { BadRequestError, NotFoundError } from '../errors/AppError.js';

export interface RecordConsentInput {
  contactId: string;
  status: ConsentStatus;
  source?: string;
  evidence?: string;
  notes?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Records a formal, auditable consent status update for a contact.
 * Updates the Contact model's consentStatus and callPermission flags.
 */
export async function recordConsent(input: RecordConsentInput) {
  const { contactId, status, source = 'WRITTEN_ENGAGEMENT', evidence, notes, userId, ipAddress, userAgent } = input;

  const contact = await prisma.contact.findUnique({
    where: { id: contactId }
  });

  if (!contact) {
    throw new NotFoundError(`Contact with ID '${contactId}' not found`);
  }

  const callPermission = status === ConsentStatus.GRANTED;

  const result = await prisma.$transaction(async (tx) => {
    // 1. Create historical consent record
    const consentRecord = await tx.consentRecord.create({
      data: {
        contactId,
        status,
        source,
        evidence,
        notes,
        recordedById: userId
      }
    });

    // 2. Update parent contact consent status & calling permission
    const updatedContact = await tx.contact.update({
      where: { id: contactId },
      data: {
        consentStatus: status,
        callPermission,
        consentSource: source,
        consentTimestamp: new Date()
      }
    });

    // 3. Log compliance audit entry
    await tx.auditLog.create({
      data: {
        userId,
        action: 'CONSENT_UPDATED',
        category: 'Contact',
        entityType: 'Contact',
        entityId: contactId,
        oldValue: {
          consentStatus: contact.consentStatus,
          callPermission: contact.callPermission
        },
        newValue: {
          consentStatus: status,
          callPermission,
          source
        },
        ipAddress,
        userAgent,
        details: `Consent status for ${contact.name} (${contact.phoneNumber}) changed to ${status}. Source: ${source}.`
      }
    });

    return { consentRecord, contact: updatedContact };
  });

  return result;
}

/**
 * Retrieves the full chronological consent audit history for a given contact.
 */
export async function getConsentHistory(contactId: string) {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId }
  });

  if (!contact) {
    throw new NotFoundError(`Contact with ID '${contactId}' not found`);
  }

  const records = await prisma.consentRecord.findMany({
    where: { contactId },
    orderBy: { recordedAt: 'desc' },
    include: {
      recordedBy: {
        select: { id: true, name: true, email: true }
      }
    }
  });

  return {
    contact: {
      id: contact.id,
      name: contact.name,
      phoneNumber: contact.phoneNumber,
      consentStatus: contact.consentStatus,
      callPermission: contact.callPermission,
      consentSource: contact.consentSource,
      consentTimestamp: contact.consentTimestamp
    },
    history: records
  };
}
