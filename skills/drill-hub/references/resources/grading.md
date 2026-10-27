# 模型评分任务与外部逐项评分

[API 索引与通用协议](@skill/references/api.md)。以下响应字段均指成功信封中的 `data`；通用鉴权、错误和并发规则见索引。

| 方法 | 路径                                       | scope             | 成功状态 | 说明               |
| ---- | ------------------------------------------ | ----------------- | -------- | ------------------ |
| GET  | `/api/v1/agent/grading-jobs`               | `read`            | 200      | 列出模型评分任务   |
| GET  | `/api/v1/agent/grading-queue`              | `read`            | 200      | 待外部评分队列     |
| POST | `/api/v1/agent/attempt-items/{id}/grades`  | `grade:write`     | 200      | 首次或修正外部评分 |
| POST | `/api/v1/agent/grading-jobs/{id}/retry`    | `grading:request` | 202      | 重试本人失败任务   |
| POST | `/api/v1/agent/attempt-items/{id}/regrade` | `grading:request` | 202      | 请求模型重评       |

## 响应字段

**GradingJob**：任务列表为数组；retry / regrade 返回单个任务。

- `id`、`createdAt`、`updatedAt`、`revision`、`ownerId`。
- `attemptId`: string；`itemId`: string；`generation`: integer。
- `profileId`: string | null；`attemptCount`: integer。
- `status`: `queued|running|retry_wait|succeeded|failed|blocked_config|blocked_budget|cancelled`。
- `nextRunAt`: string；`leaseExpiresAt`: string | null；`lastErrorCode`: string | null。

`cancelled` 表示已取消，不是 `failed` 或可重试等待态。作答作废时，关联的未结束评分任务会转为 `cancelled`，`lastErrorCode` 为 `ATTEMPT_VOIDED`；任务记录、已有评分和审计保留，不删除。

任务列表没有筛选参数，返回本人全部模型评分任务。外部评分队列返回数组，字段和筛选条件见下文。提交外部评分返回 `{ attemptId: string, itemId: string, grade: GradeResult }`。

### 评分结果

**GradeResult**

- `version`: integer — 评分版本，与资源 revision / 重评 generation 不同。
- `source`: `system|rule|model|external_agent`。
- `score`: string；`maxScore`: string — 服务端计算的分值。
- `criterionResults`: CriterionGrade[]。
- `feedback`: string；`createdAt`: string；`modelId?`: string；`reason?`: string。
- `CriterionGrade`: `{ criterionId, levelId, evidence: string[], explanation, maxScore, score }`，未标类型的字段均为 string。

