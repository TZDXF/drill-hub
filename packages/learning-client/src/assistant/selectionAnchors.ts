import type { AssistantSelectionAnchor } from '#learning-client/assistant/selection';

function boundaryOffset(root: Element, node: Node, offset: number): number | null {
  try {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return null;
  }
}

/** Capture a selection within one rendered message. Editor-only anchors never enter the prompt. */
export function captureSelectionAnchor(
  container: Element,
  range: Range,
): AssistantSelectionAnchor | null {
  const startElement =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const message = startElement?.closest<HTMLElement>('[data-message-id]');
  const endElement =
    range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;
  if (
    !message ||
    !container.contains(message) ||
    message !== endElement?.closest('[data-message-id]') ||
    !message?.dataset.messageId
  )
    return null;
  const root = message.querySelector<HTMLElement>('[data-selection-content]');
  if (!root || !root.contains(range.startContainer) || !root.contains(range.endContainer))
    return null;
  const start = boundaryOffset(root, range.startContainer, range.startOffset);
  const end = boundaryOffset(root, range.endContainer, range.endOffset);
  if (start === null || end === null) return null;
  return {
    messageId: message.dataset.messageId,
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

export function selectionContentRoot(container: Element, messageId: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    `[data-message-id="${CSS.escape(messageId)}"] [data-selection-content]`,
  );
}

function setBoundary(root: Element, range: Range, offset: number, start: boolean): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let node = walker.nextNode() as Text | null;
  let last: Text | null = null;
  while (node) {
    if (offset <= consumed + node.data.length) {
      range[start ? 'setStart' : 'setEnd'](node, offset - consumed);
      return;
    }
    consumed += node.data.length;
    last = node;
    node = walker.nextNode() as Text | null;
  }
  if (last) range[start ? 'setStart' : 'setEnd'](last, last.data.length);
  else range[start ? 'setStart' : 'setEnd'](root, 0);
}

/** Flash the exact source range without changing Markdown DOM or the user's selection. */
export function flashSelection(root: HTMLElement, anchor: AssistantSelectionAnchor): () => void {
  const range = document.createRange();
  setBoundary(root, range, anchor.start, true);
  setBoundary(root, range, anchor.end, false);
  const overlays: HTMLElement[] = [];
  for (const rect of Array.from(range.getClientRects())) {
    if (!rect.width || !rect.height) continue;
    const overlay = document.createElement('span');
    overlay.className = 'assistant-selection-highlight';
    overlay.setAttribute('aria-hidden', 'true');
    Object.assign(overlay.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    document.body.appendChild(overlay);
    overlays.push(overlay);
  }
  const timer = window.setTimeout(cleanup, 1600);
  function cleanup() {
    window.clearTimeout(timer);
    overlays.forEach((overlay) => overlay.remove());
  }
  return cleanup;
}
