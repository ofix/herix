/**
 * 应用装配入口。设计原则：**所有依赖注入**，本文件不 import electron（除入口 main()）。
 * 理由：① 让装配逻辑可单测（不需要 Electron 运行时）② 打包后唯一变化点是路径（asar）。
 * 启动顺序：单实例锁 → 路径 → 存储 → 领域服务 → IPC
 * @module main/bootstrap
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ok, err } from "../libs/utils/result.js";
import { ERROR_CODE } from "../libs/utils/errors.js";
import { CHANNEL } from "../libs/contracts/channels.js";
import { FileStore } from "./infra/storage/file-store.js";
import { StateStore } from "./core/state/state-store.js";
import { TaskRepository } from "./core/state/repositories/task.js";
import { SkillRegistry } from "./core/registry/skill-registry.js";
import { SiteQueue } from "./core/site-queue.js";
import { Scheduler } from "./core/scheduler.js";
import { Engine } from "./core/engine.js";
import { Gateway } from "./ipc/gateway.js";
import { ProjectManager } from "./git/project-manager.js";
import { CommandPolicy } from "./sandbox/command-policy.js";
import { CommandRunner } from "./sandbox/command-runner.js";
import { CheckRegistry } from "./checks/registry.js";
import { CheckService } from "./checks/service.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));

export async function bootstrap(deps) {
  // ① 单实例：多开会让两份进程同时写 state，必须挡在最前
  // 注意：requestSingleInstanceLock 返回 true 表示当前进程获得锁（是主进程）
  // 返回 false 表示已有实例（当前是副进程），应退出
  const isPrimary = deps.app.requestSingleInstanceLock();
  if (!isPrimary) {
    console.warn("[Herix] 检测到已有实例运行，当前副进程退出。");
    deps.app.quit();
    return err(ERROR_CODE.STORE_IO, "已有实例在运行，本进程退出");
  }

  console.log("[Herix] Bootstrap step 1: Initializing paths and stores...");
  const userDataRoot = path.join(deps.app.getPath("userData"), "herix");
  const paths = resolvePaths(userDataRoot, deps.app.resourcesPath, HERE);

  // 调试日志：确认路径是否正确
  console.log("[Herix] Paths:", {
    data: paths.data,
    preload: paths.preload,
    packaged: paths.packaged,
  });

  const store = new FileStore(paths.data);
  const repositories = { tasks: new TaskRepository(store) };
  const stateStore = new StateStore({ repositories });

  // ② 领域服务
  console.log("[Herix] Bootstrap step 2: Loading skills and engine...");
  const skills = new SkillRegistry();
  await hydrateSkills(skills, paths.skills);
  const siteQueue = new SiteQueue();
  const scheduler = new Scheduler();
  const engine = new Engine({
    stateStore,
    scheduler,
    siteQueue,
    skills,
    runner: makeRunnerStub(), // 真实现由 bridges/playwright-bridge 在窗口就绪后注入
  });

  console.log("[Herix] Bootstrap step 3: Initializing projects and checks...");
  const projects = new ProjectManager({ root: paths.worktrees });
  const policy = new CommandPolicy({});
  const runner = new CommandRunner({ policy });
  const checks = new CheckService({
    registry: new CheckRegistry(),
    policy,
    runner,
  });

  // ③ IPC
  console.log("[Herix] Bootstrap step 4: Setting up IPC Gateway...");
  const gateway = new Gateway({
    ipcMain: deps.ipcMain,
    handlers: buildHandlers({
      engine,
      projects,
      checks,
      policy,
      stateStore,
      skills,
      paths,
    }),
  });
  const install = gateway.install();
  if (!install.ok) {
    console.error("[Herix] IPC Installation failed:", install.error);
    return install;
  }

  return ok({
    ctx: {
      paths,
      stateStore,
      engine,
      projects,
      checks,
      policy,
      skills,
    },
    gateway,
    dispose: async () => {
      await gateway.dispose();
      await hydrateOnExit(stateStore);
    },
  });
}

/**
 * @param {string} userDataRoot
 * @param {string|undefined} resourcesPath
 * @param {string} here
 */
