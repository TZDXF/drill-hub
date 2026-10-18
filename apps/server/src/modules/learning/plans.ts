import type { LearningPlan, LearningTask, PlanPhase, TaskKind } from '@drill-hub/contracts';
import { id } from '../../core/ids.js';
import type { Database } from '../../db/database.js';
import {
  assert,
  isRecord,
  optionalScheduledDate,
  positiveInteger,
  requiredString,
} from './common.js';

const TASK_KINDS = new Set<TaskKind>(['reading', 'practice', 'exam', 'manual']);

export interface TaskLocation {
  plan: LearningPlan;
  phase: PlanPhase;
  task: LearningTask;
}

export async function findTaskLocation(
  db: Database,
  ownerId: string,
  taskId: string,
): Promise<TaskLocation> {
  const plans = await db.list('plans', { ownerId });
  for (const plan of plans) {
    for (const phase of plan.phases) {
      const task = phase.tasks.find((candidate) => candidate.id === taskId);
      if (task) return { plan, phase, task };
    }
  }
  assert(false, 'NOT_FOUND', '计划任务不存在', 404);
}

async function validateTarget(
  db: Database,
  ownerId: string,
  topicId: string,
  kind: TaskKind,
  targetId: unknown,
  requireActive: boolean,
): Promise<string | null> {
  if (kind === 'manual') {
    assert(
      targetId === null || targetId === undefined,
      'INVALID_TASK_TARGET',
      '普通任务不能关联目标',
    );
    return null;
  }
  assert(
    typeof targetId === 'string' && targetId.length > 0,
    'INVALID_TASK_TARGET',
    '该任务类型必须关联目标',
  );
  if (kind === 'reading') {
    const content = await db.get('contents', targetId);
    assert(
      content && content.ownerId === ownerId && content.topicId === topicId,
      'INVALID_TASK_TARGET',
      '阅读目标不属于当前主题',
      422,
    );
    if (requireActive)
      assert(content.archivedAt === null, 'TARGET_ARCHIVED', '不能关联已归档内容', 409);
  } else {
    const assessment = await db.get('assessments', targetId);
    assert(
      assessment &&
        assessment.ownerId === ownerId &&
        assessment.topicId === topicId &&
        assessment.kind === kind,
      'INVALID_TASK_TARGET',
      '练习或考试目标不属于当前主题或类型不符',
      422,
    );
    if (requireActive)
      assert(assessment.archivedAt === null, 'TARGET_ARCHIVED', '不能关联已归档练习或考试', 409);
  }
  return targetId;
}

function estimatedMinutes(value: unknown, fallback: number | null): number | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  return positiveInteger(value, 'estimatedMinutes', 100000);
}

