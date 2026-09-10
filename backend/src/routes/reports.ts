import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import {
  getSummaryReport,
  getCampaignReport,
  exportCallsCsv,
  exportCampaignReportCsv
} from '../services/reportService.js';

export const reportsRouter = Router();

// All reporting endpoints require authentication
reportsRouter.use(requireAuth);

const dateFilterSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  campaignId: z.string().optional()
});

/**
 * GET /api/reports/summary
 * Returns global telephony, campaign, and response aggregations for the Operations Dashboard and Analytics views.
 */
reportsRouter.get('/summary', requirePermission('reports.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = dateFilterSchema.parse(req.query);
    const report = await getSummaryReport(query);
    res.json({
      success: true,
      data: report
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/campaigns/:id
 * Returns deep analytics and questionnaire response distributions for a single campaign.
 */
reportsRouter.get('/campaigns/:id', requirePermission('reports.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = dateFilterSchema.parse(req.query);
    const report = await getCampaignReport(req.params.id, query);
    res.json({
      success: true,
      data: report
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/export/calls
 * Stream or download RFC 4180 CSV export of filtered call records with formula injection protection.
 */
reportsRouter.get('/export/calls', requirePermission('reports.export'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = dateFilterSchema.parse(req.query);
    const csvData = await exportCallsCsv(query);

    const filename = `Auckland_Accounting_Calls_${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvData);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/export/campaign/:id
 * Download RFC 4180 CSV export of campaign performance and questionnaire response statistics.
 */
reportsRouter.get('/export/campaign/:id', requirePermission('reports.export'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const csvData = await exportCampaignReportCsv(req.params.id);

    const filename = `Auckland_Accounting_Campaign_${req.params.id}_Report.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvData);
  } catch (err) {
    next(err);
  }
});
