/** 工具帮助与执行权限共用同一份端点目录，避免模型只能猜测路径和字段。 */
export const ASSISTANT_API_RESOURCES = [
  'overview',
  'topics',
  'contents',
  'plans',
  'questions',
  'assessments',
  'attempts',
  'wrong-questions',
  'archive',
  'grading',
] as const;

type Resource = (typeof ASSISTANT_API_RESOURCES)[number];
interface ApiOperation {
  resource: Resource;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  path: string;
  description: string;
}

export const ASSISTANT_API_OPERATIONS: ApiOperation[] = [
  { resource: 'overview', method: 'GET', path: '/dashboard', description: '今日学习与学习统计' },
  {
    resource: 'overview',
    method: 'GET',
    path: '/agent/capabilities',
    description: '当前能力与权限',
  },
  { resource: 'topics', method: 'GET', path: '/topics', description: '列出主题' },
  { resource: 'topics', method: 'GET', path: '/topics/{id}', description: '读取主题及 revision' },
  { resource: 'topics', method: 'GET', path: '/agent/topics', description: '列出主题' },
  {
    resource: 'topics',
    method: 'POST',
    path: '/agent/topics',
    description:
      '直接创建主题。body: {title: string, goalText?: string}；返回 201 与主题 id/revision',
  },
  {
    resource: 'topics',
    method: 'PATCH',
    path: '/agent/topics/{id}',
    description: '修改主题。body: {expectedRevision: integer, title?: string, goalText?: string}',
  },
  {
    resource: 'contents',
    method: 'GET',
    path: '/topics/{id}/contents',
    description: '列出主题学习内容',
  },
  { resource: 'contents', method: 'GET', path: '/contents/{id}', description: '读取学习内容' },
  {
    resource: 'contents',
    method: 'GET',
    path: '/agent/topics/{id}/contents',
    description: '列出主题学习内容',
  },
  {
    resource: 'contents',
    method: 'POST',
    path: '/agent/topics/{id}/contents',
    description: '创建 Markdown 内容。body: {title: string, bodyText: string}',
  },
  {
    resource: 'contents',
    method: 'PATCH',
    path: '/agent/contents/{id}',
    description: '修改内容。body: {expectedRevision: integer, title?: string, bodyText?: string}',
  },
  {
    resource: 'plans',
    method: 'GET',
    path: '/topics/{id}/plans',
    description: '列出计划及阶段任务',
  },
  {
    resource: 'plans',
    method: 'GET',
    path: '/agent/topics/{id}/plans',
    description: '列出计划及阶段任务',
  },
  {
    resource: 'plans',
    method: 'POST',
    path: '/agent/topics/{id}/plans',
    description:
      '创建计划。body: {title: string, phases: [{title: string, tasks: Task[]}]}；每个阶段至少一项任务',
  },
  {
    resource: 'plans',
    method: 'PATCH',
    path: '/agent/plans/{id}',
    description:
      '修改计划。body: {expectedRevision: integer, title?: string, phases?: Phase[]}；phases 为完整结构，保留已有阶段和任务 id',
  },
  {
    resource: 'plans',
    method: 'PATCH',
    path: '/agent/tasks/{id}',
    description:
      '修改或移动任务。body: {expectedRevision: 父计划revision, title?, scheduledDate?, estimatedMinutes?, status?, phaseId?, position?}',
  },
  {
    resource: 'plans',
    method: 'POST',
    path: '/tasks/{id}/complete',
    description:
      '完成阅读或手动任务。body: {expectedRevision?: 父计划revision}；练习/考试任务由正式作答完成',
  },
  {
    resource: 'questions',
    method: 'GET',
    path: '/agent/topics/{id}/questions',
    description:
      '读取题库与历史版本的题干、题型、选项、空位、标签和版本号；助手不读取评分键、参考答案、rubric 或解析',
  },
  {
    resource: 'questions',
    method: 'POST',
    path: '/agent/topics/{id}/questions/batch',
    description:
      '批量创建题目。body: {items: [{clientRef?: string, ...QuestionDefinition}]}；1–100 项，返回 questionId/questionRevisionId/revision 映射，新题业务版本为 1',
  },
  {
    resource: 'questions',
    method: 'PATCH',
    path: '/agent/questions/{id}',
    description:
      '创建题目新版本。body: {expectedRevision: integer, definition: 完整QuestionDefinition}；已有试卷继续引用原版本',
  },
  {
    resource: 'assessments',
    method: 'GET',
    path: '/topics/{id}/assessments',
    description: '列出练习与考试',
  },
  {
    resource: 'assessments',
    method: 'GET',
    path: '/assessments/{id}',
    description: '读取练习或考试及固定的题目版本、满分',
  },
  {
    resource: 'assessments',
    method: 'GET',
    path: '/agent/topics/{id}/assessments',
    description: '列出练习与考试',
  },
  {
    resource: 'assessments',
    method: 'POST',
    path: '/agent/topics/{id}/assessments',
    description:
      '创建练习或考试。body: {kind: "practice"|"exam", title: string, durationSeconds?: integer|null, items: [{questionId: string, questionVersion: integer, maxScore: 正数分值字符串}]}',
  },
  {
    resource: 'assessments',
    method: 'PATCH',
    path: '/agent/assessments/{id}',
    description:
      '修改试卷。body: {expectedRevision: integer, kind?, title?, durationSeconds?, items?}；items 为完整试卷项列表',
  },
  {
    resource: 'assessments',
    method: 'POST',
    path: '/agent/assessments/{id}/answer-links',
    description:
      '生成临时答题链接。body: {expiresInSeconds?: 60–2592000, purpose?: "learning"|"test", taskId?: string}；原样提供返回的 answerUrl，不自行改写',
  },
  {
    resource: 'attempts',
    method: 'POST',
    path: '/assessments/{id}/attempts',
    description:
      '开始或继续本人作答。body: {purpose?: "learning"|"test", taskId?: string}；返回作答 id 和 items',
  },
  {
    resource: 'attempts',
    method: 'GET',
    path: '/attempts',
    description: '作答历史；查询参数 status/kind/topicId/assessmentId 可选',
  },
  {
    resource: 'attempts',
    method: 'GET',
    path: '/attempts/{id}',
    description: '读取作答与答案 revision',
  },
  { resource: 'attempts', method: 'GET', path: '/attempts/{id}/report', description: '读取报告' },
  {
    resource: 'attempts',
    method: 'PUT',
    path: '/attempts/{id}/answers/{itemId}',
    description:
      '保存答案。body: {expectedRevision: 当前item.answerRevision(初始0), answer: Answer}；不是作答记录 revision',
  },
  {
    resource: 'attempts',
    method: 'POST',
    path: '/attempts/{id}/items/{itemId}/submit',
    description: '提交练习单题，无需 body',
  },
  {
    resource: 'attempts',
    method: 'POST',
    path: '/attempts/{id}/submit',
    description: '交卷，无需 body',
  },
  {
    resource: 'attempts',
    method: 'POST',
    path: '/attempts/{id}/void',
    description: '作废作答并保留历史。body: {expectedRevision: 作答revision, reason: 非空原因}',
  },
  {
    resource: 'wrong-questions',
    method: 'GET',
    path: '/wrong-questions',
    description: '列出错题；查询参数 topicId/masteryStatus 可选',
  },
  {
    resource: 'wrong-questions',
    method: 'GET',
    path: '/wrong-questions/{id}',
    description: '读取错题详情和已释放的作答',
  },
  {
    resource: 'wrong-questions',
    method: 'PATCH',
    path: '/wrong-questions/{id}/mastery',
    description:
      '更新掌握状态。body: {expectedRevision: 错题revision, masteryStatus: "pending"|"reviewing"|"mastered"}',
  },
  {
    resource: 'wrong-questions',
    method: 'POST',
    path: '/wrong-question-practices',
    description:
      '错题重练。body: {items: [{questionId: string}], title?: string, purpose?: "learning"|"test"}；不要提交 maxScore',
  },
  {
    resource: 'wrong-questions',
    method: 'GET',
    path: '/agent/wrong-questions',
    description: '列出错题记录；查询参数 topicId/masteryStatus 可选',
  },
  {
    resource: 'wrong-questions',
    method: 'PATCH',
    path: '/agent/wrong-questions/{id}/mastery',
    description:
      '更新掌握状态。body: {expectedRevision: 错题revision, masteryStatus: "pending"|"reviewing"|"mastered"}',
  },
  {
    resource: 'archive',
    method: 'GET',
    path: '/archive',
    description: '列出归档，可按 resourceType 筛选',
  },
  { resource: 'archive', method: 'GET', path: '/agent/archive', description: '列出归档' },
  {
    resource: 'archive',
    method: 'POST',
    path: '/archive/{type}/{id}/restore',
    description: '恢复资源。body: {expectedRevision?: integer}',
  },
  {
    resource: 'archive',
    method: 'POST',
    path: '/agent/resources/{type}/{id}/archive',
    description: '归档资源。body: {expectedRevision?: integer}',
  },
  {
    resource: 'archive',
    method: 'POST',
    path: '/agent/resources/{type}/{id}/restore',
    description: '恢复资源。body: {expectedRevision?: integer}',
  },
  {
    resource: 'grading',
    method: 'GET',
    path: '/agent/grading-jobs',
    description: '读取本人模型评分任务与失败原因，不包含题目答案',
  },
  {
    resource: 'grading',
    method: 'POST',
    path: '/agent/grading-jobs/{id}/retry',
    description: '重试本人 failed 评分任务。body: {expectedRevision?: integer}；返回 202',
  },
  {
    resource: 'grading',
    method: 'POST',
    path: '/agent/attempt-items/{id}/regrade',
    description:
      '请求服务端模型重评。body: {expectedGradeVersion: 当前评分版本, reason: 非空原因}；仅 model_rubric，返回 202',
  },
];

