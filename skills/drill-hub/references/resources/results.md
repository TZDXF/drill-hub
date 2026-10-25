# 学习摘要、作答与错题

[API 索引与通用协议](@skill/references/api.md)。以下响应字段均指成功信封中的 `data`；通用鉴权、错误和并发规则见索引。

| 方法  | 路径                                                 | scope           | 成功状态 | 说明                   |
| ----- | ---------------------------------------------------- | --------------- | -------- | ---------------------- |
| GET   | `/api/v1/agent/learning-summary`                     | `read`          | 200      | 增量学习摘要           |
| GET   | `/api/v1/agent/attempts`                             | `read`          | 200      | 作答列表               |
| GET   | `/api/v1/agent/attempts/{id}`                        | `read`          | 200      | 作答详情               |
| POST  | `/api/v1/agent/attempts/{id}/void`                   | `attempt:write` | 200      | 作废本人作答，保留历史 |
| GET   | `/api/v1/agent/wrong-questions`                      | `read`          | 200      | 错题列表               |
| PATCH | `/api/v1/agent/wrong-questions/{questionId}/mastery` | `content:write` | 200      | 更新错题掌握状态       |

## 响应字段

**学习摘要**：`{ topics: Topic[], plans: LearningPlan[], recentAttempts: Attempt[], wrongQuestions: WrongQuestion[] }`。

**Attempt**（列表返回数组，详情返回单个）

- `id`、`createdAt`、`updatedAt`、`revision`、`ownerId`。
- `topicId`: string；`assessmentId`: string | null；`answerLinkId`: string | null；`title`: string；`kind`: `practice|exam`。
- `purpose`: `learning|test` — 正式学习或测试；不能将既有学习作答改为测试。
- `taskId`: string | null — 已关联的单一任务（显式指定或唯一匹配）；null 表示不影响任何任务。
- `voidedAt`: string | null；`voidedBy`: string | null；`voidReason`: string | null — 作废时间、操作人和原因；未作废时为 null。
- `status`: `in_progress|pending_grading|completed` — 作答流程状态，不代表用途或有效性；须同时检查 `purpose` 和 `voidedAt`。
- `startedAt`: string；`expiresAt`: string | null；`submittedAt`: string | null。
- `submissionReason`: `user_submitted|time_expired` | null。
- `items`: AttemptItemSnapshot[]。

学习端 **AttemptView** 同样包含 `purpose`、`taskId`、`voidedAt`、`voidedBy`、`voidReason`。其 `source: personal|answer_link` 只作来源追溯，不决定统计、错题或任务资格；不暴露链接秘钥或 `answerLinkId`。

**AttemptItemSnapshot**

