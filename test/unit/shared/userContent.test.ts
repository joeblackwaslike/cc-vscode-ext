import { describe, it, expect } from 'vitest';
import { buildUserContent } from '../../../src/shared/userContent';
import { formatIdeBlocks, type IdeContext } from '../../../src/shared/ideTags';

describe('buildUserContent', () => {
  const ctx: IdeContext = { filePath: '/w/a.ts' };

  it('returns the plain string when there is no context', () => {
    expect(buildUserContent('hi')).toBe('hi');
  });

  it('returns the prompt followed by one text block per ide block', () => {
    const blocks = formatIdeBlocks(ctx);
    expect(buildUserContent('hi', ctx)).toEqual([
      { type: 'text', text: 'hi' },
      ...blocks.map((text) => ({ type: 'text', text })),
    ]);
    expect(blocks).toHaveLength(1);
  });
});
