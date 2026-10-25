<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'reka-ui';
import type { AssistantModelOption } from '@drill-hub/contracts';
import { useAssistant } from '#learning-client/assistant/store';
import AppIcon from '#learning-client/components/AppIcon.vue';

const { t } = useI18n();
const assistant = useAssistant();

const models = computed(() => assistant.state.models);

/** 按供应商（模型连接）分组，参照 pi-x 的对话模型菜单。 */
const groups = computed(() => {
  const map = new Map<string, AssistantModelOption[]>();
  for (const model of models.value) {
    const list = map.get(model.connectionName) ?? [];
    list.push(model);
    map.set(model.connectionName, list);
  }
  return [...map.entries()].map(([connectionName, items]) => ({ connectionName, items }));
});

const selected = computed(
  () => models.value.find((model) => model.id === assistant.state.selectedModelId) ?? null,
);

function formatPrice(model: AssistantModelOption): string {
  const cost = model.costPerMillion;
  if (!cost) return '';
  const money = (value: number): string =>
    value === 0
      ? '0'
      : value >= 1
        ? `$${Number(value.toFixed(2))}`
        : `$${Number(value.toFixed(4))}`;
  return t('components.assistant.modelPrice', {
    input: money(cost.input),
    output: money(cost.output),
  });
}

function formatContext(model: AssistantModelOption): string {
  if (!model.contextWindow) return '';
  const tokens = model.contextWindow;
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : String(tokens);
}
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger
      as-child
      :disabled="!models.length"
      :title="t('components.assistant.selectModel')"
    >
      <button class="assistant-model-select" type="button" data-testid="assistant-model-select">
        <AppIcon name="model" :size="14" />
        <span class="assistant-model-select__name">{{
          selected ? selected.displayName : t('components.assistant.autoModel')
        }}</span>
        <AppIcon name="down" :size="14" class="assistant-model-select__chevron" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        class="dropdown-content assistant-model-menu"
        side="top"
        align="start"
        :side-offset="8"
      >
        <DropdownMenuRadioGroup
          :model-value="assistant.state.selectedModelId"
          @update:model-value="assistant.selectModel(String($event))"
        >
          <DropdownMenuRadioItem value="" class="dropdown-item assistant-model-menu__item">
            <AppIcon name="assistant" :size="15" />
            <span class="assistant-model-menu__text">{{
              t('components.assistant.autoModel')
            }}</span>
          </DropdownMenuRadioItem>
          <template v-for="(group, index) in groups" :key="group.connectionName">
            <DropdownMenuSeparator v-if="index > 0" class="dropdown-separator" />
            <DropdownMenuLabel class="dropdown-label">{{ group.connectionName }}</DropdownMenuLabel>
            <DropdownMenuRadioItem
              v-for="model in group.items"
              :key="model.id"
              :value="model.id"
              class="dropdown-item assistant-model-menu__item"
              data-testid="assistant-model-option"
            >
              <AppIcon
                :name="model.id === assistant.state.selectedModelId ? 'check' : 'model'"
                :size="15"
              />
              <span class="assistant-model-menu__text">
                <span class="assistant-model-menu__name">{{ model.displayName }}</span>
                <span class="assistant-model-menu__meta">
                  <template v-if="formatContext(model)">{{ formatContext(model) }}</template>
                  <template v-if="formatPrice(model)">{{ formatPrice(model) }}</template>
                  <template v-if="model.reasoning">{{
                    t('components.assistant.reasoningTag')
                  }}</template>
                </span>
              </span>
            </DropdownMenuRadioItem>
          </template>
        </DropdownMenuRadioGroup>
        <p v-if="!models.length" class="assistant-model-menu__empty">
          {{ t('components.assistant.noModels') }}
        </p>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
