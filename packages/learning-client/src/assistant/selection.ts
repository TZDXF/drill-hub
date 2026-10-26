export type AssistantSelectionSource = 'user' | 'assistant';
export interface AssistantSelectionQuote {
  id: string;
  text: string;
  comment?: string;
  source?: AssistantSelectionSource;
  anchor?: AssistantSelectionAnchor;
}
export interface AssistantSelectionAnchor {
  messageId: string;
  start: number;
  end: number;
}
export const ASSISTANT_SELECTION_MAX = 8000;
export const ASSISTANT_SELECTION_MAX_COUNT = 8;
export const ASSISTANT_SELECTION_MAX_TOTAL_LENGTH = 16000;
export type AssistantSelectionLimitReason = 'count' | 'single' | 'total';
export type AssistantSelectionAppendResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; reason: AssistantSelectionLimitReason };

export function createSelectionQuote(text: string): AssistantSelectionQuote | null {
  const normalized = text.trim();
  if (!normalized) return null;
  return {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `quote-${Date.now()}-${Math.random()}`,
    text: normalized,
  };
}
function dedupeKey(quote: AssistantSelectionQuote): string {
  return [quote.text, quote.comment ?? ''].join('\0');
}
export function appendSelectionQuote(
  current: readonly AssistantSelectionQuote[],
  quote: AssistantSelectionQuote,
): AssistantSelectionAppendResult {
  if (quote.text.length > ASSISTANT_SELECTION_MAX) return { ok: false, reason: 'single' };
  if (current.some((item) => dedupeKey(item) === dedupeKey(quote)))
    return { ok: true, duplicate: true };
  if (current.length >= ASSISTANT_SELECTION_MAX_COUNT) return { ok: false, reason: 'count' };
  const totalLength = current.reduce((sum, item) => sum + item.text.length, 0);
  if (totalLength + quote.text.length > ASSISTANT_SELECTION_MAX_TOTAL_LENGTH)
    return { ok: false, reason: 'total' };
  return { ok: true, duplicate: false };
}
export function buildPromptWithQuotes(
  content: string,
  quotes: readonly AssistantSelectionQuote[],
): string {
  const text = content.trimEnd();
  if (!quotes.length) return text.trim();
  const wire = quotes.map(({ text, comment }) => ({
    text,
    ...(comment?.trim() ? { comment: comment.trim() } : {}),
  }));
  return `${text}${text ? '\n\n' : ''}# userselect:\n\`\`\`userselect\n${JSON.stringify(wire)}\n\`\`\``;
}
const QUOTE_PATTERN = /(?:^|\n\n)# userselect:\n```userselect\n([\s\S]*?)\n```\s*$/;
export function parsePromptQuotes(content: string): {
  visibleContent: string;
  quotes: AssistantSelectionQuote[];
} {
  const match = QUOTE_PATTERN.exec(content);
  if (!match) return { visibleContent: content, quotes: [] };
  try {
    const value: unknown = JSON.parse(match[1] ?? '[]');
    if (
      !Array.isArray(value) ||
      !value.every(
        (item) =>
          item &&
          typeof item === 'object' &&
          typeof item.text === 'string' &&
          (item.comment === undefined || typeof item.comment === 'string') &&
          Object.keys(item).every((key) => ['text', 'comment'].includes(key)),
      )
    )
      return { visibleContent: content, quotes: [] };
    return {
      visibleContent: content.slice(0, match.index).trimEnd(),
      quotes: value.map((item, index) => ({
        id: `quote-${index}`,
        text: item.text,
        ...(item.comment?.trim() ? { comment: item.comment } : {}),
      })),
    };
  } catch {
    return { visibleContent: content, quotes: [] };
  }
}
