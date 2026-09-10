import { Question, FlowValidationResult, FlowValidationError, FlowValidationWarning } from '../types';

const MAX_FLOW_QUESTIONS = 25;

/**
 * Client-side flow validation matching backend graph analysis.
 * Detects cycles, unreachable nodes, broken node references, and terminal states.
 */
export function validateFlowGraph(
  questions: Question[],
  startingQuestionId?: string | null
): FlowValidationResult {
  const errors: FlowValidationError[] = [];
  const warnings: FlowValidationWarning[] = [];

  if (!questions || questions.length === 0) {
    errors.push({
      code: 'EMPTY_FLOW',
      message: 'Question flow must contain at least one question step.'
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

  const questionMap = new Map<string, Question>();
  for (const q of questions) {
    questionMap.set(q.id, q);
  }

  // 1. Starting Question Check
  let effectiveStartId = startingQuestionId;
  if (!effectiveStartId || !questionMap.has(effectiveStartId)) {
    effectiveStartId = questions[0]?.id;
    if (startingQuestionId && !questionMap.has(startingQuestionId)) {
      errors.push({
        code: 'INVALID_STARTING_QUESTION',
        message: `Designated starting question ID '${startingQuestionId}' not found in flow.`
      });
    }
  }

  // 2. Individual Question & Reference Checks
  const isTerminal = (id?: string | null) => {
    if (!id) return false;
    const norm = id.trim().toUpperCase();
    return norm === 'END' || norm === 'TERMINAL';
  };

  const isSpecialTarget = (id?: string | null) => {
    if (!id) return false;
    const norm = id.trim().toUpperCase();
    return norm === 'END' || norm === 'TERMINAL' || norm === 'REPEAT';
  };

  let terminalCount = 0;

  for (const q of questions) {
    const prompt = q.promptText || (q as any).questionText || '';
    if (!prompt.trim()) {
      errors.push({
        questionId: q.id,
        code: 'EMPTY_PROMPT',
        message: `Question '${q.name}' is missing prompt text.`
      });
    }

    const qType = String(q.type).toLowerCase();

    // Verify option destinations
    let hasTerminalPath = false;

    if (q.defaultNextQuestionId) {
      if (isTerminal(q.defaultNextQuestionId)) {
        hasTerminalPath = true;
      } else if (!isSpecialTarget(q.defaultNextQuestionId) && !questionMap.has(q.defaultNextQuestionId)) {
        errors.push({
          questionId: q.id,
          code: 'BROKEN_REFERENCE',
          message: `Question '${q.name}' default transition points to non-existent question.`
        });
      }
    }

    for (const opt of q.options || []) {
      const nextId = opt.nextQuestionId;
      if (isTerminal(nextId) || (opt as any).nextAction === 'END_CALL') {
        hasTerminalPath = true;
      } else if (nextId && !isSpecialTarget(nextId) && !questionMap.has(nextId)) {
        errors.push({
          questionId: q.id,
          code: 'BROKEN_REFERENCE',
          message: `Option '${opt.label || (opt as any).optionKey}' in question '${q.name}' points to missing question ID '${nextId}'.`
        });
      }
    }

    if (qType === 'message_only' || qType === 'transfer') {
      hasTerminalPath = true;
    }

    if (hasTerminalPath || (!q.defaultNextQuestionId && (!q.options || q.options.length === 0))) {
      terminalCount++;
    }
  }

  // 3. Directed Graph Construction
  const adjacency = new Map<string, string[]>();
  for (const q of questions) {
    const edges: string[] = [];
    if (q.defaultNextQuestionId && !isTerminal(q.defaultNextQuestionId) && questionMap.has(q.defaultNextQuestionId)) {
      edges.push(q.defaultNextQuestionId);
    }
    for (const opt of q.options || []) {
      if (opt.nextQuestionId && !isTerminal(opt.nextQuestionId) && questionMap.has(opt.nextQuestionId)) {
        edges.push(opt.nextQuestionId);
      }
    }
    adjacency.set(q.id, Array.from(new Set(edges)));
  }

  // 4. Cycle Detection using 3-Color DFS
  const color = new Map<string, number>();
  for (const q of questions) color.set(q.id, 0); // 0: White, 1: Gray, 2: Black

  let hasCycle = false;

  const dfs = (u: string, path: string[]) => {
    color.set(u, 1);
    path.push(u);

    const neighbors = adjacency.get(u) || [];
    for (const v of neighbors) {
      if (color.get(v) === 1) {
        hasCycle = true;
        const cycleStartIndex = path.indexOf(v);
        const cyclePath = path.slice(cycleStartIndex).concat(v);
        const cycleNames = cyclePath.map((id) => questionMap.get(id)?.name || id);

        errors.push({
          questionId: u,
          code: 'PROHIBITED_CYCLE_DETECTED',
          message: `Prohibited infinite loop detected: ${cycleNames.join(' ? ')}.`
        });
      } else if (color.get(v) === 0) {
        dfs(v, path);
      }
    }

    path.pop();
    color.set(u, 2);
  };

  if (effectiveStartId && questionMap.has(effectiveStartId)) {
    dfs(effectiveStartId, []);
  }

  for (const q of questions) {
    if (color.get(q.id) === 0) {
      dfs(q.id, []);
    }
  }

  // 5. Reachability Check
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
        message: `Step '${q.name}' is unreachable from the flow starting point.`
      });
    }
  }

  if (terminalCount === 0) {
    errors.push({
      code: 'NO_TERMINAL_NODE',
      message: 'Flow has no valid terminal ending state (End Call). Calls will loop indefinitely.'
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
      terminalQuestions: terminalCount,
      hasCycle
    }
  };
}
