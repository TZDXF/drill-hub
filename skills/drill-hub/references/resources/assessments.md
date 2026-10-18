# 练习与考试

[API 索引与通用协议](../api.md)。以下响应字段均指成功信封中的 `data`；通用鉴权、错误和并发规则见索引。

| 方法  | 路径                                          | scope              | 成功状态 | 说明                   |
| ----- | --------------------------------------------- | ------------------ | -------- | ---------------------- |
| GET   | `/api/v1/agent/topics/{id}/assessments`       | `read`             | 200      | 主题评估列表           |
| POST  | `/api/v1/agent/topics/{id}/assessments`       | `assessment:write` | 201      | 创建练习或考试         |
| PATCH | `/api/v1/agent/assessments/{id}`              | `assessment:write` | 200      | 修改练习或考试         |
| POST  | `/api/v1/agent/assessments/{id}/answer-links` | `assessment:write` | 201      | 生成免登录临时答题链接 |

## 响应字段

列表返回 `Assessment[]`；创建、修改返回 `Assessment`。

- [通用记录字段](../api.md#通用记录字段)。
- `topicId`: string — 所属主题。
- `kind`: `practice|exam`；`title`: string。
- `durationSeconds`: integer | null — 时长（秒）；null 表示未设置时限。
- `items`: AssessmentItem[] — 有序试卷项。
- `items[].questionId`: string — 题目 ID。
- `items[].questionVersion`: integer — 固定引用的题目业务版本。
- `items[].maxScore`: string — 题目满分，最多两位小数。

列表支持 `archiveState=active|archived|all`，默认 `active`。

## 请求与约束

创建：

```http
POST /api/v1/agent/topics/{topicId}/assessments
```

```json
{
  "kind": "exam",
  "title": "期末考试",
  "durationSeconds": 3600,
  "items": [
    {
      "questionId": "{questionId}",
      "questionVersion": 1,
      "maxScore": "10.00"
    }
  ]
}
```

- `kind`：`practice` 或 `exam`。
- `title`：必填非空，最多 500 字符。
- `durationSeconds`：可选正整数、最多 31536000，或 `null`；省略为 `null`。
- `items`：1 至 200 项，同卷不能重复 `questionId`。
- `questionVersion` 必须是该题已经存在的版本；题目必须属于当前主题。已归档题目不能加入新卷。
- `maxScore` 是大于 0、最多两位小数的字符串；须能按题目评分定义完整分配。
- 成功为 201。

修改：

```http
PATCH /api/v1/agent/assessments/{id}
```

```json
{
  "expectedRevision": 1,
  "title": "期末考试（修订）",
  "items": [{ "questionId": "{questionId}", "questionVersion": 2, "maxScore": "20.00" }]
}
```

可更新 `kind`、`title`、`durationSeconds`、`items` 中至少一个。`items` 是完整的试卷项列表，不是增量。已归档评估不能修改。

## 生成免登录临时答题链接

```http
POST /api/v1/agent/assessments/{assessmentId}/answer-links
```

```json
{
  "expiresInSeconds": 7200,
  "purpose": "learning",
  "taskId": "{taskId}"
}
```

- `expiresInSeconds` 可选，允许 60 秒至 30 天。省略时至少有效 24 小时；若试卷时限更长，则为试卷时限再加 1 小时，并受 30 天上限约束。
- `purpose` 可选，只能是 `learning`（正式学习，默认）或 `test`（测试）。测试必须在创建时明确选择；不能把既有学习作答改为 `test`。测试/作废作答不计学习统计、错题或任务完成。
- `taskId` 可选；提供时必须明确关联单一任务，任务与评估同属一个用户，任务 `kind` 与评估 `kind` 匹配，且任务 `targetId` 指向该评估。不传时不影响任何任务；不能只按 `assessmentId` 推断任务，也不会连带完成其他引用同一评估的任务。测试用途即使传入 `taskId` 也不影响任务。
- 请求体可省略；省略或传 `{}` 表示使用默认有效期、`purpose: "learning"` 且不关联任务。上例中的 `taskId` 是占位符；没有关联任务时删除该字段。
- 成功返回 201，`data` 为 `AnswerLinkCreated`，包含 `id`、`assessmentId`、`expiresAt`、`answerUrl`、`purpose`、`taskId`。`purpose` 为 `learning|test`；`taskId` 为关联任务 ID，无关联时为 null。
- 公开答题上下文 `PublicAnswerContext` 在原有 `assessment`、`expiresAt`、`attempt` 之外包含 `purpose: learning|test`，用于辨明正式/测试用途；这不是新增 Agent 路由，也不代表上下文额外暴露 `taskId` 或链接秘钥。
- `answerUrl` 是完整答题地址；公开地址统一沿用服务端已有 `PUBLIC_URL` 配置，不增加专用公开地址变量，不自行拼接或替换返回地址。临时秘钥位于 URL 片段中，是敏感访问凭证。把该地址原样交给一位答题者；不要记录、公开、截断或替换片段。
- 每次调用都会创建一条新链接，不是幂等操作，也没有 `Idempotency-Key`。一个链接对应一条免登录作答；同一链接重复打开会继续该作答。免登录只省略登录步骤，作答背后已有发布者的 `ownerId`，不是无主或与用户统计隔离的匿名数据。
- 链接到期、题目所属主题归档、评估归档或发布账号停用后，不能开始新作答；已开始的作答若未到期仍可能继续保存。发布者应确保有效期覆盖答题时限。
- 免登录作答仍由服务端保存答案、执行规则/模型评分或生成外部队列，并可在到期前查看报告。发布者可在学习历史中只读查看记录和报告（标注“临时链接作答”），即使链接已过期也可通过登录查看；发布者不能通过登录接口代答或交卷。
- 链接持有人提交的正式有效作答会计入所属用户的学习统计和错题；`source: "answer_link"` 仅用于来源追溯，不免除副作用。完全未答项不计错题，部分作答答错可计错题。
- 只有显式 `taskId` 可受影响：正式有效练习全空交卷不完成任务；考试交卷或超时可完成任务。测试/作废不作为任务完成依据。完整[副作用表](results.md#副作用表)及[作废请求](results.md#作废作答)见结果页。

练习与考试都在作答过程中保存答案，并由用户最终交卷（包括到期自动交卷）后统一进入评分。服务端逐题提交简答题会返回 `409 SHORT_ANSWER_REQUIRES_SUBMISSION`；当前客户端只在最终交卷时统一提交。Agent 可用临时答题链接让答题者免登录作答，但仍不能直接替用户保存答案或交卷。
