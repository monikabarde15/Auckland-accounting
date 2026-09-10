import { prisma } from './prisma.js';
import { QuestionType, NextAction } from '@prisma/client';
import { validateQuestionFlow, FlowValidationResult } from './flowValidationService.js';
import { BadRequestError, NotFoundError } from '../errors/AppError.js';

export interface CreateQuestionnaireInput {
  title: string;
  description?: string;
  category?: string;
  startingQuestionId?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface UpdateQuestionnaireInput {
  title?: string;
  description?: string;
  category?: string;
  startingQuestionId?: string;
  isActive?: boolean;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface SaveQuestionOptionInput {
  optionKey: string;
  optionLabel: string;
  nextQuestionId?: string | null;
  nextAction?: NextAction;
  voiceTriggers?: string[];
}

export interface SaveQuestionInput {
  name: string;
  questionText: string;
  type: QuestionType;
  orderNo?: number;
  isRequired?: boolean;
  timeoutSeconds?: number;
  retryCount?: number;
  retryPromptText?: string | null;
  defaultNextQuestionId?: string | null;
  minDigits?: number | null;
  maxDigits?: number | null;
  finishOnKey?: string | null;
  transferPhoneNumber?: string | null;
  options?: SaveQuestionOptionInput[];
}

/**
 * Lists all questionnaires with question count.
 */
export async function listQuestionnaires() {
  const questionnaires = await prisma.questionnaire.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: { questions: true, campaigns: true }
      }
    }
  });

  return questionnaires.map((q) => ({
    id: q.id,
    title: q.title,
    description: q.description,
    category: q.category,
    startingQuestionId: q.startingQuestionId,
    isActive: q.isActive,
    questionCount: q._count.questions,
    campaignCount: q._count.campaigns,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt
  }));
}

/**
 * Retrieves a single questionnaire with its full question graph and validation report.
 */
export async function getQuestionnaireById(id: string) {
  const questionnaire = await prisma.questionnaire.findUnique({
    where: { id },
    include: {
      questions: {
        orderBy: { orderNo: 'asc' },
        include: { options: true }
      },
      createdBy: {
        select: { id: true, name: true, email: true }
      }
    }
  });

  if (!questionnaire) {
    throw new NotFoundError(`Questionnaire with ID '${id}' not found`);
  }

  const validation: FlowValidationResult = validateQuestionFlow(
    questionnaire.questions as any,
    questionnaire.startingQuestionId
  );

  return {
    ...questionnaire,
    validation
  };
}

/**
 * Creates a new questionnaire.
 */
export async function createQuestionnaire(input: CreateQuestionnaireInput) {
  const { title, description, category = 'General', startingQuestionId, userId, ipAddress, userAgent } = input;

  if (!title || !title.trim()) {
    throw new BadRequestError('Questionnaire title is required');
  }

  const created = await prisma.$transaction(async (tx) => {
    const q = await tx.questionnaire.create({
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        category,
        startingQuestionId: startingQuestionId?.trim() || null,
        createdById: userId
      }
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: 'QUESTIONNAIRE_CREATED',
        category: 'Questionnaire',
        entityType: 'Questionnaire',
        entityId: q.id,
        newValue: { title: q.title, category: q.category },
        ipAddress,
        userAgent,
        details: `Created questionnaire flow "${q.title}" (${q.category}).`
      }
    });

    return q;
  });

  return getQuestionnaireById(created.id);
}

/**
 * Updates an existing questionnaire.
 */
export async function updateQuestionnaire(id: string, input: UpdateQuestionnaireInput) {
  const existing = await prisma.questionnaire.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError(`Questionnaire with ID '${id}' not found`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const q = await tx.questionnaire.update({
      where: { id },
      data: {
        title: input.title !== undefined ? input.title.trim() : undefined,
        description: input.description !== undefined ? input.description?.trim() || null : undefined,
        category: input.category,
        startingQuestionId: input.startingQuestionId !== undefined ? input.startingQuestionId?.trim() || null : undefined,
        isActive: input.isActive
      }
    });

    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: 'QUESTIONNAIRE_UPDATED',
        category: 'Questionnaire',
        entityType: 'Questionnaire',
        entityId: id,
        oldValue: { title: existing.title },
        newValue: { title: q.title },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        details: `Updated questionnaire "${q.title}".`
      }
    });

    return q;
  });

  return getQuestionnaireById(updated.id);
}

/**
 * Deletes a questionnaire.
 */
export async function deleteQuestionnaire(id: string, userId?: string, ipAddress?: string, userAgent?: string) {
  const existing = await prisma.questionnaire.findUnique({
    where: { id },
    include: { _count: { select: { campaigns: true } } }
  });

  if (!existing) {
    throw new NotFoundError(`Questionnaire with ID '${id}' not found`);
  }

  if (existing._count.campaigns > 0) {
    throw new BadRequestError(`Cannot delete questionnaire: it is currently referenced by ${existing._count.campaigns} campaign(s).`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.questionnaire.delete({ where: { id } });

    await tx.auditLog.create({
      data: {
        userId,
        action: 'QUESTIONNAIRE_DELETED',
        category: 'Questionnaire',
        entityType: 'Questionnaire',
        entityId: id,
        oldValue: { title: existing.title },
        ipAddress,
        userAgent,
        details: `Deleted questionnaire "${existing.title}".`
      }
    });
  });

  return { success: true, deletedId: id };
}

