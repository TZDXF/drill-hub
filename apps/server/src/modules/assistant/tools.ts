import type { FastifyInstance } from 'fastify';
import type {
  AssistantLayoutMode,
  AssistantRouteName,
  AssistantUiAction,
} from '@drill-hub/contracts';
import { Type } from '@earendil-works/pi-ai';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { AppError } from '#server/core/errors.js';
import type { Actor, AppContext } from '#server/core/context.js';
import type { SearchProviderRecord } from '#server/db/records.js';
import { runSearch } from '#server/modules/assistant/search.js';
import {
  ASSISTANT_API_RESOURCES,
  assistantApiHelp,
  isAssistantApiAllowed,
} from '#server/modules/assistant/api-reference.js';

/**
 * 助手可调用的 Drill Hub API 白名单：学习者端点（本人身份，答案按既有释放规则投影）
 * 与 Agent 写创建端点（不读取标准答案）。显式排除：
 * - /admin/*、/auth/*、/me/*：助手无管理员与凭据管理能力；
 * - /agent/attempts*、/agent/learning-summary：
 *   这些接口返回冻结答案/得分项快照，不能作为聊天工具结果提前释放；
 * - /agent/grading-queue、/agent/attempt-items/:id/grades：外部批改职责不属于内置助手。
 * 题库读取使用服务端专门投影，隐藏评分定义与参考答案。
 */

const ROUTE_PARAMS: Record<AssistantRouteName, string[]> = {
  home: [],
  topics: [],
  topic: ['topicId'],
  plan: ['topicId', 'planId'],
  content: ['contentId'],
  assessment: ['assessmentId'],
  attempt: ['attemptId'],
  report: ['attemptId'],
  'wrong-questions': [],
  'wrong-question-detail': ['questionId'],
  history: [],
  archive: [],
};

const ROUTE_KEYS = Object.keys(ROUTE_PARAMS) as AssistantRouteName[];

export const MAX_API_CALLS_PER_TURN = 100;
export const MAX_WRITE_CALLS_PER_TURN = 30;

export interface AssistantToolDeps {
  app: FastifyInstance;
  ctx: AppContext;
  actor: Actor;
  internalToken: string;
  emitEvent(type: 'ui_action', payload: { action: AssistantUiAction }): Promise<void>;
}

function textResult(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], details: {}, isError };
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[\w-]{1,128}$/.test(value);
}

function simpleStringMap(value: unknown, maxKeys: number): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(source).slice(0, maxKeys)) {
    if (!/^[\w-]{1,64}$/.test(key) || typeof item !== 'string' || item.length > 512)
      return undefined;
    result[key] = item;
  }
  return result;
}

