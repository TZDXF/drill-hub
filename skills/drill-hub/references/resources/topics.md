# 学习主题

[API 索引与通用协议](@skill/references/api.md)。以下响应字段均指成功信封中的 `data`；通用鉴权、错误和并发规则见索引。

| 方法  | 路径                        | scope           | 成功状态 | 说明     |
| ----- | --------------------------- | --------------- | -------- | -------- |
| GET   | `/api/v1/agent/topics`      | `read`          | 200      | 主题列表 |
| POST  | `/api/v1/agent/topics`      | `content:write` | 201      | 创建主题 |
| PATCH | `/api/v1/agent/topics/{id}` | `content:write` | 200      | 修改主题 |

## 响应字段

列表返回 `Topic[]`；创建、修改返回 `Topic`。

- [通用记录字段](@skill/references/api.md#通用记录字段)：`id`、`createdAt`、`updatedAt`、`revision`、`ownerId`、`archivedAt`。
- `title`: string — 主题标题。
- `goalText`: string — 学习目标，省略创建字段时返回空字符串。

## 请求与约束

创建：

```http
POST /api/v1/agent/topics
```

```json
{
  "title": "数据库基础",
  "goalText": "理解事务与隔离级别"
}
```

- `title`：必填非空字符串，最多 500 字符。
- `goalText`：可选字符串，最多 100000 字符，可为空；省略时为空字符串。
- 成功为 201，返回带 `id`、`revision`、`archivedAt` 的主题。

修改：

```http
PATCH /api/v1/agent/topics/{id}
```

```json
{
  "expectedRevision": 1,
  "title": "数据库与事务"
}
```

`expectedRevision` 必填；`title` 和 `goalText` 至少提供一个。主题已归档时返回 409。

读取列表时可传 `archiveState=active|archived|all`，默认 `active`。
