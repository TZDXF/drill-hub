<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { RadioGroupIndicator, RadioGroupItem, RadioGroupRoot } from 'reka-ui';
import type {
  Answer,
  AttemptItemView,
  AttemptView,
  PublicAnswerContext,
} from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { draftAnswerStatus } from '../attemptPresentation';
import { planNavigationQuery, planReturnLocation } from '../planNavigation';
import { captureAnswerLinkToken } from '../publicAccess';
import { questionIndexFromQuery } from '../questionNavigation';
import { asAttemptView, emptyAnswer, questionTypeLabels } from '../types';
import { clone, errorMessage, isApiError, formatOptionLabel } from '../utils';
import AppIcon from '../components/AppIcon.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import AttemptQuestionNav from '../components/AttemptQuestionNav.vue';
import GradeFeedback from '../components/GradeFeedback.vue';
import AppCheckbox from '../components/AppCheckbox.vue';

const props = withDefaults(defineProps<{ publicAccess?: boolean }>(), { publicAccess: false });
const learning = useLearning();
const route = useRoute();
const router = useRouter();
const publicToken = ref('');
const publicPurpose = ref<AttemptView['purpose'] | null>(null);
const attempt = ref<AttemptView | null>(null);
const planReturn = computed(() =>
  attempt.value ? planReturnLocation(attempt.value.topicId, route.query) : null,
);
const answers = ref<Record<string, Answer | null>>({});
const currentIndex = ref(0);
const markedIds = ref<string[]>([]);
const navigating = ref(false);
const swiping = ref(false);
const questionTrack = ref<HTMLElement | null>(null);
const carouselEngaged = ref(false);
const composing = ref(false);
const questionGap = 16;
const swipeOffset = ref(0);
const rebounding = ref(false);
let cardAnimation: Animation | null = null;
let motionDisposed = false;
let swipeStart: {
  x: number;
  y: number;
  id: number;
  container: HTMLElement;
  editor: HTMLInputElement | HTMLTextAreaElement | null;
  selectionStart: number | null;
  selectionEnd: number | null;
  startedAt: number;
} | null = null;
let suppressSwipeClickUntil = 0;
const navigationDisabled = computed(() => navigating.value || rebounding.value || submitting.value);
const loading = ref(true);
const error = ref('');
const dirty = ref<Record<string, boolean>>({});
const saving = ref<Record<string, boolean>>({});
const saveErrors = ref<Record<string, string>>({});
const editVersions: Record<string, number> = {};
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const savePromises = new Map<string, Promise<void>>();
const submitOpen = ref(false);
const submitting = ref(false);
const leaveOpen = ref(false);
const now = ref(Date.now());
let pendingLeavePath = '';
let allowLeaveOnce = false;
let clock: ReturnType<typeof setInterval> | null = null;
let expiryRefreshing = false;

const currentItem = computed(() => attempt.value?.items[currentIndex.value] ?? null);
const renderedQuestions = computed(() => {
  const offsets = carouselEngaged.value ? [-1, 0, 1] : [0];
  return offsets.flatMap((offset) => {
    const index = currentIndex.value + offset;
    const item = attempt.value?.items[index];
    return item ? [{ item, index }] : [];
  });
});
const answeredCount = computed(
  () =>
    attempt.value?.items.filter(
      (item) => draftAnswerStatus(item, answers.value[item.id]) === 'answered',
    ).length ?? 0,
);
const partialCount = computed(
  () =>
    attempt.value?.items.filter(
      (item) => draftAnswerStatus(item, answers.value[item.id]) === 'partial',
    ).length ?? 0,
);
const unansweredCount = computed(
  () => (attempt.value?.items.length ?? 0) - answeredCount.value - partialCount.value,
);
const unsavedCount = computed(() => Object.values(dirty.value).filter(Boolean).length);
const saveErrorCount = computed(() => Object.values(saveErrors.value).filter(Boolean).length);
const remainingSeconds = computed(() => {
  if (!attempt.value?.expiresAt) return null;
  return Math.max(0, Math.floor((new Date(attempt.value.expiresAt).getTime() - now.value) / 1000));
});
const expired = computed(() => remainingSeconds.value === 0);
const routeHash = computed(() =>
  props.publicAccess && publicToken.value ? `#${publicToken.value}` : undefined,
);
const timeText = computed(() => {
  const value = remainingSeconds.value;
  if (value === null) return '';
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  return hours
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
});

