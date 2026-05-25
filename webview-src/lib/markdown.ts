/** Minimal markdown → HTML renderer. Handles code blocks, inline code, bold, italic, links. */
export function renderMarkdown(text: string): string {
  let html = escapeHtml(text);

  // Fenced code blocks
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_, lang: string, code: string) =>
      `<pre><code class="language-${lang || 'text'}">${code}</code></pre>`,
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Line breaks (preserve paragraphs)
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br />');

  return `<p>${html}</p>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
