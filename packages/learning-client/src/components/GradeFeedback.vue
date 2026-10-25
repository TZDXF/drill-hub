<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { AttemptItemView } from '@drill-hub/contracts';
import { formatScore } from '#learning-client/utils';
import AppIcon from '#learning-client/components/AppIcon.vue';

const { t } = useI18n();

withDefaults(
  defineProps<{
    item: AttemptItemView;
    showReference?: boolean;
    showScore?: boolean;
    voided?: boolean;
  }>(),
  {
    showScore: true,
  },
);
</script>

<template>
  <section class="grade-feedback" aria-live="polite">
    <div
      v-if="!voided && (item.gradingStatus === 'pending' || item.gradingStatus === 'running')"
      class="notice notice--pending"
    >
      <AppIcon name="clock" />
      <div>
        <strong>{{
          item.gradingStatus === 'running'
            ? t('components.gradeFeedback.grading')
            : t('components.gradeFeedback.waiting')
        }}</strong>
        <p>{{ t('components.gradeFeedback.pendingDescription') }}</p>
      </div>
    </div>
    <div
      v-if="item.gradingStatus === 'failed'"
      class="notice notice--error"
      style="margin-top: 12px"
    >
      <AppIcon name="alert" />
      <div>
        <strong>{{ t('components.gradeFeedback.failedTitle') }}</strong>
        <p>{{ t('components.gradeFeedback.failedDescription') }}</p>
      </div>
    </div>
    <template v-if="item.grade">
      <p v-if="item.grade.source === 'system'" class="badge">
        {{ t('components.gradeFeedback.systemEmpty') }}
      </p>
      <div v-if="showScore" class="grade-feedback__summary">
        <span>{{ t('components.gradeFeedback.scoreLabel') }}</span>
        <strong
          >{{ formatScore(item.grade.score) }}
          <small>/ {{ formatScore(item.maxScore) }}</small></strong
        >
      </div>
      <p
        v-if="item.grade.feedback && !['回答正确', '回答错误'].includes(item.grade.feedback)"
        class="feedback-text"
      >
        {{ item.grade.feedback }}
      </p>
      <div v-if="item.grade.criterionResults.length" class="criterion-list">
        <article
          v-for="criterion in item.grade.criterionResults"
          :key="`${criterion.criterionId}-${item.grade.version}`"
          class="criterion-item"
        >
          <div class="criterion-item__heading">
            <div>
              <span class="meta-label">{{
                t('components.gradeFeedback.criterionLabel', {
                  criterion: criterion.criterionDescription,
                })
              }}</span
              ><strong>{{
                t('components.gradeFeedback.levelLabel', { level: criterion.levelDescription })
              }}</strong>
            </div>
            <b>{{ formatScore(criterion.score) }} / {{ formatScore(criterion.maxScore) }}</b>
          </div>
          <p>{{ criterion.explanation }}</p>
          <blockquote v-for="evidence in criterion.evidence" :key="evidence">
            {{ evidence }}
          </blockquote>
        </article>
      </div>
    </template>
    <div v-if="showReference && item.referenceAnswer" class="reference-answer">
      <span class="meta-label">{{ t('components.gradeFeedback.referenceAnswer') }}</span>
      <p>{{ item.referenceAnswer }}</p>
    </div>
    <p v-if="showReference && item.explanation" class="explanation">
      <strong>{{ t('components.gradeFeedback.explanationLabel') }}</strong
      >{{ item.explanation }}
    </p>
  </section>
</template>
