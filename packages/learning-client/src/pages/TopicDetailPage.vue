<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui';
import type {
  AnswerLinkListItem,
  Assessment,
  Content,
  LearningPlan,
  PurgePreview,
  Topic,
} from '@drill-hub/contracts';
import { useLearning } from '#learning-client/injection';
import { errorMessage, formatDate, formatDuration, formatScore } from '#learning-client/utils';
import PageHeader from '#learning-client/components/PageHeader.vue';
import AppIcon from '#learning-client/components/AppIcon.vue';
import EmptyState from '#learning-client/components/EmptyState.vue';
import ConfirmDialog from '#learning-client/components/ConfirmDialog.vue';

const { t, n } = useI18n();
const learning = useLearning();
const route = useRoute();
const router = useRouter();
const topic = ref<Topic | null>(null);
const plans = ref<LearningPlan[]>([]);
const contents = ref<Content[]>([]);
const assessments = ref<Assessment[]>([]);
const loading = ref(true);
const error = ref('');
const topicId = computed(() => String(route.params.topicId));
const practices = computed(() => assessments.value.filter((item) => item.kind === 'practice'));
const exams = computed(() => assessments.value.filter((item) => item.kind === 'exam'));
const answerLinks = ref<AnswerLinkListItem[]>([]);
const purgePreview = ref<PurgePreview | null>(null);
const purgeOpen = ref(false);
const purgeBusy = ref(false);
const purgeLoading = ref(false);
const purgeConfirmation = ref('');
const purgeError = ref('');
const purgeConfirmInput = ref<HTMLInputElement | null>(null);
const purgeConfirmed = computed(() => purgeConfirmation.value === purgePreview.value?.topic.title);
const revokeTarget = ref<AnswerLinkListItem | null>(null);
const revokeBusy = ref(false);
const compactLayoutQuery =
  typeof window === 'undefined'
    ? null
    : window.matchMedia('(max-width: 900px), (hover: none) and (pointer: coarse)');
