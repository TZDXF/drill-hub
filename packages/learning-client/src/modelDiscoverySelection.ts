import { computed, ref, type Ref } from 'vue';
import type { DiscoveredProviderModel } from '@drill-hub/contracts';
import { createListSearch } from '#learning-client/search';

export function useModelDiscoverySelection(existingModelKeys: Ref<Set<string>>) {
  const discoveredModels = ref<DiscoveredProviderModel[]>([]);
  const selectedDiscoveredKeys = ref<string[]>([]);
  const discoveryFilter = ref('');
  const search = computed(() =>
    createListSearch(discoveredModels.value, ['modelKey', 'displayName']),
  );
  const discoveryResults = computed(() =>
    discoveryFilter.value.trim()
      ? search.value.search(discoveryFilter.value.trim())
      : discoveredModels.value.map((item, refIndex) => ({ item, refIndex, matches: undefined })),
  );
  const filteredDiscoveredModels = computed(() => discoveryResults.value.map(({ item }) => item));
  const discoveryMatches = computed(
    () => new Map(discoveryResults.value.map(({ item, matches }) => [item.modelKey, matches])),
  );
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
    discoveryMatches,
    selectableDiscoveredModels,
    allFilteredDiscoveredSelected,
    toggleDiscovered,
    toggleAllDiscovered,
  };
}
