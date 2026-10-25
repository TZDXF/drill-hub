import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { workspacePath } from '#server/core/paths.js';
import Fastify from 'fastify';
import type { Answer, QuestionDefinition } from '@drill-hub/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '#server/core/context.js';
import { AppError } from '#server/core/errors.js';
import { registerLearningRoutes } from '#server/modules/learning/index.js';
import { registerGradingRoutes } from '#server/modules/grading/routes.js';
import { gradeRubric, validateQuestion } from '#server/modules/grading/engine.js';

const skillRoot = workspacePath('skills', 'drill-hub');
const resourceRoot = resolve(skillRoot, 'references/resources');
const app = Fastify();
const registered = new Set<string>();
const requireAgent = vi.fn<AppContext['requireAgent']>(async () => {
  throw new AppError(403, 'SCOPE_PROBE', '仅检查路由鉴权，不执行资源操作');
});
// Registration only needs handlers; each request stops at requireAgent, before database access.
const context = { requireAgent } as unknown as AppContext;

function normalizePath(path: string): string {
  return path.replace(/:[^/]+|\{[^}]+\}/g, '{}');
}

function examples(markdown: string): Record<string, unknown>[] {
  return [...markdown.matchAll(/^```json\r?\n([\s\S]*?)^```/gm)].map((match) => {
    const value: unknown = JSON.parse(match[1]!);
    expect(value).toBeTypeOf('object');
    expect(value).not.toBeNull();
    expect(Array.isArray(value)).toBe(false);
    return value as Record<string, unknown>;
  });
}

async function resourcePages() {
  const names = (await readdir(resourceRoot)).filter((name) => name.endsWith('.md'));
  return Promise.all(
    names.map(async (name) => ({
      path: resolve(resourceRoot, name),
      markdown: await readFile(resolve(resourceRoot, name), 'utf8'),
    })),
  );
}

beforeAll(async () => {
  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith('/api/v1/agent/')) return;
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method !== 'HEAD') registered.add(`${method} ${normalizePath(route.url)}`);
    }
  });
  registerLearningRoutes(app, context);
  await registerGradingRoutes(app, context);
  await app.ready();
});
afterAll(async () => app.close());

describe('Agent API documentation', () => {
  it('covers registered Agent routes exactly once and documents their actual scopes', async () => {
    const documented: string[] = [];
    for (const page of await resourcePages()) {
      const operations = [
        ...page.markdown.matchAll(
          /^\|\s*(GET|POST|PATCH|PUT|DELETE)\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|/gm,
        ),
      ];
      expect(operations.length).toBeGreaterThan(0);
      for (const [, method, path, scope, status] of operations) {
        const key = `${method} ${normalizePath(path!)}`;
        documented.push(key);
        expect(registered.has(key)).toBe(true);
        expect(Number(status)).toBeGreaterThanOrEqual(200);
        expect(Number(status)).toBeLessThan(300);
        requireAgent.mockClear();
        const response = await app.inject({
          method: method as 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
          url: path!.replace(/\{[^}]+\}/g, 'doc-probe'),
        });
        expect(response.statusCode).toBe(403);
        expect(requireAgent).toHaveBeenCalledExactlyOnceWith(expect.anything(), scope);
      }
    }
    expect(new Set(documented).size).toBe(documented.length);
    expect(documented.sort()).toEqual([...registered].sort());
  });

  it('makes every reference discoverable from SKILL.md and resolves local links', async () => {
    const resourceFiles = (await resourcePages()).map((page) => page.path);
    const expected = [
      resolve(skillRoot, 'SKILL.md'),
      resolve(skillRoot, 'references/api.md'),
      ...resourceFiles,
    ];
    const visited = new Set<string>();
    const anchorLinks: { path: string; anchor: string }[] = [];
    const pending = [expected[0]!];
    while (pending.length > 0) {
      const path = pending.pop()!;
      if (visited.has(path)) continue;
      visited.add(path);
      const markdown = await readFile(path, 'utf8');
      for (const [, target] of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        if (/^[a-z]+:/i.test(target!)) continue;
        const [file, anchor] = target!.split('#');
        const linked = file
          ? file.startsWith('@skill/')
            ? resolve(skillRoot, file.slice('@skill/'.length))
            : resolve(dirname(path), file)
          : path;
        expect((await stat(linked)).isFile()).toBe(true);
        if (anchor) anchorLinks.push({ path: linked, anchor });
        if (expected.includes(linked) && !visited.has(linked)) pending.push(linked);
      }
    }
    expect([...visited].sort()).toEqual(expected.sort());
    for (const { path, anchor } of anchorLinks) {
      const headings = await readFile(path, 'utf8');
      const slugs = [...headings.matchAll(/^#+ (.+)$/gm)].map((heading) =>
        heading[1]!.trim().toLowerCase().replace(/\s+/g, '-'),
      );
      expect(slugs).toContain(decodeURIComponent(anchor));
    }
  });

  it('uses valid JSON request and response examples', async () => {
    const pages = [
      ...(await resourcePages()),
      { path: 'api.md', markdown: await readFile(resolve(skillRoot, 'references/api.md'), 'utf8') },
    ];
    let count = 0;
    for (const page of pages) count += examples(page.markdown).length;
    expect(count).toBeGreaterThan(0);
  });

  it('accepts the documented question definitions in the real grading engine', async () => {
    const values = examples(await readFile(resolve(resourceRoot, 'questions.md'), 'utf8'));
    const batch = values.find((value) => Array.isArray(value.items))!;
    for (const item of batch.items as QuestionDefinition[])
      expect(() => validateQuestion(item)).not.toThrow();
    const update = values.find((value) => value.definition)!;
    expect(() => validateQuestion(update.definition as QuestionDefinition)).not.toThrow();
  });

  it('grades both external examples against every criterion of the documented rubric', async () => {
    const questionExamples = examples(
      await readFile(resolve(resourceRoot, 'questions.md'), 'utf8'),
    );
    const batch = questionExamples.find((value) => Array.isArray(value.items))!;
    const definition: QuestionDefinition = {
      ...(batch.items as QuestionDefinition[])[0]!,
      gradingMode: 'external_rubric',
    };
    const gradeExamples = examples(await readFile(resolve(resourceRoot, 'grading.md'), 'utf8'));
    const answer = gradeExamples.find((value) => typeof value.text === 'string')!;
    const submissions = gradeExamples.filter((value) => Array.isArray(value.criterionResults));
    expect(submissions).toHaveLength(2);
    for (const submission of submissions) {
      const grade = gradeRubric(
        definition,
        answer as Answer,
        '10.00',
        submission.criterionResults,
        {
          source: 'external_agent',
          version: (submission.expectedGradeVersion as number) + 1,
          feedback: '',
          ...(submission.reason ? { reason: submission.reason as string } : {}),
        },
      );
      expect(grade.criterionResults).toHaveLength(definition.rubric!.criteria.length);
      expect(grade.maxScore).toBe('10.00');
    }
  });
});
