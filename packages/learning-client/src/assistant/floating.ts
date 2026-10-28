export interface AssistantFloatingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AssistantResizeDirection = 'left' | 'top' | 'top-left';

const VIEWPORT_MARGIN = 8;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 360;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function clampFloatingRect(
  rect: AssistantFloatingRect,
  viewportWidth: number,
  viewportHeight: number,
): AssistantFloatingRect {
  const width = clamp(rect.width, MIN_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2);
  const height = clamp(rect.height, MIN_HEIGHT, viewportHeight - VIEWPORT_MARGIN * 2);
  return {
    x: clamp(rect.x, VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN),
    y: clamp(rect.y, VIEWPORT_MARGIN, viewportHeight - height - VIEWPORT_MARGIN),
    width,
    height,
  };
}

export function moveFloatingRect(
  rect: AssistantFloatingRect,
  deltaX: number,
  deltaY: number,
  viewportWidth: number,
  viewportHeight: number,
): AssistantFloatingRect {
  return clampFloatingRect(
    { ...rect, x: rect.x + deltaX, y: rect.y + deltaY },
    viewportWidth,
    viewportHeight,
  );
}

export function resizeFloatingRect(
  rect: AssistantFloatingRect,
  direction: AssistantResizeDirection,
  deltaX: number,
  deltaY: number,
  viewportWidth: number,
  viewportHeight: number,
): AssistantFloatingRect {
  const resizeX = direction !== 'top';
  const resizeY = direction !== 'left';
  const initial = clampFloatingRect(rect, viewportWidth, viewportHeight);
  const right = initial.x + initial.width;
  const bottom = initial.y + initial.height;
  const x = resizeX ? clamp(initial.x + deltaX, VIEWPORT_MARGIN, right - MIN_WIDTH) : initial.x;
  const y = resizeY ? clamp(initial.y + deltaY, VIEWPORT_MARGIN, bottom - MIN_HEIGHT) : initial.y;
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}
