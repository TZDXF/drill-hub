# 计划、阶段与任务

[API 索引与通用协议](../api.md)。以下响应字段均指成功信封中的 `data`；通用鉴权、错误和并发规则见索引。

| 方法  | 路径                              | scope           | 成功状态 | 说明           |
| ----- | --------------------------------- | --------------- | -------- | -------------- |
| GET   | `/api/v1/agent/topics/{id}/plans` | `read`          | 200      | 主题计划列表   |
| POST  | `/api/v1/agent/topics/{id}/plans` | `content:write` | 201      | 创建计划       |
| PATCH | `/api/v1/agent/plans/{id}`        | `content:write` | 200      | 整体修改计划   |
| PATCH | `/api/v1/agent/tasks/{id}`        | `content:write` | 200      | 修改或移动任务 |

## 响应字段

列表返回 `LearningPlan[]`；创建、修改计划返回 `LearningPlan`；修改任务只返回 `LearningTask`，不返回父计划的新 revision。

**LearningPlan**

- [通用记录字段](../api.md#通用记录字段)。
- `topicId`: string — 所属主题 ID。
- `title`: string — 计划标题。
- `phases`: PlanPhase[] — 有序阶段。

**PlanPhase**

- `id`: string；`title`: string；`tasks`: LearningTask[]（有序）。

**LearningTask**

- `id`: string；`title`: string。
- `kind`: `reading|practice|exam|manual`。
- `targetId`: string | null — 引用内容或评估；manual 无目标。
- `scheduledDate`: string | null — `YYYY-MM-DD`。
- `estimatedMinutes`: integer | null。
- `status`: `todo|in_progress|completed`。
- `completedAt`: string | null — 服务端维护，不作为可自由写入的事实字段。

列表支持 `archiveState=active|archived|all`，默认 `active`。修改任务后如要继续写入，重新列出父计划读取最新 revision。

## 学习端完成规则

- 学习者从计划打开阅读内容并成功加载后，客户端自动完成该来源阅读任务；不要求停留时长或滚动到底。
- 直接打开内容（未携带来源计划与任务）不更新任务；同一内容被多个计划引用时，不会连带完成其他任务。
- 已完成任务不重复写入；已归档计划仅供查看，不自动更新。普通任务仍由用户手动标记。
- 练习/考试只根据明确关联的单一 `taskId` 更新；任务与作答须同属用户、类型匹配，任务目标为该评估。不传 `taskId` 不影响任务；不会批量完成其他引用同一评估的任务。
- 正式有效练习至少有一项非空作答才可在交卷后完成关联任务，全空交卷不完成。正式有效考试交卷或超时可完成关联任务，包括全空交卷。
- `purpose: "test"` 或已作废的作答不作为任务完成依据，测试即使指定 `taskId` 也不影响任务。`source: personal|answer_link` 只追溯来源，不决定完成资格；免登录正式作答遵循相同规则。详见[副作用表](results.md#副作用表)。

## 请求与约束

创建：

```http
POST /api/v1/agent/topics/{topicId}/plans
```

```json
{
  "title": "第一周",
  "phases": [
    {
      "title": "基础阅读",
      "tasks": [
        {
          "title": "阅读事务笔记",
          "kind": "reading",
          "targetId": "{contentId}",
          "scheduledDate": "2026-10-20",
          "estimatedMinutes": 30
        }
      ]
    }
  ]
}
```

- `title`：必填，最多 500 字符。
- `phases`：可省略，最多 100 个阶段。
- 阶段：可选已有 `id`；新阶段用 `title` 创建。
- 阶段内 `tasks` 可省略，最多 500 项。
- 任务：`title`、`kind` 必填；`targetId`、`scheduledDate`、`estimatedMinutes` 可选。
- `kind`：`reading`、`practice`、`exam`、`manual`。
- `scheduledDate`：`YYYY-MM-DD` 或 `null`。
- `estimatedMinutes`：正整数、最多 100000，或 `null`。
- 新任务只能 `todo`，且不能提供非空 `completedAt`。
- `reading.targetId` 必须引用同主题内容；`practice`/`exam.targetId` 必须引用同主题且同类型的评估；`manual.targetId` 必须为 `null`/省略。

修改计划：

```http
PATCH /api/v1/agent/plans/{id}
```

```json
{
  "expectedRevision": 1,
  "phases": [
    {
      "id": "{existingPhaseId}",
      "title": "基础阅读",
      "tasks": [
        {
          "id": "{existingTaskId}",
          "title": "阅读事务笔记",
          "kind": "reading",
          "targetId": "{contentId}",
          "status": "todo"
        }
      ]
    }
  ]
}
```

- `expectedRevision` 必填；`title` 和 `phases` 至少提供一个。
- `phases` 是完整的新结构；保留已有 ID 才能复用阶段、任务状态与完成历史。
- 不能复用未知 ID。
- 已开始或已完成的任务不能更改 `kind`/`targetId`，也不能从计划中删除。
- 已归档计划不能修改。

单独修改/移动任务：

```http
PATCH /api/v1/agent/tasks/{taskId}
```

```json
{
  "expectedRevision": 3,
  "title": "复习事务笔记",
  "status": "in_progress",
  "phaseId": "{targetPhaseId}",
  "position": 0
}
```

- `expectedRevision` 是父计划 revision。
- 可更新 `title`、`scheduledDate`、`estimatedMinutes`、`status`。
- 要移动时必须提供 `phaseId`；`position` 可选，必须落在目标阶段的可插入范围内。只给 `position` 不给 `phaseId` 会失败。
- 状态只能是 `todo`、`in_progress`、`completed`。`practice`/`exam` 任务只能按上述规则由明确关联的正式有效作答交卷或考试超时自动完成，Agent 直接将未完成此类任务改为 `completed` 会返回 `409 TASK_KIND_NOT_COMPLETABLE`；改回其他状态会清空 `completedAt`。
