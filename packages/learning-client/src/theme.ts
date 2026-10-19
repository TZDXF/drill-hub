import { useColorMode } from '@vueuse/core';

const THEME_COLORS = { light: '#f5f3ed', dark: '#141614' } as const;

/**
 * 主题偏好：auto 跟随系统（默认），可切换为浅色或深色。
 * 生效值写入 <html data-theme>，样式令牌见 style.css。
 */
export const colorMode = useColorMode({
  attribute: 'data-theme',
  storageKey: 'drill-hub.theme',
  onChanged(mode, defaultHandler) {
    defaultHandler(mode);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', THEME_COLORS[mode] ?? THEME_COLORS.light);
  },
});

/** 用户选择的偏好：auto / light / dark。 */
export const themePreference = colorMode.store;
/** 实际生效的主题：light / dark。 */
export const resolvedTheme = colorMode.state;

const CYCLE_ORDER = ['auto', 'light', 'dark'] as const;

export function cycleThemePreference() {
  const current = CYCLE_ORDER.indexOf(themePreference.value);
  themePreference.value = CYCLE_ORDER[(current + 1) % CYCLE_ORDER.length];
}
