# 07 · 内置学习助手（Built-in Assistant）

基线：v0.3。内置对话助手已实现（首版），基于 [Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable)（`@earendil-works/pi-durable` + `@earendil-works/pi-ai`）作为服务端持久 Agent 运行时，MCP 使用独立的 `@earendil-works/pi-mcp` 客户端。本文描述当前实际行为与安全边界。

## 1. 定位与职责

- 内置助手是**交互式用户功能**：登录用户在应用内对话，不是外部 Agent API，不消耗也不接受 `dhk.` 令牌。
- 助手以**当前用户身份**通过真实 API 端点读写本人学习数据；没有独立的数据通道，权限与学习者接口一致。
- 服务端独占编排：Pi 会话、工具执行、MCP 连接与模型密钥只在服务端进程内存在，不进入浏览器或 Android 包。

## 2. 架构与一轮对话的生命周期

```text
POST /me/assistant/threads/:id/messages → 202（创建 turn，可带 providerModelId、图片与队列模式）
  → DurableAssistantRuntime：
     · 每个助手线程绑定一个持久 Durable Conversation；turnId 同时作为 submission requestId
     · pi-ai Model<'openai-completions'>（按轮 providerModelId 选择；缺省回退到最早的启用模型，
       baseUrl/密钥从 modelConnections 解密后内存注入，不落盘；
       contextWindow/maxTokens/reasoning/input/cost 直接注册到 Models）
     · tools 白名单：5 个自定义工具（drill_hub_api/drill_hub_api_help/web_search/navigate/set_layout），
       不注册 read/bash/edit/write 等文件工具
     · 独立 pi-mcp 客户端 + 管理员配置的启用服务器；Skills 从 DB 动态渲染到 prompt section
  → Conversation.submit() → watchEvents 事件桥接（text_delta / tool_execution_* / submission / run_end）
  → Durable 检查点 + 应用事件与消息持久化 + 进程内 SSE hub 广播
GET /me/assistant/threads/:id/stream?after=<seq>（SSE；断线游标补齐）
GET /me/assistant/threads/:id/events?after=<seq>（按游标读取持久化事件，客户端不用于轮询）
GET /me/assistant/models（对话可选模型：仅返回启用模型及其启用连接，含价格与默认参数）
GET /me/assistant/threads/:id?before=<messageId>&limit=<1..100>（按消息分页读取，保留时间线）
POST /me/assistant/threads/:id/fork（before/through 复制历史到新对话，原对话不变）
PATCH/DELETE /me/assistant/queued-messages/:id（编辑或移除待发送消息）
```

- turn 状态机：`queued → running → succeeded | failed | cancelled`；同线程同时仅 1 个活动 turn。活动期间的第二条消息进入服务端持久化队列：`followUp` 等本轮结束后执行，`steer` 取消当前生成并优先执行；队列在重连和服务重启后仍可恢复。
- 不再限制同时执行的对话轮数、单轮超时与搜索结果上限；用户可随时取消（`POST /me/assistant/turns/:id/cancel`）。
- 模型选择在对话中完成：输入框上方按供应商分组选择（或"自动选择"），选择随该轮请求发送；无效/停用的模型在提交时立即 422 `INVALID_MODEL`。
- 进程重开时重新打开 `durable.sqlite` 并 `resume()` 未完成任务；watcher 按 `turnId` 对账提交状态，将最终回复、取消或失败投影回应用消息与 SSE。
- 文本与推理增量每秒 flush 到消息记录；SSE 同时提供增量、活动消息快照和队列快照。流式中断时保留已生成部分，客户端在终稿返回前保持同一棵回复渲染树。
- 用户消息最多附 4 张 PNG/JPEG/WebP/GIF 图片（单张 5 MB）；图片只在本人消息与当轮模型请求中使用。
- 对话界面提供历史虚拟化、时间线跳转、滚动跟随解除/恢复、复制、编辑重发、重试、分叉、划词引用与批注；Durable fork 与应用消息分叉使用同一轮次边界。

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

- MCP 服务器：stdio（command/args/env）或 http（url/headers，仅 streamable HTTP）；env/headers 加密存储；`exposure` 支持 direct/deferred，deferred 工具通过 `tool_search` 加载；**创建后默认停用**，启用需管理员显式操作并审计。stdio 会在服务端 spawn 子进程，管理页有明确提示。http 地址默认拒绝内网。
- Skills：名称+描述+Markdown 指令存 DB，启用项作为 Durable system prompt section 在每次模型请求前渲染；名称限小写字母/数字/连字符且唯一。
- 不加载 Pi CLI 内置扩展、编码工具或文件系统工具，仅显式挂载学习白名单工具、MCP 工具与工具搜索。

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
- 助手运行文件保存在 `DATABASE_PATH` 所在目录下的 `assistant-runtime/`：默认开发环境为 `.data/assistant-runtime/`，Docker 数据卷中为 `/app/data/assistant-runtime/`（PostgreSQL 部署也以 `DATABASE_PATH` 定位该目录）。该目录保存 `durable.sqlite`（Conversation、模型调用、工具调用与任务检查点），需要服务端进程具备写权限，并必须与业务数据库一起备份和恢复。模型与密钥在每轮从当前配置注入内存，Skills 从数据库动态渲染，不再生成 models.json 或物化 Skills。Durable SQLite 使用 WAL + `synchronous=NORMAL`，可恢复进程崩溃，但主机断电可能丢失最后少量提交；同一存储只允许一个服务端进程持有，PostgreSQL 业务部署也仍需独立备份此文件并遵守单实例限制。
- 新增环境变量 `ALLOW_PRIVATE_SEARCH_URLS`（默认 `false`），语义同 `ALLOW_PRIVATE_MODEL_URLS`。

## 10. 当前边界

- 助手写操作没有逐条人工确认；依赖每轮写操作限额与审计追溯。
- 同一账号多设备同时打开助手时，各自订阅同一事件流，消息以服务端为准；没有额外的离线同步机制，重开面板按分页拉取历史。
- 每个线程绑定一个 Durable Conversation，使用持久 transcript 和自动压缩，不再拼接最近 20 条消息；没有历史会话向量检索。
- 写工具默认 `replay: unsafe`：进程中断后恢复会话和后续工作，但不自动重放可能已产生业务副作用的调用；通用写幂等仍未实现，不能宣称 exactly-once。
- Durable 使用追加式检查点历史，不提供逐 Conversation 物理擦除。删除线程会删除应用消息、事件与索引，但对应检查点只能随整个 `durable.sqlite` 的生命周期处理。
- Pi Durable 当前仍标记为 experimental，升级时必须核对 API、扩展与持久化检查点行为。
- 评分适配器与助手模型共用供应商连接，但不共用评分配置；`GET /me/assistant/models` 仅返回模型与所属连接均已启用的模型。
