# 质量工具与测试

本项目只使用 Oxc 工具链与 Vitest/Playwright，不使用 ESLint 或 Prettier。

## 工具版本

- Node.js 24，TypeScript 5.9。
- `oxlint` 1.88.0，根配置为 `.oxlintrc.json`。
- `oxfmt` 0.73.0，根配置为 `.oxfmtrc.json`。
- `vitest` 5.0.5，根项目的测试 entrypoint 为 `vitest.config.ts`。
- `@playwright/test` 1.64.1，配置为 `playwright.config.ts`。

## 本地命令

先安装依赖并构建一次：

```powershell
pnpm install --frozen-lockfile
pnpm build
```

常用质量命令：

```powershell
pnpm lint          # oxlint，correctness 类别按 error 处理
pnpm lint:fix      # 应用 Oxlint 的安全修复
pnpm format        # oxfmt 写入格式化结果
pnpm format:check  # 只检查格式
pnpm typecheck     # 所有 workspace 及测试/工具配置的 TypeScript 检查
pnpm test          # vitest run，根 projects 同时运行 server、api-client 与 mobile
```

`pnpm test` 的根 Vitest 配置包含三个项目：

- `apps/server/vitest.config.ts`：真实服务端单元/集成测试。
- `packages/api-client/test/**/*.test.ts`：API 客户端测试。
- `apps/mobile/test/**/*.test.ts`：平台连接、令牌隔离及内存会话测试。

`pnpm typecheck` 还会通过 `tsconfig.tools.json` 检查测试、E2E、脚本与工具配置。

只运行一个项目时可使用，例如：

```powershell
pnpm exec vitest run --project @drill-hub/server
pnpm exec vitest run --project api-client
```

首次运行浏览器测试前安装 Chromium：

```powershell
pnpm exec playwright install chromium
```

Windows 本地安装系统依赖不是必需步骤；Ubuntu CI 使用 `--with-deps`。随后运行：

```powershell
pnpm test:e2e
```

Playwright 的 `webServer` 会自动执行 `pnpm build`，再启动隔离的测试服务；不需要手工预启开发服务器。

## 端到端测试结构

`playwright.config.ts` 在首次加载时用 Node.js `crypto` 生成一次性的管理员用户名、密码和 64 位十六进制加密密钥，并通过 `E2E_ADMIN_USERNAME`、`E2E_ADMIN_PASSWORD`、`E2E_ENCRYPTION_KEY`、`E2E_BASE_URL` 传给 web server 和测试 worker。配置被 worker 再次加载时会复用已有的 `E2E_*` 值，避免 web server 与 worker 得到不同凭据。仓库中不存在生产默认密码。

`scripts/e2e-server.ts` 在同一进程中调用真实 `createApp`：

- 只监听 `127.0.0.1:4179`。
- 使用 `databasePath: ':memory:'`，进程退出即清空，不读取开发数据库或真实用户数据。
- `startWorkers: false`，测试期间不启动后台评分/过期任务。
- 使用随机测试管理员凭据和临时加密密钥启动。
- 由服务端同时提供真实 Node API 和 `apps/web/dist` 静态前端。
- 不请求外部模型；E2E 覆盖认证、首页、退出登录、移动端导航、离线图标及学习闭环。

`reuseExistingServer: false` 保证测试不会误连现有开发端口。项目仅使用 Chromium：

- `chromium-desktop`：桌面 Chrome 视口。
- `chromium-mobile`：Pixel 7 视口和设备参数。

测试覆盖：

- 错误凭据提示，以及真实浏览器中的成功登录和首页展示。
- 退出登录后受保护页面重新跳转登录页。
- 手机视口下通过底部导航进入“学习主题”。
- 拦截外部网络后，离线 Iconify 图标仍正常渲染且不访问 CDN/API。
- Agent 通过真实 API 创建五种题型与考试，用户通过页面作答、保存和交卷，提交前不泄露答案。
- 待评分分值与当前得分分开显示；外部 Agent 逐项给出等级后服务端计算部分分、同步报告与错题集。
- 错题重练与规则判分，桌面/手机视口的错题列表无水平溢出。
- 用户可在归档页恢复 Agent 归档的题目，不泄露题目答案。
- Agent 授权页配置帮助：当前服务器示例、接入说明复制、最小权限预设、授权列表密钥复制、剪贴板不可用时的手动复制提示，以及手机视口无水平溢出。

## CI

`.github/workflows/ci.yml` 使用 Ubuntu 与 Node.js 24，按以下顺序执行：

```text
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm exec playwright install --with-deps chromium
pnpm exec playwright test
```

E2E 的 webServer 命令会自行执行构建，因此本地和 CI 都以最终静态产物运行，而不是 Vite 开发服务器。

## 配置与局限

- Oxlint 启用 `eslint`、`typescript`、`oxc`、`vue`、`vitest` 插件；`correctness` 类别为 error。安全相关规则没有在全局关闭。所有测试断言遵循当前规则集，不通过全局关闭断言规则消除告警。
- `no-unused-vars` 对 JS/TS 的变量、参数、catch 参数和数组解构变量允许 `_` 前缀。
- 忽略目录包括依赖、构建产物、覆盖率、Rust `target`、Tauri `gen`、浏览器报告和锁文件。
- Oxfmt 统一为 2 空格、单引号、分号、尾逗号、LF、行宽 100，并保留文件末尾换行。
- Oxlint 1.88.0 的实际 CLI 能识别 `.vue` 文件并检查脚本语法；本项目不声称已获得完整 Vue 模板语义 lint 覆盖。Vue 类型由 `vue-tsc` 检查，模板交互与页面行为由 Playwright 验证。
- 修改代码后先运行 `pnpm format`，再运行 `pnpm format:check`；并行开发时避免在其他任务写入中全仓格式化。当前代码已统一格式化；根 `package.json` 使用 `"type": "module"`。
- 当前 E2E 只跑 Chromium 桌面和移动视口；Firefox、WebKit、真实 Android/Tauri 安装包和外部模型供应商不在本轮自动化范围。