const RESOURCE_NOTES: Partial<Record<Resource, string>> = {
  assessments: [
    '组卷必须使用正确的 JSON 类型：questionVersion、durationSeconds 是数字，maxScore 是字符串，不能写成数字。',
    '完整创建练习 body 示例：{kind:"practice",title:"阶段练习",durationSeconds:1800,items:[{questionId:"替换为真实题目ID",questionVersion:1,maxScore:"10.00"}]}。创建考试时将 kind 改为 "exam"。',
  ].join('\n'),
  plans: [
    'Task: {title, kind: reading|practice|exam|manual, targetId?: 同主题内容或评估ID, scheduledDate?: YYYY-MM-DD|null, estimatedMinutes?: 正整数|null}。manual 无 targetId，其他类型必须提供 targetId。',
    '先创建内容/试卷，再创建引用它们的计划。阶段只是任务分组，不是可打开的内容；每个阶段至少一项任务，不要只创建阶段标题。创建后读取计划核对任务与目标。',
  ].join('\n'),
  questions: [
    'QuestionDefinition: {type, stem, gradingMode, options?, slots?, gradingKey?, referenceAnswer?, rubric?, explanation?, tags?}。',
    '单选 single_choice、多选 multiple_choice、判断 true_false 使用 rule；填空 fill_blank 可用 rule/model_rubric/external_rubric；简答 short_answer 使用 model_rubric/external_rubric。',
    '选择题 options: [{id:string,text:string}]，id 和 text 都必须是非空字符串，数字选项也要写成字符串，例如 {id:"a",text:"5"}；填空 slots: [{id:string}]。',
    'rule 的 gradingKey 按题型为 {optionId:string}、{optionIds:string[]}、{value:boolean}、{acceptedAnswers:{空位ID:string[]}}。acceptedAnswers 必须是 JSON 对象，键与 slots 的 id 完全一致，每个值是字符串数组，包含 1–100 个不重复的非空字符串；数字答案也必须写成字符串。',
    '完整填空示例：{type:"fill_blank",stem:"计算 1+2=__",gradingMode:"rule",slots:[{id:"s1"}],gradingKey:{acceptedAnswers:{s1:["3","3.0"]}}}。不要把 acceptedAnswers 写成数组、字符串或序列化后的 JSON 字符串。',
    'rubric: {version:1, criteria:[{id,description,weight:正整数,levels:[{id,creditBps:0到10000整数,description}],slotId?:填空空位ID}]}；每项必须含 0 和 10000 两档，填空必须覆盖全部空位。',
    '读取题库只返回安全的题目定义；修改时需提供完整的新定义，不要将隐藏字段当作空值覆盖。',
    '参数校验失败时按 error.code 和 error.message 修正原请求，不要创建“探测题”测试格式；批次中任一题失败则整批回滚。',
  ].join('\n'),
  attempts:
    'Answer 按题型为 {optionId:string}、{optionIds:string[]}、{value:boolean}、{slots:{空位ID:string}} 或 {text:string}。进行中考试的答案与评分项遵循服务端释放规则。临时链接作答只能只读查看，不能代答或交卷。',
  archive:
    'type 仅限 topic|plan|content|question|assessment；保留题目版本、评分历史与审计，无永久删除。',
  grading: '助手可查询、重试和请求模型重评；不能提交外部批改结果或手工改分。',
};