function resolvePaths(userDataRoot, resourcesPath, here) {
  const appRoot = path.resolve(here, "../.."); // src/main → 项目根
  const res = String(resourcesPath ?? "");
  const packaged = res !== "";
  // ✅ 新增：通过环境变量或 app.isPackaged 判断是否为开发模式
  // electron-vite / vite-plugin-electron 等工具会自动注入 VITE_DEV_SERVER_URL
  const isDev = !packaged && !!process.env.VITE_DEV_SERVER_URL;
  return {
    data: userDataRoot,
    worktrees: path.join(userDataRoot, "worktrees"),
    changesets: path.join(userDataRoot, "changesets"),
    skills: packaged ? path.join(res, "skills") : path.join(appRoot, "resources/skills"),
    sites: packaged ? path.join(res, "sites") : path.join(appRoot, "resources/sites"),
    workerEntry: packaged
      ? path.join(res, "app.asar.unpacked", "src/workers/playwright-worker/main.js")
      : path.join(appRoot, "src/workers/playwright-worker/main.js"),
    preload: packaged
      ? path.join(res, "app.asar.unpacked", "src/preload/herix-api.cjs")
      : path.join(appRoot, "src/preload/herix-api.cjs"),
    packaged,
    isDev, // ✅ 暴露给外部
    devServerUrl: process.env.VITE_DEV_SERVER_URL, // ✅ 如 http://localhost:5173
  };
}

/** @param {{engine:any, projects:any, checks:any, policy:any, stateStore:any, skills:any, paths:any}} s */
function buildHandlers({ engine, projects, checks, policy, stateStore, skills, paths }) {
  return {
    [CHANNEL.APP_INFO]: {
      fn: () => ({ paths, version: "0.9.0", providers: 8 }),
    },
    [CHANNEL.STATE_SNAPSHOT]: { fn: () => stateStore.get("tasks") },
    [CHANNEL.TASK_SUBMIT]: {
      schema: z.object({
        projectId: z.string().min(3),
        skillId: z.string().min(1),
        prompt: z.string().min(1).max(20000),
        priority: z.number().int().min(0).max(9).optional(),
      }),
      fn: async p =>
        engine.submitTask(
          { traceId: "trc_ipc", actor: "renderer" },
          { ...p, candidates: skills.candidates?.(p.skillId) ?? [] }
        ),
    },
    [CHANNEL.TASK_APPROVE]: {
      schema: z.object({
        taskId: z.string().regex(/^tsk_[0-9a-f]{8}$/),
        decision: z.enum(["approve", "reject"]),
        note: z.string().max(2000).optional(),
      }),
      fn: async p => engine.approveTask({ traceId: "trc_ipc", actor: "renderer" }, p),
    },
    [CHANNEL.PROJECT_OPEN]: {
      schema: z.object({
        projectId: z.string().min(3),
        repoPath: z.string().min(1),
        baseRef: z.string().optional(),
      }),
      fn: p => projects.open(p),
    },
    [CHANNEL.PROJECT_CLOSE]: {
      schema: z.object({
        projectId: z.string().min(3),
        removeWorktree: z.boolean().optional(),
      }),
      fn: p =>
        projects.close(p.projectId, {
          removeWorktree: p.removeWorktree,
        }),
    },
    [CHANNEL.CHECK_RUN]: {
      schema: z.object({
        files: z.array(z.string()).min(1),
        worktreePath: z.string().min(1),
        worktreeHash: z.string().min(1),
        providerIds: z.array(z.string()).optional(),
      }),
      fn: p => checks.run(p),
    },
    [CHANNEL.COMMAND_APPROVE]: {
      schema: z.object({
        cmd: z.string(),
        args: z.array(z.string()),
        cwd: z.string(),
        worktreeHash: z.string(),
        approver: z.string().min(1),
        scope: z.enum(["single", "batch"]).optional(),
      }),
      fn: p => policy.issue(p),
    },
    [CHANNEL.COMMAND_PENDING]: { fn: () => policy.pending() },
    [CHANNEL.SITE_LIST]: { fn: () => [] },
    [CHANNEL.SITE_TICK]: {
      fn: () => err(ERROR_CODE.WORKER_DOWN, "需要 PlaywrightWorker 注入后才能 tick"),
    },
  };
}

