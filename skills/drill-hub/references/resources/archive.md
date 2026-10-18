# 归档与恢复

[API 索引与通用协议](../api.md)。以下响应字段均指成功信封中的 `data`；通用鉴权、错误和并发规则见索引。

| 方法 | 路径                                          | scope           | 成功状态 | 说明           |
| ---- | --------------------------------------------- | --------------- | -------- | -------------- |
| GET  | `/api/v1/agent/archive`                       | `read`          | 200      | 归档元数据列表 |
| POST | `/api/v1/agent/resources/{type}/{id}/archive` | `archive:write` | 200      | 归档资源       |
| POST | `/api/v1/agent/resources/{type}/{id}/restore` | `archive:write` | 200      | 恢复资源       |

## 响应字段

列表返回 `ArchiveMetadata[]`；归档/恢复返回对应类型的完整资源记录，不是元数据或 `{ success: true }`。

**ArchiveMetadata**

- `resourceType`: `topic|plan|content|question|assessment`。
- `id`: string；`title`: string；`archivedAt`: string（非 null）；`revision`: integer。
- 题目的 `title` 使用题干；列表不返回正文和评分定义。

## 请求与约束

归档：

```http
POST /api/v1/agent/resources/content/{contentId}/archive
```

```json
{
  "expectedRevision": 2
}
```

恢复：

```http
POST /api/v1/agent/resources/content/{contentId}/restore
```

```json
{}
```

- scope：`archive:write`。
- `{type}` 只能是 `topic`、`plan`、`content`、`question`、`assessment`。
- `expectedRevision` 可选；提供时必须是当前 revision。对已经是目标归档状态的资源调用会幂等返回当前记录。
- 请求体必须是 JSON 对象；恢复时可发送 `{}`。
- 没有永久删除路由。

列出归档：

```http
GET /api/v1/agent/archive
GET /api/v1/agent/archive?resourceType=question
```

返回 `{ resourceType, id, title, archivedAt, revision }` 数组，按归档时间倒序；不返回正文或题目定义。需要完整归档资源时，使用对应列表的 `archiveState=archived|all`。

作答不在归档资源白名单中。误交卷等情况使用独立的 [`POST /api/v1/agent/attempts/{id}/void`](results.md#作废作答)，需 `attempt:write`、作答当前 `expectedRevision` 和原因；不能用归档/恢复接口替代作废。作废不删除答案、评分历史或审计；未结束评分任务标为 `cancelled` / `ATTEMPT_VOIDED`，不再作为学习统计、错题或任务完成依据。

资源列表默认 `archiveState=active`。归档不级联，父主题归档不会自动归档或修改子资源；已归档资源保持历史可读，但不能执行内容修改或重新加入新计划/试卷。
