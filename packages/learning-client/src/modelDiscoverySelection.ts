import { computed, ref, type Ref } from 'vue';
import type { DiscoveredProviderModel } from '@drill-hub/contracts';

export function useModelDiscoverySelection(existingModelKeys: Ref<Set<string>>) {
  const discoveredModels = ref<DiscoveredProviderModel[]>([]);
  const selectedDiscoveredKeys = ref<string[]>([]);
  const discoveryFilter = ref('');
  const filteredDiscoveredModels = computed(() => {
    const query = discoveryFilter.value.trim().toLowerCase();
    if (!query) return discoveredModels.value;
    return discoveredModels.value.filter(
      (item) =>
        item.modelKey.toLowerCase().includes(query) ||
        (item.displayName ?? '').toLowerCase().includes(query),
    );
  });
  const selectableDiscoveredModels = computed(() =>
    filteredDiscoveredModels.value.filter((item) => !existingModelKeys.value.has(item.modelKey)),
  );
  const allFilteredDiscoveredSelected = computed(
    () =>
      selectableDiscoveredModels.value.length > 0 &&
      selectableDiscoveredModels.value.every((item) =>
        selectedDiscoveredKeys.value.includes(item.modelKey),
      ),
  );

  function toggleDiscovered(key: string) {
    selectedDiscoveredKeys.value = selectedDiscoveredKeys.value.includes(key)
      ? selectedDiscoveredKeys.value.filter((item) => item !== key)
      : [...selectedDiscoveredKeys.value, key];
  }
  function toggleAllDiscovered() {
    const keys = selectableDiscoveredModels.value.map((item) => item.modelKey);
    if (allFilteredDiscoveredSelected.value) {
      const remove = new Set(keys);
      selectedDiscoveredKeys.value = selectedDiscoveredKeys.value.filter((key) => !remove.has(key));
    } else {
      selectedDiscoveredKeys.value = [...new Set([...selectedDiscoveredKeys.value, ...keys])];
    }
  }
  return {
    discoveredModels,
    selectedDiscoveredKeys,
    discoveryFilter,
    filteredDiscoveredModels,
    selectableDiscoveredModels,
    allFilteredDiscoveredSelected,
    toggleDiscovered,
    toggleAllDiscovered,
  };
}
