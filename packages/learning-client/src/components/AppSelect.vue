<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import {
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
  SelectContent,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from 'reka-ui';
import AppIcon from './AppIcon.vue';

const { t } = useI18n();

defineOptions({ inheritAttrs: false });

export interface AppSelectItem {
  value: string;
  label: string;
}

withDefaults(
  defineProps<{
    id: string;
    items: readonly AppSelectItem[];
    placeholder?: string;
    disabled?: boolean;
  }>(),
  {},
);

const model = defineModel<string>({ required: true });
</script>

<template>
  <SelectRoot v-model="model" :disabled="disabled">
    <SelectTrigger :id="id" v-bind="$attrs" class="select">
      <SelectValue :placeholder="placeholder ?? t('components.select.placeholder')" />
      <SelectIcon class="select__icon"><AppIcon name="down" :size="16" /></SelectIcon>
    </SelectTrigger>
    <SelectPortal>
      <SelectContent class="select-content" position="popper" :side-offset="5">
        <ScrollAreaRoot class="select-scroll" type="auto">
          <SelectViewport as-child>
            <ScrollAreaViewport class="select-scroll__viewport" tabindex="0">
              <SelectItem
                v-for="item in items"
                :key="item.value"
                class="select-item"
                :value="item.value"
              >
                <SelectItemText>{{ item.label }}</SelectItemText>
                <SelectItemIndicator class="select-item__indicator">
                  <AppIcon name="check" :size="14" />
                </SelectItemIndicator>
              </SelectItem>
            </ScrollAreaViewport>
          </SelectViewport>
          <ScrollAreaScrollbar class="app-scroll-area__scrollbar" orientation="vertical">
            <ScrollAreaThumb class="app-scroll-area__thumb" />
          </ScrollAreaScrollbar>
        </ScrollAreaRoot>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
