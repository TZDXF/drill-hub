import type { AssistantUiAction } from '@drill-hub/contracts';

/**
 * 关键操作摘要：把服务端下发的工具事件归类为用户可读的一条动作，
 * 返回 null 表示与学习过程无关的内部调用（GET 查询、布局调整等），界面上直接隐藏。
 */

export interface AssistantActionDescriptor {
  /** AppIcon 名称。 */
  icon: string;
  /** i18n key（components.assistant.actions 下）。 */
  key: string;
  values: Record<string, string>;
}

interface WriteActionRule {
  pattern: RegExp;
  key: string;
  icon: string;
}

/** drill_hub_api 非 GET 写动作 → 展示摘要；顺序匹配 path。 */
const WRITE_ACTIONS: WriteActionRule[] = [
  { pattern: /^\/api\/v1\/agent\/topics\/[\w-]+\/plans$/, key: 'createPlan', icon: 'plan' },
  {
    pattern: /^\/api\/v1\/agent\/topics\/[\w-]+\/contents$/,
    key: 'createContent',
    icon: 'content',
  },
  {
    pattern: /^\/api\/v1\/agent\/topics\/[\w-]+\/questions\/batch$/,
    key: 'createQuestions',
    icon: 'target',
  },
  {
    pattern: /^\/api\/v1\/agent\/topics\/[\w-]+\/assessments$/,
    key: 'createAssessment',
    icon: 'usage',
  },
  {
    pattern: /^\/api\/v1\/assessments\/[\w-]+\/attempts$/,
    key: 'startAttempt',
    icon: 'flag',
  },
  {
    pattern: /^\/api\/v1\/attempts\/[\w-]+\/items\/[\w-]+\/submit$/,
    key: 'submitItem',
    icon: 'flag',
  },
  { pattern: /^\/api\/v1\/attempts\/[\w-]+\/submit$/, key: 'submitAttempt', icon: 'flag' },
  { pattern: /^\/api\/v1\/attempts\/[\w-]+\/void$/, key: 'voidAttempt', icon: 'close' },
  {
    pattern: /^\/api\/v1\/attempts\/[\w-]+\/answers\//,
    key: 'saveAnswer',
    icon: 'save',
  },
  {
    pattern: /^\/api\/v1\/wrong-question-practices$/,
    key: 'startPractice',
    icon: 'refresh',
  },
  {
    pattern: /^\/api\/v1\/(agent\/)?wrong-questions\/[\w-]+\/mastery$/,
    key: 'updateMastery',
    icon: 'check',
  },
  { pattern: /^\/api\/v1\/tasks\/[\w-]+\/complete$/, key: 'completeTask', icon: 'check' },
  {
    pattern: /^\/api\/v1\/archive\/[\w]+\/[\w-]+\/restore$/,
    key: 'restore',
    icon: 'archive',
  },
  { pattern: /^\/api\/v1\/agent\/topics$/, key: 'createTopic', icon: 'book' },
  { pattern: /^\/api\/v1\/agent\/topics\/[\w-]+$/, key: 'updateTopic', icon: 'book' },
  { pattern: /^\/api\/v1\/agent\/(plans|tasks)\/[\w-]+$/, key: 'updatePlan', icon: 'plan' },
  { pattern: /^\/api\/v1\/agent\/contents\/[\w-]+$/, key: 'updateContent', icon: 'content' },
  { pattern: /^\/api\/v1\/agent\/questions\/[\w-]+$/, key: 'updateQuestion', icon: 'target' },
  {
    pattern: /^\/api\/v1\/agent\/assessments\/[\w-]+$/,
    key: 'updateAssessment',
    icon: 'usage',
  },
];

function titleSuffix(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const title = (body as Record<string, unknown>).title;
  return typeof title === 'string' && title ? `“${title.slice(0, 40)}”` : '';
}

export function describeToolAction(
  name: string,
  args: Record<string, unknown> | undefined,
): AssistantActionDescriptor | null {
  if (name === 'web_search') {
    const query = String(args?.query ?? '')
      .slice(0, 60)
      .trim();
    return { icon: 'search', key: 'search', values: { query } };
  }
  if (name === 'drill_hub_api') {
    if (String(args?.method ?? 'GET') === 'GET') return null;
    const path = String(args?.path ?? '');
    const rule = WRITE_ACTIONS.find((entry) => entry.pattern.test(path));
    if (!rule) return null;
    return {
      icon: rule.icon,
      key: rule.key,
      values: { title: titleSuffix(args?.body) },
    };
  }
  return null;
}

export function describeUiAction(
  action: AssistantUiAction | undefined,
): AssistantActionDescriptor | null {
  if (!action || action.type !== 'navigate') return null;
  return { icon: 'arrow', key: 'navigate', values: { route: action.route } };
}
