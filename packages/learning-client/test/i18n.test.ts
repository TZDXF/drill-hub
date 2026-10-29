import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClientLocale, ClientPlatform } from '@drill-hub/contracts';
import {
  appLocale,
  i18n,
  initializeLocale,
  messages,
  setLocale,
  toggleLocale,
} from '#learning-client/i18n';
import { errorMessage, formatDate, formatDuration } from '#learning-client/utils';
import { ApiError } from '@drill-hub/api-client';
import { questionTypeLabels } from '#learning-client/types';

const workspaceRoot = dirname(
  dirname(dirname(fileURLToPath(import.meta.resolve('@drill-hub/tsconfig/base.json')))),
);

function platform(stored: string | null = null): ClientPlatform {
  return {
    kind: 'web',
    sessionPersistence: 'memory',
    getLocale: () => stored,
    getAssistantPanelPreferences: () => null,
    setAssistantPanelPreferences: () => undefined,
    setLocale: vi.fn<(locale: ClientLocale) => void>(),
    getConnection: async () => null,
    setConnection: async () => {},
    getSession: async () => null,
    setSession: async () => {},
  };
}

function flatten(value: object, prefix = ''): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof child === 'string'
        ? [[path, child]]
        : Object.entries(flatten(child as object, path));
    }),
  );
}

afterEach(() => {
  initializeLocale(platform());
  vi.unstubAllGlobals();
});

describe('server error translations', () => {
  it('covers uppercase underscore literals emitted by the server in both locales', () => {
    const serverRoot = resolve(workspaceRoot, 'apps/server/src');
    function sources(directory: string): string[] {
      return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? sources(path) : /\.ts$/.test(entry.name) ? [path] : [];
      });
    }
    const codes = new Set<string>();
    for (const file of sources(serverRoot)) {
      for (const match of readFileSync(file, 'utf8').matchAll(
        /['"]([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)['"]/g,
      )) {
        codes.add(match[1]);
      }
    }
    for (const locale of ['zh-CN', 'en'] as const) {
      const entries = flatten(messages[locale]);
      expect([...codes].filter((code) => !(`core.errors.${code}` in entries)).sort()).toEqual([]);
    }
  });
});

