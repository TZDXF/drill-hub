# Drill Hub Android 外壳

本目录只负责 Tauri 2 Android 外壳、Vue 挂载和 `ClientPlatform` 实现。连接服务器、验证实例、登录、密码修改和学习页面均由 `@drill-hub/learning-client` 提供；本目录不实现这些页面。

## 文件

- `index.html`：Vue 挂载点，无远程脚本或远程页面。
- `vite.config.ts`：Vue 插件、固定端口 `1420`、`TAURI_DEV_HOST` 真机开发支持。
- `tsconfig.json`：移动端 TypeScript 配置。
- `src/main.ts`：调用 `createLearningApp({ platform })` 并挂载到 `#app`。
- `src/platform.ts`：最小 Android 平台适配器。
- `src-tauri/Cargo.toml`、`build.rs`、`src/lib.rs`、`src/main.rs`：Tauri 2 Rust 入口。
- `src-tauri/tauri.conf.json`：应用 ID、资源目录、窗口、CSP 和 Android 最低 API 配置。
- `src-tauri/capabilities/default.json`：仅面向 Android 主窗口的空权限 capability。
- `src-tauri/icons/app-icon.svg`：代码绘制的 Drill Hub 图标源，深青底、展开书本、DH 字样和金色书脊。
- `src-tauri/icons/`：由 Tauri CLI 从上述 SVG 派生的 PNG、ICO、ICNS、Windows Store 和 Android mipmap 资源。

`bundle.icon` 明确引用生成的 `32x32.png`、`128x128.png`、`128x128@2x.png`、`icon.icns` 和 `icon.ico`。图标不含文字字体依赖，DH 字形使用 SVG path 绘制。签名和商店上架不属于本轮交付。

这些资源只用于应用启动器、窗口和安装包等原生场景。共享学习界面的图标统一由 `@drill-hub/learning-client` 使用离线 Iconify 资源，本 Android 外壳不修改共享 UI，也不把原生应用图标当作页面图标使用。

## 开发

前端开发服务器：

```powershell
pnpm --filter @drill-hub/mobile dev
```

Vite 固定使用 `1420` 端口。真机开发时由 Tauri CLI 设置 `TAURI_DEV_HOST`，Vite 会监听传入的主机，并在该主机上使用 `1421` 端口做 HMR：

```powershell
pnpm --filter @drill-hub/mobile tauri android dev --host <开发机局域网地址>
```

该命令需要完整 Android 开发环境。当前仓库没有生成 `src-tauri/gen/android`，没有初始化 iOS 工程，也不声明 Android APK 已经可构建。

构建前端资源：

```powershell
pnpm --filter @drill-hub/mobile build
```

Tauri 配置中的 `frontendDist` 为 `../dist`，正式包只嵌入本地前端资源，不加载任意远程网页。

## 平台与凭据边界

`androidPlatform` 的声明为：

- `kind: 'android'`
- `sessionPersistence: 'memory'`

连接配置仅保存非敏感字段 `baseUrl`、`instanceId`、`displayName`，使用 WebView 的 `localStorage`。读取时会重新校验 URL，接受 HTTP/HTTPS 地址，且不接受用户名/密码、query 或 fragment。使用 HTTP 时传输不加密，应只连接可信网络中的服务。

会话只保存在当前进程内的 `Map` 中，键为规范化 `baseUrl + instanceId`。切换服务器或实例不会跨键读取会话。`refreshToken` 和密码不会写入 `localStorage` 或普通文件；应用进程结束后会话不可恢复。

这不是安全持久登录：没有使用 Android Keystore、Tauri Stronghold、系统凭据存储或原生加密实现，也没有声称已经实现。需要持久登录时必须另做原生安全存储并通过真机验证。

使用 HTTPS 时，TLS 证书校验保持平台默认行为，不提供忽略证书错误或继续登录的开关。

## 权限与网络

- capability 中没有 `shell`、`fs`、`http`、`store` 等插件权限。
- 没有注册自定义 Rust command 或额外原生桥接。
- 生产 CSP 仅允许本地脚本/样式以及 HTTP/HTTPS 网络连接；开发 CSP 额外放开 Vite/HMR 所需的 HTTP 和 WebSocket。
- 自定义 API 服务器必须允许来自 Android WebView 的跨域请求；当前 Drill Hub 服务端允许所有来源，无需额外配置来源白名单。
- 只创建一个 `main` 窗口，没有创建额外或后台可见窗口。

## 2026-10-17 本机环境检测

- Node.js：`v24.21.0`
- pnpm：`12.4.1`
- Cargo：`1.98.1`
- rustc：`1.98.1`
- 已安装 Rust target：仅 `x86_64-pc-windows-msvc`
- Java：未找到 `java`
- `ANDROID_HOME`、`ANDROID_SDK_ROOT`、`NDK_HOME`：未设置
- 常见 Android SDK 目录：不存在
- `adb`、`sdkmanager`、`gradle`：未找到
- Android Rust targets：未安装

因此没有安装 Android SDK，也没有执行 Android 构建或真机验证。

## 验证结果

- JSON 解析：`tauri.conf.json`、capability 和 `tsconfig.json` 均通过。
- `tauri --version`：`2.12.3`；`tauri info` 成功读取应用配置，解析出的 Rust `tauri` 为 `2.12.4`。
- `platform.ts` 行为测试：通过。已验证连接规范化与持久化、会话按 `baseUrl + instanceId` 隔离、进程重载后会话为空、连接配置不含 refresh token、不支持的协议与 query 地址被拒绝。
- `platform.ts` 类型检查：通过。使用共享 `contracts/src/index.ts` 的真实类型，在内存中运行 TypeScript 编译器验证 `ClientPlatform` 实现。
- `cargo fmt --check`：通过。
- `cargo metadata --no-deps`：通过。
- 图标资源检查：通过。`32x32.png`、`128x128.png`、`icon.png` 均为有效非空 ARGB PNG；`icon.ico` 为有效 ICO，包含 16、24、32、48、64、256 六种尺寸。生成的图标已人工查看，书本和 DH 符号清晰可见。
- `cargo check --manifest-path apps/mobile/src-tauri/Cargo.toml`：通过，Rust 与 Tauri `2.12.4` 编译检查完成，Windows 资源编译成功使用 `icons/icon.ico`。
- `pnpm --filter @drill-hub/mobile typecheck`：通过。共享前端语法修复后，`vue-tsc --noEmit` 完成且无错误。
- `pnpm --filter @drill-hub/mobile build`：通过。Vite 转换 750 个模块，生产资源成功写入 `dist`（HTML 0.53 kB、CSS 33.48 kB、JS 372.20 kB），耗时约 746 ms。

Android SDK、Java、NDK、Android Rust target、签名和商店发布仍是缺项；本轮不代办这些事项。Tauri 图标工具顺带生成了静态 `icons/ios` 与 ICNS 资源，但没有生成或初始化任何 iOS 工程。
