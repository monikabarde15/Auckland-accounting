import { QuestionType, NextAction } from '@prisma/client';

export interface FlowValidationQuestionOption {
  id?: string;
  optionKey: string;
  optionLabel?: string;
  nextQuestionId?: string | null;
  nextAction?: NextAction | 'CONTINUE' | 'END_CALL' | 'TRANSFER' | 'SKIP';
  voiceTriggers?: string[];
}

export interface FlowValidationQuestion {
  id: string;
  name: string;
  questionText: string;
  type: QuestionType | string;
  speechAudioUrl?: string | null;
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
  options?: FlowValidationQuestionOption[];
}

export interface FlowValidationError {
  questionId?: string;
  field?: string;
  code: string;
  message: string;
}

export interface FlowValidationWarning {
  questionId?: string;
  code: string;
  message: string;
}

export interface FlowValidationResult {
  isValid: boolean;
  errors: FlowValidationError[];
  warnings: FlowValidationWarning[];
  summary: {
    totalQuestions: number;
    reachableQuestions: number;
    unreachableQuestions: number;
    terminalQuestions: number;
    hasCycle: boolean;
  };
}

const MAX_FLOW_QUESTIONS = 25;

/**
 * Validates a complete IVR Question Flow using graph theory analysis.
 * Performs starting node validation, reference integrity, cycle detection,
 * reachability checks, and termination guarantees.
 */
