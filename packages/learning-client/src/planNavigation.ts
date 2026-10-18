import type { LocationQuery } from 'vue-router';

export function planNavigationQuery(query: LocationQuery): { planId?: string } {
  const planId = query.planId;
  return typeof planId === 'string' && planId.trim() ? { planId } : {};
}

export function planReturnLocation(topicId: string, query: LocationQuery) {
  const { planId } = planNavigationQuery(query);
  return planId ? { name: 'plan', params: { topicId, planId } } : null;
}
