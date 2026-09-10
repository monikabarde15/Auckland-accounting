import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import {
  listQuestionnaires,
  getQuestionnaireById,
  createQuestionnaire,
  updateQuestionnaire,
  deleteQuestionnaire,
  addQuestionToQuestionnaire,
  updateQuestion,
  deleteQuestion
} from '../services/questionnaireService.js';
import { validateQuestionFlow } from '../services/flowValidationService.js';

const router = Router();

const createQuestionnaireSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100),
  description: z.string().max(500).optional(),
  category: z.string().optional(),
  startingQuestionId: z.string().optional()
});

const updateQuestionnaireSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  category: z.string().optional(),
  startingQuestionId: z.string().optional().nullable(),
  isActive: z.boolean().optional()
});

const questionOptionSchema = z.object({
  optionKey: z.string().min(1),
  optionLabel: z.string().min(1),
  nextQuestionId: z.string().optional().nullable(),
  nextAction: z.enum(['CONTINUE', 'END_CALL', 'TRANSFER', 'SKIP']).optional(),
  voiceTriggers: z.array(z.string()).optional()
});

const saveQuestionSchema = z.object({
  name: z.string().min(1).max(100),
  questionText: z.string().min(1, 'Prompt text is required'),
  type: z.enum(['YES_NO', 'MULTIPLE_CHOICE', 'RATING', 'NUMERIC', 'MESSAGE_ONLY', 'TRANSFER']),
  orderNo: z.number().int().optional(),
  isRequired: z.boolean().optional(),
  timeoutSeconds: z.number().int().min(1).max(60).optional(),
  retryCount: z.number().int().min(0).max(5).optional(),
  retryPromptText: z.string().optional().nullable(),
  defaultNextQuestionId: z.string().optional().nullable(),
  minDigits: z.number().int().optional().nullable(),
  maxDigits: z.number().int().optional().nullable(),
  finishOnKey: z.string().optional().nullable(),
  transferPhoneNumber: z.string().optional().nullable(),
  options: z.array(questionOptionSchema).optional()
});

// All questionnaire routes require authentication
router.use(requireAuth);

/**
 * GET /api/questionnaires
 * List all available questionnaire flows.
 */
router.get('/', requirePermission('questionnaires.view'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const list = await listQuestionnaires();
    res.json({ success: true, data: list });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/questionnaires/:id
 * Retrieve full questionnaire graph and validation status.
 */
router.get('/:id', requirePermission('questionnaires.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const questionnaire = await getQuestionnaireById(req.params.id);
    res.json({ success: true, data: questionnaire });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/questionnaires
 * Create a new questionnaire flow.
 */
router.post(
  '/',
  requirePermission('questionnaires.create'),
  validateBody(createQuestionnaireSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const created = await createQuestionnaire({
        ...req.body,
        userId: req.user?.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /api/questionnaires/:id
 * Update questionnaire details.
 */
router.put(
  '/:id',
  requirePermission('questionnaires.edit'),
  validateBody(updateQuestionnaireSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await updateQuestionnaire(req.params.id, {
        ...req.body,
        userId: req.user?.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/questionnaires/:id
 * Delete a questionnaire flow.
 */
router.delete(
  '/:id',
  requirePermission('questionnaires.delete'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await deleteQuestionnaire(
        req.params.id,
        req.user?.id,
        req.ip,
        req.headers['user-agent']
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/questionnaires/:id/validate
 * Run graph validation on the questionnaire.
 */
router.post('/:id/validate', requirePermission('questionnaires.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = await getQuestionnaireById(req.params.id);
    const validation = validateQuestionFlow(q.questions as any, q.startingQuestionId);
    res.json({ success: true, data: validation });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/questionnaires/:id/questions
 * Add a new question to the flow.
 */
router.post(
  '/:id/questions',
  requirePermission('questionnaires.create'),
  validateBody(saveQuestionSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const question = await addQuestionToQuestionnaire(req.params.id, req.body);
      res.status(201).json({ success: true, data: question });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /api/questionnaires/questions/:questionId
 * Update a question and its branching options.
 */
router.put(
  '/questions/:questionId',
  requirePermission('questionnaires.edit'),
  validateBody(saveQuestionSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const question = await updateQuestion(req.params.questionId, req.body);
      res.json({ success: true, data: question });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/questionnaires/questions/:questionId
 * Delete a question.
 */
router.delete(
  '/questions/:questionId',
  requirePermission('questionnaires.delete'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await deleteQuestion(req.params.questionId);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