const compactCategories = ref(
  learning.platform.kind === 'android' || (compactLayoutQuery?.matches ?? false),
);
function syncCompactCategories() {
  compactCategories.value =
    learning.platform.kind === 'android' || (compactLayoutQuery?.matches ?? false);
}
const categories = computed(() => [
  {
    value: 'plans',
    label: t('learning.topicDetail.categories.plans'),
    icon: 'plan',
    count: plans.value.length,
    unit: t('learning.topicDetail.units.plans'),
  },
  {
    value: 'contents',
    label: t('learning.topicDetail.categories.contents'),
    icon: 'content',
    count: contents.value.length,
    unit: t('learning.topicDetail.units.contents'),
  },
  {
    value: 'practices',
    label: t('learning.topicDetail.categories.practices'),
    icon: 'wrong',
    count: practices.value.length,
    unit: t('learning.topicDetail.units.practices'),
  },
  {
    value: 'exams',
    label: t('learning.topicDetail.categories.exams'),
    icon: 'lock',
    count: exams.value.length,
    unit: t('learning.topicDetail.units.exams'),
  },
]);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [topicResult, planResult, contentResult, assessmentResult] = await Promise.all([
      learning.get<Topic>(`/topics/${topicId.value}`),
      learning.get<LearningPlan[]>(`/topics/${topicId.value}/plans?archiveState=active`),
      learning.get<Content[]>(`/topics/${topicId.value}/contents?archiveState=active`),
      learning.get<Assessment[]>(`/topics/${topicId.value}/assessments?archiveState=active`),
    ]);
    topic.value = topicResult;
    plans.value = planResult;
    contents.value = contentResult;
    assessments.value = assessmentResult;
    void loadAnswerLinks();
  } catch (reason) {
    error.value = errorMessage(reason);
    learning.notify.error(t('learning.topicDetail.loadFailed'), error.value);
  } finally {
    loading.value = false;
  }
}
function totalScore(assessment: Assessment) {
  return assessment.items.reduce((sum, item) => sum + Number(item.maxScore), 0).toString();
}
async function loadAnswerLinks() {
  try {
    const all = await learning.get<AnswerLinkListItem[]>('/me/answer-links');
    answerLinks.value = all.filter((link) => link.topicId === topicId.value);
  } catch {
    // 链接管理是辅助信息，加载失败不打断主题页。
    answerLinks.value = [];
  }
}
function linkStatusClass(link: AnswerLinkListItem) {
  return link.status === 'active' ? 'badge--green' : 'badge';
}
function linkStatusLabel(link: AnswerLinkListItem) {
  const key =
    link.status === 'active' ? 'Active' : link.status === 'expired' ? 'Expired' : 'Revoked';
  return t(`learning.topicDetail.answerLinks.status${key}`);
}
async function openPurge() {
  purgeLoading.value = true;
  purgeError.value = '';
  try {
    purgePreview.value = await learning.get<PurgePreview>(`/topics/${topicId.value}/purge-preview`);
    purgeConfirmation.value = '';
    purgeOpen.value = true;
    await nextTick();
    purgeConfirmInput.value?.focus();
  } catch (reason) {
    learning.notify.error(t('learning.topicDetail.purge.failed'), errorMessage(reason));
  } finally {
    purgeLoading.value = false;
  }
}
function closePurge(open: boolean) {
  purgeOpen.value = open;
  if (!open) {
    purgeConfirmation.value = '';
    purgeError.value = '';
  }
}
async function purge() {
  if (!purgePreview.value || !purgeConfirmed.value) return;
  purgeBusy.value = true;
  purgeError.value = '';
  try {
    await learning.del(`/topics/${topicId.value}`, {
      expectedRevision: purgePreview.value.topic.revision,
    });
    learning.notify.success(t('learning.topicDetail.purge.deleted'));
    purgeOpen.value = false;
    await router.replace({ name: 'topics' });
  } catch (reason) {
    purgeError.value = errorMessage(reason);
  } finally {
    purgeBusy.value = false;
  }
}
async function revokeLink() {
  if (!revokeTarget.value) return;
  revokeBusy.value = true;
  try {
    await learning.post(`/me/answer-links/${revokeTarget.value.id}/revoke`, {});
    learning.notify.success(t('learning.topicDetail.answerLinks.revoked'));
    revokeTarget.value = null;
    await loadAnswerLinks();
  } catch (reason) {
    learning.notify.error(t('learning.topicDetail.answerLinks.revokeFailed'), errorMessage(reason));
  } finally {
    revokeBusy.value = false;
  }
}
onMounted(() => {
  syncCompactCategories();
  compactLayoutQuery?.addEventListener('change', syncCompactCategories);
  void load();
});
onBeforeUnmount(() => compactLayoutQuery?.removeEventListener('change', syncCompactCategories));
watch(topicId, load);
</script>

