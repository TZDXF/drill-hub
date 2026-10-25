<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from 'reka-ui';
import { useAssistant } from '#learning-client/assistant/store';

const { t } = useI18n();
const assistant = useAssistant();

const models = computed(() => assistant.state.models);

const selected = computed(
  () => models.value.find((model) => model.id === assistant.state.selectedModelId) ?? null,
);
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger
      as-child
      :disabled="!models.length"
      :title="t('components.assistant.selectModel')"
    >
      <button class="assistant-model-select" type="button" data-testid="assistant-model-select">
        <span class="assistant-model-select__name">{{
          selected ? selected.displayName : t('components.assistant.autoModel')
        }}</span>
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
          <DropdownMenuRadioItem value="" class="dropdown-item">
            {{ t('components.assistant.autoModel') }}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            v-for="model in models"
            :key="model.id"
            :value="model.id"
            class="dropdown-item"
            data-testid="assistant-model-option"
          >
            <span class="assistant-model-menu__name">{{ model.displayName }}</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <p v-if="!models.length" class="assistant-model-menu__empty">
          {{ t('components.assistant.noModels') }}
        </p>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