- `id`: string；`questionId`: string；`questionVersion`: integer。
- `definition`: [QuestionDefinition](@skill/references/resources/questions.md) — 冻结题目，包括答案键和 rubric。
- `maxScore`: string；`answer`: Answer | null；`answerRevision`: integer。
- `lockedAt`: string | null；`generation`: integer。
- `gradingStatus`: `not_started|pending|running|failed|completed` — 尚未开始、等待、运行、失败或完成评分；不再使用 `unanswered` 表示评分状态。
- `grade`: [GradeResult](@skill/references/resources/grading.md#评分结果) | null；`gradingHistory`: GradeResult[]。
- `Answer` 按题型为 `{ optionId: string }`、`{ optionIds: string[] }`、`{ value: boolean }`、`{ slots: Record<string, string> }` 或 `{ text: string }`。

**学习端 AttemptItemView**

- `answerStatus`: `unanswered|partial|answered` — 完全未答、部分作答、已作答，与 `gradingStatus` 独立。`partial` 表示填空题有非空答案但尚有空位未填，不是部分得分；`answered` 也不表示答对。
- `gradingStatus` 使用上述五种评分进度，不含 `unanswered`。
- `answerStatus` 是学习端项投影字段，当前 Agent 返回的原始 `AttemptItemSnapshot` 不包含该字段；不要假设 `GET /agent/attempts/{id}` 会新增它。

**WrongQuestion**（列表返回数组，修改返回单个）

- `id`、`createdAt`、`updatedAt`、`revision`、`ownerId`。
- `topicId`: string；`questionId`: string。
- `masteryStatus`: `pending|reviewing|mastered`。
- `lastWrongAt`: string；`lastPracticedAt`: string；`wrongCount`: integer。

Agent 错题列表只返回上述记录，不包含学习端附加的题干投影。

## 副作用表

免登录链接只免登录，作答背后已有所属用户 `ownerId`。**正式有效**指 `purpose: "learning"` 且 `voidedAt: null`；`personal|answer_link` 两种来源执行相同规则。评分、答案状态与是否计入学习数据分别判断，不能用“零分”“已完成”或来源标签替代。

| 操作或场景                     | 答案、评分与历史                                                                          | 所属用户学习统计           | 错题                                   | 计划任务                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------- | --------------------------------------------- |
| Agent GET 读取、查看已交卷报告 | 不提交新答案或评分                                                                        | 读取不改变统计资格         | 不因读取新增                           | 不因读取完成                                  |
| 创建答题链接                   | 创建入口，不等于交卷；默认 `purpose: "learning"`                                          | 创建链接本身不计作一次交卷 | 不新增                                 | 不完成；记录显式或唯一匹配的 `taskId` 关联    |
| 正式有效练习交卷，至少一项非空 | 按实际答案评分并保留                                                                      | 计入，不区分来源           | 已作答且答错的项可计入，包括部分作答   | 仅可完成已关联且匹配的 `taskId`               |
| 正式有效练习全空交卷           | 未答项由系统记零分并保留                                                                  | 计入，未答单列             | 完全未答项不计入                       | 不完成任务                                    |
| 正式有效考试交卷或超时         | 按实际答案评分；未答项由系统记零分                                                        | 计入，不区分来源           | 完全未答项不计入；部分作答答错可计入   | 仅可完成已关联且匹配的 `taskId`，全空也可完成 |
| 测试作答（`purpose: "test"`）  | 仍可保存答案、评分和历史，不伪造成正式学习                                                | 不计入                     | 不计入                                 | 不影响，即使指定了 `taskId`                   |
| 作废作答（`voidedAt` 非 null） | 保留答案、评分、评分历史及审计；未结束评分任务标为 `cancelled` / `ATTEMPT_VOIDED`，不删除 | 不计入                     | 不作为错题依据                         | 不作为任务完成依据，不连带影响无关任务        |
| 评分完成、修正或重评           | 保留评分版本和历史；分数由服务端计算                                                      | 仅正式有效作答可贡献统计   | 仅正式有效且非完全未答的错答可贡献错题 | 不额外关联任务，不替代交卷完成规则            |

- 学习端读取到期但未交卷的作答/报告时，服务端可能触发超时交卷；这仍按上表的正式/测试用途和已保存的任务关联处理，不能把所有 GET 都当作免除到期结算。
- `taskId` 必须指向单一同属用户、`kind` 匹配且 `targetId` 为该 `assessmentId` 的任务。正式学习未指定 `taskId` 时，仅自动关联同一用户、同一主题下未归档计划中唯一匹配的任务；无匹配或多项匹配时不关联，测试不自动关联。在创建链接、开始个人作答（含复用未关联的进行中作答）或首次开始链接作答时解析关联，不追溯修改已交卷作答；其他计划中引用同一评估的任务不会被连带完成。
- 作废后的记录保留可追溯性，但不再作为统计、错题或任务完成依据；不能借作废删除答案、篡改分数或抹去审计，也不能把作废误当作资源归档。
- 临时链接是敏感访问凭证；持有人正式作答会影响所属用户的数据，不要把“免登录”当成“试用”或“无副作用”。验证流程应在创建时选 `test`，而非事后修改学习作答的用途。

## 查询参数

| 路由             | 可选查询                            | 语义                                                                              |
| ---------------- | ----------------------------------- | --------------------------------------------------------------------------------- |
| learning-summary | `since`                             | 可解析的 ISO 时间；分别返回各表 `updatedAt >= since` 的记录（含归档），不是事件流 |
| attempts         | `status`、`topicId`、`assessmentId` | 精确匹配，可组合；status 取上述作答状态                                           |
| wrong-questions  | `topicId`、`masteryStatus`          | 精确匹配，可组合                                                                  |

以上接口不使用 `archiveState`，不支持分页，也不承诺额外排序。摘要中的 `recentAttempts` 不代表限量的最近 N 条。不要据新增响应字段推断存在 `purpose`、`taskId` 或作废状态筛选参数。

`GET /agent/attempts` 包含本人评估通过临时答题链接产生的免登录作答，Agent 可通过非空 `answerLinkId` 追溯来源；`learning-summary.recentAttempts` 只纳入正式有效作答，包含符合条件的链接作答，不按来源排除；测试/作废记录仍可通过作答列表追溯，但不纳入该摘要。Web/Android 学习历史标注来源，发布者可登录只读查看详情和报告，不受临时链接过期限制。历史可见不等于计入统计，测试和作废记录仍按上表排除学习副作用。

不要假设有推送或 Webhook。只在用户需要时读取：

```http
GET /api/v1/agent/learning-summary?since=2026-10-01T00:00:00Z
```

`since` 可选、必须是可解析时间；筛选 `updatedAt >= since` 的主题、计划、近期作答和错题。

```http
GET /api/v1/agent/attempts?status=pending_grading&topicId={topicId}
```

支持 `status`、`topicId`、`assessmentId` 过滤，但当前返回全部匹配项，没有分页。

```http
GET /api/v1/agent/attempts/{id}
```

返回 `Attempt`：包含用途、任务关联、作废信息及冻结的 `items[].definition`（含 rubric/评分键）、`answer`、`gradingStatus`、`grade`、`gradingHistory`、`generation` 等。

- 模型评分未完成时 `grade` 可能为 `null`；不要把 `null` 当作 0 分。
- 完全未答项交卷后在学习端仍为 `answerStatus: "unanswered"`，由系统以 `source: "system"` 记零分，评分完成后 `gradingStatus: "completed"`；不标记为模型/Agent 评分，也不生成错题。部分作答答错则可计错题。
- `completed` 且 `grade.version` 为当前有效评分；重评历史在 `gradingHistory`。
- `attempt.status`：`in_progress`、`pending_grading`、`completed`；与用途、作废状态分开。
- 学习者报告提供 `unansweredCount`（完全未答题数），不能仅从零分题数推算；未答仍按零分参与报告分数。
- Agent 没有单独的 `/agent/attempts/{id}/report`；如用户还持有学习者会话并需要汇总 `awardedScore`/`isFinal`/`unansweredCount`，可使用学习者路由 `/api/v1/attempts/{id}/report`，但不要用 Agent 令牌调用。

## 作废作答

```http
POST /api/v1/agent/attempts/{id}/void
```

```json
{
  "expectedRevision": 3,
  "reason": "误将验证流程作为正式学习交卷，作废但保留记录。"
}
```

- 需要独立 scope `attempt:write`；只能作废令牌所属用户的作答，管理员也不能绕过 owner 校验。
- `expectedRevision` 必填，为作答当前 `revision`，且为大于等于 1 的整数；不能用题目版本、评分版本或父计划 revision 替代。版本冲突按通用 `409 VERSION_CONFLICT` 处理，重新读取后再确认，不能静默覆盖。
- `reason` 必填、非空且最多 4000 字符；不要把凭证或完整答案放进原因。
- 关联的未结束评分任务会标记为 `status: "cancelled"`、`lastErrorCode: "ATTEMPT_VOIDED"`；任务保留可追溯，不能通过失败任务重试路由恢复。
- 成功返回 200，`data` 为更新后的 `Attempt`；通过 `voidedAt`、`voidedBy`、`voidReason` 追溯，并保留答案、评分、评分历史与审计，不提供永久删除。按需重新 GET 作答核对。
- 作废不等于将 `purpose` 改成 `test`，不能把既有学习作答改为测试；本页未定义用途修改、恢复作废或批量作废接口。
- 当前没有通用幂等语义；网络失败后先读取核对作废状态和 revision，不要盲目重复请求。已作废记录会返回 `409 ATTEMPT_VOIDED`；携带旧 revision 时仍可能先遇到版本冲突。

## 修改错题掌握状态

```http
PATCH /api/v1/agent/wrong-questions/{questionId}/mastery
```

```json
{
  "expectedRevision": 1,
  "masteryStatus": "reviewing"
}
```

路径参数是 `questionId`，不是错题记录 `id`。`expectedRevision` 则是错题记录的 revision，必须是当前版本。`masteryStatus` 必填且只能是 `pending`、`reviewing`、`mastered`；成功返回更新后的错题记录。