/** @param {any} skills @param {string} dir */
async function hydrateSkills(skills, dir) {
  // 动态导入避免循环依赖或过早初始化
  const { FileStore } = await import("./infra/storage/file-store.js");
  const s = new FileStore(dir);
  const r = await s.list("*.json").catch(() => ({ ok: false, value: [] }));
  const metas = [];
  for (const f of /** @type {any} */ (r).ok ? /** @type {any} */ (r).value : []) {
    const t = await s.readText(f);
    if (!t.ok || !t.value) continue;
    try {
      metas.push(JSON.parse(t.value));
    } catch (e) {
      console.warn(`[Herix] Failed to parse skill meta ${f}:`, e);
    }
  }
  if (metas.length) skills.loadAll(metas);
}

/** @param {any} store */
async function hydrateOnExit(store) {
  if (store.set) {
    store.set("intent", {});
  }
}

/** 未注入真 runner 前的占位：显式失败而不是静默糊弄 */
function makeRunnerStub() {
  return {
    sendTask: async () => err(ERROR_CODE.WORKER_DOWN, "PlaywrightWorker 尚未就绪"),
  };
}

/**
 * Electron 入口（唯一 import electron 的地方）。
 * @returns {Promise<void>}
 */
export async function main() {
  console.log("[Herix] Main process starting...");
  const electron = await import("electron");
  const { app, ipcMain, BrowserWindow } = electron;

  const r = await bootstrap({ app, ipcMain });
  if (!r.ok) {
    console.error("[Herix] Bootstrap failed:", r.error);
    app.quit();
    return;
  }
  const { ctx } = r.value;

  // ✅ 窗口创建严格放在 whenReady 内部
  app.whenReady().then(async () => {
    console.log("[Herix] App is ready. Creating window...");

    // 防止 Mac 上重复创建窗口
    if (BrowserWindow.getAllWindows().length > 0) {
      return;
    }

    const win = new BrowserWindow({
      width: 1280,
      height: 860,
      webPreferences: {
        preload: ctx.paths.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    console.log(ctx.paths);

    // ✅ 核心改动：开发环境连 DevServer，生产环境加载本地文件
    if (ctx.paths.isDev && ctx.paths.devServerUrl) {
      console.log("[Herix] DEV mode → loading from:", ctx.paths.devServerUrl);
      await win.loadURL(ctx.paths.devServerUrl);
      win.webContents.openDevTools({ mode: "detach" });
    } else {
      const preloadDir = path.dirname(ctx.paths.preload);
      const htmlPath = path.normalize(path.join(preloadDir, "../../build/index.html"));
      console.log("[Herix] PROD mode → loading file:", htmlPath);
      try {
        await win.loadFile(htmlPath);
      } catch (error) {
        console.error("[Herix] Failed to load index.html:", error);
        win.loadURL(`data:text/html,<h1>Failed to load index.html</h1><p>${error.message}</p>`);
      }
    }

    win.on("closed", () => console.log("[Herix] Window closed"));
  });

  // macOS 特有行为：点击 Dock 图标时重新激活窗口
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      // 如果没有窗口，重新创建一个（逻辑同上，建议提取为 createWindow 函数）
      console.log(
        "[Herix] Activate event triggered, but no windows. Re-creating logic needed if supported."
      );
      // 这里简单处理：如果需要在 activate 时重建窗口，需复用上面的创建逻辑
    } else {
      // 聚焦现有窗口
      BrowserWindow.getAllWindows()[0].focus();
    }
  });

  // 所有窗口关闭时退出应用 (Windows/Linux)
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}

main().catch(console.error);
