<script setup lang="ts">
import type { AttemptItemView } from '@drill-hub/contracts';
import { formatScore } from '../utils';
import AppIcon from './AppIcon.vue';

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
        <strong>{{ item.gradingStatus === 'running' ? '正在评分' : '等待评分' }}</strong>
        <p>答案已锁定，待评分不会按 0 分计算。</p>
      </div>
    </div>
    <div
      v-if="item.gradingStatus === 'failed'"
      class="notice notice--error"
      style="margin-top: 12px"
    >
      <AppIcon name="alert" />
      <div>
        <strong>本次评分未完成</strong>
        <p>这不是 0 分。已有有效成绩会被保留，请稍后查看报告。</p>
      </div>
    </div>
    <template v-if="item.grade">
      <p v-if="item.grade.source === 'system'" class="badge">系统判空 · 未作答</p>
      <div v-if="showScore" class="grade-feedback__summary">
        <span>本题得分</span>
        <strong
          >{{ formatScore(item.grade.score) }}
          <small>/ {{ formatScore(item.maxScore) }}</small></strong
        >
      </div>
      <p v-if="item.grade.feedback" class="feedback-text">{{ item.grade.feedback }}</p>
      <div v-if="item.grade.criterionResults.length" class="criterion-list">
        <article
          v-for="criterion in item.grade.criterionResults"
          :key="`${criterion.criterionId}-${item.grade.version}`"
          class="criterion-item"
        >
          <div class="criterion-item__heading">
            <div>
              <span class="meta-label">得分项：{{ criterion.criterionDescription }}</span
              ><strong>等级：{{ criterion.levelDescription }}</strong>
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
      <span class="meta-label">参考答案</span>
      <p>{{ item.referenceAnswer }}</p>
    </div>
    <p v-if="showReference && item.explanation" class="explanation">
      <strong>解析：</strong>{{ item.explanation }}
    </p>
  </section>
</template>
