# Drill Hub

面向 Agent 协作的学习工作台：Agent 在对话侧制定学习计划、编写内容与题目，用户在 Web 或 Android 应用内学习、练习、考试和复习错题。

目前已具备可运行 MVP，不仅是设计文档；尚未完成生产环境安全审计、真实模型效果评估和 Android APK 验收。

## 已实现

- 多用户独立学习空间；管理员创建账号、停用账号与重置密码。
- 学习主题、阶段计划、Markdown 内容、练习与限时考试。
- 单选、多选、判断、填空、简答；服务端保存答案、控制考试截止与冻结提交。
- 规则判分；内部模型按得分项等级评分，服务端确定性计算分数；显式外部 Agent rubric 批改与模型重评。
- 系统设置中管理供应商连接、模型、评分配置和默认评分模型；可从供应商 `/models` 接口自动发现并批量导入模型，密钥在服务端加密保存。
- Token 用量页：个人统计、管理员全站统计、最近 7/30/90 天趋势与模型排行；记录模型评分、重试和重评的供应商用量，未知用量单列。
- 持久评分队列、失败重试、成绩报告、错题集、重练、归档与恢复。不开放永久删除和手工改分接口。
- Agent 访问令牌、最小权限 scope 和可分发 Skill。
- **内置学习助手**：基于 [Pi](https://pi.dev) 的应用内对话助手，以当前用户身份调用平台 API 查询与创建学习数据、执行 web 搜索、为用户打开页面并调整对话/内容布局；桌面三栏、平板窄栏、手机全屏覆盖三端适配；管理员可配置默认聊天模型、搜索服务（Tavily/Brave/SearXNG/OpenAI Responses）、MCP 服务器与助手 Skills。详见 [docs/07-built-in-assistant.md](docs/07-built-in-assistant.md)。
- 支持正式/测试作答和保留历史的作答作废；测试及已作废作答不计学习统计、错题或计划进度。完全未答由系统记零分并单列，不增加答错次数；全空练习不完成任务，考试仍按提交/超时结算。
- Agent 可为指定练习或考试生成限时免登录答题链接；链接秘钥只保存哈希，免登录作答归属链接所属用户，正式有效作答计入个人统计、错题及明确关联的计划任务；持链接者的作答都会记到所属用户名下，请勿转发。
- 手机浏览器布局，以及 Tauri 2 Android 外壳：先填写 HTTP/HTTPS 服务器地址、验证连接，再登录。
- **中英双语界面**：通过 `vue-i18n` 提供中文与英文，首次打开默认中文；桌面端在右上角头像左侧切换，手机端在“我的”页面切换。语言偏好保存在设备本地，刷新后保留；不翻译用户创建的学习内容或服务端业务数据。
- **Iconify 离线图标**：使用 `@iconify/vue/offline` 和 Lucide 单图标数据静态导入，随 Web/Android 资源打包，不访问 Iconify API/CDN。
- Vitest、Playwright、Oxlint、Oxfmt 与 CI 配置。

## 目录

```text
apps/server              Node.js + Fastify + SQLite + TypeORM
apps/web                 Vue 3 Web 入口
apps/mobile              Tauri 2 Android 外壳
packages/contracts       共享类型与 API 契约
packages/api-client      鉴权、CSRF、超时与取消请求
packages/learning-client 共用 Vue 3 + Reka UI 学习界面
skills/drill-hub         外部 Agent Skill 与实际 API 参考
scripts                  隔离 E2E 测试服务
tests/e2e               真实浏览器桌面/手机视口测试
```

## 本地启动

需要 Node.js 24 和 pnpm 12.4.1。以下命令在仓库根目录运行：

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env # 仅首次创建；已有 .env 时不要覆盖
```

在 `.env` 中设置自选的 `ADMIN_USERNAME` 与至少 10 个字符的 `ADMIN_PASSWORD`。没有内置账号或默认密码。数据库为空时，启动服务自动初始化第一个管理员；之后这些变量不会重置已有账号，初始化后应从环境文件中移除管理员密码。

```powershell
pnpm dev
```

- 本机 Web 开发入口：`http://127.0.0.1:3000`。`pnpm dev` 会监听 Web 源码并在变化后自动重建，页面随后自动刷新。
- 局域网 Web 入口：`http://<开发机局域网 IP>:3000`。开发环境默认监听 `0.0.0.0:3000`，同一局域网内的浏览器可直接访问；首次启动时如有需要，请在系统防火墙中允许 Node.js 的专用网络访问。
- 服务端同时提供 Web 开发产物和 `/api/v1` 接口，允许所有来源的跨域访问；Web 写操作仍需要 CSRF 校验。
- 默认数据库：仓库根 `.data/drill-hub.sqlite`，自动执行显式 TypeORM 迁移，不使用 `synchronize`。
- 开发时未设置主密钥，会在 `.data/dev-encryption-key` 创建本地主密钥；不要将 `.data` 或 `.env` 提交到版本控制。
- 局域网开发仅用于可信网络。不要将开发服务器暴露到公网；如需仅本机访问，将 `.env` 中的 `HOST` 改为 `127.0.0.1`。

单独启动可使用 `pnpm dev:web`、`pnpm dev:server`、`pnpm dev:mobile`。`pnpm dev:web` 使用 Vite 开发服务器（默认监听 `0.0.0.0:5173`，本机入口 `http://127.0.0.1:5173`，局域网入口 `http://<开发机局域网 IP>:5173`）并代理 `/api`，需要另行启动服务端。额外创建管理员可运行 `pnpm --filter @drill-hub/server admin:create`，凭据从环境变量读取。

## 构建与服务器部署

```powershell
pnpm build
# 生产环境先设置 NODE_ENV、PUBLIC_URL 和 DRILL_HUB_ENCRYPTION_KEY
pnpm --filter @drill-hub/server start
```

服务端同时提供 `apps/web/dist` 静态文件、SPA 路由与 `/api/v1` 接口。可部署在独立域名的根路径并直接使用 HTTP 或 HTTPS；公网部署仍建议经反向代理提供 HTTPS。不要直接将开发服务器暴露公网。

主要环境项：

| 变量                        | 作用                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `HOST` / `PORT`             | 开发默认 `0.0.0.0:3000`，生产默认 `127.0.0.1:3000`；按局域网或反向代理拓扑调整                    |
| `DATABASE_PATH`             | SQLite 数据库路径，默认 `.data/drill-hub.sqlite`                                                  |
| `NODE_ENV`                  | 生产设置为 `production`，会要求显式主密钥；HTTPS 部署使用 Secure Cookie                           |
| `PUBLIC_URL`                | 公开 HTTP/HTTPS 地址，用于 Secure Cookie 判断和生成完整答题链接，例如 `https://study.example.org` |
| `TRUSTED_PROXIES`           | 逗号分隔的可信代理 IP/CIDR，默认不信任转发头；仅填写实际代理地址，禁止全网 CIDR                   |
| `ALLOW_PRIVATE_MODEL_URLS`  | 默认 `false`；仅可信自建内网模型部署可显式设置 `true`，这会关闭模型地址隔离，但仍禁止重定向       |
| `ALLOW_PRIVATE_SEARCH_URLS` | 默认 `false`；仅自建内网搜索服务（如 SearXNG）可显式设置 `true`，语义同上                         |
| `ACCESS_LOG_RETENTION_DAYS` | API/登录日志保留天数，默认 7，范围 1–365；启动时及每小时清理，业务审计与评分历史不删除            |
| `DRILL_HUB_ENCRYPTION_KEY`  | 64 位十六进制主密钥，生产必须设置并妥善备份                                                       |

可用 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` 生成主密钥。数据库和主密钥需成对备份，丢失主密钥将无法解密已保存的供应商凭据。使用 SQLite 在线备份机制或停服备份，不要在运行时只复制主文件而忽略 WAL。

评分适配器当前只支持 `chat_completions` 和内置 rubric 评分提示词；兼容端点也必须通过实际连接与模型探测，不能保证所有所谓兼容供应商都可用。服务端默认拒绝模型连接访问回环、私网、链路本地和保留地址，对实际连接使用经过校验的 DNS 结果，并禁止重定向。生产仍应配合模型域名/出口网络白名单。

浏览器跨域允许任意来源并支持携带凭据，不按 Origin/Referer 设置白名单；Web 写操作仍校验 CSRF，所有接口继续按各自要求鉴权和检查权限。此策略保留了报告中的跨源会话访问风险，不能宣称已通过该项整改。Android WebView 无需登记来源，但这不代表已完成真机验收。可信代理仅用于真实 IP 与协议识别，不用于派生公开地址；HTTPS 终结时设置 HTTPS 的 `PUBLIC_URL`，并限制应用端口只能由可信代理访问。

内置助手的 SSE 事件流（`/api/v1/me/assistant/threads/:id/stream`）需要反向代理关闭响应缓冲（nginx `proxy_buffering off` 或等效配置）并允许长连接，否则流式输出会退化为整段返回。

匿名未匹配 API、匿名 429/403 及预检不逐条落库，避免扫描放大磁盘写入。登录按“用户名 + 来源 IP”限流，不再让代理后的不同账号共享低阈值桶；它仍是单实例内存限流，不能代替公网网关的连接数/速率控制。

## Docker 每日构建版

当前只发布 **nightly 每日构建**，不是正式版本，不发布 `latest` 或语义化版本镜像。
镜像地址为 `ghcr.io/tzdxf/drill-hub:nightly`，目前支持 `linux/amd64`。
镜像以非 root 用户运行，同时提供 Web 静态文件与 `/api/v1`，不包含 Android APK。
每日构建可能有破坏性变更，不保证旧数据库兼容；请先在独立环境试用，更新前备份数据库和主密钥。

### 用户部署：只拉取镜像，不需要源码

安装 Docker 与 Docker Compose 插件后，从公开镜像中提取部署文件即可，无需源码访问权限，也无需安装 Node.js 或 pnpm。
以下为 Linux/macOS 命令；Windows 可运行相同 Docker 命令，并用 `Copy-Item .env.example .env` 复制模板。
首次构建成功且维护者将 GHCR 包设为 Public 后，外部用户才能匿名拉取镜像。

```bash
mkdir drill-hub
cd drill-hub
docker pull ghcr.io/tzdxf/drill-hub:nightly
docker run --rm --entrypoint cat ghcr.io/tzdxf/drill-hub:nightly /app/deploy/docker-compose.yml > docker-compose.yml
docker run --rm --entrypoint cat ghcr.io/tzdxf/drill-hub:nightly /app/deploy/.env.example > .env.example
cp -n .env.example .env
```

**只复用 `.env.example` 这一个配置模板**；真实密钥与密码填写到部署目录的 `.env`，不要写回或提交模板。
首次启动前编辑 `.env`，取消相应配置行的注释并设置：

- `DRILL_HUB_ENCRYPTION_KEY`：生产必填的 64 位十六进制主密钥。可通过下方命令使用镜像内的 Node.js 生成，妥善保存，不要每次更新都重新生成。
- `PUBLIC_URL`：用户和外部 Agent 实际可达的 HTTP/HTTPS 地址。本机试用可用 `http://localhost:3000`；局域网或公网部署不能保留 `localhost`。
- `ADMIN_USERNAME` / `ADMIN_PASSWORD`：自选管理员用户名与至少 10 个字符的强密码，仅在空数据库首次启动时创建管理员。初始化完成后从 `.env` 删除管理员密码并重建容器；之后修改该变量不会重置已有账号密码。
- `HOST` / `PORT`：默认 `0.0.0.0:3000`。容器内保持 `HOST=0.0.0.0`；修改 `PORT` 后同步调整 `PUBLIC_URL`。
- `DRILL_HUB_IMAGE`：可选，默认 `ghcr.io/tzdxf/drill-hub:nightly`。建议验收后改为本次构建的完整标签，以免无意切换到其他构建。

```bash
# 首次发布且 GHCR 包已设为 Public 后，用户可匿名拉取。
docker pull ghcr.io/tzdxf/drill-hub:nightly

# 在本机生成主密钥，将输出保存到 .env；不需要在宿主机安装 Node.js。
docker run --rm --entrypoint node ghcr.io/tzdxf/drill-hub:nightly -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"

# 完成 .env 配置后启动。
docker compose up -d --pull always --wait
docker compose ps
docker compose logs --tail 100 drill-hub
```

访问配置的 `PUBLIC_URL` 并登录。健康检查接口为 `GET /api/v1/health`。
SQLite 保存在命名卷 `drill-hub-data` 的 `/app/data/drill-hub.sqlite` 中，Compose 会给卷名加上项目名前缀。
部署时保持相同目录和 Compose 项目名，否则可能连接到新的空卷。

公网部署建议通过 HTTPS 反向代理访问，并将 `PUBLIC_URL` 设置为实际 HTTPS 地址；
若代理运行在同一宿主机，可将 Compose 端口映射改为 `127.0.0.1:3000:3000`，避免应用端口直接暴露公网。

### 更新、固定构建与备份

`nightly` 只在质量检查、镜像构建与容器验收全部通过后更新；构建失败时保留上一次成功镜像。
GitHub Actions 的运行摘要会显示本次构建标签，格式为：
`nightly-<北京时间日期>-<提交号>-<运行编号>-<重试编号>`。
需要固定构建时，在 `.env` 中设置完整 `DRILL_HUB_IMAGE`，再执行：

```bash
# 更新前先备份数据库与加密主密钥。
docker compose up -d --pull always --wait
```

`docker compose down` 不删除命名卷，**不要执行 `docker compose down -v`，它会删除数据卷**。
备份 SQLite 时使用在线备份机制或停服备份，不要只复制运行中的主数据库文件。
由于 nightly 不保证旧数据格式兼容，不能假定只切回旧镜像就能回滚数据库；应保留与旧构建匹配的备份。

### 维护者：自动发布每日构建

`.github/workflows/docker-nightly.yml` 每天北京时间 **04:00**（UTC 20:00）从默认分支运行，
也可以在 GitHub Actions 的 **Docker Nightly → Run workflow** 手动触发默认分支构建。
GitHub 定时任务可能延迟，不保证准点；不需要创建 Git tag 或 GitHub 正式 Release。

发布前会复用 CI 的构建、类型、Lint、格式、单元/集成与 E2E 检查，然后构建并加载 `linux/amd64` 镜像，
运行容器验收，验证非 root、健康检查、Web 静态资源、管理员登录、CSRF 及重建容器后的数据卷持久化。
只有通过后，才会把**同一个已验收镜像**推送为构建标签与滚动 `nightly` 标签。

首次启用需要：

1. 将工作流及相关文件提交到 GitHub 默认分支，并确保仓库启用了 GitHub Actions。
2. 允许工作流通过 `GITHUB_TOKEN` 写入 Packages。工作流声明了 `packages: write`，不需要另建 Docker Hub 密钥；组织策略仍可能限制发布。
3. 手动运行一次 **Docker Nightly**，首次成功推送后，在仓库 **Packages → drill-hub → Package settings** 中将包的可见性设为 **Public**。代码仓库公开不代表 GHCR 包已自动公开。
4. 确认未登录的用户也能拉取 `ghcr.io/tzdxf/drill-hub:nightly`，再向用户提供部署文件。

Fork 仓库的工作流按自身仓库名生成小写 GHCR 路径；若要部署 Fork 镜像，在 `.env` 中覆盖 `DRILL_HUB_IMAGE`。
本地可先构建并运行相同容器验收；验收会创建并清理随机命名的临时容器和卷，不读取开发数据库、不调用真实模型：

```powershell
docker build -t drill-hub:nightly-test .
pnpm test:docker drill-hub:nightly-test
```

### 统一公开地址

`PUBLIC_URL` 是对外分享的**部署根地址**，例如 `https://study.example.org` 或
`http://192.168.1.20:3000`，不是 `/api/v1` 接口地址。允许 HTTP/HTTPS；末尾斜杠会移除，
路径前缀会保留（例如 `https://study.example.org/drill`）。使用路径前缀时，需自行配置反向代理
及前端部署，使该前缀下的页面、`/api/v1` 和 `/downloads` 均可访问；设置此变量本身不会重挂载路由。
不允许凭据、查询参数或片段，非法配置会阻止服务启动，错误不会回显配置原文。

`GET /api/v1/server-info` 返回 `publicBaseUrl`、`publicUrlSource`（`configured` 或 `request`）
和 `isLoopback`。未设置或留空时，仅允许从回环 Host 派生本机地址，不信任转发头；
局域网、公网和反向代理部署必须设置 `PUBLIC_URL`，否则返回 `503 PUBLIC_URL_UNAVAILABLE`，不会生成携带凭据的外部链接。

“Agent 配置帮助”使用上述公开地址生成接入说明、环境变量和 Skill ZIP 下载链接，并在回环地址时提示。
这不会修改浏览器或 Android 当前连接的 API 地址，也不保证该地址能从公网访问；
`localhost`、`127.0.0.0/8`、`[::1]` 等回环地址只能在对应主机使用，远程 Agent 需可达的部署地址。

## Agent 使用流程

1. 用户登录应用，在“Agent 授权”查看配置帮助，可复制当前服务器的接入说明、环境变量与只读验证请求，并按学习规划或只读权限预设新建令牌。授权列表可为每个有效令牌复制完整密钥，帮助示例始终使用占位符。
2. 将服务器地址和令牌通过 Agent 的安全配置提供，不要放入学习材料、Git 或日志。
3. 在“Agent 授权”的“Agent 配置帮助”中点击“下载 Drill Hub Skill（ZIP）”，或访问当前服务器的 `/downloads/drill-hub-skill.zip`（部署在路径前缀下时保留前缀）；解压后将完整的 `drill-hub/` 目录提供给外部 Agent。也可直接从项目仓库加载 `skills/drill-hub/SKILL.md`；实际接口索引见 [API 参考](skills/drill-hub/references/api.md)，按任务加载对应资源页（请求、响应、scope 和示例）。
4. Agent 创建主题、内容、计划和题目/试卷；用户可登录后在应用中作答，也可通过 Agent 生成的临时链接免登录作答。
5. Agent 按需读取报告与错题；只有 `external_rubric` 题可通过 `grade:write` 提交逐项等级，模型题由服务端调用配置的模型评分。

云端主动回调和 Webhook 尚未实现；内置学习助手已在应用内提供（见上），但它不是外部 Agent API，也不能替代 Agent 令牌的编程访问。

## 验证命令

```powershell
pnpm build
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
pnpm exec playwright install chromium # 首次准备浏览器
pnpm test:e2e
```

使用 `pnpm format` 自动格式化。项目不使用 ESLint/Prettier。E2E 自动构建并启动内存数据库服务，使用随机测试管理员与加密密钥，不读取开发数据库、不调用真实供应商模型。

## Android 与当前边界

- Android 前端资源可构建，Rust 外壳可执行本机 `cargo check`；APK 仍需 Java、Android SDK/NDK 和 Android Rust targets，本机尚未安装，未验收 APK 或真机运行。
- Android 当前只在内存保存登录令牌，重启进程需重新登录；服务器地址可持久保存，但不是完整离线学习，也未实现安全持久登录。
- 不考虑 iOS，不提供桌面安装包或商店上架承诺。
- 通用创建请求幂等、cursor 分页、持久化费用预算/限额、模型评分质量基准尚未实现；批量创建不应在网络结果不明时盲目重试。
- 当前验证覆盖本地自动化，不代表完成了公网多租户压力、安全或备份恢复演练。

## 设计文档

1. [需求与范围](docs/00-requirements.md)
2. [系统、monorepo 与 Android 架构](docs/01-architecture.md)
3. [数据模型与状态机](docs/02-data-model.md)
4. [HTTP API 契约](docs/03-api-contract.md)
5. [页面、里程碑与验收](docs/04-pages-and-delivery.md)
6. [内部模型与得分项评分](docs/05-model-grading.md)
7. [质量工具与测试](docs/06-quality.md)
8. [内置学习助手](docs/07-built-in-assistant.md)

设计文档包含后续目标；实际已实现接口以当前代码和 Skill API 参考为准。

## Token 用量统计

从侧边栏或「我的设置 → Token 用量」进入 `/token-usage`，Web 与 Android 共用页面。
普通用户仅能查看本人调用，管理员可切换全站统计。最近 7/30/90 天均包含今天，
按设备当前 UTC 偏移分日；图表与每日明细、模型排行采用同一统计口径。

- 仅记录本站模型评分和模型能力测试；每次重试、重评各算一次调用，空白答案的自动零分不调用模型。
- 输入、输出及总 Token 来自供应商响应的 `usage`。缺失、不完整或不一致时标为用量未知，
  不估算、不视为零消耗；失败响应若携带有效用量仍计入总量。
- 模型列表读取、连接测试、规则评分及外部 Agent 自身的模型消耗不计入。
- 只统计功能上线后完成并成功保存的调用；不补算历史，不提供费用估算，也不替代供应商账单。
- 新增 `modelUsage` 表及索引由 TypeORM migration 创建，无需重建开发数据库。
  记录仅包含归属、连接/模型标识、用途、任务标识、成功/失败状态及用量，不存储答案或密钥。

交互式用户会话接口（不是 Agent API）：

- `GET /api/v1/me/token-usage?days=30&utcOffsetMinutes=480`：本人统计。
- `GET /api/v1/admin/token-usage?days=30&utcOffsetMinutes=480`：全站统计，仅管理员。

`days` 仅支持 `7`、`30`、`90`，默认 `30`；`utcOffsetMinutes` 为本地时间相对 UTC 的分钟偏移，
范围为 `-840` 至 `840`，默认 `0`。响应 `data` 含 `days`、`utcOffsetMinutes`、`fromDate`、
`toDate`、`totals`、补齐无调用日期的 `daily` 以及按连接和请求模型分组的 `models`。
汇总字段包括 `calls`、`failedCalls`、`unknownUsageCalls`、`promptTokens`、
`completionTokens`、`totalTokens`；Token 汇总仅累加已知用量。