function isLocked(item: AttemptItemView) {
  return (
    Boolean(attempt.value?.voidedAt) ||
    Boolean(item.lockedAt) ||
    attempt.value?.status !== 'in_progress' ||
    expired.value
  );
}
function markDirty(item: AttemptItemView, answer: Answer) {
  if (item.id !== currentItem.value?.id || isLocked(item) || submitting.value) return false;
  answers.value[item.id] = answer;
  editVersions[item.id] = (editVersions[item.id] ?? 0) + 1;
  dirty.value[item.id] = true;
  saveErrors.value[item.id] = '';
  const timer = timers.get(item.id);
  if (timer) clearTimeout(timer);
  timers.set(
    item.id,
    setTimeout(() => {
      void saveItem(item.id);
    }, 700),
  );
  return true;
}
function setSingle(item: AttemptItemView, optionId: string) {
  markDirty(item, { optionId });
}
function setSingleValue(item: AttemptItemView, value: unknown) {
  if (typeof value === 'string') setSingle(item, value);
}
function setMultiple(item: AttemptItemView, optionId: string) {
  const current = answers.value[item.id];
  const selected = current && 'optionIds' in current ? current.optionIds : [];
  const optionIds = selected.includes(optionId)
    ? selected.filter((id) => id !== optionId)
    : [...selected, optionId];
  markDirty(item, { optionIds });
}
function setBoolean(item: AttemptItemView, value: boolean) {
  markDirty(item, { value });
}
function setSlot(item: AttemptItemView, slotId: string, value: string) {
  const current = answers.value[item.id];
  const slots = current && 'slots' in current ? { ...current.slots } : {};
  slots[slotId] = value;
  markDirty(item, { slots });
}
function setText(item: AttemptItemView, text: string) {
  markDirty(item, { text });
}
function optionSelected(item: AttemptItemView, optionId: string) {
  const answer = answers.value[item.id];
  return Boolean(answer && 'optionId' in answer && answer.optionId === optionId);
}
function multiSelected(item: AttemptItemView, optionId: string) {
  const answer = answers.value[item.id];
  return Boolean(answer && 'optionIds' in answer && answer.optionIds.includes(optionId));
}
function boolSelected(item: AttemptItemView, value: boolean) {
  const answer = answers.value[item.id];
  return Boolean(answer && 'value' in answer && answer.value === value);
}
function radioOptionValue(item: AttemptItemView) {
  const answer = answers.value[item.id];
  return answer && 'optionId' in answer ? answer.optionId : '';
}
function radioBooleanValue(item: AttemptItemView) {
  const answer = answers.value[item.id];
  return answer && 'value' in answer ? String(answer.value) : '';
}
function slotValue(item: AttemptItemView, slotId: string) {
  const answer = answers.value[item.id];
  return answer && 'slots' in answer ? (answer.slots[slotId] ?? '') : '';
}
function textValue(item: AttemptItemView) {
  const answer = answers.value[item.id];
  return answer && 'text' in answer ? answer.text : '';
}

async function load(forceAnswers = false) {
  loading.value = true;
  error.value = '';
  try {
    let value: AttemptView;
    if (props.publicAccess) {
      publicToken.value = captureAnswerLinkToken(route.hash);
      if (!publicToken.value) throw new Error('答题链接缺少临时秘钥');
      const context = await learning.publicGet<PublicAnswerContext>(
        '/public/answer',
        publicToken.value,
      );
      publicPurpose.value = context.purpose;
      value =
        context.attempt ??
        (await learning.publicPost<AttemptView>('/public/answer/attempt', publicToken.value, {}));
    } else {
      const result = await learning.get<AttemptView | { attempt: AttemptView }>(
        `/attempts/${String(route.params.attemptId)}`,
      );
      value = asAttemptView(result);
    }
    if (value.voidedAt || (!props.publicAccess && value.source === 'answer_link')) {
      attempt.value = value;
      timers.forEach(clearTimeout);
      timers.clear();
      dirty.value = {};
      saveErrors.value = {};
      await router.replace(
        props.publicAccess
          ? { name: 'public-report', hash: routeHash.value }
          : { name: 'report', params: { attemptId: value.id }, query: route.query },
      );
      return;
    }
    attempt.value = value;
    currentIndex.value = questionIndexFromQuery(route.query.question, value.items.length);
    for (const item of value.items) {
      if (forceAnswers || !(item.id in answers.value)) {
        answers.value[item.id] = item.answer
          ? clone(item.answer)
          : item.type === 'fill_blank' && !item.answer
            ? emptyAnswer(item)
            : null;
        dirty.value[item.id] = false;
        saveErrors.value[item.id] = '';
      }
    }
    if (value.status !== 'in_progress')
      await router.replace(
        props.publicAccess
          ? { name: 'public-report', hash: routeHash.value }
          : {
              name: 'report',
              params: { attemptId: value.id },
              query: planNavigationQuery(route.query),
            },
      );
  } catch (reason) {
    error.value = errorMessage(reason);
    learning.notify.error('作答会话读取失败', error.value);
  } finally {
    loading.value = false;
  }
}

