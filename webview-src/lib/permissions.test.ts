import { describe, it, expect } from 'vitest';
import fixtures from './__fixtures__/permission-protocol.json';
import type { PermissionRequest } from './ipc';
import {
  ASK_DECLINE_MESSAGE,
  KEEP_PLANNING_MESSAGE,
  OTHER_LABEL,
  ownValue,
  buildAskAnswerDecision,
  buildAskAnswers,
  buildExitPlanDecision,
  deriveAskStatus,
  deriveExitPlanStatus,
  exitPlanAutoLabel,
  formatPlanFeedback,
  isQuestionAnswered,
  parseAskAnswers,
  readAskQuestions,
} from './permissions';

const input = fixtures.askControlRequest.request.input as Record<string, unknown>;
const questions = readAskQuestions(input);
const [colorQ, petsQ] = questions.map((q) => q.question);

function req(over: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    channelId: 'c', requestId: 'r', toolName: 'ExitPlanMode', toolUseId: 't',
    input: { plan: 'p' }, suggestions: undefined, description: undefined, priorMode: undefined,
    ...over,
  };
}
const suggestions = [{ type: 'setMode', mode: 'acceptEdits' as const, destination: 'session' }];

describe('readAskQuestions', () => {
  it('reads the fixture questions', () => {
    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({ header: 'Color', multiSelect: false });
    expect(questions[1].multiSelect).toBe(true);
    expect(questions[1].options.map((o) => o.label)).toEqual(['Cat', 'Dog', 'Fish']);
  });
  it('returns [] for malformed input', () => {
    expect(readAskQuestions({})).toEqual([]);
    expect(readAskQuestions({ questions: 'x' })).toEqual([]);
  });
});

describe('answers', () => {
  it('builds answers from selections', () => {
    const answers = buildAskAnswers(questions, {
      [colorQ]: { selected: ['Red'], otherText: '' },
      [petsQ]: { selected: ['Cat', 'Dog'], otherText: '' },
    });
    expect(answers).toEqual({ [colorQ]: 'Red', [petsQ]: 'Cat, Dog' });
  });
  it('replaces Other with the typed text', () => {
    const answers = buildAskAnswers(questions, {
      [colorQ]: { selected: [OTHER_LABEL], otherText: ' mine ' },
      [petsQ]: { selected: ['Cat', OTHER_LABEL], otherText: 'Bird' },
    });
    expect(answers[colorQ]).toBe('mine');
    expect(answers[petsQ]).toBe('Cat, Bird');
  });
  it('isQuestionAnswered', () => {
    expect(isQuestionAnswered(undefined)).toBe(false);
    expect(isQuestionAnswered({ selected: [], otherText: '' })).toBe(false);
    expect(isQuestionAnswered({ selected: [OTHER_LABEL], otherText: '   ' })).toBe(false);
    expect(isQuestionAnswered({ selected: [OTHER_LABEL], otherText: 'x' })).toBe(true);
    expect(isQuestionAnswered({ selected: ['Red'], otherText: '' })).toBe(true);
  });
  it('builds the allow decision with answers merged into input', () => {
    const d = buildAskAnswerDecision(input, { a: 'b' });
    expect(d).toEqual({ behavior: 'allow', updatedInput: { ...input, answers: { a: 'b' } } });
  });
});

describe('prototype-key question texts', () => {
  test('buildAskAnswers ignores inherited properties and answers constructor/__proto__ questions', () => {
    const questions = ['constructor', '__proto__', 'toString'].map((question) => ({
      question,
      header: 'H',
      multiSelect: false,
      options: [{ label: 'A', description: '' }],
    }));
    const selections = Object.fromEntries(
      ['constructor', '__proto__'].map((q) => [q, { selected: ['A'], otherText: '' }])
    );

    expect(Object.keys(buildAskAnswers(questions as never, selections))).toEqual(['constructor', '__proto__']);
    expect(ownValue({}, 'toString')).toBeUndefined();
  });
});

