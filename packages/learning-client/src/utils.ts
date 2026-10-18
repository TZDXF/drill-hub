import { ApiError } from '@drill-hub/api-client';

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const fields = error.fields ? Object.values(error.fields).filter(Boolean) : [];
    return fields.length ? `${error.message}：${fields.join('；')}` : error.message;
  }
  if (error instanceof DOMException && error.name === 'AbortError') return '请求已取消';
  if (error instanceof TypeError) return '无法连接服务器，请检查网络、地址或传输设置后重试';
  if (error instanceof Error) return error.message;
  return '操作未完成，请稍后重试';
}

export function isApiError(error: unknown, status?: number): error is ApiError {
  return error instanceof ApiError && (status === undefined || error.status === status);
}

export function formatDate(value: string | null | undefined, withTime = true): string {
  if (!value) return '—';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(dateOnly ? { timeZone: 'UTC' } : {}),
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '不限时';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
}

export function formatScore(value: string | null | undefined): string {
  if (value === null || value === undefined) return '待评分';
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(number)
    : value;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function abortError(): DOMException {
  return new DOMException('请求已取消', 'AbortError');
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
  textarea.setSelectionRange(0, text.length);
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
