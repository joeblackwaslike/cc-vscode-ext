/**
 * Markdown → HTML for assistant message text.
 *
 * Uses markdown-it (synchronous, returns a string — keeps the existing
 * `renderMarkdown(text): string` + `dangerouslySetInnerHTML` contract) with a
 * curated highlight.js language set wired in as the fenced-code highlighter.
 *
 * Security: `html: false` escapes any raw HTML in model output (the primary XSS
 * guard), and markdown-it's default `validateLink` already blocks
 * `javascript:`/unsafe schemes. Everything is bundled into the webview JS, so
 * there is no runtime fetch — safe under the nonce-based CSP.
 */
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/core';

import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);

/**
 * Languages whose code blocks get a "Run in terminal" play button. The button +
 * an empty output slot are emitted as fixed markup; a React portal mounts the
 * collapsible output panel into the slot (see AssistantTurn's MarkdownText).
 */
const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'console']);

/**
 * Base64-encode the raw command so it survives as an HTML attribute value
 * regardless of quoting/escaping. Decoded in the webview before it is run.
 */
function encodeCommand(command: string): string {
  const bytes = new TextEncoder().encode(command);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const md = new MarkdownIt({
  html: false, // escape raw HTML in model output (XSS guard)
  linkify: true,
  breaks: true,
  highlight(code: string, lang: string): string {
    const langKey = (lang || '').trim().toLowerCase();
    const language = langKey && hljs.getLanguage(langKey) ? langKey : '';
    const value = language
      ? hljs.highlight(code, { language, ignoreIllegals: true }).value
      : md.utils.escapeHtml(code);
    // `hljs` class lets the bundled github-dark theme color the tokens.
    const pre = `<pre class="hljs"><code>${value}</code></pre>`;
    if (!SHELL_LANGS.has(langKey)) return pre;
    // Shell block: wrap with a run/copy toolbar + a slot for the output portal.
    // The base64 attribute is non-executable; we only ever emit our own markup,
    // so `html: false` (model-text escaping) is preserved.
    const cmd = encodeCommand(code.replace(/\n$/, ''));
    return (
      `<div class="cc-codeblock" data-cc-cmd="${cmd}">` +
      `<div class="cc-cb-toolbar">` +
      `<button class="cc-copy-btn" type="button" title="Copy" aria-label="Copy command">⧉</button>` +
      `<button class="cc-run-btn" type="button" title="Run in terminal" aria-label="Run command">▷</button>` +
      `</div>` +
      pre +
      `<div class="cc-run-slot"></div>` +
      `</div>`
    );
  },
});

// Open links in a new tab/window safely (webview has no normal navigation).
const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token) {
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer');
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

export function renderMarkdown(text: string): string {
  return md.render(text);
}
