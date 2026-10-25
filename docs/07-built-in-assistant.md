# 07 · 内置学习助手（Built-in Assistant）

基线：v0.3。内置对话助手已实现（首版），基于 [Pi](https://pi.dev)（`@earendil-works/pi-coding-agent` + `@earendil-works/pi-ai`）作为服务端 Agent 运行时。本文描述当前实际行为与安全边界。

## 1. 定位与职责

- 内置助手是**交互式用户功能**：登录用户在应用内对话，不是外部 Agent API，不消耗也不接受 `dhk.` 令牌。
- 助手以**当前用户身份**通过真实 API 端点读写本人学习数据；没有独立的数据通道，权限与学习者接口一致。
- 服务端独占编排：Pi 会话、工具执行、MCP 连接与模型密钥只在服务端进程内存在，不进入浏览器或 Android 包。

## 2. 架构与一轮对话的生命周期

```text
POST /me/assistant/threads/:id/messages → 202（创建 turn，可带 providerModelId 按轮选择模型）
  → Pi 会话工厂：
     · pi-ai Model<'openai-completions'>（按轮 providerModelId 选择；缺省回退到最早的启用模型，
       baseUrl/密钥从 modelConnections 解密后内存注入 setRuntimeApiKey，不落盘；
       模型默认参数 contextWindow/maxTokens/reasoning/input/cost 一并写入 models.json）
     · tools 白名单：5 个自定义工具（drill_hub_api/drill_hub_api_help/web_search/navigate/set_layout），
       Pi 内置 read/bash/edit/write 等文件工具全部不注册
     · MCP 扩展 + 管理员配置的启用服务器；Skills 目录物化（DB → SKILL.md）
  → session.prompt() → session.subscribe 事件桥接（text_delta / tool_execution_*）
  → 事件与消息持久化 + 进程内 SSE hub 广播
GET /me/assistant/threads/:id/stream?after=<seq>（SSE；断线游标补齐）
GET /me/assistant/threads/:id/events?after=<seq>（按游标读取持久化事件，客户端不用于轮询）
GET /me/assistant/models（对话可选模型：仅返回启用模型及其启用连接，含价格与默认参数）
```

- turn 状态机：`queued → running → succeeded | failed | cancelled`；同线程同时仅 1 个活动 turn（409 `ACTIVE_TURN_EXISTS`）。
- 不再限制同时执行的对话轮数、单轮超时与搜索结果上限；用户可随时取消（`POST /me/assistant/turns/:id/cancel`）。
- 模型选择在对话中完成：输入框上方按供应商分组选择（或"自动选择"），选择随该轮请求发送；无效/停用的模型在提交时立即 422 `INVALID_MODEL`。
- 进程重启不恢复模型中间态：重启时未完成 turn 标记为失败（`ASSISTANT_RESTARTED`）并广播错误事件。
- 文本增量每秒 flush 到 `assistantMessages.content`；流式中断时保留已生成部分。

## 3. 工具集与白名单

| 工具                 | 说明                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `drill_hub_api`      | 以当前用户身份经 `app.inject()` 执行真实端点；方法+路径白名单                                                                                                 |
| `drill_hub_api_help` | 返回真实学习端点、请求字段和约束；端点目录与 `drill_hub_api` 白名单共用，避免模型猜测接口                                                                     |
| `web_search`         | 走管理员配置的搜索服务（tavily/brave/searxng/openai_responses）                                                                                               |
| `navigate`           | 生成 `ui_action` 事件，前端跳转到白名单路由（home/topics/topic/plan/content/assessment/attempt/report/wrong-questions/wrong-question-detail/history/archive） |
| `set_layout`         | 生成 `ui_action` 事件；split/chat/content 与面板宽度 320–560                                                                                                  |

`drill_hub_api` 白名单显式排除：

- `/admin/*`、`/auth/*`、`/me/*`（`/me/assistant/*` 同时防止递归自调用）；
- 返回冻结答案/得分项的端点：`/agent/attempts*`、`/agent/learning-summary`；题库端点对助手使用专门投影，隐藏评分键、参考答案、rubric 和解析；
- 外部批改职责端点：`/agent/grading-queue`、`/agent/attempt-items/:id/grades`；助手仍可读取评分任务、重试失败任务和请求模型重评，不能提交外部批改结果或手工改分。

每轮限额：API 调用 ≤100 次、写操作 ≤30 次。学习者端点既有投影（进行中考试不返回答案/得分项）天然约束助手可见数据。助手可以直接创建主题等内容，不需要外部 Agent 令牌；所有写操作仍受所有权、revision 和服务端校验约束。

## 4. 内部令牌

`drill_hub_api` 的 `app.inject()` 自调用使用 `dhi.` 前缀的无状态 HMAC 内部令牌（密钥为主加密密钥）：

- 绑定单一 turn 与用户，有效期为签发起 24 小时（`INTERNAL_TOKEN_TTL_MS`）；不落库、不写日志、外部不可伪造；
- 以发起用户身份通过 `requireUser`；`requireAdmin` 对内部令牌无条件拒绝（管理员用户发起的助手会话同样无管理权限）；
- 内部令牌请求不写 API 访问日志（防止单轮对话放大日志量），业务写操作仍由各端点审计覆盖。

## 5. 搜索服务（管理员配置）

- 类型：`tavily`（POST /search）、`brave`（GET /res/v1/web/search）、`searxng`（GET /search?format=json）、`openai_responses`（POST {baseUrl}/responses + tools:[{type:'web_search'}]，引用注解转为结果条目）。
- 出站复用模型供应商的 SSRF 防护（DNS 全结果校验、拒绝私网/保留地址、禁止重定向）；`ALLOW_PRIVATE_SEARCH_URLS=true` 显式放行内网 SearXNG 等自建部署。
- API 密钥经 SecretVault 加密保存，视图只暴露 `apiKeyConfigured`；默认使用第一个启用的提供方。

## 6. MCP 与 Skills（管理员配置）

- MCP 服务器：stdio（command/args/env）或 http（url/headers，仅 streamable HTTP）；env/headers 加密存储；`exposure` 支持 direct/deferred；**创建后默认停用**，启用需管理员显式操作并审计。stdio 会在服务端 spawn 子进程，管理页有明确提示。http 地址默认拒绝内网。
- Skills：名称+描述+Markdown 指令存 DB，会话构建时物化为 `SKILL.md` 目录交给 Pi 资源加载器；名称限小写字母/数字/连字符且唯一。
- SDK 会话不加载 Pi CLI 内置扩展，仅显式挂载 MCP 扩展与上述白名单工具。

## 7. 用量与审计

- 每轮对话按实际 turn 结束写入 `modelUsage`（purpose=`assistant`，含多轮工具调用的累计 usage；失败轮也记录）；Token 用量页展示该用途。
- 配置变更（搜索服务、MCP、Skills）与线程删除写审计日志（action 前缀 `search-provider.`/`mcp-server.`/`assistant-skill.`/`assistant.thread.`）。
- 聊天消息内容不进访问日志或审计摘要。

## 8. 前端与三端适配

- 桌面（>1100px）：侧栏 + 助手面板（默认 400px，320–560 可调）+ 内容三栏；平板（781–1100px）：面板收窄至 300–340px；手机（≤780px）：全屏覆盖层，`navigate` 动作自动收起，经入口重新打开。
- 入口：桌面顶栏助手按钮与侧边栏"学习助手"；手机首页快捷链接与 `/assistant` 路由。
- 流式输出：仅使用 SSE，`text_delta` 逐字渲染（vue-stream-markdown）；连接失败或提前结束时每隔 2s 重连 SSE，携带 `after` 游标补齐持久化事件，不降级轮询；页面隐藏或关闭面板时暂停，恢复或重新打开时重连。完成或失败事件统一刷新会话中的最终回复、耗时与过程摘要。
- 管理页：`/admin/settings/assistant`（搜索/MCP/Skills）；供应商与模型在 `/admin/settings/models` 管理，助手使用的模型在对话中按轮选择。每轮 API 调用与写操作限额由服务端固定，不提供管理页配置。

## 9. 部署注意

- SSE 需要反向代理关闭响应缓冲（nginx：`proxy_buffering off`，或等效配置），并允许长连接。
- 助手运行文件保存在 `DATABASE_PATH` 所在目录下的 `assistant-runtime/`：默认开发环境为 `.data/assistant-runtime/`，Docker 数据卷中为 `/app/data/assistant-runtime/`（PostgreSQL 部署也以 `DATABASE_PATH` 定位该目录）。该目录保存 Pi 运行时的 models.json（不含密钥）与物化 Skills，需要服务端进程具备写权限，可随数据目录一起备份；密钥始终只存于数据库加密字段。
- 新增环境变量 `ALLOW_PRIVATE_SEARCH_URLS`（默认 `false`），语义同 `ALLOW_PRIVATE_MODEL_URLS`。

## 10. 当前边界

- 助手写操作没有逐条人工确认；依赖每轮写操作限额与审计追溯。
- 同一账号多设备同时打开助手时，各自订阅同一事件流，消息以服务端为准（无跨设备推送，重开面板拉取全量）。
- 会话历史以扁平消息列表注入 prompt（最近 20 条），不做向量检索或自动摘要压缩。
- 评分适配器与助手模型共用供应商连接，但不共用评分配置；`GET /me/assistant/models` 仅返回模型与所属连接均已启用的模型。