async function saveItem(itemId: string) {
  const item = attempt.value?.items.find((entry) => entry.id === itemId);
  const answer = answers.value[itemId];
  if (!item || !answer || !dirty.value[itemId] || saving.value[itemId] || isLocked(item)) return;
  const timer = timers.get(itemId);
  if (timer) clearTimeout(timer);
  const version = editVersions[itemId] ?? 0;
  const snapshot = clone(answer);
  saving.value[itemId] = true;
  saveErrors.value[itemId] = '';
  const promise = (async () => {
    try {
      const payload = { expectedRevision: item.answerRevision, answer: snapshot };
      const updated = props.publicAccess
        ? await learning.publicPut<AttemptItemView>(
            `/public/answer/attempt/items/${itemId}`,
            publicToken.value,
            payload,
          )
        : await learning.put<AttemptView | AttemptItemView>(
            `/attempts/${attempt.value!.id}/answers/${itemId}`,
            payload,
          );
      const updatedItem =
        'items' in updated ? updated.items.find((entry) => entry.id === itemId) : updated;
      if (!updatedItem) throw new Error('服务器保存响应缺少当前题目');
      const target = attempt.value?.items.find((entry) => entry.id === itemId);
      if (target) {
        target.answerRevision = updatedItem.answerRevision;
        target.answerStatus = updatedItem.answerStatus;
        target.answer = clone(updatedItem.answer);
      }
      if ((editVersions[itemId] ?? 0) === version) {
        answers.value[itemId] = clone(updatedItem.answer);
        dirty.value[itemId] = false;
      } else {
        dirty.value[itemId] = true;
      }
    } catch (reason) {
      saveErrors.value[itemId] = isApiError(reason, 409)
        ? '答案版本冲突，请重新载入会话，不要覆盖其他设备的修改'
        : errorMessage(reason);
      dirty.value[itemId] = true;
      learning.notify.error('答案保存失败', saveErrors.value[itemId]);
    } finally {
      saving.value[itemId] = false;
    }
  })();
  savePromises.set(itemId, promise);
  await promise;
  if (savePromises.get(itemId) === promise) savePromises.delete(itemId);
  if (dirty.value[itemId] && !saveErrors.value[itemId] && (editVersions[itemId] ?? 0) !== version)
    void saveItem(itemId);
}
async function flushItem(itemId: string) {
  const timer = timers.get(itemId);
  if (timer) clearTimeout(timer);
  await savePromises.get(itemId);
  if (dirty.value[itemId] && !saving.value[itemId]) await saveItem(itemId);
}
async function flushAll() {
  if (!attempt.value) return;
  await Promise.all(attempt.value.items.map((item) => flushItem(item.id)));
}
function toggleMark() {
  if (attempt.value?.kind !== 'exam' || !currentItem.value) return;
  const id = currentItem.value.id;
  markedIds.value = markedIds.value.includes(id)
    ? markedIds.value.filter((markedId) => markedId !== id)
    : [...markedIds.value, id];
}
function questionTransform(offset: number) {
  return `translate3d(${offset}px, 0, 0)`;
}
async function animateQuestion(to: number, duration: number) {
  const card = questionTrack.value;
  if (motionDisposed) return false;
  if (!card) {
    swipeOffset.value = to;
    return false;
  }
  const from = window.getComputedStyle(card).transform;
  swipeOffset.value = to;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    await nextTick();
    return !motionDisposed;
  }
  const animation = card.animate([{ transform: from }, { transform: questionTransform(to) }], {
    duration,
    easing: 'cubic-bezier(0.22, 0.68, 0.2, 1)',
    fill: 'both',
  });
  cardAnimation = animation;
  try {
    await animation.finished;
    return !motionDisposed;
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === 'AbortError') return false;
    throw reason;
  } finally {
    if (cardAnimation === animation) cardAnimation = null;
    animation.cancel();
  }
}
async function reboundQuestion() {
  if (rebounding.value || navigating.value || motionDisposed) return;
  if (swipeOffset.value === 0) {
    carouselEngaged.value = false;
    return;
  }
  rebounding.value = true;
  try {
    await animateQuestion(0, 200);
  } finally {
    rebounding.value = false;
    carouselEngaged.value = false;
  }
}
function cancelSwipe(event?: PointerEvent, rebound = true) {
  if (event && swipeStart?.id !== event.pointerId) return;
  const start = swipeStart;
  swipeStart = null;
  swiping.value = false;
  if (start?.container.hasPointerCapture(start.id)) start.container.releasePointerCapture(start.id);
  if (rebound) void reboundQuestion();
}
function onSwipeStart(event: PointerEvent) {
  if (!event.isPrimary) {
    cancelSwipe();
    return;
  }
  suppressSwipeClickUntil = 0;
  if (
    !window.matchMedia('(max-width: 780px)').matches ||
    navigationDisabled.value ||
    submitOpen.value ||
    leaveOpen.value ||
    composing.value ||
    event.shiftKey ||
    event.button !== 0
  )
    return;
  const target = event.target;
  if (!(target instanceof Element) || !(event.currentTarget instanceof HTMLElement)) return;
  const control = target.closest(
    'input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"])',
  );
  const editor =
    control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement ? control : null;
  if (control && !editor && !control.matches('[role="radio"], [role="checkbox"]')) return;
  // 已有选区、Shift 选字和长按选字保留原生行为；普通横向拖动允许从输入框发起。
  if (
    (!editor && window.getSelection()?.toString()) ||
    (editor === document.activeElement && editor && editor.selectionStart !== editor.selectionEnd)
  )
    return;
  for (
    let element: Element | null = target;
    element && element !== event.currentTarget;
    element = element.parentElement
  ) {
    if (element !== editor && element.scrollWidth > element.clientWidth + 1) return;
  }
  swipeStart = {
    x: event.clientX,
    y: event.clientY,
    id: event.pointerId,
    container: event.currentTarget,
    editor,
    selectionStart: editor?.selectionStart ?? null,
    selectionEnd: editor?.selectionEnd ?? null,
    startedAt: Date.now(),
  };
}
function onSwipeMove(event: PointerEvent) {
  if (!swipeStart || event.pointerId !== swipeStart.id) return;
  if (swipeStart.editor && !swiping.value && Date.now() - swipeStart.startedAt > 450) {
    cancelSwipe(event);
    return;
  }
  const dx = event.clientX - swipeStart.x;
  const dy = event.clientY - swipeStart.y;
  if (Math.abs(dy) > 24 && Math.abs(dy) >= Math.abs(dx)) {
    cancelSwipe(event);
    return;
  }
  if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  swiping.value = true;
  carouselEngaged.value = true;
  const hasNeighbor =
    dx < 0 ? currentIndex.value < (attempt.value?.items.length ?? 0) - 1 : currentIndex.value > 0;
  const width = questionTrack.value?.offsetWidth ?? window.innerWidth;
  const offset = hasNeighbor ? dx : dx * 0.22;
  swipeOffset.value = Math.max(-width * 0.85, Math.min(width * 0.85, offset));
  suppressSwipeClickUntil = Date.now() + 800;
  swipeStart.container.setPointerCapture(event.pointerId);
  if (event.cancelable) event.preventDefault();
  if (swipeStart.editor && swipeStart.selectionStart !== null && swipeStart.selectionEnd !== null) {
    swipeStart.editor.setSelectionRange(swipeStart.selectionStart, swipeStart.selectionEnd);
  } else window.getSelection()?.removeAllRanges();
}
function onSwipeEnd(event: PointerEvent) {
  const start = swipeStart;
  if (!start || start.id !== event.pointerId) return;
  const dx = event.clientX - start.x;
  const dy = event.clientY - start.y;
  const wasSwiping = swiping.value;
  cancelSwipe(event, false);
  const index = currentIndex.value + (dx < 0 ? 1 : -1);
  if (
    !wasSwiping ||
    navigationDisabled.value ||
    submitOpen.value ||
    leaveOpen.value ||
    Math.abs(dx) < 56 ||
    Math.abs(dx) < Math.abs(dy) * 1.5 ||
    index < 0 ||
    index >= (attempt.value?.items.length ?? 0)
  ) {
    void reboundQuestion();
    return;
  }
  suppressSwipeClickUntil = Date.now() + 800;
  start.editor?.blur();
  void goTo(index, true);
}
function preventSwipeClick(event: MouseEvent) {
  if (event.detail !== 0 && Date.now() < suppressSwipeClickUntil) {
    event.preventDefault();
    event.stopPropagation();
    suppressSwipeClickUntil = 0;
  }
}
async function goTo(index: number, animate = false) {
  if (
    !attempt.value ||
    index < 0 ||
    index >= attempt.value.items.length ||
    index === currentIndex.value ||
    navigationDisabled.value
  )
    return;
  navigating.value = true;
  try {
    const item = currentItem.value;
    if (item) await flushItem(item.id);
    if (motionDisposed) return;
    const withMotion = animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const direction = index > currentIndex.value ? 1 : -1;
    const distance = (questionTrack.value?.offsetWidth ?? window.innerWidth) + questionGap;
    if (withMotion && !(await animateQuestion(-direction * distance, 200))) return;
    await router.replace({
      query: { ...route.query, question: String(index + 1) },
      ...(props.publicAccess ? { hash: routeHash.value } : {}),
    });
    if (motionDisposed) return;
    // 相邻题已随轨道移到中心；同一轮渲染重置轨道和索引，不重新播放入场动画。
    swipeOffset.value = 0;
    currentIndex.value = index;
    carouselEngaged.value = false;
    await nextTick();
  } finally {
    navigating.value = false;
    if (!motionDisposed && swipeOffset.value !== 0) void reboundQuestion();
    else carouselEngaged.value = false;
  }
}
async function openSubmit() {
  if (submitting.value || attempt.value?.voidedAt || attempt.value?.status !== 'in_progress')
    return;
  await flushAll();
  if (saveErrorCount.value || unsavedCount.value) {
    learning.notify.warning('暂时不能交卷', '仍有答案未成功保存，请先处理保存错误。');
    return;
  }
  submitOpen.value = true;
}
async function submitAttempt() {
  if (
    !attempt.value ||
    attempt.value.voidedAt ||
    attempt.value.status !== 'in_progress' ||
    submitting.value
  )
    return;
  submitting.value = true;
  try {
    await flushAll();
    if (saveErrorCount.value || unsavedCount.value) {
      learning.notify.warning('暂时不能交卷', '仍有答案未成功保存，请先处理保存错误。');
      return;
    }
    if (props.publicAccess) {
      await learning.publicPost<AttemptView>(
        '/public/answer/attempt/submit',
        publicToken.value,
        {},
      );
    } else {
      await learning.post(`/attempts/${attempt.value.id}/submit`, {});
    }
    submitOpen.value = false;
    learning.notify.success('试卷已提交', '答案已冻结并进入评分流程。');
    await router.replace(
      props.publicAccess
        ? { name: 'public-report', hash: routeHash.value }
        : {
            name: 'report',
            params: { attemptId: attempt.value.id },
            query: planNavigationQuery(route.query),
          },
    );
  } catch (reason) {
    learning.notify.error('交卷失败', errorMessage(reason));
    submitOpen.value = false;
    if (isApiError(reason, 409)) await load(true);
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  void load();
  clock = setInterval(() => {
    now.value = Date.now();
    if (expired.value && attempt.value?.status === 'in_progress' && !expiryRefreshing) {
      expiryRefreshing = true;
      void load(true).finally(() => {
        expiryRefreshing = false;
      });
    }
  }, 1000);
});
watch(
  () => route.params.attemptId,
  () => {
    answers.value = {};
    dirty.value = {};
    saveErrors.value = {};
    currentIndex.value = 0;
    markedIds.value = [];
    cardAnimation?.cancel();
    swipeOffset.value = 0;
    carouselEngaged.value = false;
    composing.value = false;
    cancelSwipe();
    void load(true);
  },
);
onBeforeUnmount(() => {
  motionDisposed = true;
  cardAnimation?.cancel();
  if (clock) clearInterval(clock);
  timers.forEach(clearTimeout);
});
onBeforeRouteLeave(async (to) => {
  await flushAll();
  if (allowLeaveOnce) {
    allowLeaveOnce = false;
    return true;
  }
  if (saveErrorCount.value && !attempt.value?.voidedAt && attempt.value?.status === 'in_progress') {
    pendingLeavePath = to.fullPath;
    leaveOpen.value = true;
    return false;
  }
  return true;
});
function confirmLeave() {
  leaveOpen.value = false;
  allowLeaveOnce = true;
  void router.push(pendingLeavePath);
}
</script>

