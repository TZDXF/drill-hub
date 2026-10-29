import type { AssistantFloatingRect } from '#learning-client/assistant/floating';

export type AssistantPanelPosition = 'left' | 'right' | 'floating';

export interface AssistantPanelPreferences {
  position: AssistantPanelPosition;
  chatWidth: number;
  floatingRect: AssistantFloatingRect | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function parseAssistantPanelPreferences(raw: string | null): AssistantPanelPreferences {
  const preferences: AssistantPanelPreferences = {
    position: 'left',
    chatWidth: 400,
    floatingRect: null,
  };
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (!isRecord(value)) return preferences;
    if (value.position === 'left' || value.position === 'right' || value.position === 'floating')
      preferences.position = value.position;
    if (isFiniteNumber(value.chatWidth))
      preferences.chatWidth = Math.min(560, Math.max(320, Math.round(value.chatWidth)));
    const rect = value.floatingRect;
    if (
      isRecord(rect) &&
      isFiniteNumber(rect.x) &&
      isFiniteNumber(rect.y) &&
      isFiniteNumber(rect.width) &&
      isFiniteNumber(rect.height) &&
      rect.width > 0 &&
      rect.height > 0
    ) {
      preferences.floatingRect = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    }
  } catch {
    // Malformed preferences must not prevent startup.
  }
  return preferences;
}
