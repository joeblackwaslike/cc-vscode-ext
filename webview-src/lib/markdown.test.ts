import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown';

const fence = (lang: string, code: string) => '```' + lang + '\n' + code + '\n```';

describe('renderMarkdown — shell code block run button', () => {
  it('wraps a bash block with the run/copy toolbar and an output slot', () => {
    const html = renderMarkdown(fence('bash', 'echo hi'));
    expect(html).toContain('class="cc-codeblock"');
    expect(html).toContain('cc-cb-toolbar');
    expect(html).toContain('cc-run-btn');
    expect(html).toContain('cc-copy-btn');
    expect(html).toContain('cc-run-slot');
  });

  it('base64-encodes the raw command in data-cc-cmd', () => {
    const html = renderMarkdown(fence('bash', 'echo hi'));
    // btoa('echo hi') === 'ZWNobyBoaQ=='
    expect(html).toContain('data-cc-cmd="ZWNobyBoaQ=="');
  });

  it('base64-encodes non-ASCII commands as UTF-8 (round-trips)', () => {
    const command = 'echo "héllo 🌮 世界"';
    const html = renderMarkdown(fence('bash', command));
    const expected = btoa(String.fromCharCode(...new TextEncoder().encode(command)));
    expect(html).toContain(`data-cc-cmd="${expected}"`);
    // Decoding the attribute must reproduce the exact UTF-8 command.
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(expected), (c) => c.charCodeAt(0)),
    );
    expect(decoded).toBe(command);
  });

  it.each(['sh', 'shell', 'zsh', 'console'])('adds the button for %s blocks too', (lang) => {
    expect(renderMarkdown(fence(lang, 'ls'))).toContain('cc-run-btn');
  });

  it('does NOT add a run button to non-shell blocks', () => {
    for (const lang of ['json', 'python', 'typescript', 'js']) {
      const html = renderMarkdown(fence(lang, 'const x = 1'));
      expect(html).not.toContain('cc-codeblock');
      expect(html).not.toContain('cc-run-btn');
    }
  });

  it('does not add a run button to an unlabeled fenced block', () => {
    expect(renderMarkdown(fence('', 'just text')).includes('cc-run-btn')).toBe(false);
  });
});
