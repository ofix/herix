# HERIX 工程规约 v0.9（ES6 版）

> 定位：面向「多模型网页端」的 AI 代码治理客户端。Electron 外壳 + JavaScript(ES2022/ESM) 调度内核 + 独立 Playwright Worker 子进程。
> **v0.9 变更**：新增 **第 10 章「分片落地与生成规范」** —— 用「数据包 → 脚本渲染骨架 → 单类增量填充」两段式替代逐字生成，定义三条硬上限、B0–B9 批次表、`gen-skeleton` / `gen-api-surface` 两个脚本的签名级设计、`progress.json` 进度台账、每批作业循环与上下文预算规则。其余章节沿用 v0.8。
> **v0.8 变更（目录审查落地）**：① 顶层定为 `doc/build/scripts/resources/src/test`；`src` 下 `main/preload/renderer/workers/libs`；② `src/packages` → **`src/libs`**（contracts/schemas/utils，私有 workspace 包）；③ `core` 拆出 **`conference/`** 与 **`model-io/`**，新增 **`core/state/`**；④ `infra` 三分 `observability/security/storage`，`worker-guard` 移入 `runtime/`；⑤ **补 `bridges/playwright-bridge.js`**（v0.7 真实缺口：主↔Playwright 通信无归属）；⑥ renderer 增 **`api/`**（唯一 IPC 调用点）、`composables/`、`router/`；⑦ 检查器按语言分组 `providers/{js,python,go,rust,cpp}`；⑧ 新增 `resources/sites/`、根级 `scripts/`、`test/workers/{unit,integration}`；⑨ 新增 2.6 资源覆盖语义、2.7 两条不采纳说明；⑩ 类索引补 7 个拆分类（ConfigResolver / StateStore / PlaywrightBridge / ParticipantPicker / RoundRunner / VoteTally / ResponseRepair）。
> 承接 v0.7：`Orchestrator→Engine`、`WorkerSupervisor→WorkerGuard`、`LocatorResolver→ElementParser`、`WorktreeManager→ProjectManager`、命令强制逐次授权。
> 本文不写实现代码，只定契约。签名遵循 4.4：`方法名(ctx, 入参) → 出参`。

---

## 0. 技术基线与决策

| 项 | 决定 | 理由 |
|---|---|---|
| 语言 | **JavaScript ES2022（ESM）+ JSDoc** | 不编译、热改快 |
| 类型防线 | JSDoc + `tsc --checkJs`（仅检查）+ **zod 运行时校验** | 见第 4 章 |
| 包管理 | **npm workspaces** | 零额外工具、与 electron-builder 零冲突 |
| 外壳 | Electron 32 | 需要本地文件/Git/命令能力 |
| 前端 | Vue3 + Element Plus + **@vue-flow/core** + Monaco | DAG 画布、左右比对 |
| 浏览器自动化 | `playwright-core` | 纯 JS，无原生模块 |
| 存储 | **JSON + JSONL 事件日志 + 快照** | 零原生依赖 |
| 密钥 | Electron `safeStorage` | 免 keytar |
| 静态检查 | **多语言 Provider**（tsc/eslint/ruff/pyright/go vet/staticcheck/clang-tidy/clippy） | 见 5.3 |
| 通信 | 主↔Worker：NDJSON over stdio；UI↔主：IPC | 定死帧协议 |
| 打包 | electron-builder，Chromium 走 `extraResources` | 二进制不进 asar |

### 九条铁律
1. `[铁律]` Playwright 只在独立子进程内运行。
2. `[铁律]` 一个站点同一时刻最多一个会话，站点内串行、站点间并发。
3. `[铁律]` 模型永不直接写文件，一切产出经 patch 审批闸。
4. `[铁律]` 模型提议的命令必须沙箱校验 + 人工审批，禁 shell 解释。
5. `[铁律]` 所有写操作幂等，携带 `idempotencyKey`。
6. `[铁律]` 跨模块调用返回 `Result`，边界不抛异常。
7. `[铁律]` `traceId` 贯穿全链路。
8. `[铁律]` CPU 密集任务不进主线程。
9. `[铁律]` 所有跨边界数据必须过 zod（帧、IPC、模型输出、YAML、磁盘 JSON）。

---

## 0.1 三个选型的取舍

**图库 → Vue Flow**：DAG 是中等规模、强交互、节点内要放审批按钮的业务图；G6 强于大规模图分析，自定义节点走 canvas，反而贵。类型定义在 `src/libs/contracts`，将来换图库不动业务。

**存储 → 文件而非 SQLite**：单机单用户用不上事务/索引/并发，却要付出原生模块（跨平台各编一次）的代价。改用「事件日志 append + 内存状态 + 快照」，顺带把 better-sqlite3 与 keytar 一起删掉，实现**全项目零原生模块**，`electron-rebuild` 整条链路消失。

**检查器 → Provider 架构**：ESLint 只覆盖 JS 生态，而 SKILL 含算法/后端岗位。按扩展名路由到各语言原生工具，强制归一化成统一 `Diagnostic`，否则回灌模型的报文会随语言漂移。

---

## 1. 环境搭建流程

### 1.1 版本基线
```
Node.js 24.x（仅构建/脚本；Electron 内置 Node 20.x）
npm 11.x（Node 24 自带）
JavaScript ES2022 / ESM
Electron 32.x｜Vue 3.5.x｜playwright-core 1.48.x｜typescript 5.6.x（仅 checkJs）
```
无 `.nvmrc`、无 nvm、无 `electron-rebuild`。

### 1.2 初始化
```bash
node -v && npm -v
mkdir herix && cd herix && npm init -y
mkdir -p doc build scripts resources/{skills,sites} \
  src/{main/{ipc,core/{conference,model-io,state/repositories,registry,runtime},git,sandbox,bridges,tools},preload,workers/{playwright-worker,patch-worker,check-worker},libs/{contracts,schemas,utils}} \
  src/main/{infra/{observability,security,storage},checks/providers/{_shared,js,python,go,rust,cpp}} \
  src/renderer/src/{api,composables,router,views,components,stores,assets} \
  test/workers/{unit,integration}
# package.json："workspaces": ["src/libs/*","src/workers/*"]、"main": "src/main/bootstrap.js"、"type": "module"
npm i electron playwright-core yaml zod
npm i vue @vue-flow/core @vue-flow/background @vue-flow/controls dagre monaco-editor
npm i -D electron-builder vite @vitejs/plugin-vue eslint eslint-plugin-jsdoc \
         eslint-plugin-import typescript vitest fast-check
npx playwright-core install chromium
npx playwright-core install --dry-run          # 记录路径供打包
npm run check && npm run lint
```

### 1.3 依赖清单
```
runtime : electron, playwright-core, yaml, zod
frontend: vue, @vue-flow/core, @vue-flow/background, @vue-flow/controls, dagre, monaco-editor
dev     : electron-builder, vite, @vitejs/plugin-vue, eslint(+jsdoc/import), typescript, vitest, fast-check
可选外部工具（探测到才启用）：ruff、pyright、go、staticcheck、clang-tidy、cargo
```

### 1.4 脚本
```jsonc
"scripts": {
  "check": "tsc --noEmit --allowJs --checkJs --target es2022 --module nodenext --strict --skipLibCheck",
  "lint": "eslint . --max-warnings=0",
  "dev:renderer": "vite", "dev:main": "electron .",
  "build": "vite build", "pack:dir": "electron-builder --dir"
}
```

### 1.5 ESM 四个坑
1. 主进程无 `__dirname` → `path.dirname(fileURLToPath(import.meta.url))`。
2. preload 只能 CJS → `index.cjs`，`webPreferences.preload` 显式指向。
3. Worker 子进程入口用 `.js`(type:module) 或 `.mjs`，不与 `.cjs` 混。
4. `worker_threads` 用 `new URL('./x.js', import.meta.url)`。

### 1.6 打包要点
`asar:true`；Chromium 走 `extraResources`，运行时用 `process.resourcesPath`；**`src/workers/**` 必须 `asarUnpack`**（要能被 spawn）；`resources/skills` 走 `extraResources`（可热改、不进 asar）；Windows 用 `windowsHide:true`；用户数据 `app.getPath('userData')`。

### 1.7 自检清单
```
[ ] node -v=24.x；Electron 内 process.versions.node=20.x（正常）
[ ] 项目内无 .node 文件（零原生模块）
[ ] playwright-core 能 launch 打包内 Chromium
[ ] Worker spawn 成功且 pong 正常
[ ] NDJSON 在 \r\n 下解析无误
[ ] preload=.cjs 且 contextIsolation 生效
[ ] safeStorage.isEncryptionAvailable()=true（否则降级明文并告警）
```

---

## 2. 代码结构

> 顶层：**文档（doc）**、**构建与分发（build）**、**开发脚本（scripts）**、**运行时资源（resources）**、**源码（src）**、**测试（test）**。`src` 下按**进程边界**划分；共享代码集中在 `src/libs`，按「契约 / 校验 / 工具」三分，避免 runtime schema 被 UI 打包。

