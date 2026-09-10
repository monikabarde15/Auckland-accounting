import { parse } from 'csv-parse/sync';
import { prisma } from './prisma.js';
import { EntityType, ConsentStatus } from '@prisma/client';
import { normalizePhoneNumber } from '../utils/phone.js';
import { BadRequestError } from '../errors/AppError.js';

export interface ParsedCsvRow {
  rowIndex: number;
  raw: Record<string, string>;
  name: string;
  companyName: string;
  phoneNumber: string;
  normalizedPhone: string;
  email: string;
  entityType: EntityType;
  irdNumber: string;
  assignedAccountant: string;
  outstandingBalance: number;
  dueDate: string | null;
  tags: string[];
  isDoNotCall: boolean;
  status: 'VALID' | 'INVALID_DATA' | 'DUPLICATE_IN_FILE' | 'DUPLICATE_IN_DB' | 'DNC_BLOCKED';
  errors: string[];
}

export interface CsvPreviewResult {
  totalRows: number;
  validCount: number;
  invalidCount: number;
  duplicateInFileCount: number;
  duplicateInDbCount: number;
  dncBlockedCount: number;
  previewRows: ParsedCsvRow[];
  parsedRows: ParsedCsvRow[];
}

export interface ConfirmImportInput {
  rows: ParsedCsvRow[];
  targetGroupId?: string;
  duplicateStrategy?: 'SKIP' | 'UPDATE';
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ImportSummaryResult {
  totalRows: number;
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  dncBlockedCount: number;
  errorsCount: number;
  groupId?: string;
}

/**
 * Normalizes header keys for tolerant matching (e.g. "Full Name" -> "name", "Phone #" -> "phone").
 */
function findColumn(headers: string[], candidates: string[]): string | undefined {
  const normalizedHeaders = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  for (const c of candidates) {
    const normCandidate = c.toLowerCase().replace(/[^a-z0-9]/g, '');
    const idx = normalizedHeaders.indexOf(normCandidate);
    if (idx !== -1) return headers[idx];
  }
  return undefined;
}

/**
 * Step 1: Parses CSV content, normalizes phone numbers, validates mandatory fields,
 * checks for duplicates (in-file & database), checks against DNC suppression, and generates a preview.
 */
export async function previewCsvImport(csvContent: string | Buffer): Promise<CsvPreviewResult> {
  const content = typeof csvContent === 'string' ? csvContent : csvContent.toString('utf-8');

  let records: Record<string, string>[];
  try {
    records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true
    });
  } catch (err: any) {
    throw new BadRequestError(`Failed to parse CSV: ${err.message || 'Malformed CSV format'}`);
  }

  if (!records || records.length === 0) {
    throw new BadRequestError('The provided CSV file contains no data rows.');
  }

  const headers = Object.keys(records[0]);
  const nameCol = findColumn(headers, ['name', 'fullname', 'clientname', 'contactname', 'client']);
  const phoneCol = findColumn(headers, ['phone', 'phonenumber', 'mobile', 'telephone', 'contactno', 'cell']);
  const companyCol = findColumn(headers, ['company', 'companyname', 'business', 'organization']);
  const emailCol = findColumn(headers, ['email', 'emailaddress', 'mail']);
  const irdCol = findColumn(headers, ['ird', 'irdnumber', 'taxnumber', 'taxid']);
  const balanceCol = findColumn(headers, ['balance', 'outstandingbalance', 'amountdue', 'owing']);
  const dueDateCol = findColumn(headers, ['duedate', 'due', 'deadline']);
  const tagsCol = findColumn(headers, ['tags', 'category', 'tag']);
  const dncCol = findColumn(headers, ['dnc', 'donotcall', 'suppressed']);
  const entityTypeCol = findColumn(headers, ['entitytype', 'entity', 'type']);
  const accountantCol = findColumn(headers, ['accountant', 'assignedaccountant', 'manager']);

  if (!nameCol && !phoneCol) {
    throw new BadRequestError(
      `CSV must contain at least a 'Name' and a 'Phone' column. Found columns: ${headers.join(', ')}`
    );
  }

  // Preload existing contacts and active DNC numbers for batch duplicate & suppression detection
  const [existingContacts, activeDncList] = await Promise.all([
    prisma.contact.findMany({
      select: { phoneNumber: true, email: true }
    }),
    prisma.dncRecord.findMany({
      where: { isActive: true },
      select: { phoneNumber: true }
    })
  ]);

  const dbPhoneSet = new Set(existingContacts.map((c) => c.phoneNumber));
  const dncPhoneSet = new Set(activeDncList.map((d) => d.phoneNumber));

  const seenInFilePhones = new Set<string>();
  const parsedRows: ParsedCsvRow[] = [];

  let validCount = 0;
  let invalidCount = 0;
  let duplicateInFileCount = 0;
  let duplicateInDbCount = 0;
  let dncBlockedCount = 0;

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const errors: string[] = [];

    const rawName = (nameCol ? row[nameCol] : '') || '';
    const rawPhone = (phoneCol ? row[phoneCol] : '') || '';
    const rawCompany = (companyCol ? row[companyCol] : '') || '';
    const rawEmail = (emailCol ? row[emailCol] : '') || '';
    const rawIrd = (irdCol ? row[irdCol] : '') || '';
    const rawBalance = balanceCol ? parseFloat(row[balanceCol].replace(/[^0-9.-]+/g, '')) : 0;
    const rawDueDate = (dueDateCol ? row[dueDateCol] : '') || null;
    const rawTags = tagsCol ? row[tagsCol].split(/[;,]/).map((t) => t.trim()).filter(Boolean) : [];
    const rawDnc = dncCol ? ['true', 'yes', '1', 'dnc'].includes(row[dncCol].toLowerCase().trim()) : false;
    const rawAccountant = (accountantCol ? row[accountantCol] : '') || 'David Chen (CA)';

    // Entity type mapping
    let entityType: EntityType = EntityType.COMPANY;
    if (entityTypeCol && row[entityTypeCol]) {
      const et = row[entityTypeCol].toUpperCase().trim();
      if (et in EntityType) {
        entityType = et as EntityType;
      } else if (et.includes('INDIV') || et.includes('PERSON')) {
        entityType = EntityType.INDIVIDUAL;
      } else if (et.includes('TRUST')) {
        entityType = EntityType.TRUST;
      } else if (et.includes('PARTNER')) {
        entityType = EntityType.PARTNERSHIP;
      }
    }

    if (!rawName.trim()) {
      errors.push('Missing contact name');
    }

    // Phone normalization (NZ default)
    const norm = normalizePhoneNumber(rawPhone, 'NZ');
    if (!norm.isValid) {
      errors.push(`Invalid phone: ${norm.error || 'cannot normalize'}`);
    }

    // Email validation if provided
    if (rawEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail.trim())) {
      errors.push('Invalid email format');
    }

    let status: ParsedCsvRow['status'] = 'VALID';

    if (errors.length > 0) {
      status = 'INVALID_DATA';
      invalidCount++;
    } else {
      const canonical = norm.e164;

      // Check DNC suppression registry
      if (dncPhoneSet.has(canonical) || rawDnc) {
        status = 'DNC_BLOCKED';
        dncBlockedCount++;
      } else if (seenInFilePhones.has(canonical)) {
        status = 'DUPLICATE_IN_FILE';
        duplicateInFileCount++;
      } else if (dbPhoneSet.has(canonical)) {
        status = 'DUPLICATE_IN_DB';
        duplicateInDbCount++;
      } else {
        status = 'VALID';
        validCount++;
      }

      seenInFilePhones.add(canonical);
    }

    parsedRows.push({
      rowIndex: i + 1,
      raw: row,
      name: rawName.trim(),
      companyName: rawCompany.trim() || 'Sole Trader',
      phoneNumber: rawPhone.trim(),
      normalizedPhone: norm.isValid ? norm.e164 : rawPhone.trim(),
      email: rawEmail.trim().toLowerCase(),
      entityType,
      irdNumber: rawIrd.trim(),
      assignedAccountant: rawAccountant.trim(),
      outstandingBalance: isNaN(rawBalance) ? 0 : rawBalance,
      dueDate: rawDueDate,
      tags: rawTags.length > 0 ? rawTags : ['CSV Import'],
      isDoNotCall: status === 'DNC_BLOCKED' || rawDnc,
      status,
      errors
    });
  }

  return {
    totalRows: records.length,
    validCount,
    invalidCount,
    duplicateInFileCount,
    duplicateInDbCount,
    dncBlockedCount,
    previewRows: parsedRows.slice(0, 50),
    parsedRows
  };
}

