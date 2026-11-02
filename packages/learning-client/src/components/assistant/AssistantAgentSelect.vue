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
import AppIcon from '#learning-client/components/AppIcon.vue';

const { t } = useI18n();
const assistant = useAssistant();

const agents = computed(() => assistant.state.agents);
const currentThread = computed(
  () =>
    assistant.state.threads.find((thread) => thread.id === assistant.state.currentThreadId) ?? null,
);
const activeId = computed(() => currentThread.value?.agentId ?? assistant.state.selectedAgentId);
const activeAgent = computed(
  () => agents.value.find((agent) => agent.id === activeId.value) ?? null,
);
function agentIcon(icon: string | null): string {
  return icon || '🤖';
}
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child :title="t('components.assistant.selectAgent')">
      <button class="assistant-model-select" type="button" data-testid="assistant-agent-select">
        <AppIcon v-if="!activeAgent" name="bot" :size="14" />
        <span v-else class="assistant-agent-select__icon">{{ agentIcon(activeAgent.icon) }}</span>
        <span class="assistant-model-select__name">{{
          activeAgent ? activeAgent.name : t('components.assistant.defaultAgent')
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
          :model-value="activeId"
          @update:model-value="assistant.selectThreadAgent(String($event))"
        >
          <DropdownMenuRadioItem
            value=""
            class="dropdown-item"
            data-testid="assistant-agent-default"
          >
            {{ t('components.assistant.defaultAgent') }}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            v-for="agent in agents"
            :key="agent.id"
            :value="agent.id"
            class="dropdown-item"
            data-testid="assistant-agent-option"
          >
            <span class="assistant-agent-menu__name"
              >{{ agentIcon(agent.icon) }} {{ agent.name }}</span
            >
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <p class="assistant-model-menu__empty">
          <RouterLink class="assistant-agent-menu__manage" :to="{ name: 'learning-agents' }">{{
            t('components.assistant.manageAgents')
          }}</RouterLink>
        </p>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
