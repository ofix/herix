/**
 * IPC 通道名：主进程与 preload 的唯一约定。
 * 前缀规则 `<域>:<动作>`，只允许这里出现的名字注册 handle，避免 renderer 拿到任意 channel 权限。
 * @module libs/contracts/channels
 */
export const CHANNEL = Object.freeze({
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
});

/** @type {readonly string[]} */
export const CHANNEL_LIST = Object.freeze(Object.values(CHANNEL));