/**
 * Adds a question to a questionnaire flow.
 */
export async function addQuestionToQuestionnaire(questionnaireId: string, input: SaveQuestionInput) {
  const questionnaire = await prisma.questionnaire.findUnique({
    where: { id: questionnaireId }
  });

  if (!questionnaire) {
    throw new NotFoundError(`Questionnaire with ID '${questionnaireId}' not found`);
  }

  const question = await prisma.$transaction(async (tx) => {
    const q = await tx.question.create({
      data: {
        questionnaireId,
        name: input.name.trim(),
        questionText: input.questionText.trim(),
        type: input.type,
        orderNo: input.orderNo ?? 1,
        isRequired: input.isRequired ?? true,
        timeoutSeconds: input.timeoutSeconds ?? 6,
        retryCount: input.retryCount ?? 2,
        retryPromptText: input.retryPromptText?.trim() || null,
        defaultNextQuestionId: input.defaultNextQuestionId?.trim() || null,
        minDigits: input.minDigits,
        maxDigits: input.maxDigits,
        finishOnKey: input.finishOnKey ?? '#',
        transferPhoneNumber: input.transferPhoneNumber?.trim() || null,
        options: {
          create: (input.options || []).map((opt) => ({
            optionKey: opt.optionKey.trim(),
            optionLabel: opt.optionLabel?.trim() || '',
            nextQuestionId: opt.nextQuestionId?.trim() || null,
            nextAction: opt.nextAction || NextAction.CONTINUE,
            voiceTriggers: opt.voiceTriggers || []
          }))
        }
      },
      include: { options: true }
    });

    // If questionnaire had no startingQuestionId, set this as the default starting question
    if (!questionnaire.startingQuestionId) {
      await tx.questionnaire.update({
        where: { id: questionnaireId },
        data: { startingQuestionId: q.id }
      });
    }

    return q;
  });

  return question;
}

/**
 * Updates an existing question and its options.
 */
export async function updateQuestion(questionId: string, input: SaveQuestionInput) {
  const existing = await prisma.question.findUnique({
    where: { id: questionId }
  });

  if (!existing) {
    throw new NotFoundError(`Question with ID '${questionId}' not found`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Delete existing options and recreate with new configuration
    await tx.questionOption.deleteMany({
      where: { questionId }
    });

    const q = await tx.question.update({
      where: { id: questionId },
      data: {
        name: input.name.trim(),
        questionText: input.questionText.trim(),
        type: input.type,
        orderNo: input.orderNo ?? existing.orderNo,
        isRequired: input.isRequired ?? existing.isRequired,
        timeoutSeconds: input.timeoutSeconds ?? existing.timeoutSeconds,
        retryCount: input.retryCount ?? existing.retryCount,
        retryPromptText: input.retryPromptText !== undefined ? input.retryPromptText?.trim() || null : existing.retryPromptText,
        defaultNextQuestionId: input.defaultNextQuestionId !== undefined ? input.defaultNextQuestionId?.trim() || null : existing.defaultNextQuestionId,
        minDigits: input.minDigits !== undefined ? input.minDigits : existing.minDigits,
        maxDigits: input.maxDigits !== undefined ? input.maxDigits : existing.maxDigits,
        finishOnKey: input.finishOnKey ?? existing.finishOnKey,
        transferPhoneNumber: input.transferPhoneNumber !== undefined ? input.transferPhoneNumber?.trim() || null : existing.transferPhoneNumber,
        options: {
          create: (input.options || []).map((opt) => ({
            optionKey: opt.optionKey.trim(),
            optionLabel: opt.optionLabel?.trim() || '',
            nextQuestionId: opt.nextQuestionId?.trim() || null,
            nextAction: opt.nextAction || NextAction.CONTINUE,
            voiceTriggers: opt.voiceTriggers || []
          }))
        }
      },
      include: { options: true }
    });

    return q;
  });

  return updated;
}

/**
 * Deletes a question and cascades options.
 */
export async function deleteQuestion(questionId: string) {
  const existing = await prisma.question.findUnique({
    where: { id: questionId },
    include: { questionnaire: true }
  });

  if (!existing) {
    throw new NotFoundError(`Question with ID '${questionId}' not found`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.questionOption.deleteMany({ where: { questionId } });
    await tx.question.delete({ where: { id: questionId } });

    // If this was the startingQuestionId, clear or reassign it
    if (existing.questionnaire && existing.questionnaire.startingQuestionId === questionId) {
      const nextRemaining = await tx.question.findFirst({
        where: { questionnaireId: existing.questionnaireId },
        orderBy: { orderNo: 'asc' }
      });

      await tx.questionnaire.update({
        where: { id: existing.questionnaireId! },
        data: { startingQuestionId: nextRemaining?.id || null }
      });
    }
  });

  return { success: true, deletedId: questionId };
}