```
herix/
├─ doc/                          # 规约、ADR、依赖图、config-resolution.md
│  ├─ skeleton.manifest.json      # 全量文件/签名数据包（第 10 章）
│  ├─ progress.json              # 批次进度台账
│  └─ api-surface.md             # 由脚本从 JSDoc 生成，只含签名（生成物）
├─ build/                        # 发布用：electron-builder 配置、图标、签名脚本
├─ scripts/                      # 开发用：dev 启动、worker 单独调试、代码生成、fixture 抓取
│  ├─ gen-skeleton.mjs           # 数据包 → 骨架文件
│  └─ gen-api-surface.mjs        # 源码 → 签名快照
├─ resources/                    # 随包分发且可被 userData 覆盖（extraResources，不进 asar）
│  ├─ skills/*.yaml              # 默认 SKILL
│  └─ sites/*.yaml               # 站点 locators 默认模板（与 skills 同构）
├─ src/
│  ├─ main/                      # Electron 主进程（ESM，调度中枢）
│  │  ├─ bootstrap.js            # 启动序列：Storage→StateStore→WorkerGuard→Engine→IPC
│  │  ├─ ipc/gateway.js          # 通道白名单 + zod 入参校验
│  │  ├─ core/
│  │  │  ├─ engine.js  scheduler.js  task-machine.js  site-queue.js
│  │  │  ├─ registry/{site-registry,skill-registry,config-resolver}.js
│  │  │  ├─ state/{state-store.js,repositories/{task,site,conference,project}.js}
│  │  │  ├─ conference/{manager,participant-picker,round-runner,vote-tally}.js
│  │  │  └─ model-io/{prompt-composer,output-extractor,response-repair}.js
│  │  ├─ git/{project-manager,patch-pipeline,changeset-builder}.js
│  │  ├─ sandbox/{command-policy,command-runner}.js
│  │  ├─ checks/
│  │  │  ├─ {service,registry}.js
│  │  │  ├─ providers/_shared/{exec,normalize}.js
│  │  │  ├─ providers/js/{tsc,eslint}.js
│  │  │  ├─ providers/python/{ruff,pyright}.js
│  │  │  ├─ providers/go/{go-vet,staticcheck}.js
│  │  │  ├─ providers/rust/cargo-clippy.js
│  │  │  └─ providers/cpp/clang-tidy.js
│  │  ├─ runtime/{worker-guard,process-policy}.js   # 进程生命周期，与 workers 强耦合
│  │  ├─ bridges/{frame-codec,playwright-bridge,patch-bridge,check-bridge}.js
│  │  ├─ infra/
│  │  │  ├─ observability/{trace,audit}.js
│  │  │  ├─ security/{secret-vault,redaction}.js
│  │  │  └─ storage/{file-store,journal,snapshot,atomic}.js   # 只做原子 I/O，不持有状态
│  │  └─ tools/electron-paths.js      # 仅主进程专属（appPath/resourcesPath 解析）
│  ├─ preload/
│  │  └─ index.cjs               # contextBridge 白名单，唯一 bridge
│  ├─ renderer/
│  │  ├─ index.html
│  │  └─ src/
│  │     ├─ api/                 # ★ 唯一调用 window.herix.* 的地方
│  │     ├─ views/  components/  stores/      # 视图 / 组件 / pinia
│  │     ├─ composables/  router/  assets/
│  ├─ workers/                   # 独立进程 / 线程（private workspace 包）
│  │  ├─ playwright-worker/{main,frame-io,site-session,login-flow,shot-stream,element-parser,reply-assembler}.js
│  │  ├─ patch-worker/main.js
│  │  └─ check-worker/main.js
│  └─ libs/                      # ★ 内部共享库：private workspace，不对外发布
│     ├─ contracts/{index,protocol,domain,ids}.js   # 纯契约：typedef/常量，零运行时依赖
│     ├─ schemas/*.schema.js                        # zod 运行时校验
│     └─ utils/{result,errors,time}.js              # 通用工具，无业务依赖
├─ test/
│  ├─ main/…  libs/…             # 镜像 src 结构
│  └─ workers/
│     ├─ unit/                   # frame-io、reply-assembler、element-parser 等
│     └─ integration/            # 真起浏览器，独立 CI 标记，默认不跑
├─ package.json
├─ vite.config.js                # 只管 renderer；主进程 ESM 直跑，不编译
└─ electron-builder.yml
```

### 2.1 分层理由
| 目录 | 放什么 | 为什么不能混 |
|---|---|---|
| `doc/` | 规约、ADR、依赖图、配置解析说明 | 只读材料，不参与构建 |
| `build/` | 发布相关：打包配置、图标、签名 | 随平台变，与运行时代码解耦 |
| `scripts/` | 开发相关：dev、单调试、代码生成 | 与发布流程分开，避免误入产物 |
| `resources/` | 默认 SKILL、站点模板 | **必须可热改**，走 `extraResources` 不进 asar |
| `src/main/core` | 调度与决策（engine/scheduler/conference/model-io/state） | 唯一持有决策权 |
| `src/main/runtime` | 进程生命周期（worker-guard） | 与 `workers/` 强耦合，不该混进通用 infra |
| `src/main/bridges` | 主进程对外部 worker 的**协议适配** | 所有跨进程协议收敛于此，禁止散落 core |
| `src/main/infra` | 横向设施：观测、安全、原子 I/O | 安全与审计需要独立入口，便于审查 |
| `src/renderer` | UI + `api/` 唯一 IPC 调用点 | 只读镜像，禁止到处 `window.herix.*` |
| `src/workers` | 子进程与线程 | 崩溃隔离域；`asarUnpack` 才能 spawn |
| `src/libs` | 契约 / schema / 工具 | 三方共用；`private: true`，不发布 |
| `test/workers` | worker 单测与浏览器集成测试 | 集成测试需单独 CI 标记 |

### 2.2 命名与包语义
- **`src/libs` 不是对外发布的包**：四个库都在 `package.json` 里标 `"private": true`，仅通过 npm workspaces 建立本地符号链接。包名与物理路径无关（`@herix/contracts` 可以住在 `src/libs/contracts`），所以不必提到根级。
- `src` 下按进程边界：`main / preload / renderer / workers / libs`。
- 子目录：**复数**表示集合（`providers/`、`repositories/`），**单数**表示单一角色（`main/`、`renderer/`）。
- 文件 `kebab-case`；类文件与类同名（`TaskMachine` → `task-machine.js`）；内部实现前缀 `_`。
- 测试 `*.test.js`，路径镜像源码；浏览器集成测试放 `test/workers/integration/`。
- 资源 `resources/skills/<skillId>.yaml`、`resources/sites/<siteId>.yaml`，与 ID 严格同名。

### 2.3 三个最容易写错的路径
1. **主进程入口**：`package.json` → `"main": "src/main/bootstrap.js"`；打包后 asar 内路径不变。
2. **Worker 入口**：打包后在 `app.asar.unpacked/src/workers/…`，必须
   `path.join(process.resourcesPath, 'app.asar.unpacked', 'src/workers/playwright-worker/main.js')`，**不能**用 `__dirname` 直拼。
3. **默认资源**：开发期读 `resources/{skills,sites}`，打包后读 `process.resourcesPath/{skills,sites}`；统一由 `src/main/tools/electron-paths.js` 解析。

### 2.4 存储目录（`userData/herix/`，与源码树无关）
```
.lock
state/{sites,projects,tasks,conferences,skills.snapshot}.json
journal/{tasks,conferences,audit}-YYYY-MM.jsonl
changesets/<id>/{before.txt,after.txt,patch.diff,report.json}
secrets/sites/<siteId>.bin
skills/    sites/     # 用户覆盖目录，优先级高于 resources/
```
> **状态所有权**：`infra/storage` 只负责原子读写与重放；**唯一持有可变状态的是 `core/state/StateStore`**，它通过 `repositories/*` 把状态落到 storage。任何其他地方不得直接写 journal。

### 2.5 依赖方向（写进 doc/architecture.md 并由 lint 强制）
```
renderer → api → preload bridge →(IPC)→ main/ipc → core|git|sandbox|checks
workers → libs/*（绝不 import main/*）
main → libs/*
libs/utils → 无业务依赖
libs/schemas → libs/contracts
libs/contracts → 零依赖（零运行时 import）
```
> `[铁律]` 用 `eslint-plugin-import` 的 `no-restricted-paths` 固化：`libs/*` 不得 import `main/*`、`workers/*`；`renderer` 不得 import `libs/schemas`（避免 zod 进 UI 包）；跨层只走包名。

### 2.6 资源覆盖语义（必须明确的四件事）
| 问题 | 决定 |
|---|---|
| 覆盖粒度 | **整文件替换**（同名文件整体覆盖），不做字段合并 —— 合并会让"用户以为只改了 A，实际 B 被默认覆盖" |
| 优先级 | `userData/herix/{skills,sites}` > `resources/{skills,sites}` |
| 校验失败 | 该文件**忽略并回退到默认版本**，记审计 `config.rejected`，UI 顶部告警条 |
| 热加载 | 监听 userData 目录，变更后 `ConfigResolver` 重新加载；失败不影响运行中任务 |

