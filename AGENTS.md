# Drill Hub 仓库协作指南

## 项目定位

Drill Hub 是面向 Agent 协作的学习工作台。外部 Agent 通过服务端 API 创建主题、内容、计划、题目与试卷；用户通过 Web 或 Tauri Android 应用学习、练习、考试、复习错题。

当前是可运行的 MVP，但仍在开发阶段。不要把它当作已经完成生产安全审计、真实模型质量评估或 Android APK 验收的产品。

## 当前阶段的版本策略（高优先级）

- 只维护当前代码、当前 API 和当前持久化格式，不保证与历史版本兼容。
- 不要为旧客户端、旧数据库、旧配置或旧缓存增加兼容分支、双写、回退字段、长期 fallback 或“以后可能用到”的版本适配层，除非用户明确要求。
- 当改动会影响已有版本继续使用时，由 Agent 在本次变更中手动修改或重建开发数据，使其与当前版本一致。默认开发数据库是 `.data/drill-hub.sqlite`；修改前确认目标是开发数据，不要擅自操作生产或用户共享数据。
- 数据形状变化时，优先调整现有开发数据，而不是设计历史数据回填；但仍必须保证空数据库能按当前 TypeORM migration 初始化并启动。
- 同步更新受影响的当前 schema、contracts、服务端、客户端、Skill API 文档和测试，使当前版本自洽。
- 上述策略仅指软件/API/持久化格式的向后兼容，不表示可以删除业务版本历史。题目版本、评分历史、审计记录、作答 revision 等业务不变量必须保留。

## 目录与职责

```text
apps/server              Fastify + SQLite + TypeORM 服务端与 Agent API
apps/web                 Vue 3 Web 入口及 Web 平台适配
apps/mobile              Tauri 2 Android 外壳及移动平台适配
packages/contracts       共享 DTO、枚举与 API 契约
packages/api-client      鉴权、CSRF、超时、取消与错误处理
packages/learning-client 共用 Vue 页面、路由、组件与样式
skills/drill-hub         外部 Agent 使用说明和实际 API 参考
scripts/e2e-server.ts    隔离的 Playwright 服务端
tests/e2e                真实浏览器桌面/移动视口测试
docs                     设计文档；其中可能包含尚未实现的后续目标
```

依赖方向：

- `apps/web`、`apps/mobile` -> `packages/learning-client` -> `packages/api-client`、`packages/contracts`。
- `apps/server` -> `packages/contracts`。
- 服务端 ORM、答案、密钥和评分 Worker 不得进入浏览器或 Android 包。
- `packages/learning-client` 只通过注入的 `ClientPlatform` 处理 Web/Android 差异。

## 技术栈

- Node.js 24、pnpm 12.4.1、TypeScript 5.9。
- 服务端：Fastify 5、better-sqlite3、TypeORM 0.3。
- 前端：Vue 3、Vite 8、Reka UI、Vue Router、离线 Iconify Lucide 图标。
- Android：Tauri 2，Rust 工程位于 `apps/mobile/src-tauri`。
- 测试：Vitest 5、Playwright 1.64。
- 工具链：Oxlint、Oxfmt；不使用 ESLint 或 Prettier。

## 常用命令

在仓库根目录运行：

```powershell
pnpm install --frozen-lockfile
pnpm dev                 # 构建共享包并启动服务端与 Web 监听
pnpm build               # 构建所有 workspace
pnpm typecheck           # 所有 workspace 与工具配置
pnpm test                # Vitest：服务端、api-client、mobile
pnpm lint                # Oxlint
pnpm format              # Oxfmt 写入
pnpm format:check        # 只检查格式
pnpm test:e2e            # Playwright；自动构建并启动内存数据库服务
```

首次运行 E2E 前安装 Chromium：

```powershell
pnpm exec playwright install chromium
```

可分别运行 `pnpm dev:web`、`pnpm dev:server`、`pnpm dev:mobile`。`pnpm dev:web` 使用 Vite 5173 端口并代理 `/api`，需另行启动服务端。

修改共享契约或 API 客户端后，如果单独运行前端，先执行 `pnpm build:shared`。不要直接编辑 `dist`；所有 `dist` 均为构建产物。

## 服务端架构

