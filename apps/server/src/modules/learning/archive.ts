import type { Actor, AppContext } from '../../core/context.js';
import { now } from '../../core/ids.js';
import type { Database } from '../../db/database.js';
import type { DatabaseTables } from '../../db/records.js';
import { assert, checkRevision, expectedRevision, owned, type JsonObject } from './common.js';

export const archiveTables = {
  topic: 'topics',
  plan: 'plans',
  content: 'contents',
  question: 'questions',
  assessment: 'assessments',
} as const;
export type ArchiveResourceType = keyof typeof archiveTables;
export type ArchiveTableName = (typeof archiveTables)[ArchiveResourceType];

export interface ArchiveMetadata {
  resourceType: ArchiveResourceType;
  id: string;
  title: string;
  archivedAt: string;
  revision: number;
}

export function archiveTable(value: string): ArchiveTableName {
  assert(Object.hasOwn(archiveTables, value), 'INVALID_RESOURCE_TYPE', '归档资源类型无效', 400);
  return archiveTables[value as ArchiveResourceType];
}

export async function changeArchiveState(
  ctx: AppContext,
  actor: Actor,
  resourceType: string,
  resourceId: string,
  archived: boolean,
  input: JsonObject,
): Promise<DatabaseTables[ArchiveTableName]> {
  const table = archiveTable(resourceType);
  const revision = input.expectedRevision === undefined ? undefined : expectedRevision(input);
  return ctx.db.transaction(async (tx) => {
    const record = await owned(tx, table, resourceId, actor.userId);
    if (revision !== undefined) checkRevision(record, revision);
    if ((record.archivedAt !== null) === archived) return record;
    const saved = await tx.update(table, record.id, record.revision, {
      archivedAt: archived ? now() : null,
    });
    await ctx.audit(
      actor,
      archived ? 'resource.archive' : 'resource.restore',
      resourceType,
      record.id,
      {},
      tx,
    );
    return saved;
  });
}

export async function listArchive(
  db: Database,
  ownerId: string,
  resourceTypeFilter?: unknown,
): Promise<ArchiveMetadata[]> {
  const result: ArchiveMetadata[] = [];
  let resourceTypes = Object.keys(archiveTables) as ArchiveResourceType[];
  if (resourceTypeFilter !== undefined) {
    assert(
      typeof resourceTypeFilter === 'string',
      'INVALID_RESOURCE_TYPE',
      '归档资源类型无效',
      400,
    );
    archiveTable(resourceTypeFilter);
    resourceTypes = [resourceTypeFilter as ArchiveResourceType];
  }
  for (const resourceType of resourceTypes) {
    const table = archiveTables[resourceType];
    const records = await db.list(table, { ownerId });
    for (const record of records) {
      if (record.archivedAt === null) continue;
      const title =
        'definition' in record && record.definition && typeof record.definition === 'object'
          ? ((record.definition as { stem?: string }).stem ?? record.id)
          : 'title' in record && typeof record.title === 'string'
            ? record.title
            : record.id;
      result.push({
        resourceType,
        id: record.id,
        title,
        archivedAt: record.archivedAt,
        revision: record.revision,
      });
    }
  }
  return result.sort((left, right) => right.archivedAt.localeCompare(left.archivedAt));
}