### 2.7 未采纳的两条建议及理由
1. **不把共享库提到仓库根级**：你上一轮已定"顶层只放 doc / build / src"。npm workspaces 的 glob 允许指到 `src/libs/*`，包名由 `package.json` 的 `name` 决定，路径不影响引用。用 `private: true` + 本节的语义说明消除"这些包该发布"的误解，比搬家更省事。
2. **保留 `element-parser` 这个名字**：上一轮你明确指定 `LocatorResolver → ElementParser`，我不擅自改回。歧义改用三点化解：① 文件位置在 `workers/` 下，与 `core/model-io/output-extractor` 不在同一层；② 文件头注释写明"解析 DOM 可交互元素并生成 selector，与模型输出解析无关"；③ 方法名 `parse/generate/healingChain` 已表达职责。若日后仍觉混淆，建议改 `dom-parser`。

---

## 3. 类索引（详细契约见第 5 章）

| 层 | 类 | 一句话职责 |
|---|---|---|
| 门面 | **Engine** | 唯一对外入口，编排任务生命周期 |
| 核心 | **TaskMachine** | 纯函数状态机转移 |
| 核心 | **Scheduler** | 选站、优先级、退避、熔断、项目公平 |
| 核心 | **SiteQueue** | 站点 FIFO + 互斥 + 原子预留 |
| 注册 | **SiteRegistry** | 站点元数据与健康度 |
| 注册 | **SkillRegistry** | SKILL 加载、校验、匹配 |
| 注册 | **ConfigResolver** | 默认资源 → userData 覆盖 → 校验 → 回退 |
| 状态 | **StateStore** | **唯一可变状态所有者**，经 repositories 落 storage |
| 会议 | **ConferenceManager** | 会议生命周期、收敛与决议 |
| 会议 | **ParticipantPicker** | 参会人筛选（纯函数，不预留） |
| 会议 | **RoundRunner** | 单轮下发、隔离、收集 |
| 会议 | **VoteTally** | 投票统计与少数派意见留存 |
| 模型 I/O | **PromptComposer** | 组装下发 prompt、摘要压缩 |
| 模型 I/O | **OutputExtractor** | 剥壳取 JSON + schema 校验 |
| 模型 I/O | **ResponseRepair** | 修复轮 prompt 与降级判定 |
| Git | **ProjectManager** | 多项目并行、worktree 隔离与回收 |
| Git | **PatchPipeline** | patch 解析/check/apply/降级 |
| Git | **ChangeSetBuilder** | 变更集、文件树、前后快照 |
| 沙箱 | **CommandPolicy** | 白名单、组合绕过检测、签发/校验票据（纯函数为主） |
| 沙箱 | **CommandRunner** | 先验票再执行，无 shell、超时、cwd 锁定 |
| 检查 | **CheckService** | 路由、并行、归一、去重 |
| 检查 | **ProviderRegistry** | Provider 注册与可用性探测 |
| 检查 | **CheckProvider（族）** | 按语言分组：supports/run/normalize |
| 进程 | **WorkerGuard** | 子进程守护、心跳、重启 |
| 协议 | **PlaywrightBridge** | 主↔Playwright 的帧适配与会话命令封装 |
| 协议 | **FrameCodec** | NDJSON 编解码与长度护栏 |
| 存储 | **FileStore** | 事件追加、重放、快照、原子写（不含状态） |
| 观测 | **TraceContext** | traceId 生成与派生 |
| 观测 | **AuditLogger** | 审计落盘与脱敏 |
| 安全 | **SecretVault** | safeStorage 加解密与权限收紧 |
| IPC | **IpcGateway** | 通道白名单 + zod 入参校验 |
| Worker | **PlaywrightWorkerMain** | 子进程主循环 |
| Worker | **SiteSession** | 每站点 context/page 封装（唯一页面操作者） |
| Worker | **LoginFlow** | 登录检测与持久化 |
| Worker | **ShotStream** | 登录期截图流（背压） |
| Worker | **ElementParser** | 解析 DOM 可交互元素并生成 selector（与模型输出解析无关） |
| Worker | **ReplyAssembler** | 流式结束判定 |
| Worker | **FrameIO** | stdio 帧收发 |
| 线程 | **PatchWorkerMain** | patch 解析/diff 生成 |
| 线程 | **CheckWorkerMain** | 检查任务执行载体 |
| 渲染 | **DagCanvas / TaskNode / DiffViewer / FileTree / ApprovalModal / DiagnosisPanel / ConferenceBoard** | UI 组件 |
| 渲染 | **projectStore / siteStore / taskStore / conferenceStore** | 只读镜像 |
| 渲染 | **api/（模块）** | 唯一 `window.herix.*` 调用点 |

---

## 4. 函数签名约定

### 4.1 三层类型防线
| 层 | 手段 | 强度 |
|---|---|---|
| L1 | JSDoc `@typedef` + `tsc --checkJs --noEmit` | 中 |
| L2 | ESLint `eslint-plugin-jsdoc` | 中 |
| L3 | **zod 运行时校验** | 强，唯一不可绕过 |

### 4.2 通用类型
```
Result<T>       = {ok:true, value:T} | {ok:false, error:AppError}
AppError        = { code, message, retryable, traceId, detail? }
CallCtx         = { traceId, actor, signal?, idempotencyKey? }
```
`ok(value)` / `err(code, message, extra?)` 为唯一构造方式。

### 4.3 枚举
`TaskState / SiteState / ConferenceState / RiskState / Vote` 一律 `Object.freeze` 常量 + `typeof X[keyof typeof X]` 派生类型；代码中禁写字符串字面量。

### 4.4 命名与注释规则（强制）
- 方法 = 动词 + 名词：`submitTask`、`leaseSite`、`appendEvent`；不缩写。
- 布尔 = `is/has/can/should` 前缀；集合用复数名；单条用单数。
- 每个公开方法必须有 `@param`（逐参数）与 `@returns`（含 `Result` 内的成功值语义）。
- `ctx` 永远是第一个参数；纯函数可省略 `ctx`（但需在注释标注 `@pure`）。
- 时间：epoch ms，后缀 `At`；时长后缀 `Ms`；路径一律绝对路径。
- `undefined`=未提供、`null`=显式无。
- **错误码必须来自 `errors.js` 常量**，禁止裸字符串。

### 4.5 错误码分段（供各章引用）
```
E_VALIDATION     入参 schema 校验失败（不可重试）
E_TOOL_MISSING   检查器不存在（可跳过）
E_NOT_LOGGED_IN  站点未登录（需人工）
E_RISK_BLOCKED   风控命中（熔断）
E_TIMEOUT        超时（可重试）
E_PATCH_PARSE    patch 解析失败（可重试→降级）
E_PATCH_CONFLICT apply --check 失败（降级/人工）
E_COMMAND_DENIED 沙箱拒绝（黑名单/组合绕过，不可重试）
E_COMMAND_UNAUTHORIZED 无票据、票据过期/已用/与命令不符
E_PROJECT_CLOSED 项目未打开即取用
E_PROJECT_LIMIT  活跃项目数超上限
E_CONFERENCE_NO_QUORUM 参会不足（降级）
E_STORE_IO       磁盘写入失败
E_WORKER_DOWN    子进程不可用
```

---

## 5. 类设计详表

> 表格列：**函数（入参）→ 出参** ｜ 说明（副作用、前置条件、错误码）。纯函数标 `@pure`。

### 5.1 Engine（门面）
**职责**：唯一对外入口；持有全部子服务；编排任务生命周期；自身不碰浏览器、Git、磁盘。
**不变式**：① 任何状态推进必须先过 `TaskMachine.canTransition`；② `awaiting_human` 只能由 `approveTask` 离开；③ 每个方法都必须带 `ctx`。

| 函数 | 说明 |
|---|---|
| `submitTask(ctx, TaskInput) → Result<TaskId>` | 幂等：同 `idempotencyKey` 返回同 ID；内部 `SiteQueue.enqueue` |
| `cancelTask(ctx, TaskId, reason) → Result<void>` | 释放站点锁、终止在途帧、状态置 `aborted` |
| `approveTask(ctx, TaskId, Decision, note?) → Result<void>` | 唯一离开 `awaiting_human` 的口；`approve` 后触发 `applyChangeSet` |
| `openConference(ctx, ConferenceRequest) → Result<ConferenceId>` | 委托 `ConferenceManager.open`，失败回滚预留 |
| `closeConference(ctx, ConferenceId, mode) → Result<void>` | `conclude` 产出决议回主链；`cancel` 释放资源 |
| `applyChangeSet(ctx, ChangeSetId) → Result<ApplyResult>` | 仅在隔离 worktree 生效，回填 commit 候选 |
| `rejectChangeSet(ctx, ChangeSetId, reason) → Result<void>` | 丢弃并回灌驳回意见给原站点 |
| `requestCommand(ctx, CommandRequest) → Result<CommandRequestId>` | 入队待审批，不执行 |
| `runCommand(ctx, CommandRequestId, ApprovalTicket) → Result<CommandResult>` | **必须先有票据**；委托 `CommandRunner`，无票即 `E_COMMAND_UNAUTHORIZED` |
| `feedDiagnostics(ctx, ChangeSetId, CheckReport) → Result<void>` | 检查结果回灌模型（生成修复 prompt） |
| `handleWorkerFrame(ctx, Frame) → Result<void>` | Worker 上行帧的唯一入口 |
| `handleWorkerCrash(ctx, CrashReport) → Result<void>` | 站点下线、任务回队、告警 |
| `getSnapshot(ctx?) → Promise<UiSnapshot>` | 只读聚合视图，供 UI 拉取 |

