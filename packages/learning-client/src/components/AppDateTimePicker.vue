<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed } from 'vue';
import { CalendarDateTime, parseDateTime, type DateValue } from '@internationalized/date';
import {
  DatePickerAnchor,
  DatePickerCalendar,
  DatePickerCell,
  DatePickerCellTrigger,
  DatePickerContent,
  DatePickerField,
  DatePickerGrid,
  DatePickerGridBody,
  DatePickerGridHead,
  DatePickerGridRow,
  DatePickerHeadCell,
  DatePickerHeader,
  DatePickerHeading,
  DatePickerInput,
  DatePickerNext,
  DatePickerPrev,
  DatePickerRoot,
  DatePickerTrigger,
} from 'reka-ui';
import AppIcon from '#learning-client/components/AppIcon.vue';

const { t, locale } = useI18n();

const props = defineProps<{ id: string; labelledBy: string; disabled?: boolean }>();
const model = defineModel<string>({ required: true });
const dateValue = computed({
  get: () => (model.value ? parseDateTime(model.value) : null),
  set: (value: DateValue | null | undefined) => {
    model.value = value?.toString() ?? '';
  },
});
const now = new Date();
const placeholder = new CalendarDateTime(now.getFullYear(), now.getMonth() + 1, now.getDate());
</script>

<template>
  <DatePickerRoot
    :id="props.id"
    v-model="dateValue"
    :disabled="disabled"
    :default-placeholder="placeholder"
    :locale="locale"
    granularity="minute"
    :hour-cycle="24"
    :week-starts-on="1"
    close-on-select
  >
    <DatePickerAnchor as-child>
      <div class="date-time-picker">
        <DatePickerField
          v-slot="{ segments }"
          class="input date-time-picker-field"
          :aria-labelledby="labelledBy"
        >
          <div class="date-time-picker-segments">
            <template v-for="segment in segments" :key="segment.part">
              <span v-if="segment.part === 'literal'" class="date-time-picker-literal">{{
                segment.value
              }}</span>
              <DatePickerInput v-else :part="segment.part" class="date-time-picker-segment">
                {{ segment.value }}
              </DatePickerInput>
            </template>
          </div>
          <DatePickerTrigger
            class="icon-button"
            type="button"
            :aria-label="t('components.dateTime.triggerLabel')"
          >
            <AppIcon name="topics" :size="18" />
          </DatePickerTrigger>
        </DatePickerField>
        <button
          v-if="model"
          class="icon-button"
          type="button"
          :aria-label="t('components.dateTime.clearLabel')"
          :disabled="disabled"
          @click="model = ''"
        >
          <AppIcon name="close" :size="16" />
        </button>
      </div>
    </DatePickerAnchor>
    <DatePickerContent
      class="date-time-picker-content"
      :side-offset="6"
      :collision-padding="12"
      align="start"
      :aria-label="t('components.dateTime.triggerLabel')"
    >
      <DatePickerCalendar v-slot="{ grid, weekDays }">
        <DatePickerHeader class="date-time-picker-header">
          <DatePickerPrev class="icon-button" :aria-label="t('components.dateTime.previousMonth')">
            <AppIcon name="back" :size="16" />
          </DatePickerPrev>
          <DatePickerHeading class="date-time-picker-heading" />
          <DatePickerNext class="icon-button" :aria-label="t('components.dateTime.nextMonth')">
            <AppIcon name="arrow" :size="16" />
          </DatePickerNext>
        </DatePickerHeader>
        <DatePickerGrid
          v-for="month in grid"
          :key="month.value.toString()"
          class="date-time-picker-grid"
        >
          <DatePickerGridHead>
            <DatePickerGridRow>
              <DatePickerHeadCell
                v-for="day in weekDays"
                :key="day"
                class="date-time-picker-weekday"
              >
                {{ day }}
              </DatePickerHeadCell>
            </DatePickerGridRow>
          </DatePickerGridHead>
          <DatePickerGridBody>
            <DatePickerGridRow v-for="(week, index) in month.rows" :key="index">
              <DatePickerCell v-for="day in week" :key="day.toString()" :date="day">
                <DatePickerCellTrigger
                  :day="day"
                  :month="month.value"
                  class="date-time-picker-day"
                />
              </DatePickerCell>
            </DatePickerGridRow>
          </DatePickerGridBody>
        </DatePickerGrid>
      </DatePickerCalendar>
    </DatePickerContent>
  </DatePickerRoot>
</template>

<style>
.date-time-picker {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.date-time-picker-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  min-width: 0;
  padding: 4px 6px 4px 10px;
}
.date-time-picker-field:focus-within {
  border-color: var(--teal);
  box-shadow: 0 0 0 3px rgb(14 80 72 / 10%);
}
.date-time-picker-field[data-disabled] {
  opacity: 0.6;
}
.date-time-picker-segments {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  font-variant-numeric: tabular-nums;
}
.date-time-picker-segment {
  padding: 2px;
  border-radius: 3px;
  outline: none;
}
.date-time-picker-segment:focus {
  background: var(--teal);
  color: white;
}
.date-time-picker-segment[data-placeholder] {
  color: var(--ink-faint);
}
.date-time-picker-literal {
  white-space: pre;
  color: var(--ink-soft);
}
.date-time-picker-content {
  z-index: 90;
  max-width: calc(100vw - 32px);
  padding: 12px;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  background: var(--paper);
  box-shadow: 0 12px 36px rgb(27 41 35 / 16%);
}
.date-time-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.date-time-picker-heading {
  font-size: 14px;
  font-weight: 650;
}
.date-time-picker-grid {
  width: 100%;
  border-collapse: collapse;
}
.date-time-picker-weekday {
  color: var(--ink-faint);
  font-size: 12px;
  font-weight: 500;
}
.date-time-picker-day {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ink);
  font-size: 13px;
  cursor: pointer;
}
.date-time-picker-day:hover,
.date-time-picker-day:focus-visible {
  outline: 2px solid var(--teal);
  outline-offset: -2px;
  background: var(--teal-soft);
}
.date-time-picker-day[data-outside-view] {
  color: var(--ink-faint);
}
.date-time-picker-day[data-today] {
  font-weight: 750;
  text-decoration: underline;
  text-underline-offset: 4px;
}
.date-time-picker-day[data-selected] {
  background: var(--teal);
  color: white;
}
</style>
