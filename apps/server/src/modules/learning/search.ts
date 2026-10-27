import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { SearchOutcome, SearchResourceType, SearchResult } from '@drill-hub/contracts';
import type { AppContext } from '#server/core/context.js';
import { assert } from '#server/core/errors.js';
import {
  API_PREFIX,
  archiveState,
  matchesArchive,
  query,
  type JsonObject,
} from '#server/modules/learning/common.js';

const SEARCH_TYPES: SearchResourceType[] = ['topic', 'content', 'plan', 'question', 'assessment'];
const MAX_RESULTS = 50;
const SNIPPET_CONTEXT = 40;

function parseSearchTypes(value: unknown): SearchResourceType[] | null {
  if (value === undefined) return null;
  assert(
    typeof value === 'string' && value.trim().length > 0,
    'INVALID_SEARCH_TYPE',
    'types 无效',
    422,
  );
  const requested = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  assert(requested.length > 0, 'INVALID_SEARCH_TYPE', 'types 无效', 422);
  for (const item of requested)
    assert(
      (SEARCH_TYPES as string[]).includes(item),
      'INVALID_SEARCH_TYPE',
      `types 不支持 ${item}`,
      422,
    );
  return [...new Set(requested)] as SearchResourceType[];
}

function snippet(fields: string[], lowerQuery: string): string | null {
  const source = fields.find((field) => field.toLowerCase().includes(lowerQuery));
  if (!source) return null;
  const index = source.toLowerCase().indexOf(lowerQuery);
  const start = Math.max(0, index - SNIPPET_CONTEXT);
  const end = Math.min(source.length, index + lowerQuery.length + SNIPPET_CONTEXT);
  const body = source.slice(start, end).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + body + (end < source.length ? '…' : '');
}

interface Candidate {
  resourceType: SearchResourceType;
  id: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  topicId: string;
  title: string;
  fields: string[];
  archived: boolean;
}

function questionFields(definition: {
  stem: string;
  explanation?: string;
  referenceAnswer?: string;
  tags?: string[];
}): string[] {
  return [
    definition.stem,
    definition.explanation ?? '',
    definition.referenceAnswer ?? '',
    (definition.tags ?? []).join(' '),
  ];
}

export async function searchOwnedResources(
  ctx: AppContext,
  ownerId: string,
  input: JsonObject,
): Promise<SearchOutcome> {
  const raw = typeof input.q === 'string' ? input.q.trim() : '';
  assert(raw.length > 0, 'INVALID_SEARCH_QUERY', '搜索词不能为空', 422, { q: '必填' });
  assert(raw.length <= 100, 'INVALID_SEARCH_QUERY', '搜索词过长', 422, { q: '最多 100 个字符' });
  const types = parseSearchTypes(input.types);
  const state = archiveState(input.archiveState);
  const selected = types ?? SEARCH_TYPES;
  const lowerQuery = raw.toLowerCase();
  const candidates: Candidate[] = [];

  if (selected.includes('topic')) {
    for (const record of await ctx.db.list('topics', { ownerId }))
      if (matchesArchive(record, state))
        candidates.push({
          resourceType: 'topic',
          id: record.id,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          revision: record.revision,
          topicId: record.id,
          title: record.title,
          fields: [record.title, record.goalText],
          archived: record.archivedAt !== null,
        });
  }
  if (selected.includes('content')) {
    for (const record of await ctx.db.list('contents', { ownerId }))
      if (matchesArchive(record, state))
        candidates.push({
          resourceType: 'content',
          id: record.id,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          revision: record.revision,
          topicId: record.topicId,
          title: record.title,
          fields: [record.title, record.bodyText],
          archived: record.archivedAt !== null,
        });
  }
  if (selected.includes('plan')) {
    for (const record of await ctx.db.list('plans', { ownerId }))
      if (matchesArchive(record, state))
        candidates.push({
          resourceType: 'plan',
          id: record.id,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          revision: record.revision,
          topicId: record.topicId,
          title: record.title,
          fields: [
            record.title,
            ...record.phases.flatMap((phase) => phase.tasks.map((task) => task.title)),
          ],
          archived: record.archivedAt !== null,
        });
  }
  if (selected.includes('question')) {
    for (const record of await ctx.db.list('questions', { ownerId }))
      if (matchesArchive(record, state))
        candidates.push({
          resourceType: 'question',
          id: record.id,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          revision: record.revision,
          topicId: record.topicId,
          title: record.definition.stem.replace(/\s+/g, ' ').trim().slice(0, 80),
          fields: questionFields(record.definition),
          archived: record.archivedAt !== null,
        });
  }
  if (selected.includes('assessment')) {
    for (const record of await ctx.db.list('assessments', { ownerId }))
      if (matchesArchive(record, state))
        candidates.push({
          resourceType: 'assessment',
          id: record.id,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          revision: record.revision,
          topicId: record.topicId,
          title: record.title,
          fields: [record.title],
          archived: record.archivedAt !== null,
        });
  }

  const matches = candidates.filter((candidate) =>
    candidate.fields.some((field) => field.toLowerCase().includes(lowerQuery)),
  );
  const counts = Object.fromEntries(
    SEARCH_TYPES.map((type) => [
      type,
      matches.filter((candidate) => candidate.resourceType === type).length,
    ]),
  ) as Record<SearchResourceType, number>;
  const results: SearchResult[] = [...matches]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_RESULTS)
    .map((candidate) => ({
      id: candidate.id,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
      revision: candidate.revision,
      resourceType: candidate.resourceType,
      topicId: candidate.topicId,
      title: candidate.title,
      snippet: snippet(candidate.fields, lowerQuery),
      archived: candidate.archived,
    }));
  return { query: raw, counts, results };
}

export function registerSearchRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(`${API_PREFIX}/search`, async (request: FastifyRequest) => {
    const actor = await ctx.requireUser(request);
    return {
      data: await searchOwnedResources(ctx, actor.userId, query(request) as JsonObject),
    };
  });
}