<template>
  <div>
    <div v-if="loading" class="loading-block">
      <span class="spinner" />{{ t('learning.topicDetail.loading') }}
    </div>
    <EmptyState
      v-else-if="error"
      icon="alert"
      :title="t('learning.topicDetail.loadFailed')"
      :description="t('learning.common.networkHint')"
      ><button class="button button--small" type="button" @click="load">
        {{ t('learning.common.retry') }}
      </button></EmptyState
    >
    <template v-else-if="topic">
      <PageHeader :title="topic.title" eyebrow="LEARNING TOPIC" :description="topic.goalText">
        <template #back
          ><RouterLink class="back-link" :to="{ name: 'topics' }"
            ><AppIcon name="back" :size="16" />{{
              t('learning.topicDetail.backToTopics')
            }}</RouterLink
          ></template
        >
      </PageHeader>
      <div v-if="topic.archivedAt" class="notice notice--pending" style="margin-bottom: 18px">
        <AppIcon name="archive" />
        <div>
          <strong>{{ t('learning.topicDetail.archivedTitle') }}</strong>
          <p>{{ t('learning.topicDetail.archivedDescription') }}</p>
        </div>
      </div>
      <TabsRoot default-value="plans">
        <TabsList
          class="tabs-list topic-categories"
          :class="{ 'topic-categories--compact': compactCategories }"
          :aria-label="t('learning.topicDetail.categoriesLabel')"
        >
          <TabsTrigger
            v-for="category in categories"
            :key="category.value"
            class="tabs-trigger topic-category"
            :value="category.value"
          >
            <span class="topic-category__icon"><AppIcon :name="category.icon" :size="18" /></span>
            <span class="topic-category__label">{{ category.label }}</span>
            <span class="badge topic-category__count">
              {{ category.count }}<span class="topic-category__unit"> {{ category.unit }}</span>
            </span>
          </TabsTrigger>
        </TabsList>
        <TabsContent class="tabs-content" value="plans">
          <div v-if="plans.length" class="list-stack">
            <RouterLink
              v-for="plan in plans"
              :key="plan.id"
              class="card list-card"
              :to="{ name: 'plan', params: { topicId: topic.id, planId: plan.id } }"
            >
              <span class="list-card__icon"><AppIcon name="plan" /></span>
              <div class="list-card__body">
                <h3>{{ plan.title }}</h3>
                <p>
                  {{
                    t('learning.topicDetail.planSummary', {
                      phases: n(plan.phases.length),
                      tasks: n(plan.phases.reduce((sum, phase) => sum + phase.tasks.length, 0)),
                    })
                  }}
                </p>
                <div class="list-card__meta">
                  <span>{{
                    t('learning.common.updatedAt', { date: formatDate(plan.updatedAt) })
                  }}</span>
                </div>
              </div>
              <AppIcon name="chevron" :size="18" class="subtle" />
            </RouterLink>
          </div>
          <EmptyState
            v-else
            :title="t('learning.topicDetail.emptyPlansTitle')"
            :description="t('learning.topicDetail.emptyPlansDescription')"
          />
        </TabsContent>
        <TabsContent class="tabs-content" value="contents">
          <div v-if="contents.length" class="list-stack">
            <RouterLink
              v-for="content in contents"
              :key="content.id"
              class="card list-card"
              :to="{ name: 'content', params: { contentId: content.id } }"
            >
              <span class="list-card__icon"><AppIcon name="content" /></span>
              <div class="list-card__body">
                <h3>{{ content.title }}</h3>
                <p>{{ t('learning.topicDetail.contentKind') }}</p>
                <div class="list-card__meta">
                  <span>{{
                    t('learning.common.updatedAt', { date: formatDate(content.updatedAt) })
                  }}</span>
                </div>
              </div>
              <AppIcon name="chevron" :size="18" class="subtle" />
            </RouterLink>
          </div>
          <EmptyState
            v-else
            :title="t('learning.topicDetail.emptyContentsTitle')"
            :description="t('learning.topicDetail.emptyContentsDescription')"
          />
        </TabsContent>
        <TabsContent
          v-for="kind in ['practices', 'exams']"
          :key="kind"
          class="tabs-content"
          :value="kind"
        >
          <div v-if="(kind === 'practices' ? practices : exams).length" class="list-stack">
            <RouterLink
              v-for="assessment in kind === 'practices' ? practices : exams"
              :key="assessment.id"
              class="card list-card"
              :to="{ name: 'assessment', params: { assessmentId: assessment.id } }"
            >
              <span class="list-card__icon"
                ><AppIcon :name="kind === 'exams' ? 'lock' : 'wrong'"
              /></span>
              <div class="list-card__body">
                <h3>{{ assessment.title }}</h3>
                <div class="list-card__meta">
                  <span>{{
                    t('learning.common.questionCount', { count: n(assessment.items.length) })
                  }}</span
                  ><span>{{
                    t('learning.topicDetail.fullScore', {
                      score: formatScore(totalScore(assessment)),
                    })
                  }}</span
                  ><span>{{ formatDuration(assessment.durationSeconds) }}</span>
                </div>
              </div>
              <span class="badge" :class="kind === 'exams' ? 'badge--amber' : 'badge--teal'">{{
                kind === 'exams' ? t('learning.common.exam') : t('learning.common.practice')
              }}</span
              ><AppIcon name="chevron" :size="18" class="subtle" />
            </RouterLink>
          </div>
          <EmptyState
            v-else
            :title="
              kind === 'exams'
                ? t('learning.topicDetail.emptyExamsTitle')
                : t('learning.topicDetail.emptyPracticesTitle')
            "
            :description="t('learning.topicDetail.emptyAssessmentsDescription')"
          />
        </TabsContent>
      </TabsRoot>
      <section v-if="answerLinks.length" class="card topic-links" aria-labelledby="links-title">
        <div class="settings-card__heading">
          <span class="list-card__icon"><AppIcon name="link" /></span>
          <h2 id="links-title">{{ t('learning.topicDetail.answerLinks.title') }}</h2>
        </div>
        <p class="muted small">{{ t('learning.topicDetail.answerLinks.description') }}</p>
        <div class="list-stack">
          <article v-for="link in answerLinks" :key="link.id" class="task-row">
            <div class="task-row__body">
              <strong>
                {{ link.assessmentTitle }}
                <span class="badge" :class="linkStatusClass(link)">{{
                  linkStatusLabel(link)
                }}</span>
              </strong>
              <span>{{
                t('learning.topicDetail.answerLinks.expiresAt', {
                  date: formatDate(link.expiresAt),
                })
              }}</span>
            </div>
            <button
              v-if="link.status === 'active'"
              class="button button--small button--danger"
              type="button"
              @click="revokeTarget = link"
            >
              {{ t('learning.topicDetail.answerLinks.revoke') }}
            </button>
          </article>
        </div>
      </section>
      <section class="card topic-danger-zone" aria-labelledby="purge-title">
        <div class="topic-danger-zone__header">
          <span class="topic-danger-zone__icon"><AppIcon name="alert" /></span>
          <div class="topic-danger-zone__heading">
            <div>
              <span class="topic-danger-zone__eyebrow">{{
                t('learning.topicDetail.purge.eyebrow')
              }}</span>
              <h2 id="purge-title">{{ t('learning.topicDetail.purge.title') }}</h2>
            </div>
            <span class="badge badge--red">{{ t('learning.topicDetail.purge.irreversible') }}</span>
          </div>
        </div>
        <p class="topic-danger-zone__description">
          {{ t('learning.topicDetail.purge.description') }}
        </p>
        <div class="topic-danger-zone__actions">
          <RouterLink
            class="button"
            :to="{ name: 'settings', query: { focus: 'export' } }"
            data-testid="topic-export"
          >
            <AppIcon name="download" :size="16" />
            {{ t('learning.topicDetail.purge.exportFirst') }}
          </RouterLink>
          <button
            class="button button--danger"
            type="button"
            data-testid="topic-purge"
            :disabled="purgeLoading"
            @click="openPurge"
          >
            <span v-if="purgeLoading" class="spinner" /><AppIcon v-else name="trash" :size="16" />
            {{
              purgeLoading
                ? t('learning.topicDetail.purge.loading')
                : t('learning.topicDetail.purge.action')
            }}
          </button>
        </div>
      </section>
    </template>
    <ConfirmDialog
      :open="purgeOpen"
      class="topic-purge-dialog"
      :title="t('learning.topicDetail.purge.dialogTitle')"
      :description="t('learning.topicDetail.purge.dialogDescription')"
      :confirm-label="t('learning.topicDetail.purge.confirm')"
      :confirm-disabled="!purgeConfirmed"
      danger
      :busy="purgeBusy"
      @update:open="closePurge"
      @confirm="purge"
    >
      <div v-if="purgePreview" class="purge-dialog-content">
        <div class="purge-topic">
          <span>{{ t('learning.topicDetail.purge.topicLabel') }}</span>
          <strong>{{ purgePreview.topic.title }}</strong>
        </div>
        <div class="notice notice--error purge-warning">
          <AppIcon name="alert" />
          <div>
            <strong>{{ t('learning.topicDetail.purge.warningTitle') }}</strong>
            <p>{{ t('learning.topicDetail.purge.warningDescription') }}</p>
          </div>
        </div>
        <section class="purge-impact" aria-labelledby="purge-impact-title">
          <div class="purge-impact__heading">
            <strong id="purge-impact-title">{{ t('learning.topicDetail.purge.impact') }}</strong>
            <span>{{
              t('learning.topicDetail.purge.total', { count: n(purgePreview.total) })
            }}</span>
          </div>
          <ul class="purge-counts">
            <li v-for="(value, key) in purgePreview.counts" :key="key">
              <span>{{ t(`learning.topicDetail.purge.counts.${key}`) }}</span>
              <strong>{{ n(value) }}</strong>
            </li>
          </ul>
          <p v-if="purgePreview.total === 0" class="muted small">
            {{ t('learning.topicDetail.purge.nothing') }}
          </p>
        </section>
        <div class="purge-confirmation">
          <label for="purge-confirmation-input">
            {{ t('learning.topicDetail.purge.confirmationLabel') }}
          </label>
          <p>{{ t('learning.topicDetail.purge.confirmationHint') }}</p>
          <code>{{ purgePreview.topic.title }}</code>
          <input
            id="purge-confirmation-input"
            ref="purgeConfirmInput"
            v-model="purgeConfirmation"
            class="input"
            type="text"
            autocomplete="off"
            spellcheck="false"
            :placeholder="t('learning.topicDetail.purge.confirmationPlaceholder')"
            :disabled="purgeBusy"
            data-testid="topic-purge-confirmation"
          />
        </div>
        <p v-if="purgeError" class="notice notice--error" role="alert">
          <AppIcon name="alert" />{{ purgeError }}
        </p>
      </div>
    </ConfirmDialog>
    <ConfirmDialog
      :open="Boolean(revokeTarget)"
      :title="t('learning.topicDetail.answerLinks.revokeTitle')"
      :description="t('learning.topicDetail.answerLinks.revokeDescription')"
      :confirm-label="t('learning.topicDetail.answerLinks.revokeConfirm')"
      danger
      :busy="revokeBusy"
      @update:open="!$event && (revokeTarget = null)"
      @confirm="revokeLink"
    />
  </div>
