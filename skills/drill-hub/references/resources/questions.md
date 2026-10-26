# 题目、版本与 rubric

[API 索引与通用协议](@skill/references/api.md)。以下响应字段均指成功信封中的 `data`；通用鉴权、错误和并发规则见索引。

| 方法  | 路径                                        | scope           | 成功状态 | 说明               |
| ----- | ------------------------------------------- | --------------- | -------- | ------------------ |
| GET   | `/api/v1/agent/topics/{id}/questions`       | `read`          | 200      | 列出题目和全部版本 |
| POST  | `/api/v1/agent/topics/{id}/questions/batch` | `content:write` | 201      | 批量创建题目       |
| PATCH | `/api/v1/agent/questions/{id}`              | `content:write` | 200      | 创建题目新版本     |

## 响应字段

列表返回 `(Question & { versions: QuestionVersion[] })[]`；修改返回 `Question`。批量创建返回映射数组，见下方说明。

**Question**

- [通用记录字段](@skill/references/api.md#通用记录字段)。
- `topicId`: string — 所属主题。
- `version`: integer — 当前题目业务版本，不是乐观锁 revision。
- `definition`: QuestionDefinition — 完整题目与评分定义，字段见下文。
- `versions`: QuestionVersion[] — 仅列表附带；按 `version` 倒序，保留历史。

**QuestionVersion**

- `id`、`createdAt`、`updatedAt`、`revision`、`ownerId`。
- `questionId`: string；`version`: integer；`definition`: QuestionDefinition。

**批量创建映射**

- `clientRef`: string | null；`questionId`: string；`questionRevisionId`: string。
- `revision`: integer — 题目记录 revision，不是题目版本。
- `webUrl`: string — 相对 Web 路径（当前为 `/topics/{topicId}`），需保留部署路径前缀。

列表支持 `archiveState=active|archived|all`，默认 `active`。

## 请求与约束

- 题目定义采用字段白名单；仅接受下文列出的定义字段，嵌套选项、空位、评分键与 rubric 也校验字段。未知定义字段返回 `422 INVALID_QUESTION_FIELD`，不会被静默剥离。
- 批量创建和修改题目的请求外层、题目定义顶层均禁止 `ownerId`、`score`、`maxScore`、`correct`、`submittedAt`、`gradingStatus`、`answerStatus`、`startedAt`、`answerLinkId`、`voidedAt`、`voidedBy`、`voidReason`；即使值为 `null`、`false` 或 `0` 也返回 `422 CLIENT_FACT_FORBIDDEN`，`error.fields` 标出禁止字段。`maxScore` 只允许作为评估项的组卷配置，不属于题目定义。
- 一个批次中任意题目校验失败，整个批次回滚，不创建题目、版本或成功审计记录。修改校验失败不会改变当前题目、版本历史或已有作答快照。

读取：

```http
GET /api/v1/agent/topics/{topicId}/questions?archiveState=active
```

返回每道题及 `versions`（按版本倒序）。Agent 的 `read` scope 可看到评分键、参考答案、rubric 和历史版本；这些不等于可向未交卷学习者展示。

批量创建：

```http
POST /api/v1/agent/topics/{topicId}/questions/batch
```

```json
{
  "items": [
    {
      "clientRef": "q-1",
      "type": "short_answer",
      "stem": "请说明数据库事务的原子性，并举例。",
      "gradingMode": "model_rubric",
      "referenceAnswer": "事务整体成功或全部回滚；例如转账扣款与入账一起成功或回滚。",
      "rubric": {
        "version": 1,
        "criteria": [
          {
            "id": "atomicity",
            "description": "说明全部成功或全部回滚，不能只执行一部分。",
            "weight": 6,
            "levels": [
              { "id": "not_met", "creditBps": 0, "description": "未说明或错误" },
              { "id": "partial", "creditBps": 5000, "description": "只提到部分含义" },
              { "id": "met", "creditBps": 10000, "description": "完整准确" }
            ]
          },
          {
            "id": "example",
            "description": "给出符合原子性的例子。",
            "weight": 4,
            "levels": [
              { "id": "not_met", "creditBps": 0, "description": "没有有效例子" },
              { "id": "met", "creditBps": 10000, "description": "例子有效" }
            ]
          }
        ]
      }
    },
    {
      "clientRef": "q-2",
      "type": "fill_blank",
      "stem": "计算 1 + 2 = __。",
      "gradingMode": "rule",
      "slots": [{ "id": "s1" }],
      "gradingKey": {
        "acceptedAnswers": { "s1": ["3", "3.0"] }
      },
      "explanation": "1 + 2 = 3。"
    }
  ]
}
```

- `items` 为 1 至 100 项；整批在同一事务写入。
- `clientRef` 可选、最多 128 字符，同批不能重复；仅用于关联响应，不是持久幂等键。
- 响应包含每项的 `clientRef`、`questionId`、`questionRevisionId`、`revision`、`webUrl`。
- 批内任一项校验失败，整批不创建。

题目定义字段：

| 字段              | 说明                                                                           |
| ----------------- | ------------------------------------------------------------------------------ |
| `type`            | `single_choice`、`multiple_choice`、`true_false`、`fill_blank`、`short_answer` |
| `stem`            | 必填题干，纯文本                                                               |
| `options`         | 单选/多选必填，2 至 100 个 `{ id: string, text: string }`                      |
| `slots`           | 填空题必填，1 至 100 个 `{ id: string }`                                       |
| `gradingMode`     | `rule`、`model_rubric`、`external_rubric`                                      |
| `gradingKey`      | 仅 `rule`；按题型提供正确选项/布尔值/各空位可接受答案                          |
| `referenceAnswer` | 可选参考答案                                                                   |
| `rubric`          | `model_rubric`/`external_rubric` 必填                                          |
| `explanation`     | 可选解析                                                                       |
| `tags`            | 可选字符串数组                                                                 |

题型与模式组合：

| 题型                                               | 允许的 gradingMode                          |
| -------------------------------------------------- | ------------------------------------------- |
| `single_choice` / `multiple_choice` / `true_false` | `rule`                                      |
| `fill_blank`                                       | `rule` / `model_rubric` / `external_rubric` |
| `short_answer`                                     | `model_rubric` / `external_rubric`          |

不适用的 `options`、`slots` 不应提交。`stem` 最多 100000 字符；选项 ID、空位 ID 最多 128 字符且各自不可重复；选项文本最多 20000 字符。选项 ID、选项文本、空位 ID 均为非空字符串；数字选项也要写成字符串，例如 `{ "id": "a", "text": "5" }`，不能写成 `{ "id": "a", "text": 5 }`。

rubric 结构约束：

- `rubric.version` 必须为 `1`，`criteria` 为 1 至 100 项。
- 每个得分项：`id` 唯一、`description` 非空、`weight` 为 1 至 1000000 的整数。
- 每个得分项有 2 至 32 个 `levels`；等级 `id` 在项内唯一，`creditBps` 为 0 至 10000 的整数，且必须同时出现 `0` 和 `10000`。
- 得分项及等级的 `description` 应使用中文。学习端作答/报告的 `item.grade.criterionResults` 保留 `criterionId`、`levelId`，并附带 `criterionDescription`、`levelDescription`，来自本次作答冻结的题目版本；仅在练习本题锁定或考试整体交卷后返回。Agent 评分提交仍只使用 ID，不提交这些展示字段。
- 填空题的每条 criterion 都必须提供 `slotId`，且每个空位都要被某条 criterion 覆盖；非填空题不能提供 `slotId`。
- 评估项 `maxScore` 必须足够高，使按权重分配后每条 criterion 都得到正分。

`rule` 模式的评分键：

- 单选：`{ "optionId": "..." }`
- 多选：`{ "optionIds": ["...", "..."] }`
- 判断：`{ "value": true }`
- 填空：`{ "acceptedAnswers": { "slotId": ["答案1", "答案2"] } }`。`acceptedAnswers` 必须是 JSON 对象，键与 `slots[].id` 完全一致并覆盖每个空位，不能有多余空位；每个值都必须是字符串数组，包含 1 至 100 个不重复的非空字符串。数字答案也要写成字符串，例如 `{ "acceptedAnswers": { "s1": ["3", "3.0"] } }`，不能写成数字、单个字符串或序列化后的 JSON 字符串。填空按精确字符串匹配，不做 trim/大小写折叠。

修改题目：

```http
PATCH /api/v1/agent/questions/{id}
```

```json
{
  "expectedRevision": 1,
  "definition": {
    "type": "true_false",
    "stem": "事务具有原子性",
    "gradingMode": "rule",
    "gradingKey": { "value": true }
  }
}
```

- `definition` 是完整的新定义；也可以把定义字段平铺在请求体，但推荐使用 `definition` 以避免歧义。
- 成功后题目 `version` 增加并写入新的 `questionVersions` 记录；仅替换当前题目的定义，不修改已有版本行、作答冻结定义、答案或评分历史。
- 已归档题目不能修改。
- 已有评估项仍固定原 `questionVersion`；需要新版本时创建/修改评估并显式引用新版本。
