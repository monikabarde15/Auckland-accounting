import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../services/prisma.js';

export interface BackupResult {
  success: boolean;
  filename: string;
  filepath: string;
  sizeBytes: number;
  sha256Checksum: string;
  tableCount: number;
  totalRecords: number;
  timestamp: string;
}

/**
 * Programmatic Database Backup & Schema Verification Utility
 */
export async function createDatabaseSnapshot(targetDir?: string): Promise<BackupResult> {
  const dir = targetDir || path.resolve(process.cwd(), 'backups');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `acula_db_snapshot_${timestamp}.json`;
  const filepath = path.join(dir, filename);

  // Read primary tables
  const [users, roles, permissions, contacts, groups, dnc, campaigns, questionnaires, questions, options] =
    await Promise.all([
      prisma.user.findMany({ select: { id: true, email: true, name: true, isActive: true } }),
      prisma.role.findMany(),
      prisma.permission.findMany(),
      prisma.contact.findMany(),
      prisma.contactGroup.findMany(),
      prisma.dncRecord.findMany(),
      prisma.campaign.findMany(),
      prisma.questionnaire.findMany(),
      prisma.question.findMany(),
      prisma.questionOption.findMany()
    ]);

  const snapshotData = {
    metadata: {
      version: '1.0.0',
      service: 'acula-db-backup',
      generatedAt: new Date().toISOString(),
      databaseType: 'PostgreSQL'
    },
    tables: {
      users,
      roles,
      permissions,
      contacts,
      groups,
      dnc,
      campaigns,
      questionnaires,
      questions,
      options
    }
  };

  const jsonContent = JSON.stringify(snapshotData, null, 2);
  fs.writeFileSync(filepath, jsonContent, 'utf-8');

  const stats = fs.statSync(filepath);
  const sha256 = crypto.createHash('sha256').update(jsonContent).digest('hex');

  const totalRecords =
    users.length +
    roles.length +
    permissions.length +
    contacts.length +
    groups.length +
    dnc.length +
    campaigns.length +
    questionnaires.length +
    questions.length +
    options.length;

  return {
    success: true,
    filename,
    filepath,
    sizeBytes: stats.size,
    sha256Checksum: sha256,
    tableCount: Object.keys(snapshotData.tables).length,
    totalRecords,
    timestamp: new Date().toISOString()
  };
}