</template>

<style scoped>
.topic-links,
.topic-danger-zone {
  margin-top: 18px;
}
.topic-links {
  display: grid;
  gap: 10px;
}
.topic-danger-zone {
  padding: 22px;
  border-color: var(--danger-line);
  background: linear-gradient(135deg, var(--danger-soft), var(--paper) 46%);
}
.topic-danger-zone__header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.topic-danger-zone__icon {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border: 1px solid var(--danger-line);
  border-radius: 11px;
  background: var(--paper);
  color: var(--danger);
}
.topic-danger-zone__heading {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex: 1;
}
.topic-danger-zone__eyebrow {
  display: block;
  margin-bottom: 3px;
  color: var(--danger);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
}
.topic-danger-zone h2 {
  margin: 0;
  font-size: 16px;
}
.topic-danger-zone__description {
  max-width: 720px;
  margin: 16px 0 0;
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.7;
}
.topic-danger-zone__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}
.purge-dialog-content {
  display: grid;
  gap: 18px;
}
.purge-topic {
  display: grid;
  gap: 5px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--paper-muted);
}
.purge-topic span,
.purge-confirmation p {
  margin: 0;
  color: var(--ink-faint);
  font-size: 12px;
}
.purge-topic strong {
  overflow-wrap: anywhere;
}
.purge-warning strong {
  color: var(--notice-red-ink);
}
.purge-impact__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  font-size: 13px;
}
.purge-impact__heading span {
  color: var(--ink-faint);
  font-size: 12px;
}
.purge-counts {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}
.purge-counts li {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--paper-muted);
  color: var(--ink-soft);
  font-size: 12px;
}
.purge-counts strong {
  flex: 0 0 auto;
  color: var(--ink);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.purge-confirmation {
  display: grid;
  gap: 8px;
}
.purge-confirmation label {
  font-size: 13px;
  font-weight: 650;
}
.purge-confirmation code {
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--paper-muted);
  color: var(--danger);
  font-family: inherit;
  font-size: 12px;
  overflow-wrap: anywhere;
}
@media (max-width: 520px) {
  .topic-danger-zone {
    padding: 18px;
  }
  .topic-danger-zone__heading {
    align-items: flex-start;
  }
  .topic-danger-zone__heading .badge {
    display: none;
  }
  .topic-danger-zone__actions .button {
    flex: 1;
  }
  .purge-counts {
    gap: 6px;
  }
  .purge-counts li {
    padding: 7px 8px;
  }
}
.topic-category__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.topic-category__unit {
  display: none;
}
.topic-categories--compact {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.topic-categories--compact .topic-category {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  column-gap: 10px;
  row-gap: 4px;
  min-width: 0;
  min-height: 78px;
  padding: 14px 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
  text-align: left;
  white-space: normal;
}
.topic-categories--compact .topic-category[data-state='active'] {
  border-color: var(--teal);
  background: var(--teal-soft);
  box-shadow: inset 0 0 0 1px var(--teal);
}
.topic-categories--compact .topic-category__icon {
  grid-row: span 2;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--paper-muted);
}
.topic-categories--compact .topic-category[data-state='active'] .topic-category__icon {
  background: var(--teal);
  color: var(--paper);
}
.topic-categories--compact .topic-category__label {
  align-self: end;
  font-size: 14px;
  line-height: 1.3;
}
.topic-categories--compact .topic-category__count {
  justify-self: start;
  align-self: start;
  min-width: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--ink-soft);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.3;
}
.topic-categories--compact .topic-category__unit {
  display: inline;
}
</style>
