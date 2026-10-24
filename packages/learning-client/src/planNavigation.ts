import type { LocationQuery, RouteLocationRaw } from 'vue-router';
import type { LearningTask } from '@drill-hub/contracts';

export function planNavigationQuery(query: LocationQuery): { planId?: string } {
  const planId = query.planId;
  return typeof planId === 'string' && planId.trim() ? { planId } : {};
}

export function planReturnLocation(topicId: string, query: LocationQuery) {
  const { planId } = planNavigationQuery(query);
  return planId ? { name: 'plan', params: { topicId, planId } } : null;
}

export function planTaskLocation(planId: string, task: LearningTask): RouteLocationRaw | null {
  if (!task.targetId) return null;
  const query = { taskId: task.id, planId };
  if (task.kind === 'reading')
    return { name: 'content', params: { contentId: task.targetId }, query };
  if (task.kind === 'practice' || task.kind === 'exam')
    return { name: 'assessment', params: { assessmentId: task.targetId }, query };
  return null;
}