- 入口：`apps/server/src/app.ts`；数据库封装：`apps/server/src/db/database.ts`；表定义：`apps/server/src/db/schema.ts`。
- 业务模块位于 `apps/server/src/modules/auth`、`learning`、`grading`。
- TypeORM 使用 `synchronize: false` 和显式 migration。修改表结构时必须同时保证实体定义与当前 migration/初始化路径一致。
- SQLite 默认单实例、单文件部署。模型调用不得持有数据库长事务。
- 服务端是答案、评分、考试截止时间、分数、所有权和归档状态的唯一事实来源；客户端提交的 `score`、`maxScore`、`correct`、`submittedAt` 等事实字段必须拒绝。
- 修改操作通常使用 `revision` / `expectedRevision` 做乐观并发控制；版本冲突返回 409，禁止静默覆盖。
- API 成功响应为 `{ data, meta }`，错误为 `{ error: { code, message, fields? }, meta }`。
- 审计、评分历史、重评 generation 和评分任务状态必须保持可追溯；不要引入自由写分、手工改分或永久删除接口。

## 鉴权与安全不变量

- Web 使用 HttpOnly Cookie 和 CSRF，服务端允许所有来源的跨域访问；Android 当前只在进程内存保存会话，`localStorage` 只保存非敏感服务器连接信息。
- 外部 Agent 使用 `dhk.` 令牌和最小 scope；检查资源所有权，管理员也不能绕过 owner 校验。
- 内部模型题由服务端异步评分；`grade:write` 只允许提交 `external_rubric` 题的离散等级和证据，最终分数由服务端计算。
- 供应商密钥只以服务端加密形式保存。不得在日志、错误、测试快照、Skill 文档或 Git 中暴露密钥、Agent 令牌、密码或完整用户答案。
- 不在仓库中创建默认管理员密码。`.env`、`.data`、数据库、主密钥和测试报告均不得提交。

## Web、Android 与共享 UI

- 页面与组件优先放在 `packages/learning-client/src`，Web 和 Android 共用。
- Web/Android 差异通过 `ClientPlatform` 注入，不要在共享页面中直接访问 Tauri 或浏览器专属存储。
- 用户可见文案保持中文；图标使用现有离线 Iconify/Reka UI 体系，不引入 CDN 或运行时 Iconify API。
- Android 当前不是完整离线应用，也不是安全持久登录；不要声明 APK、真机或安全存储已经验收，除非实际完成验证。

## Agent API 与文档

- 实际 Agent 接口以 `packages/contracts`、服务端路由、`skills/drill-hub/SKILL.md` 和 `skills/drill-hub/references/api.md` 为准；`docs` 中的设计可能包含未来目标。
- 修改 Agent 可见字段、状态、scope、错误码、评分或归档行为时，同步更新 contracts、服务端测试、Skill 说明和 API 参考。
- Agent 写入遵循依赖顺序：主题 -> 内容/题目 -> 练习或试卷 -> 计划任务。不得伪造资源 ID、版本或完成状态。
- 修改题目创建新版本；已有考试项固定引用题目版本，不能假定题干修改会自动传播。
- 当前没有通用 `Idempotency-Key`、cursor 分页、Webhook 或应用内聊天 Agent；不要在文档或实现中假装已支持。

## 开发约定

- 使用严格 TypeScript 和 ESM。服务端遵循 NodeNext，导入本地模块时保留 `.js` 后缀。
- 保持现有 2 空格、单引号、分号、尾逗号、LF、行宽 100；提交前运行 `pnpm format:check`。
- 优先复用现有模块、校验函数、错误结构和 UI 组件；不要为单个页面复制服务端规则。
- 不做与当前需求无关的重构。修改功能时一并补充或更新对应的单元、集成或 E2E 测试。
- 不手工修改生成文件：`dist`、`node_modules`、`apps/mobile/src-tauri/gen`、`target`、Playwright 报告和锁文件的生成内容。
- 新增依赖应尽量少，并保持固定版本与 `pnpm-lock.yaml` 一致。

## 验证要求

- 小小改动至少运行相关测试；涉及类型或跨包契约时运行 `pnpm typecheck`。
- 提交前默认运行：

```powershell
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
```

- 涉及认证、学习闭环、移动端布局或构建产物时，再运行 `pnpm test:e2e`。
- E2E 使用随机临时管理员、内存数据库和临时密钥，不读取开发数据库，也不调用真实模型供应商。
- 测试通过只代表当前自动化覆盖范围，不等于完成生产安全、压力、备份恢复或 Android 真机验收。

## 当前已知边界

- Android SDK/NDK、Java、Android Rust target、签名和 APK/真机验收尚未完成。
- Android 重启后需要重新登录，没有安全持久会话。
- 通用创建请求幂等、cursor 分页、持久费用预算、Webhook、应用内聊天 Agent 和模型质量基准尚未实现。
- 评分适配器当前只支持 `chat_completions` 和 `rubric-v1`，不要假定任意“OpenAI 兼容”供应商都可用。
- 生产部署可使用 HTTP 或 HTTPS；建议 HTTPS，并需要显式主密钥和安全的数据库/密钥备份。