### 5.2 TaskMachine（纯函数状态机）
**职责**：唯一定义合法转移；不持有状态、不写盘。
**不变式**：终态不可再转移；转移必须带审计原因。

| 函数 | 说明 |
|---|---|
| `canTransition(from, to) → boolean` `@pure` | 查转移表 |
| `apply(task, to, ctx) → Result<Task>` `@pure` | 返回新对象，不改入参 |
| `isTerminal(state) → boolean` `@pure` | done/failed/aborted |
| `describeNext(task) → {action, reason}` `@pure` | 给调度器/UI 的行动提示 |

### 5.3 Scheduler
**职责**：选站、排序、退避、熔断；不做 I/O。
**不变式**：只能从 `SiteRegistry` 的健康视图选站；风控站点不得入选。

| 函数 | 说明 |
|---|---|
| `selectSite(ctx, SkillId, SiteId[]) → Result<SiteId>` | 按 skill 支持 + 健康 + 队列深度加权 |
| `computePriority(Task) → number` `@pure` | 人工触发 > 拆解任务 > 常规实现 |
| `nextBackoffMs(retryCount) → number` `@pure` | 指数退避 + 抖动 |
| `shouldCircuitBreak(SiteHealth) → boolean` `@pure` | 连续失败/风控命中即熔断 |
| `pickNext(ctx, SiteId) → Result<Task|null>` | 站点空闲时的下一个可执行任务 |
| `fairShare(ctx, ProjectId[]) → Map<ProjectId, weight>` `@pure` | 多项目并行时按项目轮转分配站点，防单项目饿死其他 |

### 5.4 SiteRegistry
**职责**：站点元数据、登录态、健康、风控状态、定位器（可热改）。
**不变式**：定位器变更必须记审计；健康度只能由 Worker 上报或超时推导。

| 函数 | 说明 |
|---|---|
| `register(ctx, SiteConfig) → Result<SiteId>` | 首启装载 `state/sites.json` 后调用 |
| `updateLocators(ctx, SiteId, LocatorSet) → Result<void>` | 热改；失败保留旧值 |
| `markRisk(ctx, SiteId, RiskState) → Result<void>` | 命中 `captcha/throttled` 时由 Worker 上报 |
| `getHealth(SiteId) → SiteHealth` `@pure` | 登录态+风控+队列+最近失败率 |
| `listBySkill(SkillId) → SiteId[]` `@pure` | 候选池，供 Scheduler |
| `touch(ctx, SiteId) → Result<void>` | 更新 `lastActiveAt`（限流用） |

### 5.5 SiteQueue
**职责**：每站点一条 FIFO + 一把互斥；会议可整锁预留。
**不变式**：① 同一 site 同时最多一个 lease；② 预留必须原子（全成或全滚）；③ 预留期间普通任务不可插队。

| 函数 | 说明 |
|---|---|
| `enqueue(ctx, SiteId, Task) → Result<{position:number}>` | 幂等按 taskId |
| `lease(ctx, SiteId, reservationId?) → Result<Task|null>` | 锁空闲才出队；无任务返回 null |
| `release(ctx, SiteId, TaskId, TaskState) → Result<void>` | 必与 lease 成对 |
| `reserveAll(ctx, SiteId[]) → Result<{reservationId}>` | 原子预留；任一失败整体回滚 |
| `releaseReservation(ctx, reservationId) → Result<void>` | 会议结束/取消时调用 |
| `depth(SiteId) → number` `@pure` | 供 UI 与选站 |

### 5.6 SkillRegistry
**职责**：加载 YAML、zod 校验、版本管理、能力匹配。

| 函数 | 说明 |
|---|---|
| `loadAll(ctx) → Result<{loaded:number, rejected:{file,reason}[]}>` | 启动时；非法条目拒绝但继续 |
| `get(SkillId) → Result<Skill>` | 未注册即 `E_VALIDATION` |
| `reload(ctx, SkillId) → Result<Skill>` | 热改；记版本与摘要 |
| `validate(YamlObject) → Result<Skill>` `@pure` | 校验 input/output schema |
| `history(SkillId) → {version, changedAt}[]` | 供回滚与 A/B |

### 5.7 PromptComposer
**职责**：把 SKILL、任务、历史、格式约束组装成 prompt；控制 token。

| 函数 | 说明 |
|---|---|
| `composeTaskPrompt(ctx, {Skill, Task, history, constraints}) → Result<{prompt, tokenEstimate}>` | 超限则触发摘要 |
| `composeConferencePrompt(ctx, {topic, self, others, priorOpinions, round}) → Result<string>` | 首轮不含他人意见；二轮注入摘要 |
| `composeRepairPrompt(ctx, rawOutput, errors) → Result<string>` | 输出提取失败时的纠错提示 |
| `summarize(items, maxTokens) → string` `@pure` | 历史压缩；超限按条截断并标注 |

### 5.8 OutputExtractor
**职责**：从不稳定输出中取出合法 JSON 并校验。