export function assistantApiHelp(resource: Resource = 'overview'): string {
  const operations =
    resource === 'overview'
      ? ASSISTANT_API_OPERATIONS
      : ASSISTANT_API_OPERATIONS.filter((operation) => operation.resource === resource);
  return [
    '所有路径前缀均为 /api/v1。通过 drill_hub_api 以当前用户身份调用，无需提供令牌或让用户配置外部 Agent。',
    '用户已要求的创建或修改应直接执行；仅缺少必填业务信息时询问。成功以真实 API 响应为准，不伪造 ID 或完成状态。',
    '通用规则：成功 {data,meta}，失败 {error,meta}。修改前读取当前 revision；409 后重读核对，不静默覆盖。列表 archiveState=active|archived|all（默认 active）；仅主题/计划/内容/题库/试卷支持。',
    '按主题→内容/题目→试卷→计划任务的依赖顺序创建。禁止客户端分数、正确性、交卷时间等事实字段；试卷项 maxScore 是允许的组卷配置。',
    ...operations.map(
      (operation) => `${operation.method} /api/v1${operation.path} — ${operation.description}`,
    ),
    ...(resource === 'overview'
      ? [
          '需要详细结构时按资源调用 drill_hub_api_help。可选 resource: ' +
            ASSISTANT_API_RESOURCES.join(', '),
        ]
      : [RESOURCE_NOTES[resource] ?? 'title 为非空字符串，最多 500 字符。']),
  ].join('\n');
}

const API_ALLOWLIST = ASSISTANT_API_OPERATIONS.map((operation) => ({
  method: operation.method,
  pattern: new RegExp(`^/api/v1${operation.path.replace(/\{\w+\}/g, '[\\w-]+')}$`),
}));

export function isAssistantApiAllowed(method: string, pathname: string): boolean {
  return API_ALLOWLIST.some((entry) => entry.method === method && entry.pattern.test(pathname));
}
