import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import * as contactService from '../services/contactService.js';
import * as consentService from '../services/consentService.js';
import * as csvImportService from '../services/csvImportService.js';
import { EntityType, ConsentStatus } from '@prisma/client';
import { BadRequestError } from '../errors/AppError.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

export const contactsRouter = Router();

// All contact routes require authentication
contactsRouter.use(requireAuth);

const listContactsQuerySchema = z.object({
  search: z.string().optional(),
  groupId: z.string().optional(),
  isDoNotCall: z
    .string()
    .optional()
    .transform((val) => (val === 'true' ? true : val === 'false' ? false : undefined)),
  consentStatus: z.nativeEnum(ConsentStatus).optional(),
  entityType: z.nativeEnum(EntityType).optional(),
  tag: z.string().optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional()
});

const createContactSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  companyName: z.string().optional(),
  phoneNumber: z.string().min(5, 'Phone number is required'),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  entityType: z.nativeEnum(EntityType).optional(),
  irdNumber: z.string().optional(),
  assignedAccountant: z.string().optional(),
  outstandingBalance: z.number().optional(),
  dueDate: z.string().optional().nullable(),
  timezone: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  isDoNotCall: z.boolean().optional(),
  consentStatus: z.nativeEnum(ConsentStatus).optional(),
  consentSource: z.string().optional(),
  groupIds: z.array(z.string()).optional()
});

const updateContactSchema = createContactSchema.partial();

const recordConsentSchema = z.object({
  status: z.nativeEnum(ConsentStatus),
  source: z.string().optional(),
  evidence: z.string().optional(),
  notes: z.string().optional()
});

/**
 * GET /api/contacts — List contacts with search, filters, sorting & pagination
 */
contactsRouter.get('/', requirePermission('contacts.view'), validateQuery(listContactsQuerySchema), async (req, res, next) => {
  try {
    const result = await contactService.listContacts(req.query as any);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/contacts/export — Export filtered contacts to CSV file
 */
contactsRouter.get('/export', requirePermission('contacts.export'), validateQuery(listContactsQuerySchema), async (req, res, next) => {
  try {
    const result = await contactService.listContacts({
      ...(req.query as any),
      page: 1,
      limit: 10000 // Export up to 10,000 records
    });

    const headers = [
      'ID',
      'Name',
      'Company',
      'Phone Number',
      'Email',
      'Entity Type',
      'IRD Number',
      'Assigned Accountant',
      'Balance Due (NZD)',
      'Due Date',
      'DNC Status',
      'Consent Status',
      'Tags',
      'Notes',
      'Created At'
    ];

    const escapeCsv = (val: any) => {
      if (val === null || val === undefined) return '""';
      let str = String(val).replace(/"/g, '""');
      if (/^[=+\-@\t\r]/.test(str)) {
        str = `'${str}`;
      }
      return `"${str}"`;
    };

    const csvRows = [headers.join(',')];

    for (const c of result.contacts) {
      csvRows.push(
        [
          escapeCsv(c.id),
          escapeCsv(c.name),
          escapeCsv(c.companyName || ''),
          escapeCsv(c.phoneNumber),
          escapeCsv(c.email || ''),
          escapeCsv(c.entityType),
          escapeCsv(c.irdNumber || ''),
          escapeCsv(c.assignedAccountant || ''),
          escapeCsv(c.outstandingBalance?.toString() || '0.00'),
          escapeCsv(c.dueDate ? new Date(c.dueDate).toISOString().split('T')[0] : ''),
          escapeCsv(c.isDoNotCall ? 'DNC' : 'CALLABLE'),
          escapeCsv(c.consentStatus),
          escapeCsv((c.tags || []).join('; ')),
          escapeCsv(c.notes || ''),
          escapeCsv(c.createdAt ? new Date(c.createdAt).toISOString() : '')
        ].join(',')
      );
    }

    const csvData = csvRows.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="contacts-export-${Date.now()}.csv"`);
    res.send(csvData);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/contacts/import/preview — Step 1 of CSV Import pipeline
 */
contactsRouter.post(
  '/import/preview',
  requirePermission('contacts.import'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      let content: string | Buffer | undefined;

      if (req.file) {
        content = req.file.buffer;
      } else if (req.body?.csvContent) {
        content = req.body.csvContent;
      }

      if (!content) {
        throw new BadRequestError('No CSV file or csvContent provided in request.');
      }

      const preview = await csvImportService.previewCsvImport(content);
      res.json({ success: true, data: preview });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/contacts/import/confirm — Step 2 of CSV Import pipeline: Transactional commit
 */
contactsRouter.post(
  '/import/confirm',
  requirePermission('contacts.import'),
  async (req, res, next) => {
    try {
      const { rows, targetGroupId, duplicateStrategy } = req.body;
      if (!Array.isArray(rows)) {
        throw new BadRequestError('Rows must be an array of parsed contacts');
      }

      const result = await csvImportService.confirmCsvImport({
        rows,
        targetGroupId,
        duplicateStrategy,
        userId: req.user?.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });

      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/contacts/:id — View contact details
 */
contactsRouter.get('/:id', requirePermission('contacts.view'), async (req, res, next) => {
  try {
    const contact = await contactService.getContactById(req.params.id);
    res.json({ success: true, data: contact });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/contacts — Create contact
 */
contactsRouter.post(
  '/',
  requirePermission('contacts.create'),
  validateBody(createContactSchema),
  async (req, res, next) => {
    try {
      const contact = await contactService.createContact({
        ...req.body,
        userId: req.user?.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });
      res.status(201).json({ success: true, data: contact });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /api/contacts/:id — Update contact
 */
contactsRouter.put(
  '/:id',
  requirePermission('contacts.edit'),
  validateBody(updateContactSchema),
  async (req, res, next) => {
    try {
      const contact = await contactService.updateContact(req.params.id, {
        ...req.body,
        userId: req.user?.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });
      res.json({ success: true, data: contact });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/contacts/:id — Delete contact
 */
contactsRouter.delete(
  '/:id',
  requirePermission('contacts.delete'),
  async (req, res, next) => {
    try {
      const result = await contactService.deleteContact(
        req.params.id,
        req.user?.id,
        req.ip,
        req.get('user-agent')
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/contacts/:id/consent — View consent audit history
 */
contactsRouter.get('/:id/consent', requirePermission('contacts.view'), async (req, res, next) => {
  try {
    const history = await consentService.getConsentHistory(req.params.id);
    res.json({ success: true, data: history });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/contacts/:id/consent — Record new consent status
 */
contactsRouter.post(
  '/:id/consent',
  requirePermission('contacts.edit'),
  validateBody(recordConsentSchema),
  async (req, res, next) => {
    try {
      const result = await consentService.recordConsent({
        contactId: req.params.id,
        status: req.body.status,
        source: req.body.source,
        evidence: req.body.evidence,
        notes: req.body.notes,
        userId: req.user?.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);