| 函数 | 说明 |
|---|---|
| `extract(raw, ZodSchema) → Result<unknown>` | 剥围栏→取平衡括号→parse→schema |
| `stripFence(text) → string` `@pure` | 去 ```json 包裹 |
| `findBalanced(text) → string|null` `@pure` | 首个平衡 `{}`/`[]` 片段 |
| `needsRepair(result) → boolean` `@pure` | 决定是否重发一次纠错 |

### 5.9 ConferenceManager
**职责**：会议生命周期；参会人来自不同站点；原子预留；轮次与收敛。
**不变式**：① 参会站点互不相同且全部经预留；② 轮次 ≤2、人数 ≤4；③ 首轮互相不可见。

| 函数 | 说明 |
|---|---|
| `open(ctx, ConferenceRequest) → Result<ConferenceId>` | 选人→`reserveAll`→建实例；凑不齐 `E_CONFERENCE_NO_QUORUM` |
| `planParticipants(need, SkillId) → SiteId[]` `@pure` | 只做候选筛选，不预留 |
| `startRound(ctx, ConferenceId) → Result<RoundResult>` | 并行下发；首轮隔离 |
| `collectOpinions(ctx, ConferenceId) → Result<{opinions}>` | 汇总并按 schema 校验 |
| `shouldConverge(state) → boolean` `@pure` | 无新增 defect 即收敛 |
| `conclude(ctx, ConferenceId) → Result<{summary, patchText?}>` | 生成决议 |
| `cancel(ctx, ConferenceId, reason) → Result<void>` | 释放预留 |
| `onTimeout(ConferenceId) → Result<'degrade'|'wait'>` | 超时降级策略 |

### 5.10 ProjectManager（多项目并行）
**职责**：管理多个项目的注册与并行运行；每个活跃项目独占一个 worktree；同一物理仓库的 git 操作串行化；回收与残留清理。
**不变式**：① 一个项目一个 worktree，互不共享；② 同一仓库（共享 `.git`）的写操作必须排队；③ 活跃项目数受 `maxActiveProjects` 限制；④ 项目关闭必须回收 worktree，异常退出由启动清扫兜底。

| 函数 | 说明 |
|---|---|
| `register(ctx, ProjectConfig) → Result<ProjectId>` | 登记根路径、默认分支、语言栈、可用检查器；幂等按根路径 |
| `open(ctx, ProjectId) → Result<{worktreePath, branch}>` | 创建或复用 worktree，抢占项目级锁；超限 `E_PROJECT_LIMIT` |
| `close(ctx, ProjectId) → Result<void>` | 落盘 commit 候选、回收 worktree、释放锁 |
| `getWorktree(ProjectId) → Result<string>` | 未打开取用即 `E_PROJECT_CLOSED` |
| `listActive() → ProjectId[]` `@pure` | 供 UI 项目切换与 Scheduler 公平调度 |
| `ensureClean(ctx, ProjectId) → Result<void>` | 有未提交变更即拒用 |
| `withRepoLock(ctx, ProjectId, fn) → Promise<Result<T>>` | 同仓库 git 操作串行；不同仓库可并行 |
| `sweepStale() → string[]` `@pure` | 启动时清理上次残留的 worktree 与锁 |

### 5.11 PatchPipeline
**职责**：patch 三段兜底；只对隔离 worktree 动手。
**不变式**：必须先 `--check` 再 `apply`；永不写用户分支。

| 函数 | 说明 |
|---|---|
| `parse(raw) → Result<ParsedPatch>` `@pure` | 结构解析；失败 `E_PATCH_PARSE` |
| `checkApply(ctx, worktreePath, ParsedPatch) → Result<void>` | `git apply --check`，冲突 `E_PATCH_CONFLICT` |
| `apply(ctx, worktreePath, ParsedPatch) → Result<void>` | 仅在 worktree |
| `toWholeFile(ParsedPatch) → WholeFilePatch` `@pure` | 降级模式 |
| `buildUnifiedDiff(before, after, path) → string` `@pure` | 整文件降级时生成 diff |

### 5.12 ChangeSetBuilder
**职责**：把 worktree 变更打包成可审批、可展示的结构。

| 函数 | 说明 |
|---|---|
| `build(ctx, TaskId, worktreePath, files[]) → Result<ChangeSet>` | 记录 before/after/patch |
| `buildTree(ChangeSet) → FileTreeNode[]` `@pure` | 树形 + 新增/修改/删除标记 |
| `snapshotFile(ctx, path) → Result<{content}>` | 审批前留底 |
| `attachReport(ctx, ChangeSetId, CheckReport) → Result<void>` | 挂诊断结果 |

### 5.13 CommandPolicy（授权策略 + 纯函数判定）
**职责**：命令白名单与组合绕过检测；签发与校验**一次性授权票据**；不做执行。
**不变式**：① **任何本地命令执行前必须有票据，无票据一律 `E_COMMAND_UNAUTHORIZED`**；② 票据与 `cmd+args+cwd+worktree` 绑定哈希，执行前复核（防审批后被篡改）；③ 票据一次性、短时效（默认 5 分钟），用后即废。

| 函数 | 说明 |
|---|---|
| `validate(CommandRequest) → Result<ValidationVerdict>` `@pure` | 返回 `{allowed, forbiddenReason?, riskLevel}`；`allowed` 仅代表"可申请授权"，不代表可执行 |
| `issueTicket(ctx, CommandRequest, approver) → Result<ApprovalTicket>` | 人工批准后签发；`approvalScope='single'`（默认，逐条）或 `'batch'`（同 Provider 同一检查批次） |
| `verifyTicket(ctx, ApprovalTicket, CommandRequest) → Result<void>` | 校验哈希、时效、一次性；不一致 `E_COMMAND_UNAUTHORIZED` |
| `consumeTicket(ctx, ticketId) → Result<void>` | 执行前原子置为已用，防重放 |
| `matchWhitelist(cmd, args, cwd) → boolean` `@pure` | 精确匹配 + cwd 必须在目标 worktree 内 |
| `rejectReason(cmd, args) → string|null` `@pure` | 组合绕过检测（`sh -c`、管道、`;`、`$()`、`..`、装包命令） |
| `isForbidden(cmd) → boolean` `@pure` | 永远拒绝类命令（黑名单），不进入审批队列 |

### 5.14 CommandRunner
**职责**：`shell:false` 执行、超时、cwd 锁定、输出截断；**入口先验票**。

| 函数 | 说明 |
|---|---|
| `execute(ctx, CommandRequest, ApprovalTicket) → Result<CommandResult>` | 先 `CommandPolicy.verifyTicket` + `consumeTicket`，再执行；缺票 `E_COMMAND_UNAUTHORIZED` |
| `kill(ctx, requestId) → Result<void>` | 超时或人工中止 |
| `env(CommandRequest) → object` `@pure` | 白名单化环境变量 |
| `truncate(stdout, stderr, maxBytes) → {stdout, stderr, truncated}` `@pure` | 防撑爆日志 |

### 5.15 CheckService
**职责**：路由 → 并行 → 归一 → 去重 → 排序；每种语言一个 Provider。
**不变式**：Provider 缺 `normalize` 不许注册；单 Provider 30s 超时。

| 函数 | 说明 |
|---|---|
| `check(ctx, worktreePath, files[]) → Result<CheckReport>` | 主入口 |
| `route(files, projectRoot) → Map<providerId, files[]>` `@pure` | 按扩展名/项目特征分流 |
| `merge(results) → Diagnostic[]` `@pure` | 统一形状 |
| `dedupe(diags) → Diagnostic[]` `@pure` | 同 file+line+code 去重 |
| `sort(diags) → Diagnostic[]` `@pure` | file → line → severity |

### 5.16 ProviderRegistry
| 函数 | 说明 |
|---|---|
| `register(CheckProvider) → Result<void>` | 缺 `normalize` 即 `E_VALIDATION` |
| `resolveFor(filePath, projectRoot) → providerId[]` `@pure` | 可能命中多条链 |
| `probeAll(ctx) → {providerId, available, reason?}[]` | 启动时探测，缺失不阻塞 |

### 5.17 CheckProvider（族：tsc / eslint / ruff / pyright / go-vet / staticcheck / clang-tidy / clippy）
**职责**：各语言检查的适配层；只负责"怎么跑、怎么解析"。
**不变式**：输出必须归一为 `Diagnostic`，不得直接回传原始格式。

| 函数 | 说明 |
|---|---|
| `supports(filePath, projectRoot) → boolean` `@pure` | 路由判定 |
| `isAvailable(cwd) → Promise<Result<boolean>>` | 工具是否安装；缺则 `E_TOOL_MISSING` |
| `run(ctx, {worktree, files}) → Promise<Result<RawResult>>` | 调白名单命令 |
| `normalize(raw, worktree) → Diagnostic[]` `@pure` | 强制实现 |

### 5.18 WorkerGuard
**职责**：子进程守护、心跳、重启、背压。
**不变式**：崩溃后先下线站点再重启，不并发起两个进程。

| 函数 | 说明 |
|---|---|
| `start(ctx) → Result<void>` | spawn + 握手（`hello/ready`） |
| `stop(ctx, gracefulMs) → Result<void>` | 先发 `shutdown` 再强杀 |
| `probe() → Promise<Health>` | 3s ping，3 次未 pong 判挂 |
| `restart(ctx, reason) → Result<void>` | 拉新进程、重建会话、回放未完成任务 |
| `send(Frame) → Result<void>` | 背压：outbox 超阈值丢弃低优先级（截图帧优先丢） |
| `onFrame(cb) → () => void` | 注册上行处理器，返回退订 |
| `isAlive() → boolean` `@pure` | UI 状态用 |

### 5.19 FrameCodec
| 函数 | 说明 |
|---|---|
| `encode(Frame) → string` `@pure` | 单行 JSON + `\n` |
| `decode(line) → Result<Frame>` `@pure` | parse + schema 校验 |
| `createParser(onFrame, onBad) → {feed(chunk), flush()}` | 增量解析；坏行计数后丢弃 |
| `guardSize(line) → Result<void>` `@pure` | 超 512KB 转 `oversize` |

### 5.20 FileStore（含 Journal/Snapshot/Atomic）
**职责**：事件追加、重放、快照压缩、原子写、单实例锁。
**不变式**：① append 成功才算状态提交；② 读盘数据必须过 zod；③ 同一时刻只有一个持有 `.lock`。

| 函数 | 说明 |
|---|---|
| `appendEvent(ctx, type, payload) → Result<seq>` | 写当日分片并 fsync |
| `replay(ctx) → Result<{events, lastSeq}>` | 快照 + 尾部事件重建 |
| `writeState(ctx, name, data) → Result<void>` | tmp→fsync→rename |
| `readState(ctx, name, ZodSchema) → Result<unknown>` | 校验后返回 |
| `compact(ctx) → Result<{archived}>` | 达阈值或退出时归档 |
| `close() → Result<void>` | 释放锁 |

### 5.21 辅助基建
| 类/函数 | 说明 |
|---|---|
| `TraceContext.newTrace(cause?) → TraceId`；`child(parent) → TraceId`；`current() → TraceId` | 贯穿全链路 |
| `AuditLogger.record(ctx, entry) → Result<void>`；`query(traceId) → Result<AuditEntry[]>`；`redact(text) → string` | 脱敏 + 追加写 |
| `SecretVault.save(siteId, StorageState) → Result<void>`；`load(siteId) → Result<StorageState|null>`；`isAvailable() → boolean` | safeStorage 加解密到 `secrets/sites/*.bin` |
| `IpcGateway.handle(channel, ZodSchema, handler) → void`；`broadcast(event, payload) → void` | 唯一 IPC 出口，入参强校验 |

### 5.22 Worker 进程类

| 类 | 函数 | 说明 |
|---|---|---|
| **PlaywrightWorkerMain** | `boot() → Promise<void>`／`onFrame(Frame) → Promise<void>`／`shutdown(reason) → Promise<void>` | 主循环：读帧→分派→回帧；异常转 `fatal` |
| **SiteSession** | `open(SiteId, opts) → Result<void>`／`close() → Result<void>`／`goto(url) → Result<void>`／`openChat() → Result<void>`／`sendPrompt(text) → Result<void>`／`readReply(timeoutMs) → Result<{text,truncated}>`／`screenshot() → Result<{filePath,w,h}>`／`dumpState() → Result<StorageState>`／`health() → Health` | 一站一会话（context+page）；其余类都通过它动页面 |
| **LoginFlow** | `detectLoggedIn() → Promise<boolean>`／`runInteractive(ctx) → Result<void>`／`waitForSuccess(timeoutMs) → Result<boolean>`／`persistState() → Result<void>` | 可见窗口人工过验证；成功后停截图流 |
| **ShotStream** | `start(SiteId, opts) → Result<void>`／`tick() → Result<{filePath}>`／`stop() → Result<void>` | JPEG 低帧率；单帧缓存丢旧；只传路径 |
| **ElementParser** | `parse(scope) → Result<{elements, index}>`／`resolve(name) → Result<selector>`／`generate(element) → Result<selector>`／`probe(selector) → Result<boolean>`／`healingChain(name) → selector[]` | 解析页面可交互元素、生成稳定选择器、失效自愈并告警 |
| **ReplyAssembler** | `feed(delta) → void`／`isComplete() → boolean`／`finalize() → {text,truncated}` | 以"停止标记 + 静默窗口"判结束 |
| **FrameIO** | `send(Frame) → void`／`onFrame(cb) → void`／`start() → void` | stdout 只写帧，日志走 stderr |

### 5.23 worker_threads
| 类 | 函数 | 说明 |
|---|---|---|
| **PatchWorkerMain** | `handle({job:'parse'|'diff', payload}) → Result` | 重 CPU 解析，避免阻塞主线程 |
| **CheckWorkerMain** | `handle({job:'check', payload}) → Result<CheckReport>` | 检查器执行载体，可被终止 |

### 5.24 渲染层
| 组件 | 输入（props） | 输出（事件） |
|---|---|---|
| **DagCanvas** | `nodes, edges, layout` | `nodeClick, nodeContextMenu(发起合议/重试)` |
| **TaskNode** | `task{state,skillId,siteId,queueDepth}` | `approve, reject, openConference` |
| **DiffViewer** | `file{before,after}` | `acceptHunk?`（预留） |
| **FileTree** | `changeSet.files` | `selectFile(path)` |
| **ApprovalModal** | `pending{type:'patch'|'command', detail}` | `confirm, reject(reason)` |
| **DiagnosisPanel** | `checkReport` | `sendBackToModel`（触发回灌） |
| **ConferenceBoard** | `conference.participants, round, votes` | `conclude, cancel, addRound` |
| **stores** | `projectStore/siteStore/taskStore/conferenceStore` | 只读镜像；**api/ 是唯一 `window.herix.*` 调用点** |

### 5.25 拆分产出的支撑类（v0.8 新增）
| 类 | 关键函数（签名） | 约束 |
|---|---|---|
| **ConfigResolver** | `load(kind:'skills'|'sites', ctx) → Result<{items, sources}>`；`watch(onChange)` | 整文件替换；校验失败回退默认并记 `config.rejected`；不改运行中任务 |
| **StateStore** | `get(slice) → Immutable`；`commit(mutation, ctx) → Result<{version}>`；`subscribe(fn) → unsubscribe` | **唯一写入口**：其他模块只能 `commit` 事件，不能直接写 journal |
| **ParticipantPicker** | `pick({candidates, skillRoles, max, exclude}) → {chosen, skipped}` | 纯函数，不预留站点；预留交给 SiteQueue，避免死锁 |
| **RoundRunner** | `runRound({members, prompt, round, signal}) → {responses, failures}` | 并发上限 ≤4，单轮失败不放大；全部失败即短路 |
| **VoteTally** | `tally({votes, rule}) → {decision, dissent:[...]}` | 少数派意见必须落 journal，不得静默丢弃 |
| **ResponseRepair** | `decide({parseError, attempt, schema}) → {action:'repair'|'fail', prompt?}` | 修复轮 ≤2 次；超限直接 fail，禁止无限重试 |
| **PlaywrightBridge** | `send(siteId, cmd, payload, signal) → Result`；`onFrame(handler)`；`login(siteId)`；`readResult(taskId)` | 主↔Playwright 的唯一出入口；帧编解码委托 FrameCodec，禁止 core 直碰 stdio |

---

## 6. 主流程调用关系

### 6.1 进程与类拓扑
```
┌──────────────────────── Electron Renderer ────────────────────────┐
│ views/components ← pinia stores（只读镜像）                          │
│            ▲ 全部读写走 api/（唯一 window.herix.* 调用点）           │
└────────────┼──────────────────────────────────────────────────────┘
             │ IPC（preload 白名单）
┌────────────▼──────────── Electron Main（ESM，不编译）──────────────┐
│ IpcGateway ──► Engine ──┬─► Scheduler ─► SiteQueue                  │
│                          ├─► SkillRegistry ◄─ ConfigResolver        │
│                          ├─► ConferenceManager                      │
│                          │     ├─► ParticipantPicker（纯）           │
│                          │     ├─► RoundRunner ─► PromptComposer    │
│                          │     └─► VoteTally                        │
│                          ├─► model-io: OutputExtractor ─► ResponseRepair
│                          ├─► TaskMachine（纯）                       │
│                          ├─► ProjectManager ─► PatchPipeline        │
│                          ├─► ChangeSetBuilder                       │
│                          ├─► CommandPolicy ─► 票据 ─► CommandRunner  │
│                          ├─► CheckService ─► ProviderRegistry ─► providers/<lang>/ │
│                          ├─► WorkerGuard ─► PlaywrightBridge ─► FrameCodec │
│                          └─► StateStore ─► storage/FileStore（原子 I/O） │
│                              AuditLogger / SecretVault（infra）      │
└───────┬───────────────────────────────────────────┬───────────────┘
        │ NDJSON over stdio（经 PlaywrightBridge）     │ postMessage
┌───────▼──── Playwright Worker（独立子进程）────┐  ┌─▼─ PatchWorker / CheckWorker ┐
│ PlaywrightWorkerMain ─► FrameIO                │  │ handle(job) → Result         │
│   ├─► SiteSession（每站点 1 个 context/page）    │  └──────────────────────────────┘
│   ├─► LoginFlow  ├─► ShotStream                │
│   ├─► ElementParser ├─► ReplyAssembler         │
└────────────────────────────────────────────────┘
```
> 状态写入路径唯一：`Engine/Scheduler/Conference → StateStore.commit() → repositories → FileStore.append() → journal`。**没有任何模块可以直接写 journal。**

### 6.2 冷启动序列
1. `bootstrap` → `FileStore.replay()`（`.lock` 抢占；失败则拒启）
2. → `StateStore.hydrate()`（从 `state/*.json` 恢复唯一状态源；校验失败落 `state.corrupted` 并降级空态）
3. → `ConfigResolver.load('sites'|'skills')`（默认资源 → userData 覆盖 → 校验 → 回退）
4. → `SiteRegistry.register()` / `SkillRegistry.loadAll()`
5. → `ProviderRegistry.probeAll()`（缺工具只在 UI 标 `tool_missing`）
6. → `WorkerGuard.start()` → `PlaywrightBridge.send('hello')` → 握手 `ready`
7. → 各站点 `SiteSession.open()` → `SecretVault.load()` 复用登录态
8. → `Engine.getSnapshot()` 经 `IpcGateway.broadcast` 推给 UI

### 6.3 任务主链路（最长的一条）
1. UI 选中项目 → `IpcGateway.handle('task.submit', TaskInputSchema)`
2. → `Engine.submitTask(ctx, input)`：查 `idempotencyKey`，命中直接返回旧 ID
3. → `Scheduler.selectSite(skillId, candidates)`（候选来自 `SiteRegistry.listBySkill`）
4. → `SiteQueue.enqueue(siteId, task)`
5. → `Scheduler.pickNext(siteId)` → `SiteQueue.lease(siteId)`
6. → `SkillRegistry.get(skillId)` → `PromptComposer.composeTaskPrompt(...)`
7. → `WorkerGuard.send(SendTaskFrame)` → `FrameIO` → `SiteSession.sendPrompt()`
8. ← Worker 上行 `reply.chunk*` → `ReplyAssembler.feed()`；`Engine.handleWorkerFrame()` 转发 UI 增量
9. ← `reply.end` → `OutputExtractor.extract(text, OutputSchema)`
   - 失败 → `ResponseRepair.decide()` → `PromptComposer.composeRepairPrompt()` → 重发一次（`retryCount` 不变）
   - 再失败 → 降级整文件模式；仍失败 → `TaskMachine.apply(FAILED_RETRYABLE)`
10. 成功 → `ProjectManager.open()` → `PatchPipeline.checkApply()` → `apply()`
11. → `ChangeSetBuilder.build()` → 状态 `awaiting_human` → UI 渲染文件树 + 左右 Diff
12. 人工 `approveTask(ctx, id, 'approve')`
13. → 先 `CheckService.check(worktree, files)`（票据 `approvalScope:'batch'`，同 Provider 同批）
14. → 有 error → `Engine.feedDiagnostics()` → 回第 6 步（同站点，标注"修复轮次"）
15. → 无 error → `ApplyResult` 生成 commit 候选 → UI 提示 → `TaskMachine.apply(DONE)`
16. → `StateStore.commit('task.done')` → `AuditLogger.record()`

### 6.4 会议链路
1. `SkillRegistry.get()` 发现 `needConference` 或用户手动触发 → `Engine.openConference()`
2. → `ConferenceManager.open()`：`ParticipantPicker.pick()` → `SiteQueue.reserveAll()`
   - 预留失败 → 全量回滚 → `E_CONFERENCE_NO_QUORUM` → 降级单模型 + 告警
3. → `RoundRunner.runRound(round=1, prompt)`：对每个参会站点独立 prompt，**并行下发、互相不可见**
4. ← 各站 `reply.end` → `OutputExtractor.extract(TalkSchema)` → `collectOpinions()`
5. → `shouldConverge()` 为否且轮次 <2 → `RoundRunner.runRound(round=2)`：`summarize()` 压缩历史后注入
6. ← 二轮意见 → `shouldConverge()` → `VoteTally.tally()` → `conclude()` 产出 `{summary, patchText?, dissent}`
7. → `SiteQueue.releaseReservation()`；有 patch 则并入 6.3 第 10 步
8. 人工 reject → `ConferenceManager.reopen()`（同 `taskId` 新实例，状态 `reopened`）
9. 全程每个参会动作与少数派意见都写 `audit`，`traceId` 与父任务恒等

### 6.5 登录链路
1. UI 点"登录站点" → `api/sites.login()` → `IpcGateway` → `Engine` → `PlaywrightBridge.login(siteId)`（`cmd:'site.open', mode:'interactive'`）
2. → `SiteSession.open()`：`browser.newContext(storageState?)` → `goto(loginUrl)`
3. → `LoginFlow.detectLoggedIn()` 为假 → `runInteractive()`（`headless:false` 可见窗口）
4. → `ShotStream.start()`（可选，仅预览；1–3 fps、JPEG、单帧缓存）→ `shot.frame{filePath}` → UI `<img>`
5. 用户在原生窗口过滑块/验证码 → `LoginFlow.waitForSuccess()`
6. → 成功：`ShotStream.stop()`（**立即停流并清临时文件**）→ `dumpState()` → `SecretVault.save()`
7. → `SiteRegistry.markLoggedIn()` → `IpcGateway.broadcast('site.status')`
8. 失败/超时 → `E_NOT_LOGGED_IN` → UI 提示重试；`retryCount` 记入站点

### 6.6 命令链路（每次执行都要授权）
1. 模型输出 `{type:'command', cmd, args, reason}` → `OutputExtractor` 校验
2. → `Engine.requestCommand()` → `CommandPolicy.validate()`
   - 黑名单 / 组合绕过 → `E_COMMAND_DENIED`，直接回灌模型（不进审批队列）
3. → 状态置 `awaiting_human`，UI `ApprovalModal` 展示 `cmd / args / cwd / worktree / riskLevel / reason`
4. 人工 `confirm` → `CommandPolicy.issueTicket(ctx, req, approver)` 签发**一次性票据**（绑定 `cmd+args+cwd+worktree` 哈希，默认 5 分钟有效）
5. → `Engine.runCommand(ctx, requestId, ticket)` → `CommandRunner.execute(ctx, req, ticket)`
   - `verifyTicket` + `consumeTicket` 通过才 spawn；票据不符/过期/已用 → `E_COMMAND_UNAUTHORIZED`
6. → 结果 `{stdout, stderr, exitCode, durationMs}` → `AuditLogger.record(票据ID + 批准人 + 命令哈希)` → 回灌模型
7. 超时或人工中止 → `kill()`，同样记审计

> 检查器命令（tsc / ruff / go vet 等）同样受此约束：默认以 `approvalScope='batch'` 签发**一次检查批次票据**，覆盖该批次内同 Provider 的多次调用——**每次执行仍验票、仍审计**，但不必为每个文件点一次确认。要绝对严格就把配置切到 `'single'`，代价是一次检查可能产生数十次人工确认。

### 6.7 崩溃恢复链路
1. `WorkerGuard.probe()` 连续 3 次无 `pong` 或进程 exit ≠ 0
2. → `stop()`（尽力）→ 标记该 worker 全部站点 `unavailable`
3. → 遍历在途任务：`TaskMachine.apply(FAILED_RETRYABLE)` → `SiteQueue` 回队头（重试 +1）
4. → `Engine.handleWorkerCrash()` → 写审计 → UI 告警条
5. → `restart()`：新进程 → `hello/ready` → 逐站点 `SiteSession.open()`（读加密 storage_state）
6. → 重试超限任务转人工；站点连续熔断则 `Scheduler.shouldCircuitBreak()` 暂停该站

### 6.8 一次任务涉及的跨进程往返次数（性能基线）
| 阶段 | 往返 | 说明 |
|---|---|---|
| 下发 | 1 | `task.send` + `ack` |
| 输出 | N | 流式 `reply.chunk`（可合并推送，默认 100ms 批量） |
| 完成 | 1 | `reply.end` |
| 命令 | 2 | `command.request` / `result`（+人工审批不计） |
| patch | 0 | 全在主进程 + `patch-worker` 线程，不出 Electron |
| 检查 | 0 | `check-worker` 线程，不出 Electron |

---

## 7. 状态机与不变式

### 任务状态机（唯一定义）
```
pending → queued → running → awaiting_human → approved → applying → verifying → done
                        ↘ rejected → requeue → queued
                        ↘ failed_retryable → queued（retryCount < max）
                        ↘ failed（超限 / 不可重试）
任意 → aborted
```
> `verifying` 即静态检查阶段；有 error 回 `running`（修复轮），无 error 才进 `done`。

### 站点状态机
`unavailable → logging_in → idle → busy → (captcha|throttled) → cooling → idle`

### 会议状态机
`preparing → speaking → debate → voting → concluded｜reopened｜canceled`

### 不变式（写成 vitest 断言）
1. 任一 `siteId` 至多一个 `running` 任务。
2. `awaiting_human` 只能由 `approveTask / rejectChangeSet / runCommand` 离开。
3. `ChangeSet` 未审批前不得写入用户分支。
4. 会议参会集合与 `reservationId` 一一对应，回收成对。
5. 同一 `idempotencyKey` 重复提交返回同一 `TaskId`。
6. `traceId` 在 `Task → Conference → ChangeSet → Command → Check` 上恒等。
7. 进入核心的 payload 都是 zod 校验过的对象。
8. 事件日志 append 成功才算状态提交；磁盘失败则回滚内存。
9. 同一时刻只有一个实例持有 `.lock`。
10. 每个 `lease` 必有配对 `release`，异常路径由 `finally` 保证。
11. **无有效票据不得执行任何本地命令**；票据一次性、短时效、与 `cmd+args+cwd+worktree` 哈希绑定。
12. 多项目并行时，任一物理仓库的 git 写操作串行；活跃项目数不超过 `maxActiveProjects`。

---

## 8. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| M0 | 骨架：`skeleton.manifest.json` → `gen-skeleton` 全量渲染 + 依赖方向 lint | 目录骨架落地、循环依赖 lint 报错、`tsc --checkJs` 通过、`gen-skeleton --verify` 通过 |
| M0.5 | FrameCodec/Heartbeat + PlaywrightBridge + 崩溃恢复 + zod 帧校验 | 强杀 worker 能重建、任务回队、坏帧不崩主进程 |
| M0.6 | **StateStore + repositories + FileStore（事件日志/快照/原子写/锁）** | 强杀后重放恢复；双开被拒；无模块绕过 StateStore 写 journal |
| M1 | ConfigResolver + 站点注册 + 登录（可见窗口 + safeStorage） | 5 站点登录、重启复用、覆盖文件坏掉回退默认不崩 |
| M2 | SiteQueue + 跨站点并发 + SkillRegistry | 单站点严格串行、两站点并行、非法 SKILL 被拒 |
| M3 | model-io：OutputExtractor + ResponseRepair + PatchPipeline 三段兜底 | 20 次畸形输出 ≥18 次救回或正确降级 |
| M4 | ConferenceManager（ParticipantPicker / RoundRunner / VoteTally） | 并发 3 会议无死锁、无抢占、饿死有降级；少数派意见可查 |
| M5 | Provider 架构（`providers/{js,python,go}` 起步）+ 命令票据 + 回灌 | 三语言混合项目出统一诊断；无票执行被拒、票据重放被拒 |
| M6 | UI：Vue Flow、左右 Diff、文件树、审批闸、会议板、诊断板、项目切换（全部经 `api/`） | 全链路一次人工确认跑通；两项目并行无互相饿死 |
| M7 | 审计与 trace 时间线、熔断、打包 | 打包换机可跑；trace 可回放整条链 |

---

## 9. 风险声明（写进 README）
> 本工具以浏览器自动化方式访问第三方 Web 端模型，相关平台用户协议普遍限制自动化访问。排队、限流、随机抖动仅降低风控概率，**不保证账号安全**；封禁属预期风险，请准备备用站点并接受降级策略。

---

## 10. 分片落地与生成规范

> 前提：本工程约 90 个文件、30+ 类。**任何一个模型的单次输出都装不下**，逐字生成必然截断、必然反复搬运。因此代码不由模型逐字产出，而由**数据包经脚本渲染**；模型的工作退化为"写数据 + 填单个类"。

### 10.1 两段式（唯一允许的落地方式）
| 段 | 输入 | 产出 | 单次规模 |
|---|---|---|---|
| **第一段：骨架** | `doc/skeleton.manifest.json`（全量文件清单 + 导出符号 + 函数签名 + TODO 批次） | 90 个骨架文件（每个 20–40 行，空实现 + `notImplemented(tag)`） | 1 次生成 + 1 次脚本渲染 |
| **第二段：填肉** | `doc/api-surface.md` 切片 + `doc/progress.json` + 本批目标 | 每轮 1–2 个类的真实实现（`Edit` 替换空函数体） | 每轮 ≤ 500 行 |

> `[铁律]` 骨架文件首行必须是 `// @generated-skeleton Bx — 由 gen-skeleton 渲染，填充时删除本行`。删除本行 = 声明"该文件已被人手接管"，脚本永不覆盖它。

### 10.2 三条硬上限（超限即拆批）
| 上限 | 值 | 理由 |
|---|---|---|
| 单文件 | ≤ 120 行（不含 JSDoc） | 超过即职责不清，应拆类 |
| 单函数 | ≤ 40 行 | 超过即可测性下降 |
| 单批新增 | ≤ 500 行、≤ 2 个类 | 保证一轮内可完整输出并被 lint 验证 |

### 10.3 骨架数据包格式（`doc/skeleton.manifest.json`）
```jsonc
{
  "schemaVersion": "1",
  "files": [
    {
      "path": "src/main/core/task-machine.js",
      "batch": "B5",
      "layer": "core",
      "kind": "class",                 // class | module | component
      "exportName": "TaskMachine",
      "imports": [
        { "from": "../../libs/contracts/index.js", "names": ["TaskState", "TaskEvent"] },
        { "from": "../../libs/utils/errors.js", "names": ["notImplemented"] }
      ],
      "classDoc": "纯函数状态机，唯一允许的状态转移权威。无 I/O、无时钟。",
      "members": [
        {
          "kind": "method", "name": "apply", "async": false,
          "params": [
            { "name": "ctx", "type": "CallCtx", "desc": "调用上下文（traceId 必填）" },
            { "name": "state", "type": "TaskState", "desc": "当前状态" },
            { "name": "event", "type": "TaskEvent", "desc": "转移事件" }
          ],
          "returns": { "type": "Result<TaskState>", "desc": "新状态或 E_VALIDATION" },
          "throwsCodes": ["E_VALIDATION"],
          "invariants": ["纯函数", "非法转移必须返回 err 而非 throw", "不得引入 Date.now()"]
        }
      ]
    }
  ]
}
```
渲染规则（`gen-skeleton` 唯一职责，不含任何业务判断）：
1. 按 `imports` 生成 import 语句（相对路径原样，不重排）；
2. 按 `classDoc` + 每个 member 的 `params/returns/throwsCodes/invariants` 生成 JSDoc（`@param` / `@returns` / `@throws` / `@invariant`）；
3. 函数体一律 `throw notImplemented('<batch>', '<Class>.<method>')`；
4. 文件已存在且首行**不是** `@generated-skeleton` → 跳过（除非 `--force`）。

### 10.4 `scripts/gen-skeleton.mjs`
```js
loadManifest(path)                          → Result<SkeletonManifest>      // zod 校验 schemaVersion + 必填字段
renderFile(file, ctx)                       → Result<string>                // 纯函数，同输入必同输出
writeAll(manifest, { root, batch?, force })  → Result<{ written[], skipped[] }> // skipped 含原因 code
markProgress(progressPath, batch, state, files) → Result<void>              // 同步 doc/progress.json
```
```bash
node scripts/gen-skeleton.mjs --manifest doc/skeleton.manifest.json --root .            # 全量渲染
node scripts/gen-skeleton.mjs --manifest ... --batch B2                                 # 只渲染某批
node scripts/gen-skeleton.mjs --manifest ... --verify                                   # 只校验不写（CI 用）
node scripts/gen-skeleton.mjs --manifest ... --mark B5 done                             # 更新进度台账
```
约束：**幂等**（连跑两次结果字节一致）；`--force` 仅允许作用于仍带 `@generated-skeleton` 的文件。

### 10.5 `scripts/gen-api-surface.mjs`（上下文预算的关键）
```js
scan(root)                                  → Result<FileSurface[]>         // 只读 src/**/*.js
extractSurface(source, path)                → Result<ClassSurface>          // 导出名 + JSDoc 签名 + 是否仍 notImplemented
renderMarkdown(surfaces, progress)          → string                        // 按 layer 分组，标注 [skeleton]/[impl]
```
```bash
node scripts/gen-api-surface.mjs --root src --progress doc/progress.json --out doc/api-surface.md
```
> 产出物只含"签名 + 一句话职责 + 状态"，**绝不含实现体**。它是下一轮生成唯一允许携带的既有代码信息。

### 10.6 `doc/progress.json`（进度台账）
```jsonc
{
  "updatedAt": "2026-11-21T00:00:00Z",
  "batches": [
    { "id": "B5", "state": "partial",
      "files": { "src/main/core/task-machine.js": { "state": "impl", "classes": { "TaskMachine": "impl" } } } }
  ]
}
```
`state` 三态：`todo`（骨架未渲染）/ `skeleton`（空实现）/ `impl`（已实现）。由 `gen-api-surface` 读、由 `gen-skeleton --mark` 写，禁止手改以减少漂移。

### 10.7 批次表（按依赖拓扑，每批必须独立可验收）
| 批 | 内容 | 文件量 | 行数预算 | 验收（进下一批的门槛） |
|---|---|---|---|---|
| B0 | 骨架全量渲染 + ESLint 依赖方向规则落地 | ~90 | 骨架不计 | `npm run check && npm run lint` 全绿 |
| B1 | `libs/contracts` typedef + `libs/schemas` zod + `libs/utils` | ~15 | 600 | 单测：坏帧/坏状态被 schema 拒绝 |
| B2 | infra 基础：frame-codec / atomic / file-store / journal / snapshot / trace / audit / redaction | ~8 | 500 | 断电力：torn write 不污染既有 journal |
| B3 | Playwright worker 侧 7 文件（session/parser/assembler/frame-io/login/shot/worker-main） | 7 | 500 | 真起 chromium，登录 smoke 通过 |
| B4 | `runtime/worker-guard` + `bridges/playwright-bridge` | 2 | 300 | 强杀 worker 能重建；坏帧不崩主进程 |
| B5 | `core/task-machine` + `state/state-store` + repositories + registries + `config-resolver` | ~12 | 500 | 状态机全转移表单测；无模块可绕过 StateStore |
| B6 | `core/engine` + `scheduler` + `site-queue` | 3 | 500 | 单站点严格串行、两站点并发、预留不死锁 |
| B7 | `model-io` 3 件 + `conference` 4 件 | 7 | 500 | 畸形输出 20 次 ≥18 次救回或正确降级 |
| B8 | `git` 3 件 + `sandbox` 2 件 + `checks`（含 providers 首批） | ~15 | 700（拆 B8a/B8b） | 无票执行被拒、票据重放被拒、多语言诊断归一 |
| B9 | `ipc` + `bootstrap` + `renderer`（api 层优先） | ~20 | 700（拆 B9a/B9b） | 全链路一次人工确认跑通 |

> 行数预算只是"预估上限"；`B8`/`B9` 天然超 500，**必须再拆 a/b 两批**，不允许一次做完。

### 10.8 每批作业循环（六步，缺一步不许进下一批）
1. **读**：`doc/api-surface.md` 中本批相关切片 + `doc/progress.json` + 本批目标（三者合计 ≤ 200 行）。
2. **读**：仅本批要改文件"已实现部分"的接口段（用 `Grep` 取签名，不读全文）。
3. **写**：实现 1–2 个类，`Edit` 替换 `notImplemented` 行，删掉 `@generated-skeleton` 行。
4. **验**：`npm run check && npm run lint && npx vitest run test/<本批>`；失败不许"下一批顺带修"。
5. **刷新**：`node scripts/gen-api-surface.mjs ...`；`node scripts/gen-skeleton.mjs --mark <批> done`。
6. **提交**：`git commit -m "feat(Bx): <批名>"`（一批一 commit，回滚单元 = 批）。

### 10.9 上下文预算规则（防"规模大"的唯一手段）
- 单轮允许携带的材料**最多 3 份**：api-surface 切片、progress 相关段、本批 1–2 个待改文件。
- **禁止**重读已实现文件的完整源码；信息只经 `api-surface.md` 传递。
- 单轮输出**禁止贴整文件代码**；回复只报"文件清单 + 验收结论 + 失败项"。
- 跨批交接只靠两个文件：`api-surface.md`（我能读到什么）+ `progress.json`（我做到哪了）。

### 10.10 反模式（写进 CLAUDE.md / 贡献指南）
1. 一轮生成 >2 个类 → 必然截断或降质。
2. 无脑重写已实现文件 → 覆盖人手改动；只允许 `Edit`。
3. 不用脚本、靠对话搬运文件 → 上下文与文件系统双份漂移。
4. `--force` 覆盖已删 skeleton 头的文件 → 摧毁实现。
5. 跳过 lint 进下一批 → 错误在上游固化，后面每批都在补丁上打补丁。
6. 在回复里贴超过 10 行代码 → 挤掉真正需要的上下文预算。

### 10.11 目录小文件治理
- 不足 40 行的独立文件：若与父模块同职责则合并（如 `repositories/task.js` 仅 3 个方法可并入 `repositories/index.js`）；
- **但类边界不合并**：类 = 测试单元 = 契约单元，宁可文件多也不要一个文件两个类（`worker-guard` 与 `process-policy` 例外，允许同目录分文件）。
