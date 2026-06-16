import { describe, it, expect } from 'vitest';
import { buildArgs } from '../../../src/process/ProcessArgs';

describe('buildArgs', () => {
  it('always includes stream-json flags', () => {
    const args = buildArgs({});
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--input-format');
    expect(args).toContain('--verbose');
  });

  it('uses permission-prompt-tool stdio in default mode', () => {
    const args = buildArgs({});
    expect(args).toContain('--permission-prompt-tool');
    expect(args).toContain('stdio');
    expect(args).not.toContain('--permission-mode');
  });

  it('passes --permission-mode for non-default modes', () => {
    for (const mode of ['acceptEdits', 'plan', 'bypassPermissions'] as const) {
      const args = buildArgs({ permissionMode: mode });
      expect(args).toContain('--permission-mode');
      expect(args).toContain(mode);
      expect(args).not.toContain('--permission-prompt-tool');
    }
  });

  it('does not add --permission-mode for default mode', () => {
    const args = buildArgs({ permissionMode: 'default' });
    expect(args).not.toContain('--permission-mode');
    expect(args).toContain('--permission-prompt-tool');
  });

  it('adds --resume when provided', () => {
    const args = buildArgs({ resume: 'session-abc-123' });
    expect(args).toContain('--resume');
    expect(args).toContain('session-abc-123');
  });

  it('does not add --resume when absent', () => {
    const args = buildArgs({});
    expect(args).not.toContain('--resume');
  });

  it('adds --allow-dangerously-skip-permissions when true', () => {
    const args = buildArgs({ allowDangerouslySkipPermissions: true });
    expect(args).toContain('--allow-dangerously-skip-permissions');
  });

  it('does not add --allow-dangerously-skip-permissions when false', () => {
    const args = buildArgs({ allowDangerouslySkipPermissions: false });
    expect(args).not.toContain('--allow-dangerously-skip-permissions');
  });

  it('passes --effort <level> when an effort is set', () => {
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
      const args = buildArgs({ effort });
      const i = args.indexOf('--effort');
      expect(i).toBeGreaterThanOrEqual(0);
      expect(args[i + 1]).toBe(effort);
    }
  });

  it('does not add --effort when absent', () => {
    expect(buildArgs({})).not.toContain('--effort');
  });

  it('passes --model when a model is set', () => {
    const args = buildArgs({ model: 'opus' });
    const i = args.indexOf('--model');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe('opus');
  });

  it('does not add --model when absent', () => {
    expect(buildArgs({})).not.toContain('--model');
  });
});
