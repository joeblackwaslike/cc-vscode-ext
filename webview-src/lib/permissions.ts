import type { PermissionDecision, PermissionMode, PermissionRequest } from './ipc';
import type { ToolResult } from './conversationModel';

export const OTHER_LABEL = 'Other';
export const ASK_DECLINE_MESSAGE = 'User declined to answer questions';
export const KEEP_PLANNING_MESSAGE = 'User chose to stay in plan mode and continue planning';

export interface AskOption { label: string; description?: string; preview?: string }
export interface AskQuestion { question: string; header: string; options: AskOption[]; multiSelect: boolean }
export interface QuestionSelection { selected: string[]; otherText: string }
export interface PlanComment { id: string; quote: string; text: string }
export type ExitPlanChoice = 'auto' | 'manual' | 'keep-planning';
export type AskStatus = 'pending' | 'answered' | 'declined' | 'no-answer' | 'session-ended';
export type ExitPlanStatus = 'pending' | 'approved' | 'stayed' | 'session-ended';

interface StatusArgs { result?: ToolResult; pending: boolean; running: boolean; cancelled?: boolean }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Extracts well-formed questions from an AskUserQuestion tool input; malformed entries are dropped. */
export function readAskQuestions(input: Record<string, unknown>): AskQuestion[] {
  if (!Array.isArray(input.questions)) return [];
  return input.questions.flatMap((q): AskQuestion[] => {
    if (!isRecord(q) || typeof q.question !== 'string') return [];
    const options = Array.isArray(q.options)
      ? q.options.flatMap((o): AskOption[] =>
          isRecord(o) && typeof o.label === 'string'
            ? [{
                label: o.label,
                ...(typeof o.description === 'string' && { description: o.description }),
                ...(typeof o.preview === 'string' && { preview: o.preview }),
              }]
            : [])
      : [];
    return [{
      question: q.question,
      header: typeof q.header === 'string' ? q.header : '',
      options,
      multiSelect: q.multiSelect === true,
    }];
  });
}

export function isQuestionAnswered(sel: QuestionSelection | undefined): boolean {
  if (!sel || sel.selected.length === 0) return false;
  return !sel.selected.includes(OTHER_LABEL) || sel.otherText.trim() !== '';
}

export function buildAskAnswers(
  questions: AskQuestion[],
  selections: Record<string, QuestionSelection>,
): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const { question } of questions) {
    const sel = selections[question];
    if (!sel) continue;
    answers[question] = sel.selected
      .map((label) => (label === OTHER_LABEL ? sel.otherText.trim() : label))
      .join(', ');
  }
  return answers;
}

export function buildAskAnswerDecision(
  input: Record<string, unknown>,
  answers: Record<string, string>,
): PermissionDecision {
  return { behavior: 'allow', updatedInput: { ...input, answers } };
}

export function exitPlanAutoLabel(priorMode: PermissionMode | undefined): string {
  return priorMode === 'auto' ? 'Yes, and use auto mode' : 'Yes, and auto-accept';
}

export function buildExitPlanDecision(
  choice: ExitPlanChoice,
  request: PermissionRequest,
  feedback: string,
): PermissionDecision {
  if (choice === 'keep-planning') {
    return { behavior: 'deny', message: feedback ? `${KEEP_PLANNING_MESSAGE}\n\n${feedback}` : KEEP_PLANNING_MESSAGE };
  }
  const updatedPermissions =
    choice === 'manual'
      ? [{ type: 'setMode', mode: 'default' as const, destination: 'session' }]
      : request.suggestions?.length
        ? request.suggestions
        : [{ type: 'setMode', mode: request.priorMode === 'auto' ? ('auto' as const) : ('acceptEdits' as const), destination: 'session' }];
  return { behavior: 'allow', updatedInput: request.input, updatedPermissions };
}

export function formatPlanFeedback(comments: PlanComment[], text: string): string {
  const parts: string[] = [];
  if (comments.length > 0) {
    parts.push(['Comments on the plan:', ...comments.map((c) => `- "${c.quote}": ${c.text}`)].join('\n'));
  }
  if (text.trim()) parts.push(text.trim());
  return parts.join('\n\n');
}

/** Parses the CLI's `"<question>"="<answer>"` result text back into an answer map. */
export function parseAskAnswers(toolResultText: string, questions: AskQuestion[]): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const { question } of questions) {
    const marker = `"${question}"="`;
    const start = toolResultText.indexOf(marker);
    if (start < 0) continue;
    const from = start + marker.length;
    for (let i = toolResultText.indexOf('"', from); i >= 0; i = toolResultText.indexOf('"', i + 1)) {
      const rest = toolResultText.slice(i + 1);
      const closes =
        rest === '' ||
        rest.startsWith('. Read the answers') ||
        questions.some((q) => q.question !== question && rest.startsWith(`, "${q.question}"="`));
      if (closes) {
        answers[question] = toolResultText.slice(from, i);
        break;
      }
    }
  }
  return answers;
}

export function deriveAskStatus({ result, pending, running, cancelled }: StatusArgs): AskStatus {
  if (result) return result.isError ? 'declined' : 'answered';
  if (pending) return 'pending';
  if (!running) return 'session-ended';
  return cancelled ? 'no-answer' : 'pending';
}

export function deriveExitPlanStatus({ result, pending, running }: StatusArgs): ExitPlanStatus {
  if (result) return result.isError ? 'stayed' : 'approved';
  if (pending) return 'pending';
  return running ? 'pending' : 'session-ended';
}
