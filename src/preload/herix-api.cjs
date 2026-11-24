/**
 * Preload（必须 .cjs）：ESM 的 preload 在 Electron 里不被支持，且 `sandbox:true` 下只能用 CommonJS。
 * 唯一职责：把固定通道的调用能力挂到 `window.herix`，**不暴露 ipcRenderer 本身**。
 * 通道名必须与 `src/libs/contracts/channels.js` 完全一致（由 test 静态比对保证）。
 * @module preload/herix-api
 */
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = {
  APP_INFO: 'app:info',
  STATE_SNAPSHOT: 'state:snapshot',
  TASK_SUBMIT: 'task:submit',
  TASK_APPROVE: 'task:approve',
  SITE_TICK: 'site:tick',
  SITE_LIST: 'site:list',
  PROJECT_OPEN: 'project:open',
  PROJECT_CLOSE: 'project:close',
  CHECK_RUN: 'check:run',
  COMMAND_APPROVE: 'command:approve',
  COMMAND_PENDING: 'command:pending',
  CONFIG_RELOAD: 'config:reload',
};

/** 只允许调用白名单内的通道 */
const call = (channel, payload) => {
  if (!Object.values(CHANNELS).includes(channel)) {
    return Promise.reject(new Error(`非法通道：${channel}`));
  }
  return ipcRenderer.invoke(channel, payload);
};

/** 统一信封解包：成功返 value，失败抛带 code 的错误（renderer 的 api 层不用重复判 ok） */
const unwrap = async (channel, payload) => {
  const env = await call(channel, payload);
  if (env && env.ok) return env.value;
  const e = new Error(env?.error?.message ?? `调用 ${channel} 失败`);
  e.code = env?.error?.code ?? 'E_UNKNOWN';
  e.detail = env?.error?.detail;
  e.traceId = env?.traceId;
  throw e;
};

contextBridge.exposeInMainWorld('herix', {
  app: {
    info: () => unwrap(CHANNELS.APP_INFO),
  },
  state: {
    snapshot: () => unwrap(CHANNELS.STATE_SNAPSHOT),
  },
  task: {
    submit: (input) => unwrap(CHANNELS.TASK_SUBMIT, input),
    approve: (input) => unwrap(CHANNELS.TASK_APPROVE, input),
  },
  site: {
    list: () => unwrap(CHANNELS.SITE_LIST),
    tick: (input) => unwrap(CHANNELS.SITE_TICK, input),
  },
  project: {
    open: (input) => unwrap(CHANNELS.PROJECT_OPEN, input),
    close: (input) => unwrap(CHANNELS.PROJECT_CLOSE, input),
  },
  check: {
    run: (input) => unwrap(CHANNELS.CHECK_RUN, input),
  },
  command: {
    approve: (input) => unwrap(CHANNELS.COMMAND_APPROVE, input),
    pending: () => unwrap(CHANNELS.COMMAND_PENDING),
  },
  config: {
    reload: (input) => unwrap(CHANNELS.CONFIG_RELOAD, input),
  },
  /** 运行时能力探测，UI 用来隐藏不可用入口 */
  capabilities: { channels: Object.values(CHANNELS) },
});
