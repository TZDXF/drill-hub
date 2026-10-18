# Markdown 学习内容

[API 索引与通用协议](../api.md)。以下响应字段均指成功信封中的 `data`；通用鉴权、错误和并发规则见索引。

| 方法  | 路径                                 | scope           | 成功状态 | 说明         |
| ----- | ------------------------------------ | --------------- | -------- | ------------ |
| GET   | `/api/v1/agent/topics/{id}/contents` | `read`          | 200      | 主题内容列表 |
| POST  | `/api/v1/agent/topics/{id}/contents` | `content:write` | 201      | 创建内容     |
| PATCH | `/api/v1/agent/contents/{id}`        | `content:write` | 200      | 修改内容     |

## 响应字段

列表返回 `Content[]`；创建、修改返回 `Content`。

- [通用记录字段](../api.md#通用记录字段)。
- `topicId`: string — 所属主题 ID。
- `title`: string — 内容标题。
- `bodyText`: string — 原始 Markdown，不是预渲染 HTML。

列表支持 `archiveState=active|archived|all`，默认 `active`。

## 请求与约束

创建：

```http
POST /api/v1/agent/topics/{topicId}/contents
```

```json
{
  "title": "事务笔记",
  "bodyText": "## 事务\n\n事务应满足 **ACID**。"
}
```

- `title`：必填非空，最多 500 字符。
- `bodyText`：必填非空，最多 1000000 字符；保存 Markdown 源码，阅读页静态渲染；Agent 应提交 Markdown 而不是预渲染 HTML，原始 HTML 不作为标签执行。
- 成功为 201。

修改：

```http
PATCH /api/v1/agent/contents/{id}
```

```json
{
  "expectedRevision": 1,
  "bodyText": "## 更新后的笔记\n\n- 原子性\n- 一致性"
}
```

- `expectedRevision` 必填；`title`/`bodyText` 至少提供一个，提供时不能为空。
- 已归档内容不能修改。