完全未答项（`answerStatus: "unanswered"`）在交卷后由系统记零分，`source: "system"`，不标为模型或 Agent 评分，也不计错题；报告以 `unansweredCount` 单列。部分作答（`partial`）不是部分得分，答错仍可计入正式有效作答的错题。测试和作废作答的答案、评分及历史保留，但不贡献学习统计、错题或任务完成，见[副作用表](@skill/references/resources/results.md#副作用表)。

`answerStatus: unanswered|partial|answered` 与 `gradingStatus: not_started|pending|running|failed|completed` 分开：完全未答不再是评分状态，未开始评分用 `not_started`；`cancelled` 只属于评分任务状态，不是作答项的 `gradingStatus`。

Agent 响应中的逐项评分使用 ID；学习者报告的 `criterionDescription` / `levelDescription` 是另一种展示投影，不是评分请求字段。

## 内部 rubric 评分

创建题目时选择 `gradingMode: "model_rubric"` 并提供完整 `rubric`。交卷后服务端为需要模型评分的非空答案创建内部评分任务；完全未答项由系统记零分，不冒充模型评分。Agent 不提交模型分数。

```http
GET /api/v1/agent/grading-jobs
GET /api/v1/agent/attempts/{attemptId}
```

读取状态时：

1. 若 `item.gradingStatus` 仍为 `pending`/`running`，保持待定；`retry_wait` 是评分任务状态，不是作答项状态。
2. 若完成，读取 `item.grade` 的 `score`、`maxScore`、`feedback`、`criterionResults` 和 `modelId`。
3. 若 `failed`，可读取任务 `lastErrorCode`。仅当任务是本人且状态为 `failed` 时，可使用重试路由。
4. `blocked_config`/`blocked_budget` 不能由普通 Agent 重试；需要管理员处理配置/预算。默认配置缺失或已绑定配置的模型、供应商等可验证的配置问题解决后，worker 会自动恢复相应的 `blocked_config` 任务；密钥和网络地址类问题仍需管理员显式重试。已绑定的任务不会自动改绑到新的默认配置。
5. 若为 `cancelled` 且 `lastErrorCode: "ATTEMPT_VOIDED"`，表示关联作答已作废；保留记录，不重试，也不将其当作仍待完成的评分。

重试失败任务：

```http
POST /api/v1/agent/grading-jobs/{jobId}/retry
```

```json
{
  "expectedRevision": 4
}
```

- scope：`grading:request`。
- 仅允许本人状态为 `failed` 的任务；成功返回 202 和重新排队后的任务。
- 请求体可为空（`{}`）；`expectedRevision` 可选，但提供时必须匹配。
- 不是写分接口，也不会修改评分模式；`cancelled` 任务不满足 `failed` 条件，不能通过重试恢复作废作答。

## 外部 rubric 评分与修正

### 读取队列

```http
GET /api/v1/agent/grading-queue
```

只返回满足全部条件的项：

- 答案已锁定；
- 非空白答案；
- `gradingMode` 为 `external_rubric`；
- 尚无 `grade` 且 `gradingStatus` 为 `pending`。

每项包含 `attemptId`、`itemId`、`questionId`、`questionVersion`、`definition`、`maxScore`、`answer`、`answerRevision`、`lockedAt`、`generation`、`expectedGradeVersion: 0`。

### 首次提交逐项评分

以下示例使用[题目页](@skill/references/resources/questions.md)的两项 rubric，但题目须以 `external_rubric` 创建；假设已锁定答案如下：

```json
{ "text": "事务全部成功或全部回滚" }
```

每次提交都覆盖 `atomicity` 和 `example`，不能只提交改动项。

```http
POST /api/v1/agent/attempt-items/{itemId}/grades
```

```json
{
  "expectedGradeVersion": 0,
  "criterionResults": [
    {
      "criterionId": "atomicity",
      "levelId": "partial",
      "evidence": ["事务全部成功或全部回滚"],
      "explanation": "覆盖整体成功/回滚，但例子不完整"
    },
    {
      "criterionId": "example",
      "levelId": "not_met",
      "evidence": [],
      "explanation": "未提供转账或其他有效例子"
    }
  ]
}
```

仅允许字段：`expectedGradeVersion`、`criterionResults`、`reason`。发送 `score`、`maxScore`、未知字段会被拒绝。

`criterionResults` 约束：

- 必须覆盖 rubric 的全部得分项，不能漏项、重复或使用未知 `criterionId`/`levelId`。
- 项字段固定为 `criterionId`、`levelId`、`evidence`、`explanation`。
- `evidence` 最多 32 条；每条非空、最多 4000 字符，且必须是该得分项答案来源的精确子串。
- 简答题的来源是 `answer.text`；填空题的来源是该 `criterion.slotId` 对应空位的 `answer.slots[slotId]`。
- `creditBps > 0` 的等级至少需要一条证据。
- 空白来源必须选择 `creditBps: 0` 的等级，且证据为空。
- `explanation` 可为空字符串，最多 4000 字符。

服务端按得分项权重分配满分、按 `creditBps` 计算每项和总分，写入 `source: "external_agent"`、`version: 1` 的评分，并同步作答状态；仅正式有效作答的非完全未答错答可贡献错题，不能借评分让测试/作废作答计入学习数据。

### 修正已有外部评分

再次调用同一 `/grades` 路由，使用当前评分版本并增加 `reason`：

```http
POST /api/v1/agent/attempt-items/{itemId}/grades
```

```json
{
  "expectedGradeVersion": 1,
  "reason": "首次遗漏了答案中的回滚说明，按原 rubric 重新判断。",
  "criterionResults": [
    {
      "criterionId": "atomicity",
      "levelId": "met",
      "evidence": ["事务全部成功或全部回滚"],
      "explanation": "完整覆盖原得分项"
    },
    {
      "criterionId": "example",
      "levelId": "not_met",
      "evidence": [],
      "explanation": "仍未提供有效例子"
    }
  ]
}
```

- 已有评分时 `reason` 必填，非空且最多 4000 字符。
- 版本必须等于当前 `item.grade.version`，否则 409 `GRADE_VERSION_CONFLICT`。
- 新评分版本递增，旧评分进入 `gradingHistory`。
- 只能修正 `external_rubric`；`rule`/`model_rubric` 会被 409 `GRADING_MODE_FORBIDDEN` 拒绝。
- 不能借修正改变得分项集合或分数上限，服务端始终按冻结 rubric 和 maxScore 计算。

## 模型题重评

```http
POST /api/v1/agent/attempt-items/{itemId}/regrade
```

```json
{
  "expectedGradeVersion": 1,
  "reason": "首次结果可能遗漏了答案中已有的回滚说明。"
}
```

- scope：`grading:request`。
- 仅限 `model_rubric`、答案已锁定且非空的题目。
- 必须已有评分，`expectedGradeVersion` 等于当前评分版本且至少为 1。
- `reason` 必填，最多 4000 字符。
- 同一作答项已有活动评分任务时返回 409 `GRADING_ALREADY_ACTIVE`。
- 返回 202 和新 `GradingJob`；不会立即返回新分数，也不能附带替代答案、分数或新 rubric。
- 若没有默认评分模型，任务可能是 `blocked_config`；不要改用外部评分绕过。
- 默认评分模型由管理员在供应商与模型页面管理；配置并发数默认 2。更换模型或编辑配置只影响使用新配置的任务，既有任务仍使用原快照；配置不记录提示词版本。Agent 不能修改模型或评分配置。