/**
 * Step 2: Commits the validated rows to PostgreSQL in a robust transaction.
 * Supports duplicate resolution (SKIP or UPDATE) and optional group membership attachment.
 */
export async function confirmCsvImport(input: ConfirmImportInput): Promise<ImportSummaryResult> {
  const { rows, targetGroupId, duplicateStrategy = 'SKIP', userId, ipAddress, userAgent } = input;

  if (!rows || rows.length === 0) {
    throw new BadRequestError('No rows provided for import confirmation');
  }

  // Verify target group if specified
  let targetGroup = null;
  if (targetGroupId) {
    targetGroup = await prisma.contactGroup.findUnique({
      where: { id: targetGroupId }
    });
    if (!targetGroup) {
      throw new BadRequestError(`Target group '${targetGroupId}' not found`);
    }
  }

  let importedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let dncBlockedCount = 0;
  let errorsCount = 0;

  const contactsToAddToGroup: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      if (row.status === 'INVALID_DATA') {
        errorsCount++;
        continue;
      }

      const isDnc = row.status === 'DNC_BLOCKED' || row.isDoNotCall;
      if (isDnc) {
        dncBlockedCount++;
      }

      // Check if phone exists in DB
      const existing = await tx.contact.findFirst({
        where: { phoneNumber: row.normalizedPhone }
      });

      if (existing) {
        if (duplicateStrategy === 'SKIP') {
          skippedCount++;
          if (targetGroupId) {
            contactsToAddToGroup.push(existing.id);
          }
          continue;
        } else {
          // UPDATE strategy
          const updated = await tx.contact.update({
            where: { id: existing.id },
            data: {
              name: row.name || existing.name,
              companyName: row.companyName || existing.companyName,
              email: row.email || existing.email,
              entityType: row.entityType,
              irdNumber: row.irdNumber || existing.irdNumber,
              assignedAccountant: row.assignedAccountant || existing.assignedAccountant,
              outstandingBalance: row.outstandingBalance,
              dueDate: row.dueDate ? new Date(row.dueDate) : existing.dueDate,
              isDoNotCall: isDnc || existing.isDoNotCall,
              tags: Array.from(new Set([...existing.tags, ...row.tags]))
            }
          });
          updatedCount++;
          if (targetGroupId) {
            contactsToAddToGroup.push(updated.id);
          }
          continue;
        }
      }

      // Create new contact
      const created = await tx.contact.create({
        data: {
          name: row.name,
          companyName: row.companyName || 'Sole Trader',
          phoneNumber: row.normalizedPhone,
          email: row.email || null,
          entityType: row.entityType,
          irdNumber: row.irdNumber || null,
          assignedAccountant: row.assignedAccountant,
          outstandingBalance: row.outstandingBalance,
          dueDate: row.dueDate ? new Date(row.dueDate) : null,
          tags: row.tags,
          isDoNotCall: isDnc,
          callPermission: !isDnc,
          consentStatus: isDnc ? ConsentStatus.REVOKED : ConsentStatus.GRANTED,
          consentSource: 'CSV_IMPORT',
          consentTimestamp: new Date(),
          source: 'CSV_IMPORT'
        }
      });

      importedCount++;
      if (targetGroupId) {
        contactsToAddToGroup.push(created.id);
      }

      // Create initial consent audit record
      await tx.consentRecord.create({
        data: {
          contactId: created.id,
          status: isDnc ? ConsentStatus.REVOKED : ConsentStatus.GRANTED,
          source: 'CSV_IMPORT',
          notes: `Imported via CSV batch${isDnc ? ' (Suppressed by DNC)' : ''}`,
          recordedById: userId
        }
      });
    }

    // Attach group memberships if targetGroupId provided
    if (targetGroupId && contactsToAddToGroup.length > 0) {
      const groupRecords = contactsToAddToGroup.map((cId) => ({
        groupId: targetGroupId,
        contactId: cId
      }));

      await tx.contactGroupMember.createMany({
        data: groupRecords,
        skipDuplicates: true
      });
    }

    // Central audit log
    await tx.auditLog.create({
      data: {
        userId,
        action: 'CONTACTS_IMPORTED',
        category: 'Contact',
        entityType: 'Contact',
        newValue: {
          totalRows: rows.length,
          importedCount,
          updatedCount,
          skippedCount,
          dncBlockedCount,
          errorsCount,
          targetGroup: targetGroup ? targetGroup.name : null
        },
        ipAddress,
        userAgent,
        details: `Batch CSV imported: ${importedCount} created, ${updatedCount} updated, ${skippedCount} skipped, ${dncBlockedCount} DNC suppressed${targetGroup ? `, attached to group "${targetGroup.name}"` : ''}.`
      }
    });
  });

  return {
    totalRows: rows.length,
    importedCount,
    updatedCount,
    skippedCount,
    dncBlockedCount,
    errorsCount,
    groupId: targetGroupId
  };
}