export function validateQuestionFlow(
  questions: FlowValidationQuestion[],
  startingQuestionId?: string | null
): FlowValidationResult {
  const errors: FlowValidationError[] = [];
  const warnings: FlowValidationWarning[] = [];

  // 1. Basic Flow Integrity Checks
  if (!questions || questions.length === 0) {
    errors.push({
      code: 'EMPTY_FLOW',
      message: 'Question flow must contain at least one question.'
    });
    return {
      isValid: false,
      errors,
      warnings,
      summary: {
        totalQuestions: 0,
        reachableQuestions: 0,
        unreachableQuestions: 0,
        terminalQuestions: 0,
        hasCycle: false
      }
    };
  }

  if (questions.length > MAX_FLOW_QUESTIONS) {
    errors.push({
      code: 'MAX_QUESTIONS_EXCEEDED',
      message: `Flow exceeds maximum limit of ${MAX_FLOW_QUESTIONS} questions (contains ${questions.length}).`
    });
  }

  const questionMap = new Map<string, FlowValidationQuestion>();
  const idCounts = new Map<string, number>();

  for (const q of questions) {
    idCounts.set(q.id, (idCounts.get(q.id) || 0) + 1);
    questionMap.set(q.id, q);
  }

  // Duplicate IDs Check
  for (const [id, count] of idCounts.entries()) {
    if (count > 1) {
      errors.push({
        questionId: id,
        code: 'DUPLICATE_QUESTION_ID',
        message: `Duplicate question ID detected: '${id}'.`
      });
    }
  }

  // 2. Starting Question Validation
  let effectiveStartId = startingQuestionId;
  if (!effectiveStartId) {
    // Default to the first question if not explicitly specified
    effectiveStartId = questions[0]?.id;
    warnings.push({
      questionId: effectiveStartId,
      code: 'DEFAULT_STARTING_NODE',
      message: `No starting question was explicitly designated. Defaulting to '${questions[0]?.name}'.`
    });
  }

  if (!questionMap.has(effectiveStartId!)) {
    errors.push({
      code: 'INVALID_STARTING_QUESTION',
      message: `Designated starting question ID '${effectiveStartId}' does not exist in flow.`
    });
  }

  // 3. Question Configuration Checks & Reference Integrity
  for (const q of questions) {
    if (!q.questionText || !q.questionText.trim()) {
      errors.push({
        questionId: q.id,
        field: 'questionText',
        code: 'EMPTY_PROMPT',
        message: `Question '${q.name}' is missing prompt text.`
      });
    }

    // Type-specific checks
    const qType = String(q.type).toUpperCase();

    if (qType === 'MULTIPLE_CHOICE' || qType === 'YES_NO') {
      const opts = q.options || [];
      if (opts.length < 2) {
        errors.push({
          questionId: q.id,
          field: 'options',
          code: 'INSUFFICIENT_OPTIONS',
          message: `Question '${q.name}' (${qType}) requires at least 2 selectable options.`
        });
      }

      // Check unique DTMF keys
      const keySet = new Set<string>();
      for (const opt of opts) {
        if (!opt.optionKey) {
          errors.push({
            questionId: q.id,
            field: 'options',
            code: 'MISSING_DTMF_KEY',
            message: `Option in question '${q.name}' is missing a DTMF key.`
          });
        } else if (keySet.has(opt.optionKey)) {
          errors.push({
            questionId: q.id,
            field: 'options',
            code: 'DUPLICATE_DTMF_KEY',
            message: `Question '${q.name}' has duplicate DTMF key '${opt.optionKey}'.`
          });
        } else {
          keySet.add(opt.optionKey);
        }
      }
    } else if (qType === 'NUMERIC') {
      const min = q.minDigits ?? 1;
      const max = q.maxDigits ?? 10;
      if (min < 1 || max < min) {
        errors.push({
          questionId: q.id,
          field: 'digits',
          code: 'INVALID_NUMERIC_BOUNDS',
          message: `Question '${q.name}' has invalid digit constraints (min: ${min}, max: ${max}).`
        });
      }
    } else if (qType === 'TRANSFER') {
      if (!q.transferPhoneNumber || !q.transferPhoneNumber.trim()) {
        errors.push({
          questionId: q.id,
          field: 'transferPhoneNumber',
          code: 'MISSING_TRANSFER_PHONE',
          message: `Transfer question '${q.name}' must configure a transfer phone number.`
        });
      }
    }

    // Reference Integrity: Check all target nextQuestionId values
    const checkTarget = (targetId: string | null | undefined, context: string) => {
      if (!targetId) return;
      const normalizedTarget = targetId.trim().toUpperCase();
      if (normalizedTarget === 'END' || normalizedTarget === 'TERMINAL' || normalizedTarget === 'REPEAT') return;

      if (!questionMap.has(targetId)) {
        errors.push({
          questionId: q.id,
          code: 'BROKEN_REFERENCE',
          message: `Question '${q.name}' ${context} references non-existent question ID '${targetId}'.`
        });
      }
    };

    if (q.defaultNextQuestionId) {
      checkTarget(q.defaultNextQuestionId, 'default transition');
    }

    for (const opt of q.options || []) {
      if (opt.nextAction !== 'END_CALL' && opt.nextQuestionId) {
        checkTarget(opt.nextQuestionId, `option '${opt.optionKey}'`);
      }
    }
  }

  // 4. Build Directed Graph for Flow Analysis
  const adjacency = new Map<string, string[]>();
  for (const q of questions) {
    adjacency.set(q.id, []);
  }

  const isTerminalAction = (action?: string | null, target?: string | null) => {
    if (action === 'END_CALL' || action === 'TRANSFER') return true;
    if (target && (target.toUpperCase() === 'END' || target.toUpperCase() === 'TERMINAL')) return true;
    return false;
  };

  let terminalNodeCount = 0;

  for (const q of questions) {
    const neighbors: string[] = [];
    let hasTerminalPath = false;

    // Check default transition
    if (q.defaultNextQuestionId) {
      const def = q.defaultNextQuestionId.trim();
      if (isTerminalAction(null, def)) {
        hasTerminalPath = true;
      } else if (questionMap.has(def)) {
        neighbors.push(def);
      }
    }

    // Check option transitions
    for (const opt of q.options || []) {
      if (isTerminalAction(opt.nextAction, opt.nextQuestionId)) {
        hasTerminalPath = true;
      } else if (opt.nextQuestionId && questionMap.has(opt.nextQuestionId)) {
        neighbors.push(opt.nextQuestionId);
      }
    }

    // Message only with no next question can naturally terminate the call
    if (String(q.type).toUpperCase() === 'MESSAGE_ONLY' && neighbors.length === 0) {
      hasTerminalPath = true;
    }

    if (hasTerminalPath || neighbors.length === 0) {
      terminalNodeCount++;
    }

    adjacency.set(q.id, Array.from(new Set(neighbors)));
  }

  // 5. Cycle Detection using 3-Color DFS
  // 0: WHITE (unvisited), 1: GRAY (visiting / recursion stack), 2: BLACK (explored)
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();
  let hasCycle = false;

  for (const q of questions) {
    color.set(q.id, 0);
    parent.set(q.id, null);
  }

  const dfsCycle = (u: string, path: string[]) => {
    color.set(u, 1);
    path.push(u);

    const neighbors = adjacency.get(u) || [];
    for (const v of neighbors) {
      if (color.get(v) === 1) {
        // Cycle detected! Reconstruct the cycle path
        hasCycle = true;
        const cycleStartIndex = path.indexOf(v);
        const cyclePath = path.slice(cycleStartIndex).concat(v);
        const cycleNames = cyclePath.map((id) => questionMap.get(id)?.name || id);

        errors.push({
          questionId: u,
          code: 'PROHIBITED_CYCLE_DETECTED',
          message: `Prohibited infinite loop cycle detected: ${cycleNames.join(' ? ')}.`
        });
      } else if (color.get(v) === 0) {
        dfsCycle(v, path);
      }
    }

    path.pop();
    color.set(u, 2);
  };

  // Run DFS cycle detection from starting question first, then across any components
  if (effectiveStartId && questionMap.has(effectiveStartId)) {
    dfsCycle(effectiveStartId, []);
  }

  for (const q of questions) {
    if (color.get(q.id) === 0) {
      dfsCycle(q.id, []);
    }
  }

  // 6. Reachability Analysis (Unreachable Node Detection)
  const visited = new Set<string>();
  if (effectiveStartId && questionMap.has(effectiveStartId)) {
    const queue: string[] = [effectiveStartId];
    visited.add(effectiveStartId);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const neighbors = adjacency.get(curr) || [];
      for (const n of neighbors) {
        if (!visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      }
    }
  }

  let unreachableCount = 0;
  for (const q of questions) {
    if (!visited.has(q.id)) {
      unreachableCount++;
      warnings.push({
        questionId: q.id,
        code: 'UNREACHABLE_QUESTION',
        message: `Question '${q.name}' cannot be reached from the starting question.`
      });
    }
  }

  // 7. Terminal State Validation
  if (terminalNodeCount === 0) {
    errors.push({
      code: 'NO_TERMINAL_NODE',
      message: 'Question flow has no terminal state (End Call or leaf question). Every path results in a dead loop.'
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    summary: {
      totalQuestions: questions.length,
      reachableQuestions: visited.size,
      unreachableQuestions: unreachableCount,
      terminalQuestions: terminalNodeCount,
      hasCycle
    }
  };
}