describe('language preferences', () => {
  it('defaults to Chinese regardless of browser language', () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    initializeLocale(platform());
    expect(appLocale.value).toBe('zh-CN');
  });

  it('restores English and resets invalid stored values to Chinese', () => {
    initializeLocale(platform('en'));
    expect(appLocale.value).toBe('en');
    initializeLocale(platform('unsupported'));
    expect(appLocale.value).toBe('zh-CN');
  });

  it('switches immediately, updates document language and saves the preference', () => {
    const host = platform();
    const document = { documentElement: { lang: '' }, title: '', querySelector: () => null };
    vi.stubGlobal('document', document);
    initializeLocale(host);
    const label = computed(() => questionTypeLabels.single_choice);
    const chinese = label.value;
    toggleLocale();
    expect(appLocale.value).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(host.setLocale).toHaveBeenCalledWith('en');
    expect(label.value).not.toBe(chinese);
    setLocale('zh-CN');
    expect(label.value).toBe(chinese);
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('keeps working when preference storage is blocked', () => {
    const host = platform();
    host.getLocale = () => {
      throw new Error('storage blocked');
    };
    host.setLocale = () => {
      throw new Error('storage blocked');
    };
    expect(() => initializeLocale(host)).not.toThrow();
    expect(() => setLocale('en')).not.toThrow();
    expect(appLocale.value).toBe('en');
  });

  it('rejects unsupported runtime locale values', () => {
    initializeLocale(platform());
    setLocale('fr' as ClientLocale);
    expect(appLocale.value).toBe('zh-CN');
  });

  it('localizes API errors by code without echoing unknown server details', () => {
    setLocale('en');
    const known = errorMessage(new ApiError('VERSION_CONFLICT', '服务端中文提示', 409));
    expect(known).toBe(i18n.global.t('core.errors.VERSION_CONFLICT'));
    const unknown = errorMessage(
      new ApiError('NEW_ERROR', '不得显示的服务端数据', 400, {
        answer: '不得显示的原始答案',
      }),
    );
    expect(unknown).toContain('NEW_ERROR');
    expect(unknown).not.toMatch(/\p{Script=Han}/u);
    expect(formatDuration(65)).not.toMatch(/\p{Script=Han}/u);
    setLocale('zh-CN');
    expect(formatDuration(65)).toBe('1 分 5 秒');
  });

  it('formats dates using the active language', () => {
    const input = '2026-10-19T12:34:00.000Z';
    const chinese = formatDate(input);
    setLocale('en');
    expect(formatDate(input)).not.toBe(chinese);
  });
});

describe('translation catalogs', () => {
  const chinese = flatten(messages['zh-CN']);
  const english = flatten(messages.en);

  it('has identical nonempty keys in Chinese and English', () => {
    expect(Object.keys(chinese).sort()).toEqual(Object.keys(english).sort());
    expect(Object.keys(chinese).length).toBeGreaterThan(100);
    for (const [key, value] of Object.entries(english)) {
      expect({ key, value: value.trim() }).toMatchObject({ value: expect.any(String) });
      expect(value.trim()).not.toBe('');
      expect(value).not.toMatch(/\p{Script=Han}/u);
    }
  });

  it('defines every statically referenced translation key', () => {
    const root = resolve(workspaceRoot, 'packages/learning-client/src');
    function sources(directory: string): string[] {
      return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? sources(path) : /\.(ts|vue)$/.test(entry.name) ? [path] : [];
      });
    }
    const missing: string[] = [];
    for (const file of sources(root)) {
      const source = readFileSync(file, 'utf8');
      const keys = source.matchAll(
        /\b(?:t|translate)\(\s*['"]((?:core|components|learning|management)\.[^'"]+)['"]/g,
      );
      for (const match of keys) {
        if (!(match[1] in chinese)) missing.push(`${file}: ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('maps every server audit action to an existing translation key', () => {
    const serverRoot = resolve(workspaceRoot, 'apps/server/src');
    function serverSources(directory: string): string[] {
      return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? serverSources(path) : /\.ts$/.test(entry.name) ? [path] : [];
      });
    }
    const serverActions = new Set<string>();
    for (const file of serverSources(serverRoot)) {
      const source = readFileSync(file, 'utf8');
      for (const call of source.matchAll(
        /ctx\.audit\(\s*actor\s*,([\s\S]{0,300}?)(?:,\s*(?:'[a-zA-Z-]+'|[a-zA-Z_$][\w$]*)\s*,)/g,
      )) {
        for (const literal of call[1].matchAll(/'([a-z][a-z0-9_.-]*\.[a-z0-9_.-]+)'/g)) {
          serverActions.add(literal[1]);
        }
      }
    }
    const auditPage = readFileSync(
      resolve(workspaceRoot, 'packages/learning-client/src/pages/AdminAuditPage.vue'),
      'utf8',
    );
    const mapped = new Map(
      [...auditPage.matchAll(/^\s*'([a-z_.-]+)':\s*'(management\.audit\.action\.\w+)',$/gm)].map(
        (match) => [match[1], match[2]],
      ),
    );
    const unmapped = [...serverActions].filter((action) => !mapped.has(action));
    expect(unmapped).toEqual([]);
    // 已移除的功能仍需展示历史审计记录。
    const historicalActions = new Set(['provider_model.tested', 'provider_model.test_failed']);
    const stale = [...mapped.keys()].filter(
      (action) => !serverActions.has(action) && !historicalActions.has(action),
    );
    for (const action of historicalActions) expect(mapped.has(action)).toBe(true);
    expect(stale).toEqual([]);
    for (const key of mapped.values()) {
      expect({ key, defined: key in chinese }).toEqual({ key, defined: true });
    }
  });

  it('preserves interpolation parameters and compiles every message', () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const locale of ['zh-CN', 'en'] as const) {
        appLocale.value = locale;
        for (const [key, value] of Object.entries(flatten(messages[locale]))) {
          expect({ key, params: placeholders(value) }).toEqual({
            key,
            params: placeholders(chinese[key]),
          });
          const params = Object.fromEntries(placeholders(value).map((name) => [name, 3]));
          const rendered = i18n.global.t(key, params);
          expect(rendered).not.toBe(key);
        }
      }
      expect(errors.mock.calls).toEqual([]);
      expect(warnings.mock.calls).toEqual([]);
    } finally {
      errors.mockRestore();
      warnings.mockRestore();
    }
  });
});