describe('exit plan', () => {
  it('auto labels', () => {
    expect(exitPlanAutoLabel(undefined)).toBe('Yes, and auto-accept');
    expect(exitPlanAutoLabel('default')).toBe('Yes, and auto-accept');
    expect(exitPlanAutoLabel('auto')).toBe('Yes, and use auto mode');
  });
  it('auto uses suggestions when present', () => {
    const r = req({ suggestions });
    expect(buildExitPlanDecision('auto', r, '')).toEqual({
      behavior: 'allow', updatedInput: r.input, updatedPermissions: suggestions,
    });
  });
  it('auto falls back to acceptEdits, or auto when priorMode is auto', () => {
    const fb = (mode: string) => [{ type: 'setMode', mode, destination: 'session' }];
    expect(buildExitPlanDecision('auto', req({ suggestions: [] }), '')).toMatchObject({ updatedPermissions: fb('acceptEdits') });
    expect(buildExitPlanDecision('auto', req(), '')).toMatchObject({ updatedPermissions: fb('acceptEdits') });
    expect(buildExitPlanDecision('auto', req({ priorMode: 'auto' }), '')).toMatchObject({ updatedPermissions: fb('auto') });
  });
  it('manual ignores suggestions', () => {
    const r = req({ suggestions });
    expect(buildExitPlanDecision('manual', r, 'x')).toEqual({
      behavior: 'allow', updatedInput: r.input,
      updatedPermissions: [{ type: 'setMode', mode: 'default', destination: 'session' }],
    });
  });
  it('keep-planning denies with optional feedback', () => {
    expect(buildExitPlanDecision('keep-planning', req(), '')).toEqual({ behavior: 'deny', message: KEEP_PLANNING_MESSAGE });
    expect(buildExitPlanDecision('keep-planning', req(), 'use bye.txt')).toEqual({
      behavior: 'deny', message: `${KEEP_PLANNING_MESSAGE}\n\nuse bye.txt`,
    });
  });
});

describe('formatPlanFeedback', () => {
  const c = [{ id: '1', quote: 'step 2', text: 'too vague' }, { id: '2', quote: 'step 3', text: 'drop' }];
  it('formats comments and text', () => {
    expect(formatPlanFeedback(c, 'overall')).toBe(
      'Comments on the plan:\n- "step 2": too vague\n- "step 3": drop\n\noverall',
    );
  });
  it('omits empty parts', () => {
    expect(formatPlanFeedback([], 'only text')).toBe('only text');
    expect(formatPlanFeedback([c[0]], '')).toBe('Comments on the plan:\n- "step 2": too vague');
    expect(formatPlanFeedback([], '  ')).toBe('');
  });
});

describe('parseAskAnswers', () => {
  it('parses the fixture result', () => {
    expect(parseAskAnswers(fixtures.askToolResult.content, questions)).toEqual({
      [colorQ]: 'My custom other answer',
      [petsQ]: 'Cat, Dog',
    });
  });
  it('keeps answers containing ", "', () => {
    const text = `The user answered: "${colorQ}"="a, b", "${petsQ}"="Cat". Read the answers carefully.`;
    expect(parseAskAnswers(text, questions)).toEqual({ [colorQ]: 'a, b', [petsQ]: 'Cat' });
  });
  it('keeps a quote inside a non-last answer', () => {
    const text = `The user answered: "${colorQ}"="say "hi" ok", "${petsQ}"="Cat". Read the answers carefully.`;
    expect(parseAskAnswers(text, questions)).toEqual({ [colorQ]: 'say "hi" ok', [petsQ]: 'Cat' });
  });
  it('keeps a quote followed by ". " in the last answer', () => {
    const text = `The user answered: "${colorQ}"="Red", "${petsQ}"="He said "no". Then". Read the answers carefully — they may request.`;
    expect(parseAskAnswers(text, questions)).toEqual({ [colorQ]: 'Red', [petsQ]: 'He said "no". Then' });
  });
  it('returns {} when nothing matches', () => {
    expect(parseAskAnswers('nope', questions)).toEqual({});
  });
});

describe('statuses', () => {
  const ok = { text: 'x', isError: false };
  const err = { text: 'x', isError: true };
  it('ask', () => {
    expect(deriveAskStatus({ result: ok, pending: true, running: true })).toBe('answered');
    expect(deriveAskStatus({ result: { text: fixtures.askDeniedToolResult.content, isError: fixtures.askDeniedToolResult.is_error }, pending: false, running: true })).toBe('declined');
    expect(deriveAskStatus({ result: err, pending: false, running: false })).toBe('declined');
    expect(deriveAskStatus({ pending: true, running: false })).toBe('pending');
    expect(deriveAskStatus({ pending: false, running: false })).toBe('session-ended');
    expect(deriveAskStatus({ pending: false, running: true })).toBe('pending');
    expect(deriveAskStatus({ pending: false, running: true, cancelled: true })).toBe('no-answer');
    expect(deriveAskStatus({ pending: false, running: false, cancelled: true })).toBe('session-ended');
  });
  it('exit plan', () => {
    expect(deriveExitPlanStatus({ result: { text: fixtures.exitPlanToolResult.content, isError: false }, pending: false, running: false })).toBe('approved');
    expect(deriveExitPlanStatus({ result: { text: fixtures.exitPlanDeniedToolResult.content, isError: fixtures.exitPlanDeniedToolResult.is_error }, pending: false, running: true })).toBe('stayed');
    expect(deriveExitPlanStatus({ pending: true, running: false })).toBe('pending');
    expect(deriveExitPlanStatus({ pending: false, running: false })).toBe('session-ended');
    expect(deriveExitPlanStatus({ pending: false, running: true })).toBe('pending');
  });
  it('exports decline message', () => {
    expect(ASK_DECLINE_MESSAGE).toBe('User declined to answer questions');
  });
});