<template>
  <div class="attempt-layout">
    <div v-if="publicAccess && publicPurpose === 'test'" class="notice notice--pending">
      <AppIcon name="alert" />
      <p>测试作答：可正常答题、交卷与评分，不计入学习统计、错题及计划进度。</p>
    </div>
    <div v-if="loading" class="loading-block" style="min-height: 100vh">
      <span class="spinner" />正在恢复服务端作答会话
    </div>
    <div v-else-if="error && !attempt" class="boot-screen boot-screen--error">
      <AppIcon name="alert" :size="30" />
      <h1>无法打开作答会话</h1>
      <p>请检查网络连接后重试；失败原因已显示在通知中。</p>
      <button class="button button--primary" @click="load(true)">重试</button>
    </div>
    <template v-else-if="attempt">
      <header class="attempt-topbar">
        <RouterLink
          v-if="!publicAccess"
          class="icon-button"
          :to="planReturn ?? { name: 'topic-detail', params: { topicId: attempt.topicId } }"
          :aria-label="planReturn ? '保存并返回学习计划' : '保存并返回主题'"
          ><AppIcon name="back"
        /></RouterLink>
        <span v-else class="badge">免登录</span>
        <div class="attempt-topbar__title">
          <strong>{{ attempt.title }}</strong
          ><span
            >{{ attempt.kind === 'exam' ? '考试 · 整体交卷' : '练习 · 简答题交卷后评分' }} ·
            答案仅保存到当前服务器</span
          >
        </div>
        <RouterLink
          v-if="!publicAccess"
          class="button button--small"
          :to="{
            name: 'report',
            params: { attemptId: attempt.id },
            query: planNavigationQuery(route.query),
          }"
          >作答详情</RouterLink
        >
        <div
          v-if="remainingSeconds !== null"
          class="attempt-timer"
          role="timer"
          aria-label="剩余作答时间"
        >
          <AppIcon name="clock" :size="17" />{{ timeText }}
        </div>
        <button
          class="button button--primary button--small"
          type="button"
          :disabled="Boolean(attempt.voidedAt) || expired || submitting"
          @click="openSubmit"
        >
          交卷
        </button>
      </header>
      <div v-if="publicAccess" class="notice">
        <AppIcon name="eye" />
        <p>
          {{
            attempt.purpose === 'test'
              ? '持链接者的作答会记到链接所属用户名下；测试作答不计入学习统计、错题和计划进度。请勿转发给他人。'
              : '持链接者的作答会记到链接所属用户名下，并计入该用户的学习统计、错题和计划进度。请勿转发给他人。'
          }}
        </p>
      </div>
      <div v-if="!publicAccess && attempt.purpose === 'test'" class="notice notice--pending">
        <AppIcon name="alert" />
        <p>测试作答：可正常答题、交卷与评分，不计入学习统计、错题及计划进度。</p>
      </div>
      <main class="attempt-container">
        <AttemptQuestionNav
          :items="attempt.items"
          :answers="answers"
          :current-index="currentIndex"
          :marked-ids="markedIds"
          :marks-enabled="attempt.kind === 'exam'"
          :disabled="navigationDisabled"
          @select="goTo"
        />
        <div
          class="attempt-content"
          :class="{ 'attempt-content--swiping': swiping }"
          @pointerdown.capture="onSwipeStart"
          @pointermove.capture="onSwipeMove"
          @pointerup.capture="onSwipeEnd"
          @pointercancel.capture="cancelSwipe"
          @lostpointercapture="$event.target === $event.currentTarget && cancelSwipe($event)"
          @click.capture="preventSwipeClick"
          @compositionstart.capture="composing = true"
          @compositionend.capture="composing = false"
        >
          <div v-if="expired" class="notice notice--pending" style="margin-bottom: 16px">
            <AppIcon name="clock" />
            <div>
              <strong>已到服务端截止时间</strong>
              <p>正在刷新交卷事实；设备时间不会改变截止状态。</p>
            </div>
          </div>
          <div
            ref="questionTrack"
            class="question-track"
            :class="{ 'question-track--moving': swiping || navigating || rebounding }"
            :style="{ transform: questionTransform(swipeOffset) }"
          >
            <article
              v-for="slide in renderedQuestions"
              :key="slide.item.id"
              class="paper-panel question-panel question-slide"
              :class="{
                'question-card question-slide--current': slide.index === currentIndex,
                'question-preview': slide.index !== currentIndex,
                'question-card--moving':
                  slide.index === currentIndex && (swiping || navigating || rebounding),
              }"
              :style="{
                left: `${(slide.index - currentIndex) * 100}%`,
                marginLeft: `${(slide.index - currentIndex) * questionGap}px`,
              }"
              :inert="slide.index !== currentIndex || navigating"
              :aria-hidden="slide.index !== currentIndex ? true : undefined"
              :aria-labelledby="`question-${slide.item.id}`"
            >
              <header class="question-heading">
                <div>
                  <span class="question-number"
                    >第 {{ slide.index + 1 }} 题 · {{ questionTypeLabels[slide.item.type] }}</span
                  >
                  <h1
                    :id="`question-${slide.item.id}`"
                    :class="
                      slide.index === currentIndex ? 'question-stem' : 'question-preview-stem'
                    "
                  >
                    {{ slide.item.stem }}
                  </h1>
                </div>
                <span class="badge">{{ slide.item.maxScore }} 分</span>
              </header>
              <RadioGroupRoot
                v-if="slide.item.type === 'single_choice'"
                class="answer-options"
                :model-value="radioOptionValue(slide.item)"
                :disabled="isLocked(slide.item) || submitting"
                aria-label="请选择一个答案"
                @update:model-value="setSingleValue(slide.item, $event)"
              >
                <label
                  v-for="(option, index) in slide.item.options"
                  :key="option.id"
                  :for="`choice-${slide.item.id}-${option.id}`"
                  class="answer-option"
                  :class="{
                    selected: optionSelected(slide.item, option.id),
                    locked: isLocked(slide.item),
                  }"
                >
                  <RadioGroupItem
                    :id="`choice-${slide.item.id}-${option.id}`"
                    :value="option.id"
                    class="choice-box choice-box--radio"
                  >
                    <RadioGroupIndicator><span class="choice-radio-dot" /></RadioGroupIndicator>
                  </RadioGroupItem>
                  <span class="answer-option__text">{{
                    formatOptionLabel(index, option.text)
                  }}</span>
                </label>
              </RadioGroupRoot>
              <div
                v-else-if="slide.item.type === 'multiple_choice'"
                class="answer-options"
                role="group"
                aria-label="请选择所有正确答案"
              >
                <AppCheckbox
                  v-for="(option, index) in slide.item.options"
                  :key="option.id"
                  class="answer-option"
                  :class="{
                    selected: multiSelected(slide.item, option.id),
                    locked: isLocked(slide.item),
                  }"
                  :model-value="multiSelected(slide.item, option.id)"
                  :disabled="isLocked(slide.item) || submitting"
                  @update:model-value="setMultiple(slide.item, option.id)"
                >
                  <span class="answer-option__text">{{
                    formatOptionLabel(index, option.text)
                  }}</span>
                </AppCheckbox>
              </div>
              <RadioGroupRoot
                v-else-if="slide.item.type === 'true_false'"
                class="answer-options"
                :model-value="radioBooleanValue(slide.item)"
                :disabled="isLocked(slide.item) || submitting"
                aria-label="请判断正误"
                @update:model-value="setBoolean(slide.item, $event === 'true')"
              >
                <label
                  v-for="choice in [
                    { value: 'true', label: '正确' },
                    { value: 'false', label: '错误' },
                  ]"
                  :key="choice.value"
                  :for="`choice-${slide.item.id}-${choice.value}`"
                  class="answer-option"
                  :class="{
                    selected: boolSelected(slide.item, choice.value === 'true'),
                    locked: isLocked(slide.item),
                  }"
                >
                  <RadioGroupItem
                    :id="`choice-${slide.item.id}-${choice.value}`"
                    :value="choice.value"
                    class="choice-box choice-box--radio"
                  >
                    <RadioGroupIndicator><span class="choice-radio-dot" /></RadioGroupIndicator>
                  </RadioGroupItem>
                  <span class="answer-option__text">{{ choice.label }}</span>
                </label>
              </RadioGroupRoot>
              <div v-else-if="slide.item.type === 'fill_blank'" class="fill-slots">
                <div v-for="(slot, index) in slide.item.slots" :key="slot.id" class="fill-slot">
                  <label :for="`slot-${slide.item.id}-${slot.id}`" class="field-label"
                    >第 {{ index + 1 }} 空</label
                  ><input
                    :id="`slot-${slide.item.id}-${slot.id}`"
                    class="input"
                    :value="slotValue(slide.item, slot.id)"
                    :disabled="isLocked(slide.item) || submitting"
                    autocomplete="off"
                    @input="setSlot(slide.item, slot.id, ($event.target as HTMLInputElement).value)"
                  />
                </div>
              </div>
              <div v-else class="form-field">
                <label :for="`answer-${slide.item.id}`">你的答案</label
                ><textarea
                  :id="`answer-${slide.item.id}`"
                  class="textarea"
                  style="min-height: 220px"
                  :value="textValue(slide.item)"
                  :disabled="isLocked(slide.item) || submitting"
                  placeholder="请用自己的话完整作答…"
                  @input="setText(slide.item, ($event.target as HTMLTextAreaElement).value)"
                />
              </div>
              <div class="attempt-actions">
                <div
                  v-if="saving[slide.item.id] || saveErrors[slide.item.id]"
                  class="save-state"
                  :class="{ error: saveErrors[slide.item.id] }"
                  aria-live="polite"
                >
                  <AppIcon :name="saveErrors[slide.item.id] ? 'alert' : 'clock'" :size="15" /><span
                    v-if="saving[slide.item.id]"
                    >正在保存到服务器…</span
                  ><span v-else>保存失败，请检查通知</span>
                </div>
                <div class="button-row">
                  <button
                    v-if="attempt.kind === 'exam'"
                    class="button attempt-mark-button"
                    type="button"
                    :class="{ 'attempt-mark-button--marked': markedIds.includes(slide.item.id) }"
                    :aria-pressed="markedIds.includes(slide.item.id)"
                    @click="slide.index === currentIndex && toggleMark()"
                  >
                    <AppIcon name="flag" :size="16" />{{
                      markedIds.includes(slide.item.id) ? '取消标记' : '标记'
                    }}
                  </button>
                  <button
                    class="button"
                    type="button"
                    :disabled="slide.index === 0 || navigationDisabled"
                    @click="slide.index === currentIndex && goTo(slide.index - 1)"
                  >
                    <AppIcon name="back" :size="16" />上一题</button
                  ><button
                    v-if="slide.index < attempt.items.length - 1"
                    class="button"
                    type="button"
                    :disabled="navigationDisabled"
                    @click="slide.index === currentIndex && goTo(slide.index + 1)"
                  >
                    下一题<AppIcon name="arrow" :size="16" /></button
                  ><button
                    v-if="slide.index === attempt.items.length - 1"
                    class="button button--primary"
                    type="button"
                    :disabled="Boolean(attempt.voidedAt) || expired || submitting"
                    @click="slide.index === currentIndex && openSubmit()"
                  >
                    检查并交卷
                  </button>
                </div>
              </div>
              <GradeFeedback
                v-if="attempt.kind === 'practice' && slide.item.lockedAt"
                :item="slide.item"
                show-reference
              />
            </article>
          </div>
        </div>
      </main>
      <ConfirmDialog
        v-model:open="submitOpen"
        title="确认提交整份试卷？"
        description="交卷后答案将冻结并进入评分，不能继续修改。"
        confirm-label="确认交卷"
        :busy="submitting"
        @confirm="submitAttempt"
      >
        <p v-if="attempt.taskId" class="muted small">
          {{
            attempt.purpose === 'test'
              ? '测试作答不会完成计划任务。'
              : attempt.kind === 'exam'
                ? '正式考试交卷即满足作答任务完成条件，全部留空也可完成。'
                : '正式练习全部留空不会完成计划任务。'
          }}
        </p>
        <div class="definition-list">
          <div>
            <dt>题目总数</dt>
            <dd>{{ attempt.items.length }}</dd>
          </div>
          <div>
            <dt>未作答</dt>
            <dd>{{ unansweredCount }} 题</dd>
          </div>
          <div>
            <dt>部分作答</dt>
            <dd>{{ partialCount }} 题</dd>
          </div>
          <div>
            <dt>未保存</dt>
            <dd>{{ unsavedCount }} 项</dd>
          </div>
        </div>
        <p class="field-hint" style="margin-top: 14px">
          提交成功即表示答案已交卷；模型题随后可能显示待评分，不会因此变成 0 分。
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        v-model:open="leaveOpen"
        title="仍有答案未成功保存"
        description="离开后这些内容不会被视为服务端已保存。是否仍然离开？"
        confirm-label="仍然离开"
        danger
        @confirm="confirmLeave"
      >
        <p class="muted small">建议留在此页重试保存，避免丢失本次修改。</p>
      </ConfirmDialog>
    </template>
  </div>
</template>
