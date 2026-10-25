import { describe, expect, it } from 'vitest';
import type { LocationQuery } from 'vue-router';
import { planNavigationQuery, planReturnLocation } from '#learning-client/planNavigation';

describe('plan navigation', () => {
  it('builds a named return route using the resource topic and source plan', () => {
    expect(planReturnLocation('topic-1', { planId: 'plan-2' })).toEqual({
      name: 'plan',
      params: { topicId: 'topic-1', planId: 'plan-2' },
    });
  });

  it('only carries the plan source forward, not task or question parameters', () => {
    expect(planNavigationQuery({ planId: 'plan-2', taskId: 'task-1', question: '3' })).toEqual({
      planId: 'plan-2',
    });
  });

  it('ignores absent, empty or ambiguous plan sources', () => {
    const queries: LocationQuery[] = [
      {},
      { planId: null },
      { planId: '' },
      { planId: '  ' },
      { planId: ['plan-1', 'plan-2'] },
    ];
    for (const query of queries) {
      expect(planNavigationQuery(query)).toEqual({});
      expect(planReturnLocation('topic-1', query)).toBeNull();
    }
  });
});
