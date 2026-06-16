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

const md = new MarkdownIt({
  html: false, // escape raw HTML in model output (XSS guard)
  linkify: true,
  breaks: true,
  highlight(code: string, lang: string): string {
    const language = lang && hljs.getLanguage(lang) ? lang : '';
    const value = language
      ? hljs.highlight(code, { language, ignoreIllegals: true }).value
      : md.utils.escapeHtml(code);
    // `hljs` class lets the bundled github-dark theme color the tokens.
    return `<pre class="hljs"><code>${value}</code></pre>`;
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
