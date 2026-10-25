# 能力发现

[API 索引与通用协议](@skill/references/api.md)。以下响应字段均指成功信封中的 `data`；通用鉴权、错误和并发规则见索引。

| 方法 | 路径                         | scope  | 成功状态 | 说明                   |
| ---- | ---------------------------- | ------ | -------- | ---------------------- |
| GET  | `/api/v1/agent/capabilities` | `read` | 200      | 读取当前能力与令牌权限 |

## 响应字段

- `apiVersion`: integer — 当前 API 版本为 `1`。
- `scopes`: string[] — 当前令牌实际拥有的权限，不代表所有可能权限。
- `questionTypes`: string[] — `single_choice`、`multiple_choice`、`true_false`、`fill_blank`、`short_answer`。
- `gradingModes`: string[] — `rule`、`model_rubric`、`external_rubric`。
- `limitations`: string[] — 服务端描述的当前限制。

## 调用

```http
GET /api/v1/agent/capabilities
```

建议接入后先读取一次。能力响应不是完整路由文档；使用已记录的请求字段，不要从描述推断不存在的接口。

## 权限与业务语义

- `scopes` 中的 `assessment:write` 允许生成免登录答题链接；链接创建可选 `purpose: learning|test`（默认 `learning`）和匹配任务的 `taskId`。`AnswerLinkCreated` 返回 `purpose/taskId`，`PublicAnswerContext` 包含 `purpose`；不要据此假设有新的 Agent 公开上下文路由。
- `attempt:write` 是独立的作答作废权限：调用 `POST /api/v1/agent/attempts/{id}/void`，必须带作答当前 `expectedRevision` 和非空、最多 4000 字符的 `reason`。`read`、`assessment:write` 或 `grade:write` 都不隐含该权限；仍需 owner 校验。
- `Attempt` / `AttemptView` 包含 `purpose`、`taskId`、`voidedAt`、`voidedBy`、`voidReason`。免登录只省略登录，作答已有 `ownerId`；正式有效作答都计入所属用户统计和错题，来源 `personal|answer_link` 只用于追溯。测试和作废不贡献统计、错题或任务；不可将既有学习作答改为测试。
- 正式学习未指定 `taskId` 时仅自动关联同一用户、同一主题下未归档计划中唯一匹配的任务，无匹配或多项匹配时不关联，测试不自动关联。只有已关联的单一匹配 `taskId` 可受影响；练习全空交卷不完成任务，考试交卷/超时可完成，测试不影响。详细[副作用表](@skill/references/resources/results.md#副作用表)以场景说明资格。
- `answerStatus: unanswered|partial|answered` 与 `gradingStatus: not_started|pending|running|failed|completed` 独立。空白由系统零分（`source: system`），不标模型/Agent；报告提供 `unansweredCount`。完全未答不计错题，部分作答答错可计。
- 评分任务支持 `cancelled`；作答作废将关联的未结束任务标为 `cancelled`，`lastErrorCode: ATTEMPT_VOIDED`。这是保留记录的取消，不是删除或可通过失败任务重试的状态。
- 公开答题地址统一沿用已有 `PUBLIC_URL`，链接是敏感访问凭证，持有人正式作答会计入所属用户。当前仍没有通用请求幂等。

上述内容是请求/响应字段与业务约束，不是 capabilities 新增字段或固定的 `limitations` 字符串列表。不要臆造用途修改、作废恢复、幂等、筛选或后续功能接口；以实际响应的 scopes 和已记录路由为准。
