import { ApiError } from '@drill-hub/api-client';
import { appLocale, i18n } from '#learning-client/i18n';

type Translate = (key: string, named?: Record<string, unknown>) => string;
type TranslateExists = (key: string, locale?: string) => boolean;

/** 翻译 core 命名空间的消息，键为消息 ID。 */
export const translate = i18n.global.t as unknown as Translate;
const translateExists = i18n.global.te as unknown as TranslateExists;

export function hasMessage(key: string): boolean {
  return translateExists(key, appLocale.value);
}

export function numberLocale(): string {
  return appLocale.value === 'en' ? 'en-US' : 'zh-CN';
}

/**
 * 创建一个可即时生效的标签表：每次读取都按当前语言解析，
 * 因此切换语言后无需重新构建即可得到新文案。
 */
export function localizedRecord<T extends string>(keys: Record<T, string>): Record<T, string> {
  const target = {} as Record<T, string>;
  for (const key of Object.keys(keys) as T[]) {
    Object.defineProperty(target, key, {
      enumerable: true,
      configurable: true,
      get: () => translate(keys[key]),
    });
  }
  return target;
}

const fieldMessageKeys: Record<string, string> = {
  必须是非空字符串: 'core.error.field.requiredString',
  必须是字符串: 'core.error.field.string',
  该字段由服务端确定: 'core.error.field.serverOwned',
  'Invalid score.': 'core.error.field.invalidScore',
  'Score is too large.': 'core.error.field.scoreTooLarge',
  'Score must be greater than zero.': 'core.error.field.scorePositive',
  'Use a decimal string with at most two fractional digits.': 'core.error.field.scoreDecimal',
};

function localizeFieldMessage(value: string): string {
  const text = value.trim();
  const known = fieldMessageKeys[text];
  if (known) return translate(known);
  const maxLength = /^最多 (\d+) 个字符$/.exec(text);
  if (maxLength) return translate('core.error.field.maxLength', { max: maxLength[1] });
  const integerRange = /^必须是 1 到 (\d+) 的整数$/.exec(text);
  if (integerRange) return translate('core.error.field.integerRange', { max: integerRange[1] });
  return translate('core.error.field.generic');
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const key = `core.errors.${error.code}`;
    const message = hasMessage(key)
      ? translate(key)
      : translate('core.error.unmapped', { code: error.code });
    const fields = error.fields ? Object.values(error.fields).filter(Boolean) : [];
    if (!fields.length) return message;
    const details = fields.map(localizeFieldMessage).join(translate('core.error.fieldSeparator'));
    return translate('core.error.withFields', { message, fields: details });
  }
  if (error instanceof DOMException && error.name === 'AbortError')
    return translate('core.error.requestCancelled');
  if (error instanceof TypeError) return translate('core.error.network');
  if (error instanceof Error) return error.message;
  return translate('core.error.unknown');
}

export function isApiError(error: unknown, status?: number): error is ApiError {
  return error instanceof ApiError && (status === undefined || error.status === status);
}

export function formatDate(value: string | null | undefined, withTime = true): string {
  if (!value) return translate('core.common.notAvailable');
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(numberLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(dateOnly ? { timeZone: 'UTC' } : {}),
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return translate('core.common.unlimited');
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest
    ? translate('core.duration.minutesSeconds', { minutes, seconds: rest })
    : translate('core.duration.minutes', { minutes });
}

export function optionPrefix(index: number): string {
  let value = index + 1;
  let prefix = '';
  while (value > 0) {
    value -= 1;
    prefix = String.fromCharCode(65 + (value % 26)) + prefix;
    value = Math.floor(value / 26);
  }
  return `${prefix}.`;
}

export function formatOptionLabel(index: number, text: string): string {
  return `${optionPrefix(index)} ${text}`;
}

export function formatScore(value: string | null | undefined): string {
  if (value === null || value === undefined) return translate('core.common.pendingGrade');
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat(numberLocale(), { maximumFractionDigits: 2 }).format(number)
    : value;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function abortError(): DOMException {
  return new DOMException(translate('core.error.requestCancelled'), 'AbortError');
}

function copyTextWithSelection(text: string): boolean {
  const textarea = document.createElement('textarea');
  const selection = document.getSelection();
  const selectedRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
  const activeElement = document.activeElement;
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.inset = '0 auto auto -9999px';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.append(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    textarea.remove();
    if (activeElement instanceof HTMLElement) activeElement.focus({ preventScroll: true });
    if (selection && selectedRange) {
      selection.removeAllRanges();
      selection.addRange(selectedRange);
    }
  }
  return copied;
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // HTTP 部署或权限受限时，继续尝试无需安全上下文的选区复制。
  }
  return copyTextWithSelection(text);
}
