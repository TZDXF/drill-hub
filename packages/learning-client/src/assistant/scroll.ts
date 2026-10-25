export interface BottomViewport {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}
export function pinToBottom(viewport: BottomViewport, following: boolean): boolean {
  if (!following) return false;
  const max = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  if (viewport.scrollTop >= max) return false;
  viewport.scrollTop = max;
  return true;
}
export function isNearBottom(viewport: BottomViewport, threshold = 32): boolean {
  return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= threshold;
}
export function shouldReleaseBottomLock(
  viewport: HTMLElement,
  target: Element | null,
  deltaY: number,
): boolean {
  if (deltaY >= 0 || viewport.scrollHeight <= viewport.clientHeight) return false;
  let element = target;
  while (element && element !== viewport) {
    const style = getComputedStyle(element);
    if (
      (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
      element.scrollHeight > element.clientHeight
    ) {
      if (
        element.scrollTop > 0 ||
        style.overscrollBehaviorY === 'contain' ||
        style.overscrollBehaviorY === 'none'
      )
        return false;
    }
    element = element.parentElement;
  }
  return element === viewport;
}
