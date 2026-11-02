import { formatIdeBlocks, type IdeContext } from './ideTags';

/** Message content accepted by the CLI's stream-json user turn. */
export type UserContent = string | Array<{ type: 'text'; text: string }>;

/**
 * Build the user turn content. Plain string when there is no IDE context;
 * otherwise the prompt followed by one text block per IDE block.
 */
export function buildUserContent(text: string, context?: IdeContext): UserContent {
  if (!context) return text;
  return [{ type: 'text', text }, ...formatIdeBlocks(context).map((t) => ({ type: 'text' as const, text: t }))];
}