/** Normalize embedded phases while preserving existing task status and completion history. */
export async function normalizePhases(
  db: Database,
  ownerId: string,
  topicId: string,
  input: unknown,
  existingPlan?: LearningPlan,
): Promise<PlanPhase[]> {
  assert(
    Array.isArray(input) && input.length <= 100,
    'INVALID_PHASES',
    'phases 必须是数量受限的数组',
  );
  const existingPhases = new Map((existingPlan?.phases ?? []).map((phase) => [phase.id, phase]));
  const existingTasks = new Map(
    (existingPlan?.phases ?? []).flatMap((phase) => phase.tasks.map((task) => [task.id, task])),
  );
  const seenPhases = new Set<string>();
  const seenTasks = new Set<string>();
  const result: PlanPhase[] = [];

  for (const rawPhase of input) {
    assert(isRecord(rawPhase), 'INVALID_PHASE', '阶段格式无效');
    const phaseId = rawPhase.id === undefined ? id() : rawPhase.id;
    assert(
      typeof phaseId === 'string' && phaseId.length > 0 && !seenPhases.has(phaseId),
      'INVALID_PHASE',
      '阶段 ID 无效或重复',
    );
    if (rawPhase.id !== undefined)
      assert(existingPhases.has(phaseId), 'INVALID_PHASE', '不能复用未知阶段 ID');
    seenPhases.add(phaseId);
    const previousPhase = existingPhases.get(phaseId);
    const title =
      rawPhase.title === undefined && previousPhase
        ? previousPhase.title
        : requiredString(rawPhase, 'title', 500);
    if (rawPhase.tasks === undefined && previousPhase) {
      for (const task of previousPhase.tasks) seenTasks.add(task.id);
      result.push({ id: phaseId, title, tasks: previousPhase.tasks });
      continue;
    }
    const rawTasks = rawPhase.tasks ?? [];
    assert(
      Array.isArray(rawTasks) && rawTasks.length <= 500,
      'INVALID_TASKS',
      'tasks 必须是数量受限的数组',
    );
    const tasks: LearningTask[] = [];

    for (const rawTask of rawTasks) {
      assert(isRecord(rawTask), 'INVALID_TASK', '任务格式无效');
      const taskId = rawTask.id === undefined ? id() : rawTask.id;
      assert(
        typeof taskId === 'string' && taskId.length > 0 && !seenTasks.has(taskId),
        'INVALID_TASK',
        '任务 ID 无效或重复',
      );
      if (rawTask.id !== undefined)
        assert(existingTasks.has(taskId), 'INVALID_TASK', '不能复用未知任务 ID');
      seenTasks.add(taskId);
      const previous = existingTasks.get(taskId);
      if (!previous) {
        assert(
          rawTask.status === undefined || rawTask.status === 'todo',
          'INVALID_TASK_STATUS',
          '新任务只能以 todo 状态创建',
        );
        assert(
          rawTask.completedAt === undefined || rawTask.completedAt === null,
          'INVALID_TASK_STATUS',
          '新任务不能伪造完成时间',
        );
      }
      const taskTitle =
        rawTask.title === undefined && previous
          ? previous.title
          : requiredString(rawTask, 'title', 500);
      const kindValue = rawTask.kind === undefined && previous ? previous.kind : rawTask.kind;
      assert(
        typeof kindValue === 'string' && TASK_KINDS.has(kindValue as TaskKind),
        'INVALID_TASK_KIND',
        '任务类型无效',
      );
      const kind = kindValue as TaskKind;
      const targetInput =
        rawTask.targetId === undefined && previous ? previous.targetId : (rawTask.targetId ?? null);
      const targetChanged =
        !previous || previous.kind !== kind || previous.targetId !== targetInput;
      if (previous && targetChanged)
        assert(
          previous.status === 'todo',
          'TASK_HISTORY_REQUIRED',
          '已开始或已完成的任务不能更改类型或目标',
          409,
        );
      const targetId = await validateTarget(db, ownerId, topicId, kind, targetInput, targetChanged);
      const scheduledInput =
        rawTask.scheduledDate === undefined && previous
          ? previous.scheduledDate
          : rawTask.scheduledDate;
      const minutes = estimatedMinutes(
        rawTask.estimatedMinutes,
        previous?.estimatedMinutes ?? null,
      );
      tasks.push({
        id: taskId,
        title: taskTitle,
        kind,
        targetId,
        scheduledDate: optionalScheduledDate(scheduledInput),
        estimatedMinutes: minutes,
        status: previous?.status ?? 'todo',
        completedAt: previous?.completedAt ?? null,
      });
    }
    result.push({ id: phaseId, title, tasks });
  }

  if (existingPlan) {
    for (const task of existingTasks.values()) {
      if (!seenTasks.has(task.id)) {
        assert(
          task.status === 'todo',
          'TASK_HISTORY_REQUIRED',
          '已有学习记录的任务不能从计划中移除',
          409,
        );
      }
    }
  }
  return result;
}

export function replaceTask(
  plan: LearningPlan,
  taskId: string,
  replacement: LearningTask,
): PlanPhase[] {
  return plan.phases.map((phase) => ({
    ...phase,
    tasks: phase.tasks.map((task) => (task.id === taskId ? replacement : task)),
  }));
}
