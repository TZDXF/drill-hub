import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import type { Answer, AttemptItemView } from '@drill-hub/contracts';
import { useAttemptAnswerValues } from '#learning-client/attemptAnswerValues';
import { useModelDiscoverySelection } from '#learning-client/modelDiscoverySelection';

describe('答题值读取', () => {
  it('按题目和答案类型读取，响应草稿更新并对缺失值使用空值', () => {
    const answers = ref<Record<string, Answer | null>>({ a: null });
    const values = useAttemptAnswerValues(answers);
    const item = { id: 'a' } as AttemptItemView;
    expect(values.radioOptionValue(item)).toBe('');
    expect(values.textValue(item)).toBe('');
    answers.value.a = { optionId: 'one' };
    expect(values.optionSelected(item, 'one')).toBe(true);
    expect(values.radioOptionValue(item)).toBe('one');
    answers.value.a = { optionIds: ['two'] };
    expect(values.multiSelected(item, 'two')).toBe(true);
    expect(values.optionSelected(item, 'two')).toBe(false);
    answers.value.a = { value: false };
    expect(values.boolSelected(item, false)).toBe(true);
    expect(values.radioBooleanValue(item)).toBe('false');
    answers.value.a = { slots: { first: '答案' } };
    expect(values.slotValue(item, 'first')).toBe('答案');
    expect(values.slotValue(item, 'missing')).toBe('');
    answers.value.a = { text: '正文' };
    expect(values.textValue(item)).toBe('正文');
  });
});

describe('模型发现选择', () => {
  it('仅批量切换当前筛选中尚未添加的模型，保留其他选择', () => {
    const existing = ref(new Set(['existing']));
    const state = useModelDiscoverySelection(existing);
    state.discoveredModels.value = [
      { modelKey: 'existing', displayName: 'Alpha existing' },
      { modelKey: 'a', displayName: 'Alpha one' },
      { modelKey: 'b', displayName: 'Beta' },
    ];
    state.toggleDiscovered('b');
    state.discoveryFilter.value = ' ALPHA ';
    expect(state.filteredDiscoveredModels.value).toHaveLength(2);
    state.toggleAllDiscovered();
    expect(state.selectedDiscoveredKeys.value).toEqual(['b', 'a']);
    expect(state.allFilteredDiscoveredSelected.value).toBe(true);
    state.toggleAllDiscovered();
    expect(state.selectedDiscoveredKeys.value).toEqual(['b']);
    existing.value = new Set(['existing', 'a']);
    expect(state.selectableDiscoveredModels.value).toEqual([]);
    expect(state.allFilteredDiscoveredSelected.value).toBe(false);
  });
});
