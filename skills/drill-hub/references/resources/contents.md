# Markdown 学习内容

[API 索引与通用协议](@skill/references/api.md)。以下响应字段均指成功信封中的 `data`；通用鉴权、错误和并发规则见索引。

| 方法  | 路径                                 | scope           | 成功状态 | 说明         |
| ----- | ------------------------------------ | --------------- | -------- | ------------ |
| GET   | `/api/v1/agent/topics/{id}/contents` | `read`          | 200      | 主题内容列表 |
| POST  | `/api/v1/agent/topics/{id}/contents` | `content:write` | 201      | 创建内容     |
| PATCH | `/api/v1/agent/contents/{id}`        | `content:write` | 200      | 修改内容     |

## 响应字段

列表返回 `Content[]`；创建、修改返回 `Content`。

- [通用记录字段](@skill/references/api.md#通用记录字段)。
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

## 阅读页渲染能力

`bodyText` 保存 Markdown 源码，阅读页在客户端静态渲染。Agent 提交内容时可以使用以下语法，均已本地渲染、无外部依赖：

- **GFM**：标题、列表、任务列表、表格、引用、删除线、脚注、链接与图片。图片支持点击缩放。
- **代码块**：围栏代码块按语言标识做语法高亮（Shiki），支持常见语言；`mermaid 与 `infographic 代码块会渲染为图表而不是代码。
- **数学公式（KaTeX）**：行内 `$...$`，块级 `$$...$$`。例如 `$E = mc^2$`。
- **Mermaid 图表**：```mermaid 代码块，支持 flowchart/graph、sequenceDiagram、classDiagram、stateDiagram、erDiagram、gantt、pie、mindmap 等 Mermaid 官方图表类型。读者可切换预览/源码。Mermaid 以 strict 安全级别渲染，不支持 `click` 交互与 HTML 标签。
- **信息图（AntV Infographic）**：```infographic 代码块，使用信息图 DSL（首行 `infographic <模板名>`，随后 `data` 等小节）。适合流程、层级、对比、时间线类内容。注意：`icon`/`illus` 字段依赖外部图标服务，阅读页会剥离这两个字段，不要在 DSL 中依赖它们；数据条目用 `label`/`desc`/`value` 表达即可。

安全约束：原始 HTML 不作为标签执行；`javascript:`、`data:`、`file:` 等协议的链接和图片会被拦截。内容必须保持纯 Markdown 语义，不要内嵌脚本或事件属性。