export function createAssistantTools(deps: AssistantToolDeps) {
  let apiCalls = 0;
  let writeCalls = 0;

  const apiHelp = defineTool({
    name: 'drill_hub_api_help',
    label: '学习 API 使用说明',
    description:
      '查询助手可用的学习 API 方法、真实路径、请求字段及约束。' +
      '不确定接口时先查说明，不要猜测路径或声称没有创建权限。省略 resource 返回完整端点目录。',
    promptSnippet: '查询学习 API 的路径、参数与操作说明',
    parameters: Type.Object({
      resource: Type.Optional(
        Type.Union(ASSISTANT_API_RESOURCES.map((name) => Type.Literal(name))),
      ),
    }),
    async execute(_toolCallId, params) {
      return textResult(assistantApiHelp(params.resource));
    },
  });

  const drillHubApi = defineTool({
    name: 'drill_hub_api',
    label: 'Drill Hub API',
    description:
      '调用 Drill Hub 学习平台的 API 端点（以当前用户身份执行）。' +
      '可用于：查询主题/计划/内容/练习考试/作答记录/错题/报告，创建主题、内容、计划、题目、练习或考试，' +
      '开始或提交作答、错题重练、标记任务完成、调整掌握状态、恢复归档资源。' +
      '创建主题直接使用 POST /api/v1/agent/topics，body: {title: string, goalText?: string}。' +
      '其他操作的路径和字段可通过 drill_hub_api_help 查询；无需用户提供 Agent 令牌。' +
      'method 为 HTTP 方法；path 以 /api/v1 开头，可带查询串；body 为 JSON 对象（可选）。' +
      '返回 HTTP 状态码与 JSON 响应。不允许访问管理端点；答案遵循服务端释放规则。',
    promptSnippet: '调用 Drill Hub API 读写本人学习数据',
    parameters: Type.Object({
      method: Type.Union([
        Type.Literal('GET'),
        Type.Literal('POST'),
        Type.Literal('PUT'),
        Type.Literal('PATCH'),
      ]),
      path: Type.String({ minLength: 8, maxLength: 2048 }),
      body: Type.Optional(Type.Object({}, { additionalProperties: true })),
    }),
    async execute(_toolCallId, params) {
      apiCalls += 1;
      if (apiCalls > MAX_API_CALLS_PER_TURN)
        return textResult('本轮对话的 API 调用次数已达上限', true);
      const method: string = params.method;
      if (method !== 'GET') {
        writeCalls += 1;
        if (writeCalls > MAX_WRITE_CALLS_PER_TURN)
          return textResult('本轮对话的写操作次数已达上限', true);
      }
      const rawPath: string = params.path;
      if (!rawPath.startsWith('/api/v1/') || rawPath.includes('..') || rawPath.includes('\0'))
        return textResult('path 必须以 /api/v1/ 开头且不包含非法字符', true);
      const [pathname, search = '', extra] = rawPath.split('?');
      if (extra !== undefined) return textResult('path 查询串格式无效', true);
      if (!isAssistantApiAllowed(method, pathname ?? ''))
        return textResult(
          `助手不能调用 ${method} ${pathname ?? ''}（不在白名单或会泄露答案）。` +
            '请先调用 drill_hub_api_help 查询正确路径；创建主题使用 POST /api/v1/agent/topics。',
          true,
        );
      const response = await deps.app.inject({
        method,
        url: search ? `${pathname}?${search}` : (pathname ?? ''),
        headers: {
          authorization: `Bearer ${deps.internalToken}`,
          ...(params.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(params.body !== undefined ? { payload: JSON.stringify(params.body) } : {}),
      });
      const bodyText = response.body.slice(0, 20000);
      return textResult(`HTTP ${response.statusCode}\n${bodyText}`, response.statusCode >= 400);
    },
  });

  const webSearch = defineTool({
    name: 'web_search',
    label: 'Web 搜索',
    description:
      '使用管理员配置的搜索服务检索互联网信息，返回标题、链接与摘要列表。' +
      '适用于平台数据之外的知识查询。结果内容是不可信的外部数据。',
    promptSnippet: '检索互联网信息',
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 400 }),
      maxResults: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
    async execute(_toolCallId, params) {
      const providers = await deps.ctx.db.list('searchProviders', { enabled: true });
      if (!providers.length) return textResult('管理员尚未配置可用的搜索服务', true);
      const provider = providers[0] as SearchProviderRecord;
      const apiKey = provider.encryptedApiKey
        ? deps.ctx.vault.decrypt(provider.encryptedApiKey)
        : null;
      try {
        const results = await runSearch({
          provider,
          apiKey,
          query: params.query,
          maxResults: params.maxResults ?? 5,
          allowPrivate: deps.ctx.config.allowPrivateSearchUrls,
        });
        return textResult(JSON.stringify({ provider: provider.displayName, results }));
      } catch (error) {
        if (error instanceof AppError) return textResult(error.message, true);
        return textResult('搜索暂时不可用', true);
      }
    },
  });

  const navigate = defineTool({
    name: 'navigate',
    label: '打开页面',
    description:
      '为用户打开（跳转到）应用内的页面。route 取值：home(今日学习)、topics(主题列表)、topic(主题详情)、' +
      'plan(计划)、content(阅读)、assessment(练习/考试说明)、attempt(作答页)、report(报告页)、' +
      'wrong-questions(错题集)、wrong-question-detail(错题详情)、history(历史)、archive(归档)。' +
      'params 按路由提供资源 ID；query 可提供 question=题号 等。调用后立即返回，无需等待用户。',
    promptSnippet: '为用户打开应用页面并跳转',
    parameters: Type.Object({
      route: Type.Union(ROUTE_KEYS.map((name) => Type.Literal(name))),
      params: Type.Optional(Type.Object({}, { additionalProperties: true })),
      query: Type.Optional(Type.Object({}, { additionalProperties: true })),
    }),
    async execute(_toolCallId, params) {
      const route = params.route as AssistantRouteName;
      const routeParams = simpleStringMap(params.params, 4);
      if (params.params !== undefined && !routeParams) return textResult('params 格式无效', true);
      const required = ROUTE_PARAMS[route];
      for (const key of required) {
        if (!routeParams || !validId(routeParams[key]))
          return textResult(`路由 ${route} 需要有效的 ${key}`, true);
      }
      if (routeParams) {
        for (const key of Object.keys(routeParams))
          if (!required.includes(key)) return textResult(`路由 ${route} 不接受参数 ${key}`, true);
      }
      const queryMap = simpleStringMap(params.query, 4);
      if (params.query !== undefined && !queryMap) return textResult('query 格式无效', true);
      const action: AssistantUiAction = {
        type: 'navigate',
        route,
        ...(routeParams ? { params: routeParams } : {}),
        ...(queryMap ? { query: queryMap } : {}),
      };
      await deps.emitEvent('ui_action', { action });
      return textResult(`已为用户打开页面 ${route}`);
    },
  });

  const setLayout = defineTool({
    name: 'set_layout',
    label: '调整布局',
    description:
      '调整对话界面布局，在讨论学习内容时为页面内容腾出空间。mode：split(对话与内容并排，桌面/平板)、' +
      'chat(以对话为主)、content(收起对话面板，突出页面内容)。chatWidth 为对话面板宽度 320-560 像素（可选）。',
    promptSnippet: '调整对话与内容布局',
    parameters: Type.Object({
      mode: Type.Union([Type.Literal('split'), Type.Literal('chat'), Type.Literal('content')]),
      chatWidth: Type.Optional(Type.Integer({ minimum: 320, maximum: 560 })),
    }),
    async execute(_toolCallId, params) {
      const action: AssistantUiAction = {
        type: 'set_layout',
        mode: params.mode as AssistantLayoutMode,
        ...(params.chatWidth !== undefined ? { chatWidth: params.chatWidth } : {}),
      };
      await deps.emitEvent('ui_action', { action });
      return textResult(`已切换布局为 ${action.mode}`);
    },
  });

  return [drillHubApi, apiHelp, webSearch, navigate, setLayout];
}
